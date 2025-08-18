# Effect Integration

DynamicFlow is built from the ground up on Effect, making it the first AI orchestration framework to leverage Effect's powerful functional programming primitives. The Flow API provides workflow-specific operations that enhance Effect with AI orchestration capabilities.

## Why Effect for AI Orchestration

### The Problem with Traditional Approaches

Most AI frameworks use imperative programming patterns that lead to:

- **Unpredictable error handling** - Thrown exceptions and uncaught promises
- **Resource leaks** - No automatic cleanup of connections, files, or memory
- **Composition difficulties** - Hard to combine operations reliably
- **Testing challenges** - Side effects make testing complex
- **Type safety gaps** - Runtime errors from type mismatches

### The DynamicFlow Solution

DynamicFlow's Flow API builds on Effect to provide workflow-specific operations:

```typescript
// Traditional imperative approach
async function processUser(userId: string): Promise<ProcessedUser> {
  try {
    const user = await fetchUser(userId) // Might throw
    if (!user) throw new Error('User not found') // Manual error handling
    
    const validated = validateUser(user) // Might throw
    const processed = await processData(validated) // Might throw
    
    await logActivity(userId, 'processed') // Fire and forget - might fail silently
    return processed
  } catch (error) {
    // Error handling becomes complex with nested operations
    console.error('Processing failed:', error)
    throw error
  }
}

// DynamicFlow functional approach using Flow API
const processUserFlow = (userId: string) =>
  pipe(
    Effect.succeed(userId),
    Flow.andThen(fetchUserEffect),
    Flow.andThen(validateUserEffect),
    Flow.andThen(processDataEffect),
    Flow.tap(processed => logActivityEffect(userId, 'processed')),
    Flow.catchAll(error => 
      pipe(
        logErrorEffect(error),
        Flow.andThen(() => Effect.fail(error))
      )
    )
  )
```

## Core Effect Concepts in DynamicFlow

### Effect Type Signature

Every operation in DynamicFlow returns an `Effect.Effect<A, E, R>`:

- `A` - **Success type**: What the operation produces on success
- `E` - **Error type**: What errors can occur  
- `R` - **Requirements**: What dependencies/context are needed

```typescript
// Tool execution returns typed Effect
const weatherTool: Tool<WeatherInput, WeatherOutput> = {
  execute: (input, context): Effect.Effect<WeatherOutput, ToolError, NetworkService> =>
    pipe(
      makeHttpRequest(`/weather?city=${input.city}`),
      Effect.map(response => ({
        temperature: response.temp,
        conditions: response.weather,
        humidity: response.humidity
      })),
      Effect.catchAll(error => 
        Effect.fail(new ToolError({
          toolId: 'fetchWeather',
          cause: error.message,
          retryable: error.retryable
        }))
      )
    )
}
```

### Flow API: Enhanced Composition

DynamicFlow's Flow API provides workflow-specific operations built on Effect:

```typescript
// Complex workflow composition using Flow API
const userOnboardingFlow = pipe(
  Effect.succeed(registrationData),
  
  // Sequential operations with Flow
  Flow.andThen(validateRegistrationData),
  Flow.andThen(createUserAccount),
  
  // Parallel operations with Flow
  Flow.andThen(account => 
    Flow.parallel({
      emailSent: sendWelcomeEmail(account.email),
      profileCreated: createUserProfile(account.id),
      preferencesSet: setDefaultPreferences(account.id)
    })
  ),
  
  // Error handling with Flow
  Flow.catchAll(error =>
    error._tag === 'ValidationError'
      ? pipe(
          logValidationError(error),
          Flow.andThen(() => Effect.succeed({ 
            success: false, 
            error: 'Validation failed' 
          }))
        )
      : Effect.fail(error)
  ),
  
  // Tap for side effects
  Flow.tap(() => cleanupResources())
)
```

## Effect-Based Tool System

### Tool Definition with Effects

Tools are pure functions that return Effects:

```typescript
const databaseTool = Tools.createTool({
  id: 'queryDatabase',
  name: 'Database Query Tool',
  description: 'Execute SQL queries with connection management',
  inputSchema: S.Struct({
    query: S.String,
    parameters: S.Array(S.Unknown)
  }),
  outputSchema: S.Struct({
    rows: S.Array(S.Record(S.String, S.Unknown)),
    rowCount: S.Number
  }),
  execute: (input, context): Effect.Effect<QueryResult, DatabaseError, DatabaseService> =>
    pipe(
      // Acquire connection from pool
      Effect.serviceFunction(DatabaseService)(service => service.getConnection()),
      
      // Execute query
      Effect.flatMap(connection =>
        pipe(
          executeQuery(connection, input.query, input.parameters),
          Effect.ensuring(releaseConnection(connection)) // Always release
        )
      ),
      
      // Handle specific database errors
      Effect.catchTag('ConnectionError', error =>
        Effect.fail(new DatabaseError({
          cause: 'Database connection failed',
          retryable: true,
          context: { query: input.query }
        }))
      ),
      
      Effect.catchTag('QueryError', error =>
        Effect.fail(new DatabaseError({
          cause: `Query failed: ${error.message}`,
          retryable: false,
          context: { query: input.query, parameters: input.parameters }
        }))
      )
    )
})
```

### Environment and Dependency Injection

Effect's environment system provides type-safe dependency injection:

```typescript
// Define service interfaces
interface EmailService {
  sendEmail: (to: string, subject: string, body: string) => Effect.Effect<EmailResult, EmailError>
}

interface DatabaseService {
  query: <T>(sql: string, params: unknown[]) => Effect.Effect<T[], DatabaseError>
}

interface LoggingService {
  log: (level: string, message: string, context?: Record<string, unknown>) => Effect.Effect<void>
}

// Create service tags
const EmailService = Context.GenericTag<EmailService>('EmailService')
const DatabaseService = Context.GenericTag<DatabaseService>('DatabaseService')  
const LoggingService = Context.GenericTag<LoggingService>('LoggingService')

// Tool that uses multiple services
const userNotificationTool = Tools.createTool({
  id: 'notifyUser',
  name: 'User Notification Tool',
  description: 'Send notifications to users via email with database logging',
  inputSchema: S.Struct({
    userId: S.String,
    message: S.String,
    urgent: S.Boolean
  }),
  outputSchema: S.Struct({
    sent: S.Boolean,
    notificationId: S.String
  }),
  execute: (input, context): Effect.Effect<
    NotificationResult, 
    EmailError | DatabaseError | LoggingError,
    EmailService | DatabaseService | LoggingService
  > =>
    Effect.gen(function* () {
      // Access services from environment
      const emailService = yield* EmailService
      const dbService = yield* DatabaseService
      const logger = yield* LoggingService
      
      // Get user email from database
      const users = yield* dbService.query(
        'SELECT email FROM users WHERE id = ?',
        [input.userId]
      )
      
      if (users.length === 0) {
        return yield* Effect.fail(new UserNotFoundError(input.userId))
      }
      
      const userEmail = users[0].email
      
      // Send email
      const emailResult = yield* emailService.sendEmail(
        userEmail,
        input.urgent ? 'URGENT: Notification' : 'Notification',
        input.message
      )
      
      // Log notification
      yield* logger.log('info', 'Notification sent', {
        userId: input.userId,
        notificationId: emailResult.messageId,
        urgent: input.urgent
      })
      
      // Store in database
      yield* dbService.query(
        'INSERT INTO notifications (user_id, message_id, sent_at) VALUES (?, ?, ?)',
        [input.userId, emailResult.messageId, new Date().toISOString()]
      )
      
      return {
        sent: true,
        notificationId: emailResult.messageId
      }
    })
})
```

## Error Handling with Effect

### Typed Error Channels

Effect's error channel provides type-safe error handling:

```typescript
// Define specific error types
class ValidationError extends Error {
  readonly _tag = 'ValidationError'
  constructor(public field: string, public reason: string) {
    super(`Validation failed for ${field}: ${reason}`)
  }
}

class NetworkError extends Error {
  readonly _tag = 'NetworkError'
  constructor(public cause: string, public retryable: boolean = true) {
    super(`Network error: ${cause}`)
  }
}

class BusinessLogicError extends Error {
  readonly _tag = 'BusinessLogicError'
  constructor(public rule: string, public context: Record<string, unknown>) {
    super(`Business rule violation: ${rule}`)
  }
}

// Flow with comprehensive error handling
const orderProcessingFlow = pipe(
  Effect.succeed(orderData),
  
  Effect.flatMap(validateOrder), // Can fail with ValidationError
  Effect.flatMap(checkInventory), // Can fail with NetworkError
  Effect.flatMap(processPayment), // Can fail with NetworkError
  Effect.flatMap(validateBusinessRules), // Can fail with BusinessLogicError
  
  // Handle specific error types
  Effect.catchTag('ValidationError', error =>
    pipe(
      logError('Validation failed', { field: error.field, reason: error.reason }),
      Effect.zipRight(Effect.succeed({
        success: false,
        error: 'validation',
        message: error.message,
        field: error.field
      }))
    )
  ),
  
  Effect.catchTag('NetworkError', error =>
    error.retryable
      ? pipe(
          logError('Network error, retrying', { cause: error.cause }),
          Effect.zipRight(
            pipe(
              Effect.sleep(Duration.seconds(5)),
              Effect.zipRight(orderProcessingFlow) // Retry entire flow
            )
          )
        )
      : pipe(
          logError('Network error, not retryable', { cause: error.cause }),
          Effect.zipRight(Effect.succeed({
            success: false,
            error: 'network',
            message: 'Service temporarily unavailable'
          }))
        )
  ),
  
  Effect.catchTag('BusinessLogicError', error =>
    pipe(
      logError('Business rule violation', { rule: error.rule, context: error.context }),
      Effect.zipRight(Effect.succeed({
        success: false,
        error: 'business_rule',
        message: error.message,
        rule: error.rule
      }))
    )
  )
)
```

### Error Recovery Patterns

Effect enables sophisticated error recovery:

```typescript
// Fallback chains
const resilientDataFetch = pipe(
  primaryDataSource(),
  Effect.catchAll(() => secondaryDataSource()),
  Effect.catchAll(() => cachedDataSource()),
  Effect.catchAll(() => Effect.succeed(defaultData))
)

// Retry with backoff
const retryWithBackoff = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  maxAttempts: number = 3
): Effect.Effect<A, E, R> => {
  const retry = (attempt: number): Effect.Effect<A, E, R> =>
    pipe(
      effect,
      Effect.catchAll(error => 
        attempt < maxAttempts
          ? pipe(
              Effect.sleep(Duration.millis(Math.pow(2, attempt) * 1000)),
              Effect.flatMap(() => retry(attempt + 1))
            )
          : Effect.fail(error)
      )
    )
  
  return retry(1)
}

// Circuit breaker pattern
const createCircuitBreaker = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  failureThreshold: number = 5,
  timeoutDuration: Duration.Duration = Duration.minutes(1)
) => {
  let failures = 0
  let lastFailureTime = 0
  
  return pipe(
    Effect.sync(() => {
      const now = Date.now()
      if (failures >= failureThreshold && 
          now - lastFailureTime < Duration.toMillis(timeoutDuration)) {
        return Effect.fail(new Error('Circuit breaker open'))
      }
      return effect
    }),
    Effect.flatten,
    Effect.tap(() => Effect.sync(() => { failures = 0 })), // Reset on success
    Effect.catchAll(error => 
      pipe(
        Effect.sync(() => {
          failures++
          lastFailureTime = Date.now()
        }),
        Effect.zipRight(Effect.fail(error))
      )
    )
  )
}
```

## Resource Management

### Automatic Resource Cleanup

Effect provides automatic resource management:

```typescript
// Database connection with automatic cleanup
const withDatabaseConnection = <A, E>(
  operation: (connection: DatabaseConnection) => Effect.Effect<A, E>
): Effect.Effect<A, E | DatabaseError, DatabaseService> =>
  pipe(
    Effect.serviceFunction(DatabaseService)(service => service.acquireConnection()),
    Effect.flatMap(connection =>
      pipe(
        operation(connection),
        Effect.ensuring(
          pipe(
            Effect.serviceFunction(DatabaseService)(service => 
              service.releaseConnection(connection)
            ),
            Effect.catchAll(error => 
              // Log cleanup failure but don't propagate
              logError('Failed to release connection', { error })
            )
          )
        )
      )
    )
  )

// File operations with cleanup
const withFileHandle = <A, E>(
  filePath: string,
  operation: (handle: FileHandle) => Effect.Effect<A, E>
): Effect.Effect<A, E | FileError> =>
  pipe(
    openFile(filePath),
    Effect.flatMap(handle =>
      pipe(
        operation(handle),
        Effect.ensuring(closeFile(handle))
      )
    )
  )

// HTTP client with connection pooling
const withHttpClient = <A, E>(
  operation: (client: HttpClient) => Effect.Effect<A, E>
): Effect.Effect<A, E | NetworkError, HttpClientService> =>
  pipe(
    Effect.serviceFunction(HttpClientService)(service => service.getClient()),
    Effect.flatMap(client =>
      pipe(
        operation(client),
        Effect.ensuring(
          Effect.serviceFunction(HttpClientService)(service =>
            service.returnClient(client)
          )
        )
      )
    )
  )
```

### Scope Management

Effect's scope system manages resource lifecycles:

```typescript
// Long-running workflow with multiple resources
const complexWorkflow = Effect.scoped(
  Effect.gen(function* () {
    // Acquire resources that will be automatically cleaned up
    const dbConnection = yield* Effect.serviceFunction(DatabaseService)(
      service => service.acquireConnection()
    )
    
    const redisConnection = yield* Effect.serviceFunction(RedisService)(
      service => service.acquireConnection()  
    )
    
    const s3Client = yield* Effect.serviceFunction(S3Service)(
      service => service.getClient()
    )
    
    // Use resources for complex operations
    const userData = yield* queryUserData(dbConnection)
    const cachedData = yield* getCachedData(redisConnection, userData.id)
    const fileData = yield* downloadFile(s3Client, userData.documentPath)
    
    // Process data
    const processedResult = yield* processUserDocuments(
      userData,
      cachedData,
      fileData
    )
    
    // Store results
    yield* storeResults(dbConnection, processedResult)
    yield* updateCache(redisConnection, processedResult)
    yield* uploadProcessedFile(s3Client, processedResult.outputFile)
    
    return processedResult
    
    // All resources automatically cleaned up on success or failure
  })
)
```

## Parallelism and Concurrency

### Safe Parallel Execution

Effect provides safe concurrent operations:

```typescript
// Parallel data fetching with proper error handling
const gatherUserData = (userId: string) =>
  Effect.all({
    profile: fetchUserProfile(userId),
    orders: fetchUserOrders(userId),
    preferences: fetchUserPreferences(userId),
    analytics: fetchUserAnalytics(userId)
  }, { concurrency: 4 }) // Limit concurrent operations

// Parallel with different error handling strategies
const gatherDataWithFallbacks = (userId: string) =>
  Effect.all({
    // Critical data - must succeed
    profile: fetchUserProfile(userId),
    
    // Optional data - provide fallbacks
    orders: pipe(
      fetchUserOrders(userId),
      Effect.catchAll(() => Effect.succeed([]))
    ),
    
    preferences: pipe(
      fetchUserPreferences(userId),
      Effect.catchAll(() => Effect.succeed(defaultPreferences))
    ),
    
    // Analytics can fail silently
    analytics: pipe(
      fetchUserAnalytics(userId),
      Effect.catchAll(() => Effect.succeed(null))
    )
  })
```

### Work Distribution

Effect enables sophisticated work distribution patterns:

```typescript
// Queue-based work distribution
const processWorkQueue = <A, B, E>(
  items: ReadonlyArray<A>,
  processor: (item: A) => Effect.Effect<B, E>,
  concurrency: number = 10
): Effect.Effect<ReadonlyArray<B>, E> =>
  pipe(
    Effect.all(
      items.map(processor),
      { concurrency }
    )
  )

// Streaming work processing
const processStreamingWork = <A, B, E>(
  source: Stream.Stream<A, E>,
  processor: (item: A) => Effect.Effect<B, E>,
  concurrency: number = 10
): Stream.Stream<B, E> =>
  pipe(
    source,
    Stream.mapEffect(processor, { concurrency })
  )

// Work stealing pattern
const processWithWorkStealing = <A, B, E>(
  workItems: ReadonlyArray<A>,
  processor: (item: A) => Effect.Effect<B, E>,
  workers: number = 4
): Effect.Effect<ReadonlyArray<B>, E> => {
  const chunks = chunkArray(workItems, Math.ceil(workItems.length / workers))
  
  return pipe(
    Effect.all(
      chunks.map(chunk =>
        Effect.all(chunk.map(processor))
      )
    ),
    Effect.map(results => results.flat())
  )
}
```

## Testing with Effect

### Pure Testing

Effect enables pure, deterministic testing:

```typescript
import { describe, it, expect } from 'vitest'
import { Effect, Layer, Context } from 'effect'

// Mock services for testing
const MockEmailService = Layer.succeed(
  EmailService,
  {
    sendEmail: (to, subject, body) => 
      Effect.succeed({
        messageId: 'mock-123',
        delivered: true
      })
  }
)

const MockDatabaseService = Layer.succeed(
  DatabaseService,
  {
    query: (sql, params) =>
      Effect.succeed([
        { id: '1', email: 'test@example.com', name: 'Test User' }
      ])
  }
)

const MockLogService = Layer.succeed(
  LoggingService,
  {
    log: (level, message, context) => Effect.void
  }
)

// Test environment
const TestEnvironment = Layer.merge(
  Layer.merge(MockEmailService, MockDatabaseService),
  MockLogService
)

describe('User Notification Tool', () => {
  it('should send notification successfully', async () => {
    const result = await pipe(
      userNotificationTool.execute(
        { userId: '1', message: 'Hello!', urgent: false },
        mockContext
      ),
      Effect.provide(TestEnvironment),
      Effect.runPromise
    )
    
    expect(result.sent).toBe(true)
    expect(result.notificationId).toBe('mock-123')
  })
  
  it('should handle user not found error', async () => {
    const FailingDatabaseService = Layer.succeed(
      DatabaseService,
      {
        query: () => Effect.succeed([]) // No users found
      }
    )
    
    const FailingEnvironment = Layer.merge(
      Layer.merge(MockEmailService, FailingDatabaseService),
      MockLogService
    )
    
    const exit = await pipe(
      userNotificationTool.execute(
        { userId: '999', message: 'Hello!', urgent: false },
        mockContext
      ),
      Effect.provide(FailingEnvironment),
      Effect.runPromiseExit
    )
    
    expect(exit._tag).toBe('Failure')
    expect(exit.error).toBeInstanceOf(UserNotFoundError)
  })
})
```

### Property-Based Testing

Effect integrates well with property-based testing:

```typescript
import { Effect } from 'effect'
import { property, string, integer, boolean } from 'fast-check'

describe('Order Processing Properties', () => {
  it('should always return valid order ID format', async () => {
    await property(
      string({ minLength: 1 }),
      integer({ min: 1, max: 1000 }),
      boolean(),
      async (customerId, amount, isPriority) => {
        const result = await pipe(
          processOrder({ customerId, amount, isPriority }),
          Effect.provide(TestEnvironment),
          Effect.runPromise
        )
        
        // Order ID should always match expected format
        expect(result.orderId).toMatch(/^ORD-\d{8}-[A-Z0-9]{6}$/)
        expect(result.amount).toBe(amount)
        expect(result.customerId).toBe(customerId)
      }
    )
  })
})
```

## Summary: Flow API vs Raw Effect

### When to Use Flow API (Recommended)

Use DynamicFlow's Flow operations for:
- **Building AI workflows** - Flow.andThen, Flow.parallel, Flow.map
- **Tool composition** - Flow.tool, Flow.switchRoute
- **Error handling in workflows** - Flow.catchAll, Flow.retry
- **Workflow-specific patterns** - Flow.doIf, Flow.forEach

```typescript
// ✅ Recommended: Use Flow API for workflows
const workflowExample = pipe(
  Effect.succeed(initialData),
  Flow.andThen(processStep1),
  Flow.parallel({ 
    branch1: processBranch1,
    branch2: processBranch2 
  }),
  Flow.catchAll(handleWorkflowError)
)
```

### When to Use Raw Effect

Use raw Effect operations for:
- **Low-level utilities** - Helper functions, pure transformations
- **Effect library integration** - When using Effect ecosystem libraries
- **Custom operators** - Building new Flow operations
- **Performance-critical code** - Direct Effect usage can be more efficient

```typescript
// ✅ Use raw Effect for utilities and low-level code
const utilityFunction = (data: Data): Effect.Effect<Result, Error> =>
  pipe(
    Effect.try(() => parseData(data)),
    Effect.flatMap(validate),
    Effect.map(transform)
  )
```

### Key Principle

**Flow API is for workflows, Effect is for utilities.** DynamicFlow's Flow API provides workflow-specific operations that make AI orchestration patterns clearer and more maintainable, while still giving you full access to Effect's power when needed.

Effect integration makes DynamicFlow uniquely powerful among AI orchestration frameworks, providing functional programming benefits while maintaining the flexibility needed for dynamic workflow generation. This foundation ensures your AI workflows are reliable, composable, and maintainable at scale.

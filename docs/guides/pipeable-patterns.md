# Pipeable Patterns Guide

DynamicFlow's pipeable API enables functional composition of workflows using Effect.js. This guide explores advanced patterns and best practices for building robust, maintainable flows.

## Table of Contents

- [Core Piping Concepts](#core-piping-concepts)
- [Sequential Composition](#sequential-composition)
- [Parallel Execution](#parallel-execution)
- [Conditional Logic](#conditional-logic)
- [Error Handling Patterns](#error-handling-patterns)
- [Resource Management](#resource-management)
- [Advanced Composition](#advanced-composition)
- [Performance Optimisation](#performance-optimisation)
- [Testing Pipeable Flows](#testing-pipeable-flows)

## Core Piping Concepts

### The Pipe Function

The `pipe` function enables left-to-right function composition, making code more readable and maintainable:

```typescript
import { pipe, Flow, Effect } from '@jambudipa/dynamic-flow'

// Sequential operations using pipe
const dataProcessingFlow = pipe(
  Effect.succeed(rawData),           // Start with initial data
  Flow.andThen(validateInput),       // Validate the input
  Flow.map(transformData),           // Transform the data
  Flow.tap(logResult),               // Log without changing value
  Flow.catchAll(handleError)         // Handle any errors
)
```

### Effect Composition

Every pipeable operation returns an `Effect.Effect<A, E, R>` where:
- `A` is the success type
- `E` is the error type  
- `R` is the required environment/context

```typescript
// Type-safe composition
const typedFlow: Effect.Effect<ProcessedData, ValidationError | NetworkError, DatabaseService> = pipe(
  Effect.succeed(input),
  Flow.andThen(validateWithDatabase),  // May fail with ValidationError
  Flow.andThen(fetchFromAPI),          // May fail with NetworkError
  Flow.map(transformResult)            // Pure transformation
)
```

## Sequential Composition

### Basic Sequential Operations

Use `Flow.andThen` for operations that depend on previous results:

```typescript
const userRegistrationFlow = pipe(
  Effect.succeed(registrationData),
  
  // Step 1: Validate input
  Flow.andThen(data => 
    validateRegistrationData(data)
  ),
  
  // Step 2: Check if user exists
  Flow.andThen(validData => 
    checkUserExists(validData.email)
  ),
  
  // Step 3: Create account
  Flow.andThen(({ userData, exists }) => 
    exists 
      ? Effect.fail(new UserExistsError())
      : createUserAccount(userData)
  ),
  
  // Step 4: Send welcome email
  Flow.andThen(account => 
    sendWelcomeEmail(account.email, account.name)
  ),
  
  // Step 5: Return success response
  Flow.map(emailResult => ({
    success: true,
    userId: emailResult.userId,
    message: 'Registration completed successfully'
  }))
)
```

### Accumulating Results

When you need to preserve intermediate results:

```typescript
const orderProcessingFlow = pipe(
  Effect.succeed(orderData),
  
  // Validate and keep original data
  Flow.andThen(order => 
    Effect.all({
      original: Effect.succeed(order),
      validated: validateOrder(order)
    })
  ),
  
  // Calculate pricing and keep previous results
  Flow.andThen(({ original, validated }) =>
    Effect.all({
      original: Effect.succeed(original),
      validated: Effect.succeed(validated),
      pricing: calculatePricing(validated)
    })
  ),
  
  // Process payment and accumulate
  Flow.andThen(({ original, validated, pricing }) =>
    Effect.all({
      original: Effect.succeed(original),
      validated: Effect.succeed(validated),
      pricing: Effect.succeed(pricing),
      payment: processPayment(pricing.total)
    })
  ),
  
  // Create final result
  Flow.map(({ original, validated, pricing, payment }) => ({
    orderId: payment.transactionId,
    originalData: original,
    finalPrice: pricing.total,
    status: 'completed'
  }))
)
```

### Building Complex Pipelines

For complex business processes, break them into focused sub-flows:

```typescript
// Sub-flows for each major step
const validateOrderFlow = (order: OrderData) => pipe(
  Effect.succeed(order),
  Flow.andThen(validateOrderData),
  Flow.andThen(checkInventory),
  Flow.andThen(validatePaymentMethod)
)

const fulfillmentFlow = (validOrder: ValidatedOrder) => pipe(
  Effect.succeed(validOrder),
  Flow.andThen(reserveInventory),
  Flow.andThen(calculateShipping),
  Flow.andThen(createShipment)
)

const notificationFlow = (completedOrder: CompletedOrder) => pipe(
  Effect.succeed(completedOrder),
  Flow.parallel({
    customerEmail: sendCustomerConfirmation(completedOrder),
    internalNotification: notifyFulfillmentTeam(completedOrder),
    analyticsEvent: trackOrderEvent(completedOrder)
  })
)

// Main flow combines sub-flows
const completeOrderFlow = pipe(
  Effect.succeed(orderRequest),
  Flow.andThen(validateOrderFlow),
  Flow.andThen(fulfillmentFlow),
  Flow.andThen(notificationFlow),
  Flow.map(({ customerEmail, internalNotification, analyticsEvent }) => ({
    success: true,
    confirmationSent: customerEmail.sent,
    trackingNumber: analyticsEvent.trackingNumber
  }))
)
```

## Parallel Execution

### Basic Parallel Operations

Use `Flow.parallel` to execute independent operations concurrently:

```typescript
const dataAggregationFlow = pipe(
  Effect.succeed(userId),
  
  Flow.andThen(id => 
    Flow.parallel({
      profile: fetchUserProfile(id),
      orders: fetchUserOrders(id),
      preferences: fetchUserPreferences(id),
      recommendations: fetchRecommendations(id)
    }, { concurrency: 4 })
  ),
  
  Flow.map(({ profile, orders, preferences, recommendations }) => ({
    user: {
      ...profile,
      totalOrders: orders.length,
      preferences,
      recommendedProducts: recommendations.slice(0, 5)
    }
  }))
)
```

### Controlled Concurrency

Limit concurrent operations to manage resource usage:

```typescript
const batchProcessingFlow = pipe(
  Effect.succeed(largeDataset),
  
  // Process in batches of 10 with max 3 concurrent
  Flow.forEach(
    item => processDataItem(item),
    { concurrency: 3 }
  ),
  
  // Aggregate results
  Flow.map(results => ({
    processed: results.length,
    successful: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length
  }))
)
```

### Parallel with Different Shapes

When parallel operations return different types:

```typescript
const dashboardDataFlow = pipe(
  Effect.succeed(userContext),
  
  Flow.andThen(context => 
    Flow.parallel({
      // Different return types
      metrics: fetchMetrics(context.userId),      // MetricsData
      alerts: fetchAlerts(context.teamId),       // AlertData[]
      tasks: fetchTasks(context.userId),         // TaskData[]
      notifications: fetchNotifications(context.userId) // NotificationData[]
    })
  ),
  
  // Type-safe access to different result types
  Flow.map(({ metrics, alerts, tasks, notifications }) => ({
    dashboard: {
      summary: {
        totalTasks: tasks.length,
        unreadAlerts: alerts.filter(a => !a.read).length,
        performance: metrics.performance
      },
      recentActivity: [
        ...tasks.slice(0, 5),
        ...notifications.slice(0, 5)
      ].sort((a, b) => b.timestamp - a.timestamp)
    }
  }))
)
```

### Mixed Sequential and Parallel

Combine sequential and parallel patterns for complex workflows:

```typescript
const reportGenerationFlow = pipe(
  Effect.succeed(reportRequest),
  
  // Step 1: Validate request (sequential)
  Flow.andThen(validateReportRequest),
  
  // Step 2: Fetch data in parallel
  Flow.andThen(validRequest => 
    Flow.parallel({
      salesData: fetchSalesData(validRequest.dateRange),
      customerData: fetchCustomerData(validRequest.regions),
      inventoryData: fetchInventoryData(validRequest.products)
    }, { concurrency: 3 })
  ),
  
  // Step 3: Process data sequentially (order matters)
  Flow.andThen(({ salesData, customerData, inventoryData }) => pipe(
    Effect.succeed({ salesData, customerData, inventoryData }),
    Flow.andThen(aggregateData),
    Flow.andThen(calculateMetrics),
    Flow.andThen(formatForReport)
  )),
  
  // Step 4: Generate outputs in parallel
  Flow.andThen(reportData => 
    Flow.parallel({
      pdfReport: generatePDFReport(reportData),
      excelReport: generateExcelReport(reportData),
      emailSummary: generateEmailSummary(reportData)
    })
  )
)
```

## Conditional Logic

### Simple Conditional Execution

Use `Flow.doIf` for branching logic:

```typescript
const paymentProcessingFlow = pipe(
  Effect.succeed(paymentRequest),
  
  Flow.andThen(validatePaymentData),
  
  Flow.doIf(
    payment => payment.amount > 1000,
    {
      onTrue: payment => pipe(
        // High-value payment path
        Effect.succeed(payment),
        Flow.andThen(requireManagerApproval),
        Flow.andThen(processHighValuePayment),
        Flow.andThen(notifyRiskTeam)
      ),
      onFalse: payment => pipe(
        // Standard payment path
        Effect.succeed(payment),
        Flow.andThen(processStandardPayment)
      )
    }
  )
)
```

### Complex Conditional Logic

For multiple conditions, use nested or chained conditionals:

```typescript
const userAccessFlow = pipe(
  Effect.succeed(accessRequest),
  
  Flow.andThen(validateAccessRequest),
  
  // First condition: User role
  Flow.doIf(
    request => request.user.role === 'admin',
    {
      onTrue: request => Effect.succeed({ ...request, accessLevel: 'full' }),
      onFalse: request => 
        // Nested condition: User department
        Flow.doIf(
          req => req.user.department === 'finance',
          {
            onTrue: req => Effect.succeed({ ...req, accessLevel: 'financial' }),
            onFalse: req => 
              // Another nested condition: User tier
              Flow.doIf(
                r => r.user.tier === 'premium',
                {
                  onTrue: r => Effect.succeed({ ...r, accessLevel: 'premium' }),
                  onFalse: r => Effect.succeed({ ...r, accessLevel: 'basic' })
                }
              )(Effect.succeed(req))
          }
        )(Effect.succeed(request))
    }
  ),
  
  Flow.andThen(({ user, accessLevel }) => 
    grantAccess(user.id, accessLevel)
  )
)
```

### Pattern Matching with Switch

For multiple discrete options, use a switch-like pattern:

```typescript
const contentProcessingFlow = pipe(
  Effect.succeed(uploadedFile),
  
  Flow.andThen(file => {
    switch (file.type) {
      case 'image':
        return pipe(
          Effect.succeed(file),
          Flow.andThen(validateImageFile),
          Flow.andThen(resizeImage),
          Flow.andThen(optimiseImage),
          Flow.andThen(generateThumbnails)
        )
      
      case 'video':
        return pipe(
          Effect.succeed(file),
          Flow.andThen(validateVideoFile),
          Flow.andThen(transcodeVideo),
          Flow.andThen(extractThumbnails),
          Flow.andThen(generatePreview)
        )
      
      case 'document':
        return pipe(
          Effect.succeed(file),
          Flow.andThen(validateDocument),
          Flow.andThen(extractText),
          Flow.andThen(generateIndex),
          Flow.andThen(createPreview)
        )
      
      default:
        return Effect.fail(new UnsupportedFileTypeError(file.type))
    }
  })
)
```

## Error Handling Patterns

### Graceful Error Recovery

Use `Flow.catchAll` for comprehensive error handling:

```typescript
const resilientApiFlow = pipe(
  Effect.succeed(apiRequest),
  
  Flow.andThen(makeApiCall),
  
  // Catch all errors and provide fallbacks
  Flow.catchAll(error => {
    if (error instanceof NetworkError) {
      // Network issues: try cached data
      return getCachedData(apiRequest.key)
    } else if (error instanceof RateLimitError) {
      // Rate limited: wait and retry
      return pipe(
        Effect.sleep(Duration.seconds(5)),
        Flow.andThen(() => makeApiCall(apiRequest))
      )
    } else if (error instanceof AuthError) {
      // Auth issues: refresh token and retry
      return pipe(
        refreshAuthToken(),
        Flow.andThen(newToken => makeApiCall({ ...apiRequest, token: newToken }))
      )
    } else {
      // Unknown error: return error state
      return Effect.succeed({
        success: false,
        error: error.message,
        fallbackUsed: true
      })
    }
  })
)
```

### Selective Error Handling

Use `Flow.catchTag` to handle specific error types:

```typescript
const dataValidationFlow = pipe(
  Effect.succeed(inputData),
  
  Flow.andThen(validateData),
  
  // Handle validation errors specifically
  Flow.catchTag('ValidationError', error => {
    console.log('Validation failed:', error.details)
    return Effect.succeed({
      valid: false,
      errors: error.details,
      suggestions: generateSuggestions(error.details)
    })
  }),
  
  // Handle database errors differently
  Flow.catchTag('DatabaseError', error => {
    console.error('Database error:', error.message)
    return Effect.succeed({
      valid: false,
      errors: ['Database temporarily unavailable'],
      retryAfter: Duration.minutes(5)
    })
  }),
  
  // Let other errors bubble up
  Flow.andThen(result => 
    result.valid 
      ? processValidData(result.data)
      : Effect.succeed(result)
  )
)
```

### Error Recovery with Retries

Combine error handling with retry logic:

```typescript
const robustServiceCall = pipe(
  Effect.succeed(serviceRequest),
  
  Flow.andThen(callExternalService),
  
  // Retry with exponential backoff
  Flow.retry({
    times: 3,
    delay: Duration.seconds(1),
    backoff: 'exponential'
  }),
  
  // If retries fail, provide fallback
  Flow.catchAll(error => {
    console.warn('Service call failed after retries:', error.message)
    return getFallbackData(serviceRequest)
  }),
  
  // Always ensure we have a result
  Flow.map(result => ({
    ...result,
    timestamp: Date.now(),
    fromFallback: result.fallback === true
  }))
)
```

## Resource Management

### Automatic Resource Cleanup

Use Effect's resource management for automatic cleanup:

```typescript
const databaseOperationFlow = pipe(
  // Acquire database connection
  acquireDatabaseConnection(),
  
  Flow.andThen(connection => pipe(
    Effect.succeed(connection),
    
    // Use connection for multiple operations
    Flow.andThen(conn => beginTransaction(conn)),
    Flow.andThen(transaction => 
      Flow.parallel({
        users: insertUsers(transaction, userData),
        audit: insertAuditLog(transaction, auditData),
        notifications: queueNotifications(transaction, notificationData)
      })
    ),
    Flow.andThen(results => commitTransaction(transaction)),
    
    // Connection is automatically closed even if operations fail
    Flow.tap(() => releaseConnection(connection))
  )),
  
  Flow.catchAll(error => {
    console.error('Database operation failed:', error)
    return Effect.succeed({ success: false, error: error.message })
  })
)
```

### File Operations with Cleanup

```typescript
const fileProcessingFlow = pipe(
  Effect.succeed(filePath),
  
  // Open file handle
  Flow.andThen(path => openFile(path)),
  
  Flow.andThen(fileHandle => pipe(
    Effect.succeed(fileHandle),
    
    // Process file in chunks
    Flow.andThen(handle => readFileContents(handle)),
    Flow.andThen(contents => validateFileFormat(contents)),
    Flow.andThen(validContents => transformContents(validContents)),
    Flow.andThen(transformed => writeToOutputFile(transformed)),
    
    // Always close file handle
    Flow.tap(() => closeFile(fileHandle))
  )),
  
  Flow.catchAll(error => {
    console.error('File processing failed:', error)
    return Effect.succeed({ processed: false, error: error.message })
  })
)
```

## Advanced Composition

### Higher-Order Flow Functions

Create reusable flow patterns:

```typescript
// Generic retry wrapper
const withRetry = <A, E, R>(
  retryConfig: { times: number; delay: Duration.Duration }
) => (
  flow: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> => pipe(
  flow,
  Flow.retry(retryConfig)
)

// Generic timeout wrapper
const withTimeout = <A, E, R>(
  duration: Duration.Duration
) => (
  flow: Effect.Effect<A, E, R>
): Effect.Effect<A, E | 'TimeoutError', R> => pipe(
  flow,
  Flow.timeout(duration)
)

// Generic logging wrapper
const withLogging = <A, E, R>(
  label: string
) => (
  flow: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> => pipe(
  flow,
  Flow.tap(result => Effect.sync(() => 
    console.log(`${label} completed:`, result)
  )),
  Flow.catchAll(error => 
    pipe(
      Effect.sync(() => console.error(`${label} failed:`, error)),
      Flow.andThen(() => Effect.fail(error))
    )
  )
)

// Compose wrappers
const robustApiCall = pipe(
  makeApiCall(request),
  withTimeout(Duration.seconds(30)),
  withRetry({ times: 3, delay: Duration.seconds(1) }),
  withLogging('API Call')
)
```

### Flow Composition Patterns

```typescript
// Compose multiple flows into a pipeline
const createFlowPipeline = <A, B, C, D>(
  step1: (a: A) => Effect.Effect<B, any, any>,
  step2: (b: B) => Effect.Effect<C, any, any>,
  step3: (c: C) => Effect.Effect<D, any, any>
) => (input: A) => pipe(
  Effect.succeed(input),
  Flow.andThen(step1),
  Flow.andThen(step2),
  Flow.andThen(step3)
)

// Usage
const dataProcessingPipeline = createFlowPipeline(
  validateData,
  transformData,
  saveData
)

const result = await Flow.run(
  dataProcessingPipeline(rawData)
)
```

### Conditional Flow Composition

```typescript
// Conditional flow execution based on runtime conditions
const createConditionalFlow = <A, B>(
  condition: (a: A) => boolean,
  trueFlow: (a: A) => Effect.Effect<B, any, any>,
  falseFlow: (a: A) => Effect.Effect<B, any, any>
) => (input: A) => pipe(
  Effect.succeed(input),
  Flow.doIf(condition, {
    onTrue: trueFlow,
    onFalse: falseFlow
  })
)

// Usage
const userProcessingFlow = createConditionalFlow(
  user => user.isPremium,
  processPremiumUser,
  processStandardUser
)
```

## Performance Optimisation

### Batch Processing

```typescript
const batchProcessingFlow = pipe(
  Effect.succeed(largeDataset),
  
  // Split into chunks
  Flow.map(data => chunkArray(data, 100)),
  
  // Process chunks in parallel with controlled concurrency
  Flow.andThen(chunks => 
    Flow.forEach(
      chunk => processChunk(chunk),
      { concurrency: 5 }
    )
  ),
  
  // Flatten results
  Flow.map(results => results.flat()),
  
  // Final aggregation
  Flow.map(allResults => ({
    processed: allResults.length,
    successful: allResults.filter(r => r.success).length,
    errors: allResults.filter(r => !r.success).map(r => r.error)
  }))
)
```

### Caching Patterns

```typescript
const withCaching = <A, E, R>(
  cacheKey: string,
  ttl: Duration.Duration
) => (
  flow: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> => pipe(
  getCachedValue(cacheKey),
  Flow.catchAll(() => pipe(
    flow,
    Flow.tap(result => setCachedValue(cacheKey, result, ttl))
  ))
)

// Usage
const cachedUserDataFlow = pipe(
  fetchUserFromDatabase(userId),
  withCaching(`user:${userId}`, Duration.minutes(5))
)
```

### Memory-Efficient Streaming

```typescript
const streamingProcessingFlow = pipe(
  openDataStream(sourceFile),
  
  Flow.andThen(stream => 
    Stream.fromAsyncIterable(stream, error => 
      new StreamError(error.message)
    )
  ),
  
  // Process in chunks to avoid memory issues
  Flow.andThen(stream => 
    stream.pipe(
      Stream.chunks(1000),
      Stream.map(chunk => processChunk(chunk)),
      Stream.tap(result => writeToOutput(result)),
      Stream.runCollect
    )
  )
)
```

## Testing Pipeable Flows

### Unit Testing Individual Steps

```typescript
import { describe, it, expect } from 'vitest'
import { Flow, Effect } from '@jambudipa/dynamic-flow'

describe('Data Processing Steps', () => {
  it('should validate data correctly', async () => {
    const testData = { email: 'test@example.com', age: 25 }
    
    const result = await Flow.run(
      validateData(testData)
    )
    
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })
  
  it('should handle validation errors', async () => {
    const invalidData = { email: 'invalid', age: -5 }
    
    const exit = await Flow.runExit(
      validateData(invalidData)
    )
    
    expect(exit._tag).toBe('Failure')
    expect(exit.error).toBeInstanceOf(ValidationError)
  })
})
```

### Integration Testing Complete Flows

```typescript
describe('Complete User Registration Flow', () => {
  it('should handle successful registration', async () => {
    const registrationData = {
      email: 'newuser@example.com',
      name: 'New User',
      password: 'securepassword'
    }
    
    const result = await Flow.run(
      userRegistrationFlow(registrationData)
    )
    
    expect(result.success).toBe(true)
    expect(result.userId).toBeDefined()
    expect(result.message).toContain('Registration completed')
  })
  
  it('should handle existing user error', async () => {
    const existingUserData = {
      email: 'existing@example.com',
      name: 'Existing User',
      password: 'password'
    }
    
    const exit = await Flow.runExit(
      userRegistrationFlow(existingUserData)
    )
    
    expect(exit._tag).toBe('Failure')
    expect(exit.error).toBeInstanceOf(UserExistsError)
  })
})
```

### Testing Error Handling

```typescript
describe('Error Handling', () => {
  it('should recover from network errors', async () => {
    // Mock network failure
    const failingApiCall = Effect.fail(new NetworkError('Connection failed'))
    
    const resilientFlow = pipe(
      failingApiCall,
      Flow.catchAll(() => 
        Effect.succeed({ success: true, fromCache: true })
      )
    )
    
    const result = await Flow.run(resilientFlow)
    
    expect(result.success).toBe(true)
    expect(result.fromCache).toBe(true)
  })
})
```

### Testing Parallel Operations

```typescript
describe('Parallel Execution', () => {
  it('should execute operations concurrently', async () => {
    const startTime = Date.now()
    
    const parallelFlow = pipe(
      Effect.succeed('test'),
      Flow.andThen(() => 
        Flow.parallel({
          slow1: Effect.sleep(Duration.seconds(1)).pipe(
            Flow.andThen(() => Effect.succeed('result1'))
          ),
          slow2: Effect.sleep(Duration.seconds(1)).pipe(
            Flow.andThen(() => Effect.succeed('result2'))
          ),
          slow3: Effect.sleep(Duration.seconds(1)).pipe(
            Flow.andThen(() => Effect.succeed('result3'))
          )
        })
      )
    )
    
    const result = await Flow.run(parallelFlow)
    const duration = Date.now() - startTime
    
    // Should complete in ~1 second, not 3 seconds
    expect(duration).toBeLessThan(1500)
    expect(result.slow1).toBe('result1')
    expect(result.slow2).toBe('result2')
    expect(result.slow3).toBe('result3')
  })
})
```

## Best Practices Summary

1. **Use meaningful names** for flows and operations
2. **Keep flows focused** on single business processes
3. **Handle errors gracefully** with appropriate fallbacks
4. **Use parallel execution** for independent operations
5. **Implement timeouts** for external operations
6. **Add logging and monitoring** for production flows
7. **Test both success and failure paths** thoroughly
8. **Use type-safe schemas** for data validation
9. **Consider resource cleanup** for long-running operations
10. **Optimise for readability** over cleverness

The pipeable API provides powerful composition capabilities while maintaining type safety and error handling. By following these patterns, you can build robust, maintainable workflows that scale with your application's complexity.
# How-to Guide: DynamicFlow Implementation Patterns

*Focused instructions for competent users to accomplish specific tasks*

## Table of Contents

- [Flow Composition Patterns](#flow-composition-patterns)
- [Tool Development](#tool-development)
- [Dynamic Flow Generation](#dynamic-flow-generation)
- [Persistence and Suspension](#persistence-and-suspension)
- [LLM Integration](#llm-integration)
- [MCP Server Integration](#mcp-server-integration)
- [Error Handling](#error-handling)
- [Performance Optimization](#performance-optimization)
- [Production Deployment](#production-deployment)

## Flow Composition Patterns

### How to Chain Operations Sequentially

Use `Flow.andThen()` for sequential operations where each step depends on the previous:

```typescript
import { Flow } from '@jambudipa/dynamic-flow'
import { Effect, pipe } from 'effect'

const sequentialFlow = pipe(
  Effect.succeed(initialData),
  Flow.andThen(data => processStep1(data)),
  Flow.andThen(result => processStep2(result)),
  Flow.andThen(final => saveResult(final))
)
```

### How to Execute Operations in Parallel

Use `Effect.all()` with `Flow.andThen()` for parallel execution:

```typescript
const parallelFlow = pipe(
  Effect.succeed(inputData),
  Flow.andThen(data => 
    Effect.all([
      processA(data),
      processB(data),
      processC(data)
    ], { concurrency: 'unbounded' })
  ),
  Flow.map(([resultA, resultB, resultC]) => combineResults(resultA, resultB, resultC))
)
```

### How to Add Conditional Logic

Use conditional Effects within `Flow.andThen()`:

```typescript
const conditionalFlow = pipe(
  Effect.succeed(userData),
  Flow.andThen(user => 
    user.isAdmin 
      ? adminProcessing(user)
      : regularProcessing(user)
  ),
  Flow.map(result => finalizeResult(result))
)
```

### How to Handle Side Effects

Use `Flow.tap()` for side effects that don't change the data:

```typescript
const flowWithLogging = pipe(
  Effect.succeed(data),
  Flow.tap(data => 
    Effect.sync(() => console.log('Processing:', data.id))
  ),
  Flow.andThen(data => processData(data)),
  Flow.tap(result => 
    Effect.sync(() => logger.info('Completed', { result }))
  )
)
```

## Tool Development

### How to Create a Basic Tool

Define input/output schemas and implement the execute function:

```typescript
import { Tool } from '@jambudipa/dynamic-flow'
import { Schema, Effect } from 'effect'

const myTool: Tool<
  { param1: string; param2?: number },
  { result: string; metadata: Record<string, unknown> }
> = {
  id: 'my-tool',
  name: 'My Tool',
  description: 'Does something specific',
  inputSchema: Schema.Struct({
    param1: Schema.String,
    param2: Schema.optional(Schema.Number)
  }),
  outputSchema: Schema.Struct({
    result: Schema.String,
    metadata: Schema.Record(Schema.String, Schema.Unknown)
  }),
  execute: (input, context) => {
    // Your implementation
    return Effect.succeed({
      result: `Processed: ${input.param1}`,
      metadata: { timestamp: Date.now() }
    })
  }
}
```

### How to Create an Async Tool

Use `Effect.promise()` for async operations:

```typescript
const asyncTool: Tool<{ url: string }, { data: unknown }> = {
  id: 'async-api',
  name: 'Async API Tool',
  description: 'Calls external API',
  inputSchema: Schema.Struct({ url: Schema.String }),
  outputSchema: Schema.Struct({ data: Schema.Unknown }),
  execute: (input, context) => Effect.promise(async () => {
    const response = await fetch(input.url)
    const data = await response.json()
    return { data }
  })
}
```

### How to Add Tool Validation

Include validation in your tool implementation:

```typescript
const validatingTool: Tool<{ email: string }, { valid: boolean }> = {
  id: 'validator',
  name: 'Validating Tool',
  description: 'Validates input before processing',
  inputSchema: Schema.Struct({
    email: Schema.String.pipe(Schema.pattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/))
  }),
  outputSchema: Schema.Struct({ valid: Schema.Boolean }),
  execute: (input, context) => {
    // Additional validation if needed
    if (!input.email.includes('@')) {
      return Effect.fail(new Error('Invalid email format'))
    }
    return Effect.succeed({ valid: true })
  }
}
```

### How to Create Tool Registries

Organize tools into registries for better management:

```typescript
import { createRegistry } from '@jambudipa/dynamic-flow'

const myRegistry = createRegistry([
  weatherTool,
  emailTool,
  calculatorTool
])

// Use in flows
const result = await myRegistry.execute('weather-tool', { city: 'London' })
```

## Dynamic Flow Generation

### How to Generate Flows with AI

Use `DynamicFlow.execute()` for immediate execution:

```typescript
import { DynamicFlow } from '@jambudipa/dynamic-flow'
import { OpenAi } from '@effect/ai-openai'

const result = await DynamicFlow.execute({
  prompt: "Check weather in London and send summary email",
  tools: [weatherTool, emailTool],
  joins: [],
  model: OpenAi.completion({ model: 'gpt-5' })
})
```

### How to Generate and Inspect Flows

Use `DynamicFlow.generate()` to get the flow instance:

```typescript
const flowInstance = await DynamicFlow.generate({
  prompt: "Process customer orders and update inventory",
  tools: [orderTool, inventoryTool, notificationTool],
  joins: [],
  model: OpenAi.completion({ model: 'gpt-5' })
})

// Inspect the generated graph
console.log('Generated IR:', flowInstance.ir)

// Execute when ready
const result = await Effect.runPromise(flowInstance.runCollect({ orderId: '123' }))
```

### How to Provide Context to Dynamic Flows

Include relevant context in your prompt:

```typescript
const contextualPrompt = `
Context: User is a premium customer with ID ${userId}
Available budget: $${budget}
Previous orders: ${orderHistory.length}

Task: Process the following order and apply appropriate discounts:
${JSON.stringify(orderData)}
`

const result = await DynamicFlow.execute({
  prompt: contextualPrompt,
  tools: [orderTool, discountTool, paymentTool],
  joins: [],
  model: OpenAi.completion({ model: 'gpt-5' })
})
```

## Persistence and Suspension

### How to Set Up Filesystem Persistence

Create a persistence hub with filesystem backend:

```typescript
import { createPersistenceHub, BackendFactory } from '@jambudipa/dynamic-flow'
import { Effect, Duration } from 'effect'

const backend = await Effect.runPromise(
  BackendFactory.create({
    type: 'filesystem',
    config: { basePath: './flow-storage' }
  })
)

const hub = await Effect.runPromise(
  createPersistenceHub(backend, {
    enableEncryption: true,
    enableCompression: true,
    defaultTimeout: Duration.hours(24)
  })
)
```

### How to Create Approval Workflows

Use `AwaitInputPresets` for common approval patterns:

```typescript
import { AwaitInputPresets } from '@jambudipa/dynamic-flow'

const approvalTool = AwaitInputPresets.approval(
  'manager-approval',
  'Manager Approval Required',
  'This action requires manager approval'
)
.withTimeout(Duration.hours(4))
.withValidation(Schema.Struct({
  approved: Schema.Boolean,
  approvedBy: Schema.String,
  comments: Schema.optional(Schema.String)
}))
.build(hub)
```

### How to Handle Flow Suspension

Catch suspension signals and manage resumption:

```typescript
import { FlowSuspensionSignal } from '@jambudipa/dynamic-flow'

try {
  const result = await Effect.runPromise(myFlow)
  console.log('Flow completed:', result)
} catch (error) {
  if (error instanceof FlowSuspensionSignal) {
    console.log('Flow suspended:', error.suspensionKey)
    
    // Store suspension key for later resumption
    await storeSuspensionKey(error.suspensionKey, userId)
    
    // Resume later with user input
    const userInput = await getUserInput()
    const resumedResult = await Effect.runPromise(
      hub.resume(error.suspensionKey, userInput)
    )
  }
}
```

### How to Set Up PostgreSQL Persistence

Configure PostgreSQL backend for production:

```typescript
const postgresBackend = await Effect.runPromise(
  BackendFactory.create({
    type: 'postgres',
    config: {
      connectionString: process.env.DATABASE_URL,
      tableName: 'flow_suspensions',
      enableSsl: true
    }
  })
)

const hub = await Effect.runPromise(
  createPersistenceHub(postgresBackend, {
    enableEncryption: true,
    encryptionKey: process.env.ENCRYPTION_KEY,
    enableCompression: true
  })
)
```

## LLM Integration

### How to Configure OpenAI Integration

Set up OpenAI with custom configuration:

```typescript
import { LLMServiceLive } from '@jambudipa/dynamic-flow'
import { OpenAi } from '@effect/ai-openai'

const llmConfig = {
  apiKey: process.env.OPENAI_API_KEY,
  model: 'gpt-5',
  maxTokens: 2000,
  temperature: 0.7
}

const myFlow = pipe(
  // Your flow here
  Effect.provide(LLMServiceLive)
)
```

### How to Use LLM Tools in Flows

Create LLM-powered tools for text processing:

```typescript
const llmAnalyzer: Tool<
  { text: string; task: string },
  { analysis: string; confidence: number }
> = {
  id: 'llm-analyzer',
  name: 'LLM Text Analyzer',
  description: 'Analyze text using LLM',
  inputSchema: Schema.Struct({
    text: Schema.String,
    task: Schema.String
  }),
  outputSchema: Schema.Struct({
    analysis: Schema.String,
    confidence: Schema.Number
  }),
  execute: (input, context) => Effect.gen(function* (_) {
    const llm = yield* _(LLMService)
    const prompt = `Task: ${input.task}\nText: ${input.text}\nProvide analysis:`
    
    const response = yield* _(llm.completion({
      prompt,
      maxTokens: 500
    }))
    
    return {
      analysis: response.content,
      confidence: 0.85
    }
  })
}
```

### How to Implement Conversation Routing

Use `Flow.switchRoute()` for LLM-powered routing:

```typescript
const conversationFlow = pipe(
  Flow.succeed(userMessage),
  Flow.switchRoute(
    'Analyze user intent and route to appropriate handler',
    [weatherTool, calculatorTool, emailTool],
    {
      weather: (input) => handleWeatherRequest(input),
      calculation: (input) => handleCalculation(input),
      email: (input) => handleEmailRequest(input),
      general: (input) => handleGeneralQuery(input)
    }
  )
)
```

## MCP Server Integration

### How to Discover MCP Servers

Use the CLI to discover available servers:

```bash
# Discover from network
npx tsx src/lib/cli/mcp-discovery.ts discover --source network > servers.json

# Discover specific server
npx tsx src/lib/cli/mcp-discovery.ts discover \
  --source url \
  --filter "stdio://npx @modelcontextprotocol/server-filesystem /tmp"
```

### How to Generate MCP Tools

Generate TypeScript tools from discovered servers:

```bash
npx tsx src/lib/cli/mcp-discovery.ts generate \
  -i servers.json \
  -o src/generated/mcp-tools
```

### How to Use Generated MCP Tools

Import and use the generated tools with full type safety:

```typescript
import { read_file_tool, list_directory_tool } from '../generated/mcp-tools'

const fileFlow = pipe(
  list_directory_tool.execute({ path: '/home/user' }),
  Flow.andThen(files => {
    const textFiles = files.filter(f => f.name.endsWith('.txt'))
    return Effect.all(
      textFiles.map(file => 
        read_file_tool.execute({ path: file.path })
      )
    )
  }),
  Flow.map(contents => processTextFiles(contents))
)
```

## Error Handling

### How to Handle Tool Errors

Use Effect's error handling for graceful failures:

```typescript
const robustFlow = pipe(
  Effect.succeed(inputData),
  Flow.andThen(data => 
    myTool.execute(data, context)
      .pipe(
        Effect.catchAll(error => {
          console.error('Tool failed:', error)
          return Effect.succeed(fallbackResult)
        })
      )
  ),
  Flow.map(result => processResult(result))
)
```

### How to Implement Retry Logic

Add automatic retries for transient failures:

```typescript
import { Schedule } from 'effect'

const retryableFlow = pipe(
  Effect.succeed(requestData),
  Flow.andThen(data => 
    apiTool.execute(data, context)
      .pipe(
        Effect.retry(
          Schedule.exponential(Duration.seconds(1))
            .pipe(Schedule.intersect(Schedule.recurs(3)))
        )
      )
  )
)
```

### How to Create Custom Error Types

Define specific error types for better error handling:

```typescript
class DataValidationError extends Error {
  readonly _tag = 'DataValidationError'
  constructor(public field: string, public value: unknown) {
    super(`Invalid value for field ${field}: ${value}`)
  }
}

const validatingTool: Tool<{ email: string }, unknown> = {
  id: 'validator',
  name: 'Validating Tool',
  description: 'Validates input before processing',
  inputSchema: Schema.Struct({ email: Schema.String }),
  outputSchema: Schema.Unknown,
  execute: (input, context) => {
    if (!isValid(input.email)) {
      return Effect.fail(new DataValidationError('email', input.email))
    }
    return Effect.succeed(processedData)
  }
}
```

## Performance Optimization

### How to Optimize Parallel Execution

Use appropriate concurrency settings:

```typescript
// Limited concurrency for API calls
const apiFlow = pipe(
  Effect.succeed(dataList),
  Flow.andThen(list => 
    Effect.all(
      list.map(item => apiTool.execute(item, context)),
      { concurrency: 5 } // Limit to 5 concurrent requests
    )
  )
)

// Unbounded for CPU-bound tasks
const processingFlow = pipe(
  Effect.succeed(dataList),
  Flow.andThen(list => 
    Effect.all(
      list.map(item => processItem(item)),
      { concurrency: 'unbounded' }
    )
  )
)
```

### How to Cache Expensive Operations

Implement caching for repeated operations:

```typescript
const cachingTool: Tool<unknown, unknown> = {
  id: 'cached-api',
  name: 'Cached API Tool',
  description: 'API tool with built-in caching',
  inputSchema: Schema.Unknown,
  outputSchema: Schema.Unknown,
  execute: (input, context) => Effect.gen(function* (_) {
    const cacheKey = `api:${JSON.stringify(input)}`
    const cached = yield* _(getCachedResult(cacheKey))
    
    if (cached) {
      return cached
    }
    
    const result = yield* _(expensiveApiCall(input))
    yield* _(setCachedResult(cacheKey, result, Duration.minutes(15)))
    
    return result
  })
}
```

### How to Stream Large Results

Use streaming for large datasets:

```typescript
const streamingFlow = pipe(
  Effect.succeed(largeDataset),
  Flow.andThen(data => 
    Stream.fromIterable(data)
      .pipe(
        Stream.mapEffect(item => processItem(item)),
        Stream.buffer(100),
        Stream.runCollect
      )
  )
)
```

## Production Deployment

### How to Set Up Environment Configuration

Use environment variables for configuration:

```typescript
const config = {
  openaiApiKey: process.env.OPENAI_API_KEY!,
  databaseUrl: process.env.DATABASE_URL!,
  encryptionKey: process.env.ENCRYPTION_KEY!,
  logLevel: process.env.LOG_LEVEL || 'info',
  maxConcurrency: parseInt(process.env.MAX_CONCURRENCY || '10')
}

// Validate configuration
if (!config.openaiApiKey) {
  throw new Error('OPENAI_API_KEY is required')
}
```

### How to Set Up Logging

Implement structured logging:

```typescript
import { Logger } from 'effect'

const productionFlow = pipe(
  Effect.succeed(inputData),
  Flow.tap(data => 
    Logger.info('Flow started', { 
      flowId: context.requestId,
      dataSize: data.length 
    })
  ),
  Flow.andThen(data => processData(data)),
  Flow.tap(result => 
    Logger.info('Flow completed', { 
      flowId: context.requestId,
      resultSize: result.length 
    })
  )
)
```

### How to Monitor Flow Execution

Add metrics and monitoring:

```typescript
const monitoredFlow = pipe(
  Effect.succeed(inputData),
  Flow.tap(() => incrementMetric('flows.started')),
  Flow.andThen(data => 
    processData(data)
      .pipe(
        Effect.tapError(error => {
          incrementMetric('flows.failed')
          Logger.error('Flow failed', { error: error.message })
        })
      )
  ),
  Flow.tap(() => incrementMetric('flows.completed'))
)
```

### How to Handle Graceful Shutdown

Implement proper cleanup:

```typescript
process.on('SIGTERM', async () => {
  console.log('Received SIGTERM, shutting down gracefully')
  
  // Close persistence hub connections
  await hub.close()
  
  // Wait for ongoing flows to complete
  await waitForActiveFlows()
  
  process.exit(0)
})
```

These patterns provide the foundation for building robust, production-ready DynamicFlow applications. Each pattern can be adapted to your specific use case and combined with others for complex workflows.

# Tools API Reference

The Tools API provides a comprehensive system for creating, registering, and executing typed tools within DynamicFlow. Tools are the fundamental building blocks that enable AI systems to interact with external services, process data, and perform complex operations.

## Overview

Tools in DynamicFlow are type-safe, composable units of functionality that:
- Accept structured input validated by Effect Schema
- Return structured output with full type safety
- Handle errors gracefully through Effect's error channels
- Support configuration for timeouts, retries, and rate limiting
- Integrate seamlessly with LLM planning and execution

## Core Types

### `Tool<TInput, TOutput>`

The fundamental tool interface that defines a reusable, typed operation.

```typescript
interface Tool<TInput = unknown, TOutput = unknown> {
  id: string;
  name: string;
  description: string;
  category?: string;
  version?: string;
  inputSchema: Schema.Schema<TInput>;
  outputSchema: Schema.Schema<TOutput>;
  config?: ToolConfig;
  execute: (
    input: TInput,
    context: ExecutionContext
  ) => Effect.Effect<TOutput, ToolError, ToolRequirements>;
}
```

**Properties:**
- `id` - Unique identifier for the tool
- `name` - Human-readable name
- `description` - Detailed description for LLM planning
- `category` - Optional categorisation for organisation
- `version` - Tool version for compatibility tracking
- `inputSchema` - Effect Schema defining valid input structure
- `outputSchema` - Effect Schema defining output structure
- `config` - Runtime configuration (timeouts, retries, etc.)
- `execute` - Pure Effect implementation of tool logic

### `ToolConfig`

Configuration for tool execution behaviour.

```typescript
interface ToolConfig {
  timeout?: Duration.Duration;
  retry?: RetryConfig;
  rateLimit?: RateLimitConfig;
  requiresApproval?: boolean;
  cacheable?: boolean;
  cacheTTL?: Duration.Duration;
  concurrencyLimit?: number;
}
```

**Properties:**
- `timeout` - Maximum execution time
- `retry` - Retry policy for failed executions
- `rateLimit` - Rate limiting configuration
- `requiresApproval` - Whether tool requires human approval
- `cacheable` - Enable result caching
- `cacheTTL` - Cache expiration time
- `concurrencyLimit` - Maximum concurrent executions

### `ToolJoin<From, To>`

Type-safe data transformation between incompatible tool inputs/outputs.

```typescript
interface ToolJoin<From = unknown, To = unknown, R = never> {
  fromTool: string;
  toTool: string;
  transform: Schema.Schema<To, From, R>;
}
```

**Example:**
```typescript
const userToEmailJoin: ToolJoin<User, EmailInput> = {
  fromTool: 'getUser',
  toTool: 'sendEmail',
  transform: Schema.transform(
    Schema.Struct({ id: Schema.String, email: Schema.String, name: Schema.String }),
    Schema.Struct({ to: Schema.String, subject: Schema.String }),
    {
      strict: true,
      decode: (user) => ({
        to: user.email,
        subject: `Welcome ${user.name}`
      }),
      encode: (email) => ({
        id: 'unknown',
        email: email.to,
        name: email.subject.replace('Welcome ', '')
      })
    }
  )
}
```

## Tools Namespace

### `Tools.createTool<TInput, TOutput>(definition)`

Create a new tool with full type safety and runtime validation.

**Type Signature:**
```typescript
<TInput, TOutput>(
  definition: Omit<Tool<TInput, TOutput>, 'execute'> & {
    execute: (input: TInput, context: ExecutionContext) => 
      Effect.Effect<TOutput, ToolError, ToolRequirements>
  }
) => Tool<TInput, TOutput>
```

**Example:**
```typescript
import { Schema } from 'effect'
import { Tools } from '@jambudipa/dynamic-flow'
import { Effect, Duration } from 'effect'

const weatherTool = Tools.createTool({
  id: 'fetchWeather',
  name: 'Weather Fetcher',
  description: 'Fetch current weather conditions for a given city',
  category: 'weather',
  inputSchema: Schema.Struct({
    city: Schema.String,
    units: Schema.optional(Schema.Union(Schema.Literal('celsius'), Schema.Literal('fahrenheit')))
  }),
  outputSchema: Schema.Struct({
    temperature: Schema.Number,
    conditions: Schema.String,
    humidity: Schema.Number,
    windSpeed: Schema.Number
  }),
  config: {
    timeout: Duration.seconds(10),
    retry: {
      maxAttempts: 3,
      backoff: 'exponential',
      initialDelay: Duration.seconds(1)
    },
    cacheable: true,
    cacheTTL: Duration.minutes(5)
  },
  execute: (input, context) =>
    Effect.gen(function* () {
      const units = input.units || 'celsius'
      
      // Simulate API call
      const response = yield* Effect.promise(() =>
        fetch(`https://api.weather.com/v1/current?city=${input.city}&units=${units}`)
      )
      
      if (!response.ok) {
        return yield* Effect.fail(new ToolError({
          toolId: 'fetchWeather',
          cause: `Weather API returned ${response.status}`,
          retryable: response.status >= 500
        }))
      }
      
      const data = yield* Effect.promise(() => response.json())
      
      return {
        temperature: data.temp,
        conditions: data.weather,
        humidity: data.humidity,
        windSpeed: data.wind_speed
      }
    })
})
```

### `Tools.createLLMTool<TInput, TOutput>(config)`

Create an LLM-powered tool with structured input/output handling.

**Type Signature:**
```typescript
<TInput, TOutput>(config: {
  id: string;
  name: string;
  description: string;
  inputSchema: Schema.Schema<TInput>;
  outputSchema: Schema.Schema<TOutput>;
  systemPrompt?: string;
  llmConfig?: LLMConfig;
}) => Tool<TInput, TOutput>
```

**Example:**
```typescript
const analysisTool = Tools.createLLMTool({
  id: 'analyzeText',
  name: 'Text Analyzer',
  description: 'Analyze text content for sentiment, topics, and key insights',
  inputSchema: Schema.Struct({
    text: Schema.String,
    analysisType: Schema.Union(
      Schema.Literal('sentiment'),
      Schema.Literal('topics'), 
      Schema.Literal('summary')
    )
  }),
  outputSchema: Schema.Struct({
    analysis: Schema.String,
    confidence: Schema.Number,
    insights: Schema.Array(Schema.String)
  }),
  systemPrompt: `You are an expert text analyst. Provide detailed, accurate analysis based on the requested type.`,
  llmConfig: {
    model: 'gpt-5',
    temperature: 0.3,
    maxTokens: 1000
  }
})
```

### `Tools.wrapFunction<TInput, TOutput>(fn, schemas)`

Wrap an existing function as a tool with schema validation.

**Example:**
```typescript
// Existing function
async function calculateDistance(from: string, to: string): Promise<number> {
  // ... implementation
}

// Wrap as tool
const distanceTool = Tools.wrapFunction(
  calculateDistance,
  {
    id: 'calculateDistance',
    name: 'Distance Calculator',
    description: 'Calculate distance between two locations',
    inputSchema: Schema.Struct({
      from: Schema.String,
      to: Schema.String
    }),
    outputSchema: Schema.Number
  }
)
```

## Tool Registry

### `ToolRegistry`

Central registry for managing and discovering tools.

#### `createRegistry(tools?)`

Create a new tool registry with optional initial tools.

```typescript
import { createRegistry } from '@jambudipa/dynamic-flow'

const registry = createRegistry([weatherTool, analysisTool])
```

#### `registry.register(tool)`

Register a single tool in the registry.

```typescript
registry.register(weatherTool)
```

#### `registry.registerMany(tools)`

Register multiple tools at once.

```typescript
registry.registerMany([tool1, tool2, tool3])
```

#### `registry.get(id)`

Retrieve a tool by its ID.

```typescript
const tool = registry.get('fetchWeather')
if (tool) {
  console.log(`Found tool: ${tool.name}`)
}
```

#### `registry.getMany(ids)`

Retrieve multiple tools by their IDs.

```typescript
const tools = registry.getMany(['fetchWeather', 'analyzeText'])
console.log(`Retrieved ${tools.length} tools`)
```

#### `registry.findTools(criteria)`

Find tools matching specific criteria.

```typescript
// Find all weather-related tools
const weatherTools = registry.findTools({
  category: 'weather'
})

// Find tools by name pattern
const analysisTools = registry.findTools({
  namePattern: /analy/i
})

// Find tools with caching enabled
const cacheableTools = registry.findTools({
  cacheable: true
})
```

#### `registry.execute(toolId, input, context)`

Execute a tool directly through the registry.

```typescript
const result = await Effect.runPromise(
  registry.execute('fetchWeather', { city: 'London' }, executionContext)
)
```

### Global Registry

#### `getGlobalRegistry()`

Access the global tool registry shared across your application.

```typescript
import { getGlobalRegistry } from '@jambudipa/dynamic-flow'

const globalRegistry = getGlobalRegistry()
globalRegistry.register(myTool)
```

#### `resetGlobalRegistry()`

Reset the global registry (useful for testing).

```typescript
import { resetGlobalRegistry } from '@jambudipa/dynamic-flow'

// In test setup
beforeEach(() => {
  resetGlobalRegistry()
})
```

## Tool Execution

### Execution Context

Tools receive an `ExecutionContext` that provides access to runtime information and services.

```typescript
interface ExecutionContext {
  flowId: string;
  nodeId: string;
  variables: Map<string, unknown>;
  metadata: Record<string, unknown>;
  abortSignal?: AbortSignal;
  logger?: Logger;
}
```

**Properties:**
- `flowId` - Unique identifier for the current flow execution
- `nodeId` - Identifier for the current execution node
- `variables` - Flow state variables accessible to the tool
- `metadata` - Additional context metadata
- `abortSignal` - Signal for cancelling long-running operations
- `logger` - Structured logging interface

### Error Handling

Tools should handle errors through Effect's error channel using `ToolError`.

```typescript
class ToolError extends Error {
  constructor(config: {
    toolId: string;
    cause: string;
    retryable?: boolean;
    context?: Record<string, unknown>;
  })
}
```

**Example:**
```typescript
execute: (input, context) =>
  Effect.gen(function* () {
    try {
      const result = yield* riskyOperation(input)
      return result
    } catch (error) {
      return yield* Effect.fail(new ToolError({
        toolId: 'myTool',
        cause: error.message,
        retryable: error.status >= 500,
        context: { input, nodeId: context.nodeId }
      }))
    }
  })
```

## Advanced Patterns

### Composable Tools

```typescript
// Base HTTP tool
const httpTool = Tools.createTool({
  id: 'httpRequest',
  name: 'HTTP Request',
  // ... implementation
})

// Specialised API tool built on top
const apiTool = Tools.createTool({
  id: 'apiCall',
  name: 'API Call',
  execute: (input, context) =>
    pipe(
      httpTool.execute({
        url: `https://api.example.com/${input.endpoint}`,
        method: 'GET',
        headers: { 'Authorization': `Bearer ${input.token}` }
      }, context),
      Effect.map(response => response.data)
    )
})
```

### Conditional Tool Execution

```typescript
const conditionalTool = Tools.createTool({
  id: 'conditionalProcess',
  name: 'Conditional Processor',
  execute: (input, context) =>
    pipe(
      Effect.succeed(input),
      Flow.doIf(
        (data) => data.useAdvanced,
        {
          onTrue: (data) => advancedProcessor.execute(data, context),
          onFalse: (data) => basicProcessor.execute(data, context)
        }
      )
    )
})
```

### Tool Chains

```typescript
const chainedTool = Tools.createTool({
  id: 'dataProcessingChain',
  name: 'Data Processing Chain',
  execute: (input, context) =>
    pipe(
      validateTool.execute(input, context),
      Flow.andThen(validated => 
        transformTool.execute(validated, context)
      ),
      Flow.andThen(transformed => 
        enrichTool.execute(transformed, context)
      ),
      Flow.andThen(enriched => 
        outputTool.execute(enriched, context)
      )
    )
})
```

## Integration with Flow API

### Using Tools in Flows

```typescript
import { Flow, Tools } from '@jambudipa/dynamic-flow'
import { pipe } from 'effect'

const weatherFlow = pipe(
  Effect.succeed({ city: 'London' }),
  Flow.andThen(Tools.createTool(weatherTool)),
  Flow.map(weather => `Temperature: ${weather.temperature}°C`)
)
```

### Tool Joins in Flows

```typescript
const joinedFlow = pipe(
  getUserTool.execute(input, context),
  Flow.join(userToEmailJoin),
  Flow.andThen(emailTool.execute)
)
```

### Parallel Tool Execution

```typescript
const parallelFlow = pipe(
  Effect.succeed(input),
  Flow.parallel({
    weather: weatherTool.execute,
    news: newsTool.execute,
    stocks: stocksTool.execute
  })
)
```

## Best Practices

### Tool Design

1. **Keep tools focused:** Each tool should have a single, well-defined responsibility
2. **Use descriptive schemas:** Input/output schemas should be self-documenting
3. **Handle errors gracefully:** Always use Effect's error channel for failures
4. **Include metadata:** Provide rich descriptions for LLM planning
5. **Consider caching:** Enable caching for expensive, idempotent operations

### Schema Design

```typescript
// ✅ Good: Clear, specific schema
const inputSchema = Schema.Struct({
  userId: Schema.String.pipe(Schema.minLength(1)),
  includePreferences: Schema.Boolean,
  format: Schema.Union(Schema.Literal('json'), Schema.Literal('xml'))
})

// ❌ Avoid: Vague, unvalidated schema
const inputSchema = Schema.Struct({
  data: Schema.Unknown
})
```

### Error Handling

```typescript
// ✅ Good: Detailed error information
Effect.fail(new ToolError({
  toolId: 'fetchUser',
  cause: 'User not found',
  retryable: false,
  context: { userId: input.userId, timestamp: Date.now() }
}))

// ❌ Avoid: Generic error without context
Effect.fail(new Error('Something went wrong'))
```

### Configuration

```typescript
// ✅ Good: Thoughtful configuration
config: {
  timeout: Duration.seconds(30),     // Appropriate for network operations
  retry: {
    maxAttempts: 3,
    backoff: 'exponential',
    initialDelay: Duration.seconds(1)
  },
  cacheable: true,                   // Safe to cache results
  cacheTTL: Duration.minutes(5)      // Reasonable cache duration
}

// ❌ Avoid: Overly aggressive settings
config: {
  timeout: Duration.minutes(10),     // Too long for most operations
  retry: { maxAttempts: 20 }         // Too many retries
}
```

## Testing Tools

### Unit Testing

```typescript
import { describe, it, expect } from 'vitest'
import { Effect } from 'effect'

describe('WeatherTool', () => {
  it('should fetch weather data successfully', async () => {
    const input = { city: 'London' }
    const context = createMockContext()
    
    const result = await Effect.runPromise(
      weatherTool.execute(input, context)
    )
    
    expect(result.temperature).toBeTypeOf('number')
    expect(result.conditions).toBeTypeOf('string')
  })
  
  it('should handle API errors gracefully', async () => {
    const input = { city: 'InvalidCity' }
    const context = createMockContext()
    
    const exit = await Effect.runPromiseExit(
      weatherTool.execute(input, context)
    )
    
    expect(exit._tag).toBe('Failure')
    expect(exit.error).toBeInstanceOf(ToolError)
  })
})
```

### Integration Testing

```typescript
describe('Tool Registry Integration', () => {
  it('should execute tools through registry', async () => {
    const registry = createRegistry([weatherTool])
    const context = createMockContext()
    
    const result = await Effect.runPromise(
      registry.execute('fetchWeather', { city: 'London' }, context)
    )
    
    expect(result).toBeDefined()
  })
})
```

## Related APIs

- [Flow API](./flow.md) - Using tools within flows
- [DynamicFlow API](./dynamic-flow.md) - AI-generated tool orchestration
- [Schema API](./schema.md) - Defining tool input/output schemas
- [Error Handling](./errors.md) - Comprehensive error handling patterns

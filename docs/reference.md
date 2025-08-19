# Reference: DynamicFlow API Documentation

*Structured, factual resource with precise technical information*

## Table of Contents

- [Core API](#core-api)
- [Flow Operations](#flow-operations)
- [Tool System](#tool-system)
- [Dynamic Generation](#dynamic-generation)
- [Persistence](#persistence)
- [LLM Integration](#llm-integration)
- [MCP Integration](#mcp-integration)
- [Types and Interfaces](#types-and-interfaces)
- [Error Types](#error-types)
- [Configuration](#configuration)

## Core API

### Flow Namespace

The primary namespace for flow operations and execution.

#### `Flow.succeed(value: A): Effect<A>`

Creates an Effect that succeeds with the given value.

**Parameters:**
- `value: A` - The success value

**Returns:** `Effect<A>` - Effect that succeeds with the value

**Example:**
```typescript
const effect = Flow.succeed("hello")
```

#### `Flow.andThen<A, B>(f: (a: A) => Effect<B>): (effect: Effect<A>) => Effect<B>`

Chains Effects sequentially, passing the output of the first to the input of the second.

**Parameters:**
- `f: (a: A) => Effect<B>` - Function that takes the previous result and returns a new Effect

**Returns:** `(effect: Effect<A>) => Effect<B>` - Pipeable function

**Example:**
```typescript
pipe(
  Flow.succeed(5),
  Flow.andThen(n => Effect.succeed(n * 2))
)
```

#### `Flow.map<A, B>(f: (a: A) => B): (effect: Effect<A>) => Effect<B>`

Transforms the success value of an Effect.

**Parameters:**
- `f: (a: A) => B` - Transformation function

**Returns:** `(effect: Effect<A>) => Effect<B>` - Pipeable function

**Example:**
```typescript
pipe(
  Flow.succeed("hello"),
  Flow.map(s => s.toUpperCase())
)
```

#### `Flow.tap<A>(f: (a: A) => Effect<any>): (effect: Effect<A>) => Effect<A>`

Executes a side effect without changing the value.

**Parameters:**
- `f: (a: A) => Effect<any>` - Side effect function

**Returns:** `(effect: Effect<A>) => Effect<A>` - Pipeable function

**Example:**
```typescript
pipe(
  Flow.succeed("data"),
  Flow.tap(data => Effect.sync(() => console.log(data)))
)
```

#### `Flow.runCollect<A>(effect: Effect<A>): Effect<{ output: A, metadata: ExecutionMetadata }>`

Executes a flow and collects the final result with metadata.

**Parameters:**
- `effect: Effect<A>` - The Effect to execute

**Returns:** `Effect<{ output: A, metadata: ExecutionMetadata }>` - Result with execution metadata

#### `Flow.runStream<A>(effect: Effect<A>): Stream<ExecutionEvent>`

Executes a flow and returns a stream of execution events.

**Parameters:**
- `effect: Effect<A>` - The Effect to execute

**Returns:** `Stream<ExecutionEvent>` - Stream of execution events

#### `Flow.switchRoute<A, B>(prompt: string, tools: Tool[], routes: Record<string, (input: A) => Effect<B>>): (effect: Effect<A>) => Effect<B>`

LLM-powered routing that selects a route based on the input and prompt.

**Parameters:**
- `prompt: string` - Instruction for the LLM on how to route
- `tools: Tool[]` - Available tools for the LLM to consider
- `routes: Record<string, (input: A) => Effect<B>>` - Route handlers

**Returns:** `(effect: Effect<A>) => Effect<B>` - Pipeable function

## Tool System

### Tools Namespace

Utilities for creating and managing tools.

#### `Tool<I, O>` Interface

Tools are created as plain objects conforming to the Tool interface.

**Type Definition:**
```typescript
interface Tool<I, O> {
  id: string
  name: string
  description: string
  inputSchema: Schema.Schema<I>
  outputSchema: Schema.Schema<O>
  execute: (input: I, context: ExecutionContext) => Effect<O>
}
```

**Example:**
```typescript
const myTool: Tool<{ input: string }, { output: string }> = {
  id: 'my-tool',
  name: 'My Tool',
  description: 'Does something useful',
  inputSchema: Schema.Struct({ input: Schema.String }),
  outputSchema: Schema.Struct({ output: Schema.String }),
  execute: (input, context) => Effect.succeed({ output: input.input.toUpperCase() })
}
```

### Tool Registry

#### `createRegistry(tools: Tool[]): ToolRegistry`

Creates a tool registry with the given tools.

**Parameters:**
- `tools: Tool[]` - Array of tools to register

**Returns:** `ToolRegistry` - The created registry

#### `ToolRegistry.execute<I, O>(toolId: string, input: I): Effect<O>`

Executes a tool by ID with the given input.

**Parameters:**
- `toolId: string` - ID of the tool to execute
- `input: I` - Input data for the tool

**Returns:** `Effect<O>` - Effect containing the tool's output

## Dynamic Generation

### DynamicFlow Class

#### `DynamicFlow.execute<T>(config: DynamicExecutionConfig): Promise<T>`

Generates and immediately executes a dynamic flow.

**Parameters:**
- `config: DynamicExecutionConfig` - Execution configuration

**Type Definition:**
```typescript
interface DynamicExecutionConfig {
  prompt: string
  tools: Tool[]
  joins: ToolJoin[]
  model: LLMModel
  input?: unknown
}
```

**Returns:** `Promise<T>` - The execution result

#### `DynamicFlow.generate<T>(config: DynamicGenerationConfig): Promise<ValidatedFlowInstance<T>>`

Generates a flow instance without executing it.

**Parameters:**
- `config: DynamicGenerationConfig` - Generation configuration

**Returns:** `Promise<ValidatedFlowInstance<T>>` - The generated flow instance

### ValidatedFlowInstance

#### `ValidatedFlowInstance.runCollect<I>(input?: I): Effect<{ output: T, metadata: ExecutionMetadata }>`

Executes the flow and collects the final result.

**Parameters:**
- `input?: I` - Optional input data

**Returns:** `Effect<{ output: T, metadata: ExecutionMetadata }>` - Result with metadata

#### `ValidatedFlowInstance.runStream<I>(input?: I): Stream<ExecutionEvent>`

Executes the flow and returns a stream of events.

**Parameters:**
- `input?: I` - Optional input data

**Returns:** `Stream<ExecutionEvent>` - Stream of execution events

## Persistence

### PersistenceHub

#### `createPersistenceHub(backend: StorageBackend, options?: PersistenceOptions): Effect<PersistenceHub>`

Creates a persistence hub with the specified backend.

**Parameters:**
- `backend: StorageBackend` - Storage backend implementation
- `options?: PersistenceOptions` - Optional configuration

**Type Definition:**
```typescript
interface PersistenceOptions {
  enableEncryption?: boolean
  encryptionKey?: string
  enableCompression?: boolean
  defaultTimeout?: Duration
}
```

**Returns:** `Effect<PersistenceHub>` - The created persistence hub

#### `PersistenceHub.suspend<T>(key: SuspensionKey, state: T, config?: SuspensionConfig): Effect<void>`

Suspends a flow state for later resumption.

**Parameters:**
- `key: SuspensionKey` - Unique suspension key
- `state: T` - State to suspend
- `config?: SuspensionConfig` - Optional suspension configuration

**Returns:** `Effect<void>` - Effect indicating completion

#### `PersistenceHub.resume<T>(key: SuspensionKey, input: unknown): Effect<ResumptionResult<T>>`

Resumes a suspended flow with user input.

**Parameters:**
- `key: SuspensionKey` - Suspension key
- `input: unknown` - User input data

**Returns:** `Effect<ResumptionResult<T>>` - Resumption result

### Storage Backends

#### `BackendFactory.create(config: BackendConfig): Effect<StorageBackend>`

Creates a storage backend from configuration.

**Parameters:**
- `config: BackendConfig` - Backend configuration

**Type Definition:**
```typescript
type BackendConfig = 
  | { type: 'filesystem', config: { basePath: string } }
  | { type: 'postgres', config: PostgresConfig }
  | { type: 'redis', config: RedisConfig }
  | { type: 'mongodb', config: MongoConfig }
  | { type: 'neo4j', config: Neo4jConfig }
```

**Returns:** `Effect<StorageBackend>` - The created backend

### AwaitInput Tools

#### `AwaitInputPresets.approval(id: string, name: string, description: string): AwaitInputBuilder`

Creates an approval tool builder.

**Parameters:**
- `id: string` - Tool ID
- `name: string` - Tool name
- `description: string` - Tool description

**Returns:** `AwaitInputBuilder` - Builder for customization

#### `AwaitInputBuilder.withTimeout(timeout: Duration): AwaitInputBuilder`

Sets a timeout for the input.

**Parameters:**
- `timeout: Duration` - Timeout duration

**Returns:** `AwaitInputBuilder` - Builder for chaining

#### `AwaitInputBuilder.build(hub: PersistenceHub): AwaitInputTool`

Builds the final await input tool.

**Parameters:**
- `hub: PersistenceHub` - Persistence hub for suspension

**Returns:** `AwaitInputTool` - The created tool

## LLM Integration

### LLMService

#### `LLMService.completion(request: CompletionRequest): Effect<CompletionResponse>`

Generates a text completion using the configured LLM.

**Parameters:**
- `request: CompletionRequest` - Completion request

**Type Definition:**
```typescript
interface CompletionRequest {
  prompt: string
  maxTokens?: number
  temperature?: number
  model?: string
}
```

**Returns:** `Effect<CompletionResponse>` - The LLM response

#### `LLMServiceLive: Layer<LLMService>`

Live implementation of the LLM service using OpenAI.

### Model Configuration

#### `OpenAi.completion(config: OpenAiConfig): LLMModel`

Creates an OpenAI completion model configuration.

**Parameters:**
- `config: OpenAiConfig` - OpenAI configuration

**Type Definition:**
```typescript
interface OpenAiConfig {
  model: string
  apiKey?: string
  maxTokens?: number
  temperature?: number
}
```

**Returns:** `LLMModel` - Configured LLM model

## MCP Integration

### MCP Discovery CLI

#### `mcp-discovery discover [options]`

Discovers available MCP servers.

**Options:**
- `--source <source>` - Discovery source (network, url, file)
- `--filter <filter>` - Filter pattern for servers
- `--output <format>` - Output format (json, yaml)

#### `mcp-discovery generate [options]`

Generates TypeScript tools from MCP server definitions.

**Options:**
- `-i, --input <file>` - Input server definition file
- `-o, --output <dir>` - Output directory for generated tools
- `--types` - Generate only type definitions

### Generated MCP Tools

Generated MCP tools follow this pattern:

```typescript
export const tool_name_tool: Tool<InputType, OutputType> = {
  id: 'tool-name',
  name: 'Tool Name', 
  description: 'Tool description from MCP server',
  inputSchema: Schema.Struct({
    path: Schema.String,
    options: Schema.optional(Schema.Record(Schema.String, Schema.Unknown))
  }),
  outputSchema: Schema.Struct({
    result: Schema.Unknown,
    metadata: Schema.Record(Schema.String, Schema.Unknown)
  }),
  execute: (input, context) => Effect.promise(() => mcpServerCall(input))
}
```

## Types and Interfaces

### Core Types

#### `Effect<A, E = never, R = never>`

Represents a computation that may succeed with `A`, fail with `E`, or require `R`.

#### `Stream<A, E = never, R = never>`

Represents a stream of values of type `A`.

#### `Schema<A>`

Represents a schema for validating type `A`.

#### `Duration`

Represents a time duration.

### Flow Types

#### `ExecutionContext`

```typescript
interface ExecutionContext {
  requestId: string
  timestamp: Date
  metadata?: Record<string, unknown>
}
```

#### `ExecutionMetadata`

```typescript
interface ExecutionMetadata {
  duration: Duration
  stepCount: number
  startTime: Date
  endTime: Date
}
```

#### `ExecutionEvent`

```typescript
type ExecutionEvent = 
  | { type: 'flow-start', timestamp: Date }
  | { type: 'step-start', stepId: string, timestamp: Date }
  | { type: 'step-complete', stepId: string, result: unknown, timestamp: Date }
  | { type: 'flow-complete', result: unknown, timestamp: Date }
  | { type: 'flow-error', error: Error, timestamp: Date }
```

### Tool Types

#### `Tool<I, O>`

```typescript
interface Tool<I, O> {
  id: string
  name: string
  description: string
  inputSchema: Schema.Schema<I>
  outputSchema: Schema.Schema<O>
  execute: (input: I, context: ExecutionContext) => Effect<O>
}
```

#### `ToolJoin`

```typescript
interface ToolJoin {
  from: string
  to: string
  transform?: (value: unknown) => unknown
}
```

### Persistence Types

#### `SuspensionKey`

A branded string type representing a unique suspension identifier.

```typescript
type SuspensionKey = string & { readonly _brand: 'SuspensionKey' }
```

#### `SerializedState`

```typescript
interface SerializedState {
  data: string
  metadata: {
    timestamp: Date
    version: string
    compressed: boolean
    encrypted: boolean
  }
}
```

#### `SuspensionContext`

```typescript
interface SuspensionContext {
  flowId: string
  stepId: string
  timeout?: Duration
  metadata?: Record<string, unknown>
}
```

### IR Types

#### `IR`

```typescript
interface IR {
  version: string
  metadata: IRMetadata
  nodes: IRNode[]
  edges: IREdge[]
}
```

#### `IRNode`

```typescript
type IRNode = 
  | ToolNode
  | ConditionalNode  
  | ParallelNode
  | SequenceNode
  | LoopNode
```

#### `IREdge`

```typescript
interface IREdge {
  from: string | string[]
  to: string | string[]
  condition?: IRCondition
}
```

## Error Types

### Core Errors

#### `DynamicFlowError`

Base error class for all DynamicFlow errors.

```typescript
class DynamicFlowError extends Error {
  readonly _tag: string
  readonly cause?: Error
}
```

#### `ValidationError`

Thrown when schema validation fails.

```typescript
class ValidationError extends DynamicFlowError {
  readonly _tag = 'ValidationError'
  constructor(public schema: string, public value: unknown, public errors: string[])
}
```

#### `ToolNotFoundError`

Thrown when a requested tool is not found in the registry.

```typescript
class ToolNotFoundError extends DynamicFlowError {
  readonly _tag = 'ToolNotFoundError'  
  constructor(public toolId: string)
}
```

### Persistence Errors

#### `PersistenceError`

Base error for persistence operations.

```typescript
class PersistenceError extends DynamicFlowError {
  readonly _tag = 'PersistenceError'
}
```

#### `SuspensionKeyNotFound`

Thrown when trying to resume with an invalid suspension key.

```typescript
class SuspensionKeyNotFound extends PersistenceError {
  readonly _tag = 'SuspensionKeyNotFound'
  constructor(public key: SuspensionKey)
}
```

#### `SerializationError`

Thrown when state serialization fails.

```typescript
class SerializationError extends PersistenceError {
  readonly _tag = 'SerializationError'
  constructor(public operation: 'serialize' | 'deserialize', cause: Error)
}
```

### Generation Errors

#### `IRCompilationError`

Thrown when IR compilation fails.

```typescript
class IRCompilationError extends DynamicFlowError {
  readonly _tag = 'IRCompilationError'
  constructor(public stage: string, public details: string)
}
```

#### `FlowGenerationError`

Thrown when dynamic flow generation fails.

```typescript
class FlowGenerationError extends DynamicFlowError {
  readonly _tag = 'FlowGenerationError'
  constructor(public prompt: string, public modelResponse: string)
}
```

## Configuration

### Environment Variables

#### Required

- `OPENAI_API_KEY` - OpenAI API key for LLM operations

#### Optional

- `DATABASE_URL` - PostgreSQL connection string for persistence
- `REDIS_URL` - Redis connection string for persistence  
- `MONGODB_URL` - MongoDB connection string for persistence
- `NEO4J_URL` - Neo4j connection string for persistence
- `ENCRYPTION_KEY` - Key for state encryption (auto-generated if not provided)
- `LOG_LEVEL` - Logging level (debug, info, warn, error)
- `MAX_CONCURRENCY` - Maximum concurrent operations (default: 10)

### Configuration Objects

#### `LLMConfig`

```typescript
interface LLMConfig {
  provider: 'openai' | 'anthropic' | 'custom'
  apiKey: string
  model: string
  maxTokens?: number
  temperature?: number
  timeout?: Duration
}
```

#### `PersistenceConfig`

```typescript
interface PersistenceConfig {
  backend: BackendConfig
  encryption?: {
    enabled: boolean
    key?: string
    algorithm?: string
  }
  compression?: {
    enabled: boolean
    algorithm?: 'gzip' | 'brotli'
  }
  cleanup?: {
    enabled: boolean
    maxAge: Duration
    batchSize?: number
  }
}
```

#### `ExecutionConfig`

```typescript
interface ExecutionConfig {
  maxConcurrency?: number
  timeout?: Duration
  retryPolicy?: {
    maxRetries: number
    backoff: 'exponential' | 'linear' | 'fixed'
    initialDelay: Duration
    maxDelay?: Duration
  }
  monitoring?: {
    enabled: boolean
    metricsEndpoint?: string
    tracingEnabled?: boolean
  }
}
```

This reference provides comprehensive technical details for all DynamicFlow APIs. For usage examples and implementation guidance, see the [Tutorial](./tutorial.md) and [How-to Guide](./how-to-guide.md).
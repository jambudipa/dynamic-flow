# Flow API Reference

The `Flow` namespace provides a comprehensive set of pipeable operations for building type-safe, functional workflows with Effect.js integration.

## Core Concepts

The Flow API is built on Effect.js principles, providing functional composition through piping operations. All Flow operations return `Effect.Effect<A, E, R>` types for maximum composability and type safety.

### Basic Pattern

```typescript
import { pipe, Flow, Effect } from '@jambudipa/dynamic-flow'

const myFlow = pipe(
  Effect.succeed(initialValue),
  Flow.andThen(transformFunction),
  Flow.map(mapFunction),
  Flow.catchAll(errorHandler)
)

const result = await Flow.run(myFlow)
```

## Sequential Operations

### `Flow.andThen<A, B, E2, R2>(f: (a: A) => Effect.Effect<B, E2, R2>)`

Sequential composition: run `f` after the previous effect succeeds.

**Type Signature:**
```typescript
<E1, R1>(self: Effect.Effect<A, E1, R1>) 
  => Effect.Effect<B, E1 | E2, R1 | R2>
```

**Parameters:**
- `f` - Function that takes the success value and returns a new Effect

**Example:**
```typescript
const flow = pipe(
  Effect.succeed("hello"),
  Flow.andThen(greeting => Effect.succeed(`${greeting} world`)),
  Flow.andThen(message => Effect.succeed(message.toUpperCase()))
)
// Result: "HELLO WORLD"
```

**Use Cases:**
- Database operations that depend on previous results
- API calls with sequential dependencies
- Multi-step validation processes

## Parallel Operations

### `Flow.parallel<T>(flows: T, options?: { concurrency?: number | 'inherit' | 'unbounded' })`

Execute multiple Effects concurrently and collect all results.

**Type Signature:**
```typescript
<T extends Record<string, Effect.Effect<any, any, any>>>(
  flows: T,
  options?: { concurrency?: number | 'inherit' | 'unbounded' }
) => Effect.Effect<
  { [K in keyof T]: T[K] extends Effect.Effect<infer A, any, any> ? A : never },
  T[keyof T] extends Effect.Effect<any, infer E, any> ? E : never,
  T[keyof T] extends Effect.Effect<any, any, infer R> ? R : never
>
```

**Parameters:**
- `flows` - Record of named Effects to execute in parallel
- `options.concurrency` - Maximum concurrent operations (default: unbounded)

**Example:**
```typescript
const weatherFlow = pipe(
  Effect.succeed(['London', 'Paris', 'Tokyo']),
  Flow.andThen(cities => 
    Flow.parallel({
      weather: Flow.forEach(city => fetchWeather({ city })),
      populations: Flow.forEach(city => getPopulation({ city }))
    }, { concurrency: 3 })
  )
)
```

**Performance Considerations:**
- Use `concurrency` limits for rate-limited APIs
- Consider memory usage with large parallel operations
- Ideal for independent operations that can run simultaneously

## Conditional Operations

### `Flow.doIf<A, B>(predicate, options)`

Conditional execution: choose `onTrue` or `onFalse` based on predicate.

**Type Signature:**
```typescript
<A, B, E1, R1, E2, R2>(
  predicate: (a: A) => boolean,
  options: {
    onTrue: (a: A) => Effect.Effect<B, E1, R1>;
    onFalse: (a: A) => Effect.Effect<B, E2, R2>;
  }
) => <E, R>(self: Effect.Effect<A, E, R>) 
  => Effect.Effect<B, E | E1 | E2, R | R1 | R2>
```

**Parameters:**
- `predicate` - Boolean function to test the input value
- `options.onTrue` - Effect to execute when predicate returns true
- `options.onFalse` - Effect to execute when predicate returns false

**Example:**
```typescript
const alertFlow = pipe(
  fetchMetrics(),
  Flow.doIf(
    metrics => metrics.errorRate > 0.1,
    {
      onTrue: metrics => sendAlert(`High error rate: ${metrics.errorRate}`),
      onFalse: metrics => Effect.succeed({ status: 'normal', metrics })
    }
  )
)
```

## Advanced Routing

### `Flow.switchRoute<A, B>(prompt, options, branches, config?)`

Route to one of several flows using LLM-guided decision making.

**Type Signature:**
```typescript
<A, B>(
  prompt: string | ((a: A) => string),
  options: ReadonlyArray<Tool<any, any>>,
  branches: Record<string, ((a: A) => Effect.Effect<B, any, any>) | ValidatedFlowInstance>,
  config?: { retries?: number }
) => <E, R>(self: Effect.Effect<A, E, R>) 
  => Effect.Effect<B, E | FlowError, R>
```

**Parameters:**
- `prompt` - LLM prompt for choosing branch (string or function)
- `options` - Array of tool definitions for LLM to choose from
- `branches` - Record mapping tool IDs to executable branches
- `config.retries` - Number of retry attempts (default: 2)

**Example:**
```typescript
const processingFlow = pipe(
  Effect.succeed(userRequest),
  Flow.switchRoute(
    (request) => `How should I process: ${request.type}?`,
    [
      { id: 'text', name: 'Text Processor', description: 'Process text content' },
      { id: 'image', name: 'Image Processor', description: 'Process image content' },
      { id: 'audio', name: 'Audio Processor', description: 'Process audio content' }
    ],
    {
      text: (input) => processText(input),
      image: (input) => processImage(input),
      audio: (input) => processAudio(input)
    }
  )
)
```

**Requirements:**
- `OPENAI_API_KEY` environment variable must be set
- All branches must return the same output type `B`
- Tool IDs in `options` must match keys in `branches`

## Data Transformation

### `Flow.map<A, B>(f: (a: A) => B)`

Transform the success value without changing the Effect context.

**Example:**
```typescript
const upperCaseFlow = pipe(
  Effect.succeed("hello world"),
  Flow.map(text => text.toUpperCase()),
  Flow.map(text => `✨ ${text} ✨`)
)
// Result: "✨ HELLO WORLD ✨"
```

### `Flow.join<From, To>(transformOrJoin)`

Transform data between incompatible tool input/output shapes using Schema transforms.

**Type Signature:**
```typescript
<From, To, R2>(
  transformOrJoin: Schema.Schema<To, From, R2> | ToolJoin<From, To, R2>
) => <E, R1>(self: Effect.Effect<From, E, R1>) 
  => Effect.Effect<To, E | ParseError, R1 | R2>
```

**Example:**
```typescript
import * as S from 'effect/Schema'

const transformFlow = pipe(
  Effect.succeed({ title: "Document Title" }),
  Flow.join(
    S.transform(
      S.Struct({ title: S.String }),
      S.Struct({ text: S.String }),
      {
        strict: true,
        decode: (a) => ({ text: a.title }),
        encode: (b) => ({ title: b.text })
      }
    )
  ),
  Flow.andThen(processText)
)
```

### `Flow.filter<A>(predicate, options?)`

Filter values by predicate, failing with `FlowExecutionError` if predicate fails.

**Example:**
```typescript
const validatedFlow = pipe(
  Effect.succeed(42),
  Flow.filter(
    value => value > 0,
    { error: toFlowError(new ValidationError('Value must be positive')) }
  )
)
```

## Collection Operations

### `Flow.forEach<A, B>(f, options?)`

Map over an array of items, transforming each via the provided function.

**Type Signature:**
```typescript
<A, B, E2, R2>(
  f: (a: A, index: number) => Effect.Effect<B, E2, R2>,
  options?: { concurrency?: number | 'inherit' | 'unbounded' }
) => <E, R>(self: Effect.Effect<ReadonlyArray<A>, E, R>) 
  => Effect.Effect<ReadonlyArray<B>, E | E2, R | R2>
```

**Example:**
```typescript
const processItemsFlow = pipe(
  Effect.succeed(['apple', 'banana', 'cherry']),
  Flow.forEach(
    (item, index) => Effect.succeed(`${index + 1}: ${item.toUpperCase()}`),
    { concurrency: 2 }
  )
)
// Result: ["1: APPLE", "2: BANANA", "3: CHERRY"]
```

## Error Handling

### `Flow.catchAll<E, A2>(f)`

Catch and handle all errors with a recovery function.

**Example:**
```typescript
const resilientFlow = pipe(
  riskyOperation(),
  Flow.catchAll(error => 
    Effect.succeed({ error: true, message: error.message })
  )
)
```

### `Flow.catchTag<E, K>(tag, f)`

Catch only specific tagged errors for granular error handling.

**Example:**
```typescript
const specificErrorFlow = pipe(
  databaseOperation(),
  Flow.catchTag('DatabaseError', error => 
    Effect.succeed({ retried: true, fallbackData: [] })
  ),
  Flow.catchTag('NetworkError', error =>
    Effect.succeed({ cached: true, staleData: cachedData })
  )
)
```

## Resilience Operations

### `Flow.timeout(duration)`

Apply a timeout to any Flow operation.

**Example:**
```typescript
const timeoutFlow = pipe(
  slowApiCall(),
  Flow.timeout(Duration.seconds(30)),
  Flow.catchTag('TimeoutError', () => 
    Effect.succeed({ timedOut: true })
  )
)
```

### `Flow.retry(options)`

Retry failed operations with configurable backoff strategies.

**Type Signature:**
```typescript
(options: {
  times: number;
  delay?: Duration.Duration;
  backoff?: 'exponential' | 'linear' | 'fixed';
}) => <A, E, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
```

**Example:**
```typescript
const retryFlow = pipe(
  unreliableApiCall(),
  Flow.retry({
    times: 3,
    delay: Duration.seconds(1),
    backoff: 'exponential'
  })
)
```

## Side Effects

### `Flow.tap<A>(f)`

Execute side effects without changing the flow value.

**Example:**
```typescript
const loggedFlow = pipe(
  computeResult(),
  Flow.tap(result => Effect.sync(() => 
    console.log(`Computed: ${JSON.stringify(result)}`)
  )),
  Flow.tap(result => logToDatabase(result))
)
```

## Execution

### `Flow.run<A, E>(flow)`

Execute a flow and return a Promise of the result.

**Type Signature:**
```typescript
<A, E, R = never>(flow: Effect.Effect<A, E, R>) => Promise<A>
```

**Example:**
```typescript
const result = await Flow.run(myFlow)
console.log('Flow result:', result)
```

**Error Handling:**
- Throws if the flow fails
- Use `Flow.runExit()` for explicit error handling

### `Flow.runExit<A, E>(flow)`

Execute a flow and return both success and failure cases.

**Type Signature:**
```typescript
<A, E, R = never>(flow: Effect.Effect<A, E, R>) 
  => Promise<{ _tag: 'Success'; value: A } | { _tag: 'Failure'; error: E }>
```

**Example:**
```typescript
const exit = await Flow.runExit(riskyFlow)

if (exit._tag === 'Success') {
  console.log('Success:', exit.value)
} else {
  console.error('Failure:', exit.error)
}
```

## Compilation and Streaming

### `Flow.runStream<A, E>(program, options?)`

Execute a flow with streaming events for real-time monitoring.

**Returns:** `Stream.Stream<FlowEvent, ExecutionError>`

**Example:**
```typescript
import { Stream } from 'effect'

await Flow.runStream(myFlow).pipe(
  Stream.tap(event => Effect.sync(() => {
    console.log(`Event: ${event.type}`)
  })),
  Stream.runDrain,
  Effect.runPromise
)
```

### `Flow.runCollect<A, E>(program, options?)`

Execute a flow and collect the final result (non-streaming).

**Example:**
```typescript
const result = await Flow.runCollect(myFlow, { 
  name: 'My Flow Execution' 
})
console.log('Final output:', result.output)
```

## Type-Safe Helpers

### `Flow.succeed<A>(value)`

Create a successful Flow from a value.

### `Flow.fail<E>(error)`

Create a failing Flow from an error.

### `Flow.sync<A>(f)`

Create a Flow from a synchronous function that might throw.

### `Flow.promise<A>(f)`

Create a Flow from a Promise-returning function.

## Best Practices

### Performance Optimisation

1. **Use appropriate concurrency limits:**
   ```typescript
   Flow.parallel(operations, { concurrency: 5 })
   ```

2. **Apply timeouts for external operations:**
   ```typescript
   Flow.timeout(Duration.seconds(30))
   ```

3. **Implement retry strategies for unreliable operations:**
   ```typescript
   Flow.retry({ times: 3, backoff: 'exponential' })
   ```

### Error Handling Patterns

1. **Use specific error catching:**
   ```typescript
   Flow.catchTag('NetworkError', handleNetworkError)
   ```

2. **Provide fallback values:**
   ```typescript
   Flow.catchAll(() => Effect.succeed(defaultValue))
   ```

3. **Use filter for validation:**
   ```typescript
   Flow.filter(isValid, { error: validationError })
   ```

### Composition Patterns

1. **Keep effects pure and composable**
2. **Use meaningful names for parallel operations**
3. **Leverage type inference where possible**
4. **Structure complex flows with helper functions**

## Common Patterns

### API Orchestration

```typescript
const orchestratedFlow = pipe(
  Effect.succeed(requestData),
  Flow.parallel({
    user: fetchUser,
    preferences: fetchPreferences,
    permissions: fetchPermissions
  }),
  Flow.andThen(({ user, preferences, permissions }) =>
    processUserData({ user, preferences, permissions })
  ),
  Flow.timeout(Duration.seconds(10)),
  Flow.retry({ times: 2 })
)
```

### Data Pipeline

```typescript
const dataPipeline = pipe(
  loadRawData(),
  Flow.andThen(validateData),
  Flow.filter(isComplete),
  Flow.forEach(transformRecord, { concurrency: 10 }),
  Flow.andThen(aggregateResults),
  Flow.tap(saveToDatabase)
)
```

### Conditional Processing

```typescript
const conditionalFlow = pipe(
  analyseInput(),
  Flow.doIf(
    analysis => analysis.confidence > 0.8,
    {
      onTrue: analysis => processWithHighConfidence(analysis),
      onFalse: analysis => requestHumanReview(analysis)
    }
  )
)
```

## Related APIs

- [Tools API](./tools.md) - Creating and using tools in flows
- [Dynamic Flow API](./dynamic-flow.md) - AI-generated flow execution
- [IR API](./ir.md) - Intermediate representation for flows
- [Streaming API](./streaming.md) - Real-time flow execution events
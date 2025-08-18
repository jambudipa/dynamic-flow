# Services Architecture

This directory contains the service-oriented architecture implementation for DynamicFlow, replacing the previous class-based approach.

## Migration Status

### Phase 1: Foundation Services
- [ ] ConfigService - Configuration management
- [ ] LoggingService - Structured logging
- [ ] TypeUtilsService - Effect type utilities

### Phase 2: Core Services  
- [ ] StateService - State management (replaces StateManager)
- [ ] ExecutionContextService - Execution context (replaces ExecutionContext)
- [ ] SerializerService - Serialization (replaces Serializer)
- [ ] KeyGeneratorService - Key generation (replaces KeyGenerator)
- [ ] ToolRegistryService - Tool registry (replaces ToolRegistry)

### Phase 3: Persistence Services
- [ ] EncryptionService - Encryption operations (replaces EncryptionService class)
- [ ] BackendService - Generic backend interface
- [ ] PostgresBackend - PostgreSQL implementation
- [ ] MongoDBBackend - MongoDB implementation
- [ ] Neo4jBackend - Neo4j implementation
- [ ] RedisBackend - Redis implementation
- [ ] FilesystemBackend - Filesystem implementation
- [ ] PersistenceService - Orchestration (replaces PersistenceHub)

### Phase 4: Execution Services
- [ ] IRExecutorService - IR execution (replaces IRExecutor)
- [ ] FlowService - Flow orchestration

### Phase 5: Feature Services
- [ ] SchemaService - Schema utilities
- [ ] MCPDiscoveryService - MCP discovery

## Service Pattern

Each service follows this pattern:

```typescript
// 1. Define interface
interface MyService {
  readonly operation: (input: Input) => Effect.Effect<Output, Error>
}

// 2. Create Context.Tag
const MyService = Context.GenericTag<MyService>("@services/MyService")

// 3. Implement Layer
const MyServiceLive = Layer.effect(
  MyService,
  Effect.gen(function* () {
    // Dependencies
    const dep = yield* DependencyService
    
    // State (if needed)
    const state = yield* Ref.make(initialState)
    
    // Return implementation
    return {
      operation: (input) => Effect.gen(function* () {
        // Implementation
      })
    }
  })
)

// 4. Export
export { MyService, MyServiceLive }
```

## Usage

```typescript
// Access service in Effect
const program = Effect.gen(function* () {
  const myService = yield* MyService
  const result = yield* myService.operation(input)
  return result
})

// Run with layers
Effect.runPromise(
  program.pipe(Effect.provide(MyServiceLive))
)
```

## Testing

Each service should have:
1. Unit tests with mock dependencies
2. Integration tests with real dependencies
3. Property-based tests where applicable

## Notes

- No `const self = this` patterns
- No try/catch blocks - use Effect.try/tryPromise
- All errors extend Data.TaggedError
- State managed with Ref
- Dependencies via Context/Layer
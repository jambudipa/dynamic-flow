# Effect Service Pattern

## Overview

The Effect Service pattern provides a type-safe, composable approach to dependency injection in Effect-based applications. This pattern enables clean separation between service interfaces and implementations while ensuring compile-time safety for all dependencies.

## Core Concepts

### Service Definition

A service in Effect consists of three key components:

1. **Service Tag**: A unique identifier for the service
2. **Service Interface**: The type describing available operations
3. **Service Implementation**: The concrete implementation provided via layers

### When to Use This Pattern

Use the Effect Service pattern when you need:

- **Dependency Injection**: Managing complex dependencies between components
- **Testability**: Easy mocking and testing of service interactions
- **Modularity**: Building composable, reusable application components
- **Type Safety**: Compile-time verification of service dependencies
- **External System Abstraction**: Isolating database, API, or filesystem interactions

## Pattern Implementation

### 1. Basic Service Definition (Effect.Service)

For services with a single implementation, use `Effect.Service`:

```typescript
import { Effect } from "effect"

// Define service using Effect.Service
class LoggerService extends Effect.Service<LoggerService>()("LoggerService", {
  // Service interface
  effect: Effect.gen(function* () {
    return {
      log: (message: string) => Effect.sync(() => console.log(message)),
      error: (message: string) => Effect.sync(() => console.error(message))
    }
  })
}) {}
```

### 2. Generic Service Definition (Context.Tag)

For more flexibility or multiple implementations, use `Context.Tag` directly:

```typescript
// Define service interface
interface DatabaseService {
  readonly query: (sql: string) => Effect.Effect<unknown[], DatabaseError>
  readonly execute: (sql: string) => Effect.Effect<void, DatabaseError>
}

// Create service tag
const DatabaseService = Context.Tag<DatabaseService>("DatabaseService")
```

### 3. Service Implementation with Layers

Services are implemented and provided using Layers:

```typescript
import { Layer } from "effect"

// Simple implementation with Layer.succeed
const LoggerLive = Layer.succeed(
  LoggerService,
  {
    log: (message) => Effect.sync(() => console.log(message)),
    error: (message) => Effect.sync(() => console.error(message))
  }
)

// Complex implementation with dependencies
const DatabaseLive = Layer.effect(
  DatabaseService,
  Effect.gen(function* () {
    const logger = yield* LoggerService
    
    return {
      query: (sql) => Effect.gen(function* () {
        yield* logger.log(`Executing query: ${sql}`)
        // Implementation details...
        return []
      }),
      execute: (sql) => Effect.gen(function* () {
        yield* logger.log(`Executing: ${sql}`)
        // Implementation details...
      })
    }
  })
)
```

## Layer Composition

### Merging Layers

Combine multiple layers to build your application's dependency graph:

```typescript
const AppLive = Layer.merge(LoggerLive, DatabaseLive)
```

### Sequential Composition

Build layers that depend on each other:

```typescript
const ConfigLive = Layer.succeed(ConfigService, { /* config */ })
const LoggerWithConfig = Layer.provide(LoggerLive, ConfigLive)
```

## Usage Patterns

### Accessing Services in Effects

```typescript
const program = Effect.gen(function* () {
  const logger = yield* LoggerService
  const db = yield* DatabaseService
  
  yield* logger.log("Starting operation")
  const results = yield* db.query("SELECT * FROM users")
  yield* logger.log(`Found ${results.length} users`)
  
  return results
})

// Provide dependencies and run
const runnable = Effect.provide(program, AppLive)
```

### Testing with Mock Implementations

```typescript
const LoggerTest = Layer.succeed(
  LoggerService,
  {
    log: () => Effect.void,
    error: () => Effect.void
  }
)

const testProgram = Effect.provide(program, LoggerTest)
```

## Best Practices

### 1. Service Interface Design

- **Keep interfaces minimal**: Only include essential operations
- **Use semantic names**: Operations should clearly express intent
- **Return Effects**: All operations should return Effect types
- **Avoid leaking implementation**: Don't expose internal dependencies

### 2. Layer Organisation

- **Naming Convention**: Use `Live` suffix for production layers, `Test` for test layers
- **Single Responsibility**: Each layer should construct one service
- **Dependency Management**: Handle dependencies at layer level, not service level
- **Layer Files**: Organise layers in separate files by domain

### 3. Error Handling

```typescript
class DatabaseError extends Data.TaggedError("DatabaseError")<{
  message: string
  code?: string
}> {}

interface DatabaseService {
  readonly query: (sql: string) => Effect.Effect<unknown[], DatabaseError>
}
```

### 4. Configuration Services

```typescript
class Config extends Context.Tag("Config")<
  Config,
  {
    readonly database: {
      readonly host: string
      readonly port: number
    }
    readonly logging: {
      readonly level: "debug" | "info" | "error"
    }
  }
>() {}

const ConfigLive = Layer.effect(
  Config,
  Effect.sync(() => ({
    database: {
      host: process.env.DB_HOST || "localhost",
      port: parseInt(process.env.DB_PORT || "5432")
    },
    logging: {
      level: (process.env.LOG_LEVEL || "info") as "debug" | "info" | "error"
    }
  }))
)
```

## Advanced Patterns

### Service Factories

Create services dynamically based on configuration:

```typescript
const createDatabaseLayer = (config: DatabaseConfig) =>
  Layer.succeed(DatabaseService, {
    query: (sql) => /* implementation using config */,
    execute: (sql) => /* implementation using config */
  })
```

### Service Decorators

Enhance existing services with additional behaviour:

```typescript
const withLogging = <S>(
  service: Context.Tag<S>,
  implementation: S
): Layer.Layer<S, never, LoggerService> =>
  Layer.effect(
    service,
    Effect.gen(function* () {
      const logger = yield* LoggerService
      
      // Wrap each method with logging
      return Object.entries(implementation).reduce(
        (acc, [key, value]) => ({
          ...acc,
          [key]: typeof value === "function"
            ? (...args: any[]) => Effect.gen(function* () {
                yield* logger.log(`Calling ${key}`)
                return yield* value(...args)
              })
            : value
        }),
        {} as S
      )
    })
  )
```

## Migration Guide

### From Direct Dependencies to Services

Before:
```typescript
const fetchUser = (id: string, db: Database): Promise<User> => {
  return db.query(`SELECT * FROM users WHERE id = ${id}`)
}
```

After:
```typescript
const fetchUser = (id: string) => Effect.gen(function* () {
  const db = yield* DatabaseService
  return yield* db.query(`SELECT * FROM users WHERE id = ?`, [id])
})
```

### From Constructor Injection to Layers

Before:
```typescript
class UserRepository {
  constructor(
    private db: Database,
    private logger: Logger
  ) {}
}
```

After:
```typescript
const UserRepository = Layer.effect(
  UserRepositoryService,
  Effect.gen(function* () {
    const db = yield* DatabaseService
    const logger = yield* LoggerService
    
    return {
      // repository methods
    }
  })
)
```

## Common Pitfalls and Solutions

### 1. Circular Dependencies

**Problem**: Service A depends on B, B depends on A

**Solution**: Refactor to break the cycle, often by extracting shared functionality

### 2. Over-abstracting

**Problem**: Creating services for simple utilities

**Solution**: Only use services for stateful components or external interactions

### 3. Forgetting to Provide Layers

**Problem**: Runtime errors about missing services

**Solution**: Use TypeScript to track required services, provide all layers at app root

## Summary

The Effect Service pattern provides a powerful, type-safe approach to dependency injection that scales from simple applications to complex systems. By separating service interfaces from implementations and managing dependencies through layers, you achieve:

- **Modularity**: Services can be developed and tested independently
- **Flexibility**: Easy to swap implementations for testing or different environments
- **Type Safety**: Compile-time verification of all dependencies
- **Composability**: Services and layers compose naturally
- **Maintainability**: Clear separation of concerns and explicit dependencies

This pattern is fundamental to building robust Effect applications and should be the default approach for managing dependencies and external interactions.

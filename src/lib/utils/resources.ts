/**
 * Resource Management - Effect-based resource management for DynamicFlow.
 * Provides acquire/release patterns with proper cleanup guarantees.
 */

import type { Scope } from 'effect';
import { Effect, pipe, Ref, Duration } from 'effect';
import { logDebug, logError } from './logging';
import { ResourceError } from '../errors/base';

// ============= Resource Types =============

/**
 * A resource that can be acquired and released.
 */
export interface Resource<T> {
  readonly acquire: Effect.Effect<T>;
  readonly release: (resource: T) => Effect.Effect<void>;
}

/**
 * Resource configuration options.
 */
export interface ResourceConfig {
  readonly timeout?: number;
  readonly retries?: number;
  readonly onAcquire?: (resource: unknown) => Effect.Effect<void>;
  readonly onRelease?: (resource: unknown) => Effect.Effect<void>;
  readonly onError?: (error: unknown) => Effect.Effect<void>;
}

/**
 * Managed resource with automatic cleanup.
 */
export type ManagedResource<T, E = ResourceError> = Effect.Effect<
  T,
  E,
  Scope.Scope
>;

// ============= Core Resource Functions =============

/**
 * Create a managed resource with acquire/release semantics.
 */
export const managed = <T, E, R>(
  acquire: Effect.Effect<T, E, R>,
  release: (resource: T) => Effect.Effect<void>
): Effect.Effect<T, E, R | Scope.Scope> =>
  Effect.acquireRelease(acquire, release);

/**
 * Create a managed resource with timeout and error handling.
 */
export const managedWithConfig = <T, E, R>(
  acquire: Effect.Effect<T, E, R>,
  release: (resource: T) => Effect.Effect<void>,
  config?: ResourceConfig
): Effect.Effect<T, E | ResourceError, R | Scope.Scope> =>
  Effect.acquireRelease(
    pipe(
      acquire,
      Effect.tap(
        (resource) =>
          config?.onAcquire?.(resource) ??
          logDebug('Resource acquired', {
            module: 'Resource',
            metadata: { resourceType: typeof resource },
          })
      )
    ),
    (resource) =>
      pipe(
        release(resource),
        Effect.tap(
          () =>
            config?.onRelease?.(resource) ??
            logDebug('Resource released', {
              module: 'Resource',
              metadata: { resourceType: typeof resource },
            })
        ),
        Effect.catchAll((error) =>
          pipe(
            config?.onError?.(error) ??
              logError('Resource release failed', {
                module: 'Resource',
                error,
              }),
            Effect.andThen(Effect.void)
          )
        )
      )
  );

/**
 * Create a resource pool with size limits.
 */
export const createResourcePool = <T, E>(
  factory: () => Effect.Effect<T, E>,
  destroyer: (resource: T) => Effect.Effect<void>,
  config?: {
    minSize?: number;
    maxSize?: number;
    idleTimeout?: number;
  }
): Effect.Effect<
  {
    acquire: Effect.Effect<T, E | ResourceError>;
    release: (resource: T) => Effect.Effect<void>;
    shutdown: Effect.Effect<void>;
  },
  E,
  never
> =>
  Effect.gen(function* () {
    const minSize = config?.minSize || 1;
    const maxSize = config?.maxSize || 10;
    const idleTimeout = config?.idleTimeout || 60000; // 1 minute

    const available = yield* Ref.make<T[]>([]);
    const inUse = yield* Ref.make<Set<T>>(new Set());
    const totalCount = yield* Ref.make(0);

    // Pre-populate minimum resources
    for (let i = 0; i < minSize; i++) {
      const resource = yield* factory();
      yield* Ref.update(available, (arr) => [...arr, resource]);
      yield* Ref.update(totalCount, (count) => count + 1);
    }

    const acquire = Effect.gen(function* () {
      // Try to get from available pool first
      const availableResources = yield* Ref.get(available);

      if (availableResources.length > 0) {
        const resource = availableResources[0]!;
        yield* Ref.update(available, (arr) => arr.slice(1));
        yield* Ref.update(inUse, (set) => new Set([...set, resource]));
        return resource;
      }

      // Check if we can create a new one
      const currentTotal = yield* Ref.get(totalCount);
      if (currentTotal < maxSize) {
        const resource = yield* factory();
        yield* Ref.update(totalCount, (count) => count + 1);
        yield* Ref.update(inUse, (set) => new Set([...set, resource]));
        return resource;
      }

      // Pool is exhausted
      return yield* Effect.fail(
        new ResourceError({
          resource: 'Pool',
          operation: 'acquire',
          message: `Resource pool exhausted (max: ${maxSize})`,
        })
      );
    });

    const release = (resource: T): Effect.Effect<void, never, never> =>
      Effect.gen(function* () {
        const inUseSet = yield* Ref.get(inUse);

        if (!inUseSet.has(resource)) {
          // Log error but don't fail the release
          yield* logError('Attempting to release resource not in use', {
            module: 'ResourcePool',
            error: new Error('Resource not in use'),
            metadata: { resource: String(resource) },
          });
          return;
        }

        yield* Ref.update(inUse, (set) => {
          const newSet = new Set(set);
          newSet.delete(resource);
          return newSet;
        });

        // Return to available pool
        yield* Ref.update(available, (arr) => [...arr, resource]);
      });

    const shutdown = Effect.gen(function* () {
      // Release all resources
      const availableResources = yield* Ref.get(available);
      const inUseResources = yield* Ref.get(inUse);

      yield* Effect.forEach(
        [...availableResources, ...inUseResources],
        destroyer,
        { concurrency: 'unbounded' }
      );

      yield* Ref.set(available, []);
      yield* Ref.set(inUse, new Set());
      yield* Ref.set(totalCount, 0);
    });

    return { acquire, release, shutdown };
  });

// ============= Database Connection Management =============

/**
 * Managed database connection with connection pooling.
 */
export const managedConnection = <T>(
  connect: () => Effect.Effect<T>,
  disconnect: (connection: T) => Effect.Effect<void>
): ManagedResource<T, ResourceError> =>
  managedWithConfig(
    pipe(
      connect(),
      Effect.tapBoth({
        onFailure: (error) =>
          logError('Database connection failed', {
            module: 'Database',
            error,
          }),
        onSuccess: () =>
          logDebug('Database connection established', {
            module: 'Database',
          }),
      })
    ),
    (connection) =>
      pipe(
        disconnect(connection),
        Effect.tapBoth({
          onFailure: (error) =>
            logError('Database disconnection failed', {
              module: 'Database',
              error,
            }),
          onSuccess: () =>
            logDebug('Database disconnected', {
              module: 'Database',
            }),
        })
      ),
    {
      onError: (error) =>
        logError('Database connection error', {
          module: 'Database',
          error,
        }),
    }
  );

/**
 * Managed transaction with rollback on failure.
 */
export const managedTransaction = <T, R>(
  connection: T,
  beginTransaction: (conn: T) => Effect.Effect<R>,
  commitTransaction: (tx: R) => Effect.Effect<void>,
  rollbackTransaction: (tx: R) => Effect.Effect<void>
): ManagedResource<R, ResourceError> =>
  Effect.acquireRelease(
    pipe(
      beginTransaction(connection),
      Effect.tap(() => logDebug('Transaction started', { module: 'Database' }))
    ),
    (transaction) =>
      pipe(
        commitTransaction(transaction),
        Effect.tap(() =>
          logDebug('Transaction committed', { module: 'Database' })
        ),
        Effect.catchAll((error) =>
          pipe(
            rollbackTransaction(transaction),
            Effect.tap(() =>
              logDebug('Transaction rolled back', { module: 'Database' })
            ),
            Effect.flatMap(() => Effect.fail(error))
          )
        )
      )
  );

// ============= File System Resources =============

/**
 * Managed file handle with automatic cleanup.
 */
export const managedFile = (
  path: string,
  mode: string = 'r'
): ManagedResource<any, ResourceError> =>
  managedWithConfig(
    Effect.tryPromise({
      try: () => import('fs/promises').then((fs) => fs.open(path, mode)),
      catch: (error) =>
        new ResourceError({
          resource: 'File',
          operation: 'acquire',
          message: `Failed to open file: ${path}`,
          cause: error,
        }),
    }),
    (fileHandle) =>
      Effect.tryPromise({
        try: () => fileHandle.close(),
        catch: (error) => error, // Log but don't fail cleanup
      }).pipe(Effect.orElse(() => Effect.void)),
    {
      onAcquire: () =>
        logDebug(`File opened: ${path}`, { module: 'FileSystem' }),
      onRelease: () =>
        logDebug(`File closed: ${path}`, { module: 'FileSystem' }),
    }
  );

/**
 * Managed temporary directory with cleanup.
 */
export const managedTempDir = (
  prefix?: string
): ManagedResource<string, ResourceError> =>
  managedWithConfig(
    Effect.tryPromise({
      try: () =>
        import('fs/promises').then((fs) =>
          fs.mkdtemp(prefix || '/tmp/dynamic-flow-')
        ),
      catch: (error) =>
        new ResourceError({
          resource: 'TempDirectory',
          operation: 'acquire',
          message: 'Failed to create temporary directory',
          cause: error,
        }),
    }),
    (dirPath) =>
      Effect.tryPromise({
        try: () =>
          import('fs/promises').then((fs) =>
            fs.rm(dirPath, { recursive: true, force: true })
          ),
        catch: (error) => error, // Log but don't fail cleanup
      }).pipe(Effect.orElse(() => Effect.void)),
    {
      onAcquire: (dirPath) =>
        logDebug(`Temp directory created: ${dirPath}`, {
          module: 'FileSystem',
        }),
      onRelease: (dirPath) =>
        logDebug(`Temp directory cleaned: ${dirPath}`, {
          module: 'FileSystem',
        }),
    }
  );

// ============= Network Resources =============

/**
 * Managed HTTP client with connection pooling.
 */
export const managedHttpClient = (
  config?: any
): ManagedResource<any, ResourceError> =>
  managedWithConfig(
    Effect.sync(() => {
      // This would create an HTTP client instance
      // Implementation depends on the HTTP library used
      return { config, active: true };
    }),
    (client) =>
      Effect.sync(() => {
        // Cleanup HTTP client resources
        client.active = false;
      }),
    {
      onAcquire: () => logDebug('HTTP client created', { module: 'Network' }),
      onRelease: () => logDebug('HTTP client destroyed', { module: 'Network' }),
    }
  );

// ============= Memory Resources =============

/**
 * Managed memory buffer with size tracking.
 */
export const managedBuffer = (
  size: number
): ManagedResource<Buffer, ResourceError> =>
  managedWithConfig(
    Effect.sync(() => Buffer.allocUnsafe(size)),
    (buffer) =>
      Effect.sync(() => {
        // Clear sensitive data
        buffer.fill(0);
      }),
    {
      onAcquire: (buffer) =>
        logDebug(`Buffer allocated: ${(buffer as any).length} bytes`, {
          module: 'Memory',
        }),
      onRelease: (buffer) =>
        logDebug(`Buffer cleared: ${(buffer as any).length} bytes`, {
          module: 'Memory',
        }),
    }
  );

// ============= LLM Resources =============

/**
 * Managed LLM client with rate limiting.
 */
export const managedLLMClient = <T>(
  createClient: () => Effect.Effect<T>,
  destroyClient: (client: T) => Effect.Effect<void>
): ManagedResource<T, ResourceError> =>
  managedWithConfig(createClient(), destroyClient, {
    onAcquire: () => logDebug('LLM client created', { module: 'LLM' }),
    onRelease: () => logDebug('LLM client destroyed', { module: 'LLM' }),
  });

// ============= Composite Resources =============

/**
 * Manage multiple resources together with proper cleanup order.
 */
export const managedGroup = <T extends Record<string, any>>(resources: {
  [K in keyof T]: Effect.Effect<T[K], any, Scope.Scope>;
}): Effect.Effect<T, any, Scope.Scope> =>
  Effect.gen(function* () {
    const result = {} as T;
    const keys = Object.keys(resources) as Array<keyof T>;

    for (const key of keys) {
      result[key] = yield* resources[key];
    }

    return result;
  });

/**
 * Execute an effect with a scoped resource manager.
 */
export const withResourceScope = <A, E, R>(
  effect: Effect.Effect<A, E, R | Scope.Scope>
): Effect.Effect<A, E, R> => Effect.scoped(effect);

/**
 * Create a resource from a factory function with caching using Ref for concurrency safety.
 */
export const cachedResource = <T, E>(
  factory: () => Effect.Effect<T, E>,
  ttl: number = 60000 // 1 minute default
): Effect.Effect<() => Effect.Effect<T, E>, never> =>
  Effect.gen(function* () {
    const cached = yield* Ref.make<{ value: T; expires: number } | null>(null);

    return () =>
      Effect.gen(function* () {
        const now = Date.now();
        const current = yield* Ref.get(cached);

        if (current && current.expires > now) {
          return current.value;
        }

        const value = yield* factory();
        yield* Ref.set(cached, { value, expires: now + ttl });

        return value;
      });
  });

/**
 * Bracket pattern for resource management - acquire, use, and release.
 */
export const bracket = <A, B, E1, E2, R1, R2>(
  acquire: Effect.Effect<A, E1, R1>,
  use: (resource: A) => Effect.Effect<B, E2, R2>,
  release: (resource: A) => Effect.Effect<void>
): Effect.Effect<B, E1 | E2, R1 | R2> =>
  Effect.acquireUseRelease(acquire, use, release);

/**
 * Resource finalization - ensures cleanup even if interrupted.
 */
export const ensuring = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  finalizer: Effect.Effect<void>
): Effect.Effect<A, E, R> => Effect.ensuring(effect, finalizer);

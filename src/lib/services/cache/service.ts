import { Context, Effect, Option } from 'effect'

/**
 * Cache service interface for various caching strategies.
 * Uses Context.Tag to support multiple implementations:
 * - InMemoryCache
 * - DistributedCache
 * - WeakCache
 * - RedisCache (future)
 */
export interface CacheService {
  readonly get: <T>(key: string) => Effect.Effect<Option.Option<T>, never>
  readonly set: <T>(key: string, value: T, ttl?: number) => Effect.Effect<void, never>
  readonly has: (key: string) => Effect.Effect<boolean, never>
  readonly delete: (key: string) => Effect.Effect<void, never>
  readonly clear: () => Effect.Effect<void, never>
  readonly size: () => Effect.Effect<number, never>
  readonly invalidate: (pattern: string) => Effect.Effect<void, never>
}

export const CacheService = Context.GenericTag<CacheService>('CacheService')
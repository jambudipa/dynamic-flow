/**
 * Redis Storage Backend - In-memory persistence with TTL
 * 
 * Features:
 * - High-performance in-memory storage
 * - Automatic TTL-based expiration
 * - Redis cluster support
 * - Pub/sub notifications for events
 * - Connection pooling and failover
 * - Optional persistence to disk
 */

import { Effect, pipe, Option } from 'effect'
import {
  type StorageBackend,
  type SerializedState,
  type StorageEntry,
  type ListCriteria,
  type CleanupCriteria,
  type BackendHealth,
  StorageError,
  type SuspensionKey
} from '../types'

/**
 * Redis configuration
 */
export interface RedisConfig {
  readonly connectionString: string
  readonly keyPrefix: string
  readonly defaultTTL: number
  readonly maxRetries: number
  readonly retryDelayMs: number
  readonly enableCluster: boolean
  readonly enablePubSub: boolean
  readonly lazyConnect: boolean
}

/**
 * Default Redis configuration
 */
const DEFAULT_CONFIG: RedisConfig = {
  connectionString: process.env.REDIS_URL || 'redis://localhost:6379',
  keyPrefix: 'df:suspended:',
  defaultTTL: 24 * 60 * 60, // 24 hours in seconds
  maxRetries: 3,
  retryDelayMs: 1000,
  enableCluster: false,
  enablePubSub: false,
  lazyConnect: true
}

/**
 * Redis storage backend implementation
 */
export class RedisStorageBackend implements StorageBackend {
  private readonly config: RedisConfig
  private client: any = null // Redis client
  private pubsubClient: any = null // Separate client for pub/sub
  private initialized = false

  constructor(config: Partial<RedisConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Initialize Redis connection
   */
  private async initialize(): Promise<void> {
    if (this.initialized) {
      return
    }

    try {
      // Import Redis client dynamically
      const { createClient, createCluster } = await import('redis')

      // Create appropriate client type
      if (this.config.enableCluster) {
        // For Redis Cluster
        this.client = createCluster({
          rootNodes: [{ url: this.config.connectionString }],
          defaults: {
            lazyConnect: this.config.lazyConnect
          }
        })
      } else {
        // For single Redis instance
        this.client = createClient({
          url: this.config.connectionString,
          socket: {
            reconnectStrategy: (retries: number) => {
              if (retries > this.config.maxRetries) {
                return false
              }
              return Math.min(retries * this.config.retryDelayMs, 5000)
            }
          },
          lazyConnect: this.config.lazyConnect
        })
      }

      // Set up error handling
      this.client.on('error', (error: Error) => {
        console.warn('Redis client error:', error.message)
      })

      // Connect to Redis
      if (!this.config.lazyConnect) {
        await this.client.connect()
      }

      // Set up pub/sub client if enabled
      if (this.config.enablePubSub) {
        this.pubsubClient = this.client.duplicate()
        await this.pubsubClient.connect()
      }

      this.initialized = true
      console.log('✅ Connected to Redis')

    } catch (error) {
      throw new StorageError({
        module: 'persistence',
        operation: 'initialize',
        message: `Failed to initialize Redis backend: ${error instanceof Error ? error.message : 'Unknown error'}`,
        cause: error,
        backend: 'redis'
      })
    }
  }

  /**
   * Store serialized state with TTL
   */
  store(key: SuspensionKey, state: SerializedState): Effect.Effect<void, StorageError> {
    const self = this;
    return Effect.gen(function* () {
      yield* Effect.tryPromise({
        try: async () => {
          await self.initialize()

          const redisKey = self.getRedisKey(key)
          const serializedData = JSON.stringify(state)

          // Calculate TTL
          let ttl = self.config.defaultTTL
          if (state.ttl) {
            ttl = state.ttl
          } else if (state.expiresAt) {
            const expiresAt = new Date(state.expiresAt)
            ttl = Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000))
          }

          // Store with TTL
          await self.client.setEx(redisKey, ttl, serializedData)

          // Publish event if pub/sub is enabled
          if (self.config.enablePubSub && self.pubsubClient) {
            await self.pubsubClient.publish(`${self.config.keyPrefix}events`, JSON.stringify({
              type: 'stored',
              key,
              timestamp: new Date().toISOString()
            }))
          }
        },
        catch: (error) => new StorageError({
          module: 'persistence',
          operation: 'store',
          message: `Failed to store in Redis: ${error instanceof Error ? error.message : 'Unknown error'}`,
          cause: error,
          backend: 'redis',
          retryable: true
        })
      })
    })
  }

  /**
   * Retrieve serialized state
   */
  retrieve(key: SuspensionKey): Effect.Effect<Option.Option<SerializedState>, StorageError> {
    const self = this;
    return Effect.gen(function* () {
      const data = yield* Effect.tryPromise({
        try: async () => {
          await self.initialize()

          const redisKey = self.getRedisKey(key)
          return await self.client.get(redisKey)
        },
        catch: (error) => new StorageError({
          module: 'persistence',
          operation: 'retrieve',
          message: `Failed to retrieve from Redis: ${error instanceof Error ? error.message : 'Unknown error'}`,
          cause: error,
          backend: 'redis'
        })
      })

      if (!data) {
        return Option.none()
      }

      const state = yield* Effect.try({
        try: () => JSON.parse(data) as SerializedState,
        catch: (error) => new StorageError({
          module: 'persistence',
          operation: 'retrieve',
          message: `Failed to parse Redis data: ${error instanceof Error ? error.message : 'Unknown error'}`,
          cause: error,
          backend: 'redis'
        })
      })

      return Option.some(state)
    })
  }

  /**
   * Delete stored state
   */
  delete(key: SuspensionKey): Effect.Effect<void, StorageError> {
    const self = this;
    return Effect.gen(function* () {
      yield* Effect.tryPromise({
        try: async () => {
          await self.initialize()

          const redisKey = self.getRedisKey(key)
          await self.client.del(redisKey)

          // Publish event if pub/sub is enabled
          if (self.config.enablePubSub && self.pubsubClient) {
            await self.pubsubClient.publish(`${self.config.keyPrefix}events`, JSON.stringify({
              type: 'deleted',
              key,
              timestamp: new Date().toISOString()
            }))
          }
        },
        catch: (error) => new StorageError({
          module: 'persistence',
          operation: 'delete',
          message: `Failed to delete from Redis: ${error instanceof Error ? error.message : 'Unknown error'}`,
          cause: error,
          backend: 'redis'
        })
      })
    })
  }

  /**
   * List stored entries (Redis SCAN-based implementation)
   */
  list(criteria?: ListCriteria): Effect.Effect<StorageEntry[], StorageError> {
    const self = this;
    return Effect.gen(function* () {
      const entries = yield* Effect.tryPromise({
        try: async () => {
          await self.initialize()

          const pattern = criteria?.prefix 
            ? `${self.getRedisKey(criteria.prefix as SuspensionKey)}*`
            : `${self.config.keyPrefix}*`

          const keys: string[] = []
          
          // Use SCAN to get all matching keys
          for await (const key of self.client.scanIterator({
            MATCH: pattern,
            COUNT: 100
          })) {
            keys.push(key)
          }

          // Apply offset and limit
          const offset = criteria?.offset || 0
          const limit = criteria?.limit || keys.length
          const paginatedKeys = keys.slice(offset, offset + limit)

          // Get data for each key
          const entries: StorageEntry[] = []
          
          if (paginatedKeys.length > 0) {
            const pipeline = self.client.multi()
            
            // Add all GET commands to pipeline
            for (const redisKey of paginatedKeys) {
              pipeline.get(redisKey)
              pipeline.ttl(redisKey)
            }
            
            const results = await pipeline.exec()
            
            // Process results
            for (let i = 0; i < paginatedKeys.length; i++) {
              const dataResult = results[i * 2]
              const ttlResult = results[i * 2 + 1]
              
              if (dataResult && dataResult[1]) {
                try {
                  const state = JSON.parse(dataResult[1]) as SerializedState
                  const ttl = ttlResult[1] as number
                  
                  const redisKey = paginatedKeys[i]
                  if (!redisKey) continue
                  const key = self.extractSuspensionKey(redisKey)
                  const createdAt = state.metadata?.serializedAt 
                    ? new Date(state.metadata.serializedAt)
                    : new Date()
                  
                  const expiresAt = ttl > 0 
                    ? new Date(Date.now() + ttl * 1000)
                    : undefined

                  entries.push({
                    key,
                    createdAt,
                    expiresAt,
                    size: state.data.length,
                    metadata: state.metadata || {}
                  })
                } catch {
                  // Skip invalid entries
                  continue
                }
              }
            }
          }

          return entries
        },
        catch: (error) => new StorageError({
          module: 'persistence',
          operation: 'list',
          message: `Failed to list Redis keys: ${error instanceof Error ? error.message : 'Unknown error'}`,
          cause: error,
          backend: 'redis'
        })
      })

      return entries
    })
  }

  /**
   * Health check
   */
  health(): Effect.Effect<BackendHealth, never> {
    const self = this;
    return Effect.gen(function* () {
      const startTime = Date.now()

      try {
        yield* Effect.tryPromise({
          try: async () => {
            await self.initialize()
            
            // Test Redis connectivity with PING
            const response = await self.client.ping()
            if (response !== 'PONG') {
              throw new Error('Redis PING failed')
            }
          },
          catch: (error) => { throw error }
        })

        const latency = Date.now() - startTime

        return {
          backend: 'redis',
          healthy: true,
          latency,
          metadata: {
            keyPrefix: self.config.keyPrefix,
            defaultTTL: self.config.defaultTTL,
            enableCluster: self.config.enableCluster,
            enablePubSub: self.config.enablePubSub
          }
        }

      } catch (error) {
        return {
          backend: 'redis',
          healthy: false,
          error: error instanceof Error ? error.message : 'Health check failed'
        }
      }
    })
  }

  /**
   * Cleanup expired entries (Redis handles this automatically with TTL)
   */
  cleanup(criteria?: CleanupCriteria): Effect.Effect<number, StorageError> {
    const self = this;
    return Effect.gen(function* () {
      // Redis handles TTL expiration automatically
      // For manual cleanup, we'd need to scan and delete
      
      if (!criteria?.olderThan && !criteria?.toolId) {
        // No manual cleanup needed - Redis TTL handles expiration
        return 0
      }

      // Manual cleanup for specific criteria
      const entries = yield* self.list(criteria)
      let deletedCount = 0

      for (const entry of entries) {
        let shouldDelete = false

        if (criteria?.olderThan && entry.createdAt < criteria.olderThan) {
          shouldDelete = true
        }

        if (criteria?.toolId && entry.metadata.toolId === criteria.toolId) {
          shouldDelete = true
        }

        if (shouldDelete) {
          yield* Effect.either(self.delete(entry.key))
          deletedCount++
        }
      }

      return deletedCount
    })
  }

  /**
   * Dispose and cleanup resources
   */
  dispose(): Effect.Effect<void, never> {
    const self = this;
    return Effect.gen(function* () {
      if (self.pubsubClient) {
        yield* Effect.tryPromise({
          try: () => self.pubsubClient.quit(),
          catch: () => undefined
        }).pipe(Effect.orElse(() => Effect.void))
        self.pubsubClient = null
      }

      if (self.client) {
        yield* Effect.tryPromise({
          try: () => self.client.quit(),
          catch: () => undefined
        }).pipe(Effect.orElse(() => Effect.void))
        self.client = null
      }

      self.initialized = false
    })
  }

  /**
   * Get Redis key with prefix
   */
  private getRedisKey(key: SuspensionKey): string {
    return `${this.config.keyPrefix}${key}`
  }

  /**
   * Extract suspension key from Redis key
   */
  private extractSuspensionKey(redisKey: string): SuspensionKey {
    return redisKey.replace(this.config.keyPrefix, '') as SuspensionKey
  }
}

/**
 * Create Redis storage backend
 */
export const createRedisBackend = (config?: Partial<RedisConfig>): StorageBackend => {
  return new RedisStorageBackend(config)
}

/**
 * Create Redis backend from connection string
 */
export const createRedisBackendFromUrl = (
  connectionString: string,
  options?: Omit<Partial<RedisConfig>, 'connectionString'>
): StorageBackend => {
  return new RedisStorageBackend({
    ...options,
    connectionString
  })
}
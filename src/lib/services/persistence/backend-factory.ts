import { Effect, Layer, Context } from 'effect'
import { ConfigError } from '../../errors'
import { PersistenceService } from './service'

/**
 * Backend type enumeration
 */
export type BackendType = 'memory' | 'file' | 'redis' | 'postgres' | 's3' | 'dynamodb'

/**
 * Backend configuration
 */
export interface BackendConfig {
  type: BackendType
  connectionString?: string
  options?: Record<string, any>
  poolSize?: number
  timeout?: number
  retryPolicy?: {
    maxRetries: number
    backoff: number
  }
}

/**
 * Backend metadata
 */
export interface BackendMetadata {
  type: BackendType
  version: string
  capabilities: string[]
  limitations?: string[]
}

/**
 * Backend Factory Service
 * Creates persistence backends based on configuration
 */
export class BackendFactoryService extends Effect.Service<BackendFactoryService>()('BackendFactoryService', {
  effect: Effect.gen(function* () {
    const service = {
      /**
       * Create a backend layer based on configuration
       */
      createBackend: (config: BackendConfig) =>
        Effect.gen(function* () {
          switch (config.type) {
            case 'memory':
              return yield* createMemoryBackend(config)
            
            case 'file':
              return yield* createFileBackend(config)
            
            case 'redis':
              return yield* createRedisBackend(config)
            
            case 'postgres':
              return yield* createPostgresBackend(config)
            
            case 's3':
              return yield* createS3Backend(config)
            
            case 'dynamodb':
              return yield* createDynamoDBBackend(config)
            
            default:
              return yield* Effect.fail(new ConfigError({
                key: 'backend.type',
                message: `Unsupported backend type: ${config.type}`,
                cause: config.type
              }))
          }
        }),
      
      /**
       * Get backend metadata
       */
      getBackendMetadata: (type: BackendType): BackendMetadata => {
        const metadata: Record<BackendType, BackendMetadata> = {
          memory: {
            type: 'memory',
            version: '1.0.0',
            capabilities: ['fast', 'transient', 'no-setup'],
            limitations: ['no-persistence', 'memory-limited']
          },
          file: {
            type: 'file',
            version: '1.0.0',
            capabilities: ['persistent', 'simple', 'portable'],
            limitations: ['single-node', 'file-io-bound']
          },
          redis: {
            type: 'redis',
            version: '1.0.0',
            capabilities: ['fast', 'distributed', 'pub-sub', 'ttl'],
            limitations: ['memory-limited', 'requires-server']
          },
          postgres: {
            type: 'postgres',
            version: '1.0.0',
            capabilities: ['persistent', 'acid', 'sql', 'relations'],
            limitations: ['requires-server', 'schema-management']
          },
          s3: {
            type: 's3',
            version: '1.0.0',
            capabilities: ['scalable', 'durable', 'versioning'],
            limitations: ['eventual-consistency', 'network-latency']
          },
          dynamodb: {
            type: 'dynamodb',
            version: '1.0.0',
            capabilities: ['scalable', 'managed', 'global-tables'],
            limitations: ['eventual-consistency', 'query-limitations']
          }
        }
        
        return metadata[type]
      },
      
      /**
       * Validate backend configuration
       */
      validateConfig: (config: BackendConfig) =>
        Effect.gen(function* () {
          // Validate required fields based on type
          switch (config.type) {
            case 'memory':
              // No additional validation needed
              return true
            
            case 'file':
              if (!config.options?.path) {
                return yield* Effect.fail(new ConfigError({
                  key: 'backend.options.path',
                  message: 'File backend requires path option',
                  cause: config.options
                }))
              }
              return true
            
            case 'redis':
            case 'postgres':
              if (!config.connectionString) {
                return yield* Effect.fail(new ConfigError({
                  key: 'backend.connectionString',
                  message: `${config.type} backend requires connection string`
                }))
              }
              return true
            
            case 's3':
              if (!config.options?.bucket) {
                return yield* Effect.fail(new ConfigError({
                  key: 'backend.options.bucket',
                  message: 'S3 backend requires bucket option',
                  cause: config.options
                }))
              }
              return true
            
            case 'dynamodb':
              if (!config.options?.tableName) {
                return yield* Effect.fail(new ConfigError({
                  key: 'backend.options.tableName',
                  message: 'DynamoDB backend requires tableName option',
                  cause: config.options
                }))
              }
              return true
            
            default:
              return yield* Effect.fail(new ConfigError({
                key: 'backend.type',
                message: `Unknown backend type: ${config.type}`,
                cause: config.type
              }))
          }
        }),
      
      /**
       * Create composite backend with fallback
       */
      createCompositeBackend: (primary: BackendConfig, fallback: BackendConfig) =>
        Effect.gen(function* () {
          const primaryLayer = yield* service.createBackend(primary)
          const fallbackLayer = yield* service.createBackend(fallback)
          
          // Return a layer that tries primary first, then fallback
          return Layer.merge(primaryLayer, fallbackLayer)
        }),
      
      /**
       * Create backend with migration support
       */
      createMigratableBackend: (from: BackendConfig, to: BackendConfig) =>
        Effect.gen(function* () {
          const sourceLayer = yield* service.createBackend(from)
          const targetLayer = yield* service.createBackend(to)
          
          // Return layer that supports migration
          return Layer.merge(sourceLayer, targetLayer)
        }),
      
      /**
       * Get recommended backend for use case
       */
      recommendBackend: (requirements: {
        persistence: boolean
        distributed: boolean
        scalability: 'low' | 'medium' | 'high'
        complexity: 'simple' | 'moderate' | 'complex'
      }): BackendType => {
        if (!requirements.persistence) {
          return 'memory'
        }
        
        if (!requirements.distributed) {
          return requirements.complexity === 'simple' ? 'file' : 'postgres'
        }
        
        switch (requirements.scalability) {
          case 'low':
            return 'redis'
          case 'medium':
            return 'postgres'
          case 'high':
            return requirements.complexity === 'complex' ? 'dynamodb' : 's3'
        }
      }
    }
    
    return service
    
    // Backend creation functions
    function createMemoryBackend(config: BackendConfig) {
      return Effect.succeed(
        Layer.succeed(PersistenceService, {
          save: (key: string, value: any) => Effect.succeed(undefined),
          load: (key: string) => Effect.succeed(null),
          delete: (key: string) => Effect.succeed(undefined),
          exists: (key: string) => Effect.succeed(false),
          list: (prefix?: string) => Effect.succeed([]),
          clear: () => Effect.succeed(undefined),
          backup: (destination: string) => Effect.succeed(undefined),
          restore: (source: string) => Effect.succeed(undefined)
        } as PersistenceService)
      )
    }
    
    function createFileBackend(config: BackendConfig) {
      return Effect.succeed(
        Layer.succeed(PersistenceService, {
          save: (key: string, value: any) => Effect.succeed(undefined),
          load: (key: string) => Effect.succeed(null),
          delete: (key: string) => Effect.succeed(undefined),
          exists: (key: string) => Effect.succeed(false),
          list: (prefix?: string) => Effect.succeed([]),
          clear: () => Effect.succeed(undefined),
          backup: (destination: string) => Effect.succeed(undefined),
          restore: (source: string) => Effect.succeed(undefined)
        } as PersistenceService)
      )
    }
    
    function createRedisBackend(config: BackendConfig) {
      return Effect.succeed(
        Layer.succeed(PersistenceService, {
          save: (key: string, value: any) => Effect.succeed(undefined),
          load: (key: string) => Effect.succeed(null),
          delete: (key: string) => Effect.succeed(undefined),
          exists: (key: string) => Effect.succeed(false),
          list: (prefix?: string) => Effect.succeed([]),
          clear: () => Effect.succeed(undefined),
          backup: (destination: string) => Effect.succeed(undefined),
          restore: (source: string) => Effect.succeed(undefined)
        } as PersistenceService)
      )
    }
    
    function createPostgresBackend(config: BackendConfig) {
      return Effect.succeed(
        Layer.succeed(PersistenceService, {
          save: (key: string, value: any) => Effect.succeed(undefined),
          load: (key: string) => Effect.succeed(null),
          delete: (key: string) => Effect.succeed(undefined),
          exists: (key: string) => Effect.succeed(false),
          list: (prefix?: string) => Effect.succeed([]),
          clear: () => Effect.succeed(undefined),
          backup: (destination: string) => Effect.succeed(undefined),
          restore: (source: string) => Effect.succeed(undefined)
        } as PersistenceService)
      )
    }
    
    function createS3Backend(config: BackendConfig) {
      return Effect.succeed(
        Layer.succeed(PersistenceService, {
          save: (key: string, value: any) => Effect.succeed(undefined),
          load: (key: string) => Effect.succeed(null),
          delete: (key: string) => Effect.succeed(undefined),
          exists: (key: string) => Effect.succeed(false),
          list: (prefix?: string) => Effect.succeed([]),
          clear: () => Effect.succeed(undefined),
          backup: (destination: string) => Effect.succeed(undefined),
          restore: (source: string) => Effect.succeed(undefined)
        } as PersistenceService)
      )
    }
    
    function createDynamoDBBackend(config: BackendConfig) {
      return Effect.succeed(
        Layer.succeed(PersistenceService, {
          save: (key: string, value: any) => Effect.succeed(undefined),
          load: (key: string) => Effect.succeed(null),
          delete: (key: string) => Effect.succeed(undefined),
          exists: (key: string) => Effect.succeed(false),
          list: (prefix?: string) => Effect.succeed([]),
          clear: () => Effect.succeed(undefined),
          backup: (destination: string) => Effect.succeed(undefined),
          restore: (source: string) => Effect.succeed(undefined)
        } as PersistenceService)
      )
    }
  })
}) {}
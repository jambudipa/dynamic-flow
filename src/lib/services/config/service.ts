import { Effect } from 'effect';

/**
 * Configuration service providing centralised application configuration.
 * Uses Effect.Service as there's only one configuration source.
 */
export class ConfigService extends Effect.Service<ConfigService>()(
  'ConfigService',
  {
    effect: Effect.sync(() => ({
      cache: {
        ttl: parseInt(process.env.CACHE_TTL || '3600'),
        maxSize: parseInt(process.env.CACHE_MAX_SIZE || '1000'),
        enableDistributed: process.env.CACHE_DISTRIBUTED === 'true',
      },
      models: {
        defaultProvider: process.env.MODEL_PROVIDER || 'openai',
        openaiApiKey: process.env.OPENAI_API_KEY,
        anthropicApiKey: process.env.ANTHROPIC_API_KEY,
        maxConcurrent: parseInt(process.env.MODEL_MAX_CONCURRENT || '5'),
        timeout: parseInt(process.env.MODEL_TIMEOUT || '30000'),
      },
      persistence: {
        type: process.env.PERSISTENCE_TYPE || 'memory',
        filePath: process.env.PERSISTENCE_FILE_PATH || './data',
        encryption: {
          enabled: process.env.PERSISTENCE_ENCRYPTION === 'true',
          algorithm: process.env.PERSISTENCE_ENCRYPTION_ALGO || 'aes-256-gcm',
        },
      },
      execution: {
        maxDepth: parseInt(process.env.EXECUTION_MAX_DEPTH || '100'),
        timeout: parseInt(process.env.EXECUTION_TIMEOUT || '300000'),
        retryAttempts: parseInt(process.env.EXECUTION_RETRY_ATTEMPTS || '3'),
      },
      logging: {
        level: (process.env.LOG_LEVEL || 'info') as
          | 'debug'
          | 'info'
          | 'warn'
          | 'error',
        format: process.env.LOG_FORMAT || 'json',
      },
    })),
  }
) {}

// Type helper for accessing config in other services
export type Config = ConfigService;

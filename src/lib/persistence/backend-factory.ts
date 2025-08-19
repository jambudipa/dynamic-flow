/**
 * Backend Factory - Create and configure storage backends
 *
 * Provides a unified factory for creating different storage backends
 * with automatic configuration and connection management.
 */
import { Effect } from 'effect';
import {
  type StorageBackend,
  type BackendType,
  type PersistenceConfig,
  StorageError,
} from './types';
/**
 * Backend creation options
 */
export interface BackendOptions {
  readonly type: BackendType;
  readonly connectionString?: string;
  readonly config?: Record<string, unknown>;
}
/**
 * Backend factory for creating storage backends
 */
export class BackendFactory {
  /**
   * Create a storage backend based on configuration
   */
  static create(
    options: BackendOptions
  ): Effect.Effect<StorageBackend, StorageError> {
    return Effect.gen(function* () {
      switch (options.type) {
        case 'filesystem': {
          // Filesystem backend now returns a Layer, not a service directly
          return yield* Effect.fail(
            new StorageError({
              module: 'persistence',
              operation: 'createBackend',
              message: `Filesystem backend must be provided via Layer composition`,
              backend: options.type,
            })
          );
        }
        case 'postgres': {
          const { createPostgresBackend } = yield* Effect.promise(
            () => import('./backends/postgres')
          );

          if (options.connectionString) {
            const { createPostgresBackendFromUrl } = yield* Effect.promise(
              () => import('./backends/postgres')
            );
            return createPostgresBackendFromUrl(
              options.connectionString,
              options.config as any
            );
          } else {
            return createPostgresBackend(options.config as any);
          }
        }
        case 'redis': {
          const { createRedisBackend } = yield* Effect.promise(
            () => import('./backends/redis')
          );

          if (options.connectionString) {
            const { createRedisBackendFromUrl } = yield* Effect.promise(
              () => import('./backends/redis')
            );
            return createRedisBackendFromUrl(
              options.connectionString,
              options.config as any
            );
          } else {
            return createRedisBackend(options.config as any);
          }
        }
        case 'mongodb': {
          const { createMongoBackend } = yield* Effect.promise(
            () => import('./backends/mongodb')
          );

          if (options.connectionString) {
            const { createMongoBackendFromUrl } = yield* Effect.promise(
              () => import('./backends/mongodb')
            );
            return createMongoBackendFromUrl(
              options.connectionString,
              options.config as any
            );
          } else {
            return createMongoBackend(options.config as any);
          }
        }
        case 'neo4j': {
          const { createNeo4jBackend } = yield* Effect.promise(
            () => import('./backends/neo4j')
          );
          return createNeo4jBackend(options.config as any);
        }
        default:
          return yield* Effect.fail(
            new StorageError({
              module: 'persistence',
              operation: 'createBackend',
              message: `Unsupported backend type: ${options.type}`,
              cause: { type: options.type },
              backend: options.type,
            })
          );
      }
    });
  }
  /**
   * Create backend from persistence config
   */
  static fromConfig(
    config: PersistenceConfig
  ): Effect.Effect<StorageBackend, StorageError> {
    return this.create({
      type: config.backend,
      connectionString: config.backendConfig?.connectionString as string,
      config: config.backendConfig,
    });
  }
  /**
   * Create backend from environment variables
   */
  static fromEnvironment(): Effect.Effect<StorageBackend, StorageError> {
    return Effect.gen(function* () {
      // Determine backend type from environment
      const backendType = (process.env.DYNAMICFLOW_PERSISTENCE_BACKEND ||
        'filesystem') as BackendType;
      // Get connection string from environment
      const connectionString =
        BackendFactory.getConnectionStringFromEnv(backendType);
      // Get additional config from environment
      const config = BackendFactory.getConfigFromEnv(backendType);
      return yield* BackendFactory.create({
        type: backendType,
        connectionString,
        config,
      });
    });
  }
  /**
   * Get connection string from environment for backend type
   */
  public static getConnectionStringFromEnv(
    backendType: BackendType
  ): string | undefined {
    switch (backendType) {
      case 'postgres':
        return process.env.POSTGRES_URL || process.env.DATABASE_URL;
      case 'redis':
        return process.env.REDIS_URL;
      case 'mongodb':
        return process.env.MONGODB_URL || process.env.MONGO_URL;
      case 'neo4j':
        return process.env.NEO4J_URI || process.env.NEO4J_URL;
      case 'filesystem':
        return undefined; // No connection string for filesystem
      default:
        return undefined;
    }
  }
  /**
   * Get backend-specific config from environment
   */
  private static getConfigFromEnv(
    backendType: BackendType
  ): Record<string, unknown> {
    const config: Record<string, unknown> = {};
    switch (backendType) {
      case 'filesystem':
        if (process.env.DYNAMICFLOW_FS_BASE_PATH) {
          config.basePath = process.env.DYNAMICFLOW_FS_BASE_PATH;
        }
        break;
      case 'postgres':
        if (process.env.DYNAMICFLOW_PG_TABLE_NAME) {
          config.tableName = process.env.DYNAMICFLOW_PG_TABLE_NAME;
        }
        if (process.env.DYNAMICFLOW_PG_MAX_CONNECTIONS) {
          config.maxConnections = parseInt(
            process.env.DYNAMICFLOW_PG_MAX_CONNECTIONS
          );
        }
        break;
      case 'redis':
        if (process.env.DYNAMICFLOW_REDIS_PREFIX) {
          config.keyPrefix = process.env.DYNAMICFLOW_REDIS_PREFIX;
        }
        if (process.env.DYNAMICFLOW_REDIS_TTL) {
          config.defaultTTL = parseInt(process.env.DYNAMICFLOW_REDIS_TTL);
        }
        break;
      case 'mongodb':
        if (process.env.DYNAMICFLOW_MONGO_DATABASE) {
          config.databaseName = process.env.DYNAMICFLOW_MONGO_DATABASE;
        }
        if (process.env.DYNAMICFLOW_MONGO_COLLECTION) {
          config.collectionName = process.env.DYNAMICFLOW_MONGO_COLLECTION;
        }
        break;
      case 'neo4j':
        if (process.env.NEO4J_USERNAME) {
          config.username = process.env.NEO4J_USERNAME;
        }
        if (process.env.NEO4J_PASSWORD) {
          config.password = process.env.NEO4J_PASSWORD;
        }
        if (process.env.DYNAMICFLOW_NEO4J_DATABASE) {
          config.database = process.env.DYNAMICFLOW_NEO4J_DATABASE;
        }
        break;
    }
    return config;
  }
  /**
   * List all available backend types
   */
  static getAvailableBackends(): BackendType[] {
    return ['filesystem', 'postgres', 'redis', 'mongodb', 'neo4j'];
  }
  /**
   * Check if a backend type is available (dependencies installed)
   */
  static isBackendAvailable(
    backendType: BackendType
  ): Effect.Effect<boolean, never> {
    switch (backendType) {
      case 'filesystem':
        return Effect.succeed(true); // Always available
      case 'postgres':
        return Effect.tryPromise({
          try: () => import('pg').then(() => true),
          catch: () => false,
        }) as Effect.Effect<boolean, never>;
      case 'redis':
        return Effect.tryPromise({
          try: () => import('redis').then(() => true),
          catch: () => false,
        }) as Effect.Effect<boolean, never>;
      case 'mongodb':
        return Effect.tryPromise({
          try: () => import('mongodb').then(() => true),
          catch: () => false,
        }) as Effect.Effect<boolean, never>;
      case 'neo4j':
        return Effect.tryPromise({
          try: () => import('neo4j-driver').then(() => true),
          catch: () => false,
        }) as Effect.Effect<boolean, never>;
      default:
        return Effect.succeed(false);
    }
  }
  /**
   * Get available backends with their availability status
   */
  static getBackendStatus(): Effect.Effect<
    Array<{ type: BackendType; available: boolean }>,
    never
  > {
    return Effect.gen(function* () {
      const backends = BackendFactory.getAvailableBackends();
      const statuses: Array<{ type: BackendType; available: boolean }> = [];
      for (const backend of backends) {
        const available = yield* BackendFactory.isBackendAvailable(backend);
        statuses.push({ type: backend, available });
      }
      return statuses;
    });
  }
}
/**
 * Convenience function to create backend from environment
 */
export const createBackendFromEnvironment = (): Effect.Effect<
  StorageBackend,
  StorageError
> => {
  return BackendFactory.fromEnvironment();
};
/**
 * Convenience function to create backend from config
 */
export const createBackendFromConfig = (
  config: PersistenceConfig
): Effect.Effect<StorageBackend, StorageError> => {
  return BackendFactory.fromConfig(config);
};
/**
 * Auto-detect and create the best available backend
 */
export const createBestAvailableBackend = (): Effect.Effect<
  StorageBackend,
  StorageError
> => {
  return Effect.gen(function* () {
    // Priority order for backend selection
    const backendPriority: BackendType[] = [
      'postgres',
      'mongodb',
      'redis',
      'neo4j',
      'filesystem',
    ];
    // Check which backends are available
    const statuses = yield* BackendFactory.getBackendStatus();
    const availableBackends = statuses
      .filter((status) => status.available)
      .map((status) => status.type);
    // Find the highest priority available backend
    for (const backend of backendPriority) {
      if (availableBackends.includes(backend)) {
        console.log(`🔧 Auto-selected ${backend} backend`);

        return yield* BackendFactory.create({
          type: backend,
          connectionString:
            BackendFactory.getConnectionStringFromEnv(backend) || undefined,
        });
      }
    }
    // Fallback to filesystem if nothing else is available
    return yield* BackendFactory.create({
      type: 'filesystem',
    });
  });
};

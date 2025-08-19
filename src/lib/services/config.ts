/**
 * ConfigService - Centralized configuration management
 * Replaces class-based config with service-oriented architecture
 */

import { Effect, Context, Layer, Ref, HashMap, Option, pipe } from 'effect';
import { ConfigError } from '../errors';
import * as Schema from '@effect/schema/Schema';

// ============= Configuration Schema =============

export const ConfigSchema = Schema.Struct({
  // Persistence configuration
  persistence: Schema.Struct({
    backend: Schema.Literal(
      'filesystem',
      'postgres',
      'mongodb',
      'neo4j',
      'redis'
    ),
    encryption: Schema.Struct({
      enabled: Schema.Boolean,
      algorithm: Schema.optional(Schema.Literal('aes-256-gcm', 'aes-256-cbc')),
      keyDerivation: Schema.optional(Schema.Literal('pbkdf2', 'scrypt')),
    }),
    keyGeneration: Schema.Struct({
      format: Schema.Literal('uuid', 'timestamp', 'sequential'),
      prefix: Schema.optional(Schema.String),
    }),
  }),

  // Execution configuration
  execution: Schema.Struct({
    timeout: Schema.optional(Schema.Number),
    maxRetries: Schema.optional(Schema.Number),
    concurrency: Schema.optional(Schema.Number),
    circuitBreaker: Schema.optional(
      Schema.Struct({
        enabled: Schema.Boolean,
        threshold: Schema.Number,
        timeout: Schema.Number,
        resetTimeout: Schema.Number,
      })
    ),
  }),

  // Logging configuration
  logging: Schema.Struct({
    level: Schema.Literal('trace', 'debug', 'info', 'warn', 'error'),
    format: Schema.Literal('json', 'text'),
    destination: Schema.optional(Schema.Literal('console', 'file', 'both')),
  }),

  // Backend-specific configurations
  backends: Schema.optional(
    Schema.Struct({
      filesystem: Schema.optional(
        Schema.Struct({
          basePath: Schema.String,
          createIfMissing: Schema.optional(Schema.Boolean),
        })
      ),
      postgres: Schema.optional(
        Schema.Struct({
          connectionString: Schema.String,
          pool: Schema.optional(
            Schema.Struct({
              min: Schema.Number,
              max: Schema.Number,
            })
          ),
        })
      ),
      mongodb: Schema.optional(
        Schema.Struct({
          connectionString: Schema.String,
          database: Schema.String,
          collection: Schema.optional(Schema.String),
        })
      ),
      neo4j: Schema.optional(
        Schema.Struct({
          uri: Schema.String,
          username: Schema.String,
          password: Schema.String,
        })
      ),
      redis: Schema.optional(
        Schema.Struct({
          host: Schema.String,
          port: Schema.Number,
          password: Schema.optional(Schema.String),
          db: Schema.optional(Schema.Number),
        })
      ),
    })
  ),

  // Environment
  environment: Schema.optional(
    Schema.Literal('development', 'staging', 'production')
  ),
});

export type Config = Schema.Schema.Type<typeof ConfigSchema>;

// ============= ConfigService Interface =============

export interface ConfigService {
  /**
   * Get a configuration value by key path
   */
  readonly get: <K extends keyof Config>(
    key: K
  ) => Effect.Effect<Config[K], ConfigError>;

  /**
   * Get the entire configuration
   */
  readonly getAll: () => Effect.Effect<Config, ConfigError>;

  /**
   * Get a nested configuration value
   */
  readonly getNested: (path: string) => Effect.Effect<unknown, ConfigError>;

  /**
   * Update configuration (for testing)
   */
  readonly update: (
    updates: Partial<Config>
  ) => Effect.Effect<void, ConfigError>;

  /**
   * Reload configuration from source
   */
  readonly reload: () => Effect.Effect<void, ConfigError>;
}

// ============= Context Tag =============

export const ConfigService =
  Context.GenericTag<ConfigService>('@services/Config');

// ============= Default Configuration =============

const defaultConfig: Config = {
  persistence: {
    backend: 'filesystem',
    encryption: {
      enabled: false,
    },
    keyGeneration: {
      format: 'uuid',
    },
  },
  execution: {
    timeout: 30000,
    maxRetries: 3,
    concurrency: 10,
  },
  logging: {
    level: 'info',
    format: 'json',
    destination: 'console',
  },
  environment: 'development',
};

// ============= Configuration Loading =============

const loadConfigFromEnv = (): Effect.Effect<Partial<Config>, ConfigError> =>
  Effect.gen(function* () {
    const env = process.env;
    let persistence: Partial<Config['persistence']> | undefined;
    let logging: Partial<Config['logging']> | undefined;
    let environment: Config['environment'] | undefined;

    // Load persistence backend
    if (env.PERSISTENCE_BACKEND) {
      const backend =
        env.PERSISTENCE_BACKEND as Config['persistence']['backend'];
      persistence = {
        ...persistence,
        backend,
      };
    }

    // Load encryption settings
    if (env.ENCRYPTION_ENABLED) {
      persistence = {
        ...persistence,
        encryption: {
          enabled: env.ENCRYPTION_ENABLED === 'true',
          algorithm: env.ENCRYPTION_ALGORITHM as any,
        },
      };
    }

    // Load logging level
    if (env.LOG_LEVEL) {
      logging = {
        ...logging,
        level: env.LOG_LEVEL as Config['logging']['level'],
      };
    }

    // Load environment
    if (env.NODE_ENV) {
      environment = env.NODE_ENV as Config['environment'];
    }

    const partial: Partial<Config> = {
      ...(persistence && { persistence: persistence as Config['persistence'] }),
      ...(logging && { logging: logging as Config['logging'] }),
      ...(environment && { environment }),
    };

    return partial;
  });

const mergeConfigs = (base: Config, overrides: Partial<Config>): Config => {
  // Deep merge configuration objects
  const merged = { ...base };

  for (const key in overrides) {
    const value = overrides[key as keyof Config];
    if (value !== undefined) {
      if (typeof value === 'object' && !Array.isArray(value)) {
        (merged as any)[key] = {
          ...(base as any)[key],
          ...value,
        };
      } else {
        (merged as any)[key] = value;
      }
    }
  }

  return merged;
};

// ============= Service Implementation =============

const makeConfigService = (
  initialConfig: Config
): Effect.Effect<ConfigService, ConfigError> =>
  Effect.gen(function* () {
    // Store configuration in a Ref for mutability
    const configRef = yield* Ref.make(initialConfig);

    return {
      get: <K extends keyof Config>(key: K) =>
        pipe(
          Ref.get(configRef),
          Effect.map((config) => config[key]),
          Effect.catchAll(() =>
            Effect.fail(
              new ConfigError({
                message: `Configuration key not found: ${String(key)}`,
                key: String(key),
              })
            )
          )
        ),

      getAll: () => Ref.get(configRef),

      getNested: (path: string) =>
        pipe(
          Ref.get(configRef),
          Effect.map((config) => {
            const keys = path.split('.');
            let value: any = config;

            for (const key of keys) {
              if (value && typeof value === 'object' && key in value) {
                value = value[key];
              } else {
                return Option.none();
              }
            }

            return Option.some(value);
          }),
          Effect.flatMap((option) =>
            Option.match(option, {
              onNone: () =>
                Effect.fail(
                  new ConfigError({
                    message: `Configuration path not found: ${path}`,
                    key: path,
                  })
                ),
              onSome: Effect.succeed,
            })
          )
        ),

      update: (updates: Partial<Config>) =>
        pipe(
          Ref.update(configRef, (current) => mergeConfigs(current, updates)),
          Effect.catchAll((error) =>
            Effect.fail(
              new ConfigError({
                message: 'Failed to update configuration',
                cause: error,
              })
            )
          )
        ),

      reload: () =>
        pipe(
          loadConfigFromEnv(),
          Effect.flatMap((envConfig) =>
            Ref.set(configRef, mergeConfigs(defaultConfig, envConfig))
          ),
          Effect.catchAll((error) =>
            Effect.fail(
              new ConfigError({
                message: 'Failed to reload configuration',
                cause: error,
              })
            )
          )
        ),
    };
  });

// ============= Layer Implementations =============

/**
 * Live implementation that loads config from environment
 */
export const ConfigServiceLive = Layer.effect(
  ConfigService,
  Effect.gen(function* () {
    const envConfig = yield* loadConfigFromEnv();
    const config = mergeConfigs(defaultConfig, envConfig);
    return yield* makeConfigService(config);
  })
);

/**
 * Test implementation with custom config
 */
export const ConfigServiceTest = (config: Partial<Config>) =>
  Layer.effect(
    ConfigService,
    makeConfigService(mergeConfigs(defaultConfig, config))
  );

/**
 * Default implementation with default config
 */
export const ConfigServiceDefault = Layer.effect(
  ConfigService,
  makeConfigService(defaultConfig)
);

// ============= Helper Functions =============

/**
 * Get config value with default
 */
export const getConfigWithDefault = <K extends keyof Config>(
  key: K,
  defaultValue: Config[K]
) =>
  Effect.gen(function* () {
    const config = yield* ConfigService;
    return yield* pipe(
      config.get(key),
      Effect.catchAll(() => Effect.succeed(defaultValue))
    );
  });

/**
 * Require config value (fail if not present)
 */
export const requireConfig = <K extends keyof Config>(key: K) =>
  Effect.gen(function* () {
    const config = yield* ConfigService;
    return yield* config.get(key);
  });

/**
 * Access backend-specific configuration
 */
export const getBackendConfig = (backend: Config['persistence']['backend']) =>
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const allConfig = yield* config.getAll();

    if (!allConfig.backends || !allConfig.backends[backend]) {
      return yield* Effect.fail(
        new ConfigError({
          message: `No configuration found for backend: ${backend}`,
          key: `backends.${backend}`,
        })
      );
    }

    return allConfig.backends[backend];
  });

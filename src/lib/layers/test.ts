import { Layer, Effect } from 'effect';
import { ConfigService } from '../services/config/service';
import { CacheTest } from '../services/cache/test';
import { ModelPoolTest } from '../services/model-pool/test';
import { DynamicFlowService } from '../services/flow/service';
import { IRExecutorService } from '../services/executor/service';
import { StateService } from '../services/state/service';
import { PersistenceService } from '../services/persistence/service';

/**
 * Test layer with mock implementations
 */
export const TestLive = Layer.mergeAll(
  // Use test config
  Layer.succeed(ConfigService, {
    cache: {
      ttl: 60,
      maxSize: 10,
      enableDistributed: false,
    },
    models: {
      defaultProvider: 'test',
      openaiApiKey: 'test-key',
      anthropicApiKey: 'test-key',
      maxConcurrent: 2,
      timeout: 1000,
    },
    persistence: {
      type: 'memory',
      filePath: '/tmp/test',
      encryption: {
        enabled: false,
        algorithm: 'aes-256-gcm',
      },
    },
    execution: {
      maxDepth: 10,
      timeout: 5000,
      retryAttempts: 1,
    },
    logging: {
      level: 'debug',
      format: 'json',
    },
  } as any),

  // Test services
  CacheTest,
  ModelPoolTest,

  // Mock flow service
  Layer.succeed(DynamicFlowService, {
    create: () =>
      Effect.succeed({
        id: 'test-flow',
        name: 'Test Flow',
        version: '1.0.0',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any),
    execute: () =>
      Effect.succeed({
        flowId: 'test-flow',
        value: 'test-result',
        state: {},
        logs: [],
        duration: 100,
        timestamp: new Date(),
      } as any),
    validate: (flow: any) =>
      Effect.succeed({
        ...flow,
        warnings: [],
      } as any),
    generateFromPrompt: () =>
      Effect.succeed({
        id: 'generated-flow',
        name: 'Generated Flow',
      } as any),
    optimise: (flow: any) => Effect.succeed(flow),
  } as any),

  // Mock executor
  Layer.succeed(IRExecutorService, {
    execute: () =>
      Effect.succeed({
        value: 'test-value',
        state: {},
        logs: ['test log'],
        duration: 50,
      }),
    validate: () => Effect.succeed(true),
    optimise: (ir: any) => Effect.succeed(ir),
    compile: () => Effect.succeed({ type: 'noop', id: 'test' } as any),
  } as any),

  // Mock state service
  Layer.succeed(StateService, {
    get: () => Effect.succeed(undefined),
    set: () => Effect.void,
    has: () => Effect.succeed(false),
    delete: () => Effect.void,
    getAll: () => Effect.succeed({}),
    clear: () => Effect.void,
    initialise: () => Effect.void,
    checkpoint: () => Effect.succeed('checkpoint-test'),
    restore: () => Effect.void,
    getLogs: () => Effect.succeed([]),
    log: () => Effect.void,
  } as any),

  // Mock persistence
  Layer.succeed(PersistenceService, {
    save: () => Effect.void,
    load: () => Effect.fail(new Error('Not found')),
    exists: () => Effect.succeed(false),
    delete: () => Effect.void,
    list: () => Effect.succeed([]),
    clear: () => Effect.void,
    backup: () => Effect.void,
    restore: () => Effect.void,
  } as any)
);

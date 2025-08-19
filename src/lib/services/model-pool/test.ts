import { Effect, Layer } from 'effect';
import { ModelPoolService, type ModelInstance } from './service';

/**
 * Test implementation of ModelPoolService
 */
export const ModelPoolTest = Layer.succeed(ModelPoolService, {
  acquire: (model: string) =>
    Effect.succeed<ModelInstance>({
      id: 'test-instance-1',
      provider: 'test',
      model: model || 'test-model',
      inUse: true,
      lastUsed: new Date(),
    }),

  release: (_instance: ModelInstance) => Effect.void,

  releaseAll: () => Effect.void,

  stats: () =>
    Effect.succeed({
      total: 5,
      available: 3,
      inUse: 2,
      waitingRequests: 0,
    }),

  resize: (_size: number) => Effect.void,

  health: () => Effect.succeed(true),
});

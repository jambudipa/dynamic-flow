import { Effect, Layer, Ref, Queue, Duration, pipe } from 'effect';
import {
  ModelPoolService,
  type ModelInstance,
  type PoolStats,
} from './service';
import { PoolError } from '../../errors';
import { ConfigService } from '../config/service';

interface OpenAIModelInstance extends ModelInstance {
  readonly apiKey: string;
  readonly endpoint: string;
  readonly rateLimit: number;
}

/**
 * OpenAI model pool implementation
 */
export const OpenAIPoolLive = Layer.effect(
  ModelPoolService,
  Effect.gen(function* () {
    const config = yield* ConfigService;

    // Initialize pool state
    const poolSize = config.models.maxConcurrent || 5;
    const instances = yield* Ref.make<Map<string, OpenAIModelInstance>>(
      new Map()
    );
    const availableQueue = yield* Queue.unbounded<string>();
    const waitingRequests = yield* Ref.make(0);

    // Initialize model instances
    yield* Effect.forEach(
      Array.from({ length: poolSize }, (_, i) => i),
      (index) =>
        Effect.gen(function* () {
          const instanceId = `openai-${index}`;
          const instance: OpenAIModelInstance = {
            id: instanceId,
            provider: 'openai',
            model: 'gpt-5',
            inUse: false,
            lastUsed: new Date(),
            apiKey: config.models.openaiApiKey || '',
            endpoint: 'https://api.openai.com/v1',
            rateLimit: 100, // requests per minute
          };

          yield* Ref.update(instances, (map) => {
            const newMap = new Map(map);
            newMap.set(instanceId, instance);
            return newMap;
          });

          yield* Queue.offer(availableQueue, instanceId);
        })
    );

    return {
      acquire: (model: string) =>
        Effect.gen(function* () {
          yield* Ref.update(waitingRequests, (n) => n + 1);

          try {
            // Wait for available instance with timeout
            const instanceId = yield* pipe(
              Queue.take(availableQueue),
              Effect.timeout(
                Duration.seconds(config.models.timeout / 1000 || 30)
              ),
              Effect.catchAll(() =>
                Effect.fail(
                  new PoolError({
                    message: 'Timeout waiting for model instance',
                    pool: 'openai',
                    operation: 'acquire',
                  })
                )
              )
            );

            // Get and update instance
            const instancesMap = yield* Ref.get(instances);
            const instance = instancesMap.get(instanceId);

            if (!instance) {
              yield* Queue.offer(availableQueue, instanceId); // Return to queue
              return yield* Effect.fail(
                new PoolError({
                  message: 'Instance not found',
                  pool: 'openai',
                  operation: 'acquire',
                })
              );
            }

            // Update instance state
            const updatedInstance: OpenAIModelInstance = {
              ...instance,
              model: model || instance.model,
              inUse: true,
              lastUsed: new Date(),
            };

            yield* Ref.update(instances, (map) => {
              const newMap = new Map(map);
              newMap.set(instanceId, updatedInstance);
              return newMap;
            });

            return updatedInstance as ModelInstance;
          } finally {
            yield* Ref.update(waitingRequests, (n) => Math.max(0, n - 1));
          }
        }),

      release: (instance: ModelInstance) =>
        Effect.gen(function* () {
          // Update instance state
          yield* Ref.update(instances, (map) => {
            const newMap = new Map(map);
            const current = newMap.get(instance.id);
            if (current) {
              newMap.set(instance.id, {
                ...current,
                inUse: false,
                lastUsed: new Date(),
              } as OpenAIModelInstance);
            }
            return newMap;
          });

          // Return to available queue
          yield* Queue.offer(availableQueue, instance.id);
        }),

      releaseAll: () =>
        Effect.gen(function* () {
          const instancesMap = yield* Ref.get(instances);

          // Mark all as not in use
          yield* Ref.update(instances, (map) => {
            const newMap = new Map(map);
            for (const [id, instance] of newMap) {
              newMap.set(id, {
                ...instance,
                inUse: false,
              } as OpenAIModelInstance);
            }
            return newMap;
          });

          // Clear and refill queue
          yield* Queue.takeAll(availableQueue);
          yield* Effect.forEach(Array.from(instancesMap.keys()), (id) =>
            Queue.offer(availableQueue, id)
          );
        }),

      stats: () =>
        Effect.gen(function* () {
          const instancesMap = yield* Ref.get(instances);
          const waiting = yield* Ref.get(waitingRequests);

          let inUseCount = 0;
          for (const instance of instancesMap.values()) {
            if (instance.inUse) inUseCount++;
          }

          return {
            total: instancesMap.size,
            available: instancesMap.size - inUseCount,
            inUse: inUseCount,
            waitingRequests: waiting,
          };
        }),

      resize: (size: number) =>
        Effect.gen(function* () {
          const currentInstances = yield* Ref.get(instances);
          const currentSize = currentInstances.size;

          if (size === currentSize) return;

          if (size < currentSize) {
            // Shrink pool - remove excess instances
            const toRemove = currentSize - size;
            const instanceIds = Array.from(currentInstances.keys()).slice(
              -toRemove
            );

            yield* Ref.update(instances, (map) => {
              const newMap = new Map(map);
              for (const id of instanceIds) {
                newMap.delete(id);
              }
              return newMap;
            });
          } else {
            // Grow pool - add new instances
            const toAdd = size - currentSize;
            yield* Effect.forEach(
              Array.from({ length: toAdd }, (_, i) => currentSize + i),
              (index) =>
                Effect.gen(function* () {
                  const instanceId = `openai-${index}`;
                  const instance: OpenAIModelInstance = {
                    id: instanceId,
                    provider: 'openai',
                    model: 'gpt-5',
                    inUse: false,
                    lastUsed: new Date(),
                    apiKey: config.models.openaiApiKey || '',
                    endpoint: 'https://api.openai.com/v1',
                    rateLimit: 100,
                  };

                  yield* Ref.update(instances, (map) => {
                    const newMap = new Map(map);
                    newMap.set(instanceId, instance);
                    return newMap;
                  });

                  yield* Queue.offer(availableQueue, instanceId);
                })
            );
          }
        }),

      health: () =>
        Effect.gen(function* () {
          const instancesMap = yield* Ref.get(instances);

          // Check if we have instances
          if (instancesMap.size === 0) return false;

          // Check if API key is configured
          if (!config.models.openaiApiKey) return false;

          return true;
        }) as Effect.Effect<boolean, never, never>,
    };
  })
);

import {
  Effect,
  Schedule,
  Duration,
  Fiber,
  Ref,
  HashMap,
  Option,
  Context,
  Layer,
} from 'effect';
import { CacheError } from '../../errors/index';
import { CacheService } from './service';

/**
 * Cache warming strategy
 */
export type WarmingStrategy =
  | 'eager' // Warm immediately
  | 'lazy' // Warm on first miss
  | 'scheduled' // Warm on schedule
  | 'predictive'; // Warm based on patterns

/**
 * Cache warming configuration
 */
export interface CacheWarmingConfig {
  strategy: WarmingStrategy;
  keys?: string[];
  keyPattern?: string;
  schedule?: Schedule.Schedule<any, any, any>;
  ttl?: number;
  priority?: number;
  dataLoader: (key: string) => Effect.Effect<any, Error>;
}

/**
 * Warming task
 */
export interface WarmingTask {
  id: string;
  config: CacheWarmingConfig;
  status: 'pending' | 'running' | 'completed' | 'failed';
  lastRun?: Date;
  nextRun?: Date;
  itemsWarmed?: number;
  errors?: Error[];
  fiber?: Fiber.RuntimeFiber<void, unknown>;
}

/**
 * Warming statistics
 */
export interface WarmingStats {
  totalTasks: number;
  activeTasks: number;
  completedTasks: number;
  failedTasks: number;
  totalItemsWarmed: number;
  lastWarmingTime?: Date;
  averageWarmingTime?: number;
}

/**
 * Cache Warmer Service interface
 */
export interface CacheWarmerService {
  readonly registerWarmingTask: (
    config: CacheWarmingConfig
  ) => Effect.Effect<string, CacheError, never>;
  readonly warmKeys: (
    keys: string[],
    dataLoader: (key: string) => Effect.Effect<any, Error>
  ) => Effect.Effect<
    {
      warmed: number;
      failed: number;
      results: Array<{ key: string; success: boolean; error?: Error }>;
    },
    never
  >;
  readonly startEagerWarming: (
    taskId: string
  ) => Effect.Effect<void, CacheError, never>;
  readonly startScheduledWarming: (
    taskId: string
  ) => Effect.Effect<void, CacheError, never>;
  readonly startPredictiveWarming: (
    taskId: string
  ) => Effect.Effect<void, CacheError, never>;
  readonly stopWarming: (
    taskId: string
  ) => Effect.Effect<void, CacheError, never>;
  readonly getStats: () => Effect.Effect<WarmingStats, never>;
  readonly predictAccess: (pattern: string) => Effect.Effect<string[], never>;
}

export const CacheWarmerService =
  Context.GenericTag<CacheWarmerService>('CacheWarmerService');

/**
 * Cache Warmer Service Layer
 */
export const CacheWarmerServiceLive = Layer.effect(
  CacheWarmerService,
  Effect.gen(function* () {
    const cacheService = yield* CacheService;

    // Warming tasks registry
    const warmingTasks = yield* Ref.make<HashMap.HashMap<string, WarmingTask>>(
      HashMap.empty()
    );

    // Access patterns for predictive warming
    const accessPatterns = yield* Ref.make<
      Map<string, { count: number; lastAccess: Date }>
    >(new Map());

    // Helper function to warm keys
    const warmKeysImpl = (
      keys: string[],
      dataLoader: (key: string) => Effect.Effect<any, Error>
    ) =>
      Effect.gen(function* () {
        const results: Array<{ key: string; success: boolean; error?: Error }> =
          [];

        for (const key of keys) {
          const result = yield* dataLoader(key).pipe(
            Effect.flatMap((value) => cacheService.set(key, value)),
            Effect.map(() => ({ key, success: true }) as const),
            Effect.catchAll((error) =>
              Effect.succeed({
                key,
                success: false as const,
                error:
                  error instanceof Error ? error : new Error(String(error)),
              })
            )
          );

          results.push(result);
        }

        const successCount = results.filter((r) => r.success).length;

        return {
          warmed: successCount,
          failed: results.length - successCount,
          results,
        };
      });

    // Start eager warming
    const startEagerWarmingImpl = (task: WarmingTask) =>
      Effect.gen(function* () {
        const { config } = task;
        const keys = config.keys || [];

        if (config.keyPattern) {
          // In production, would query keys matching pattern
          // For now, we'll skip pattern matching
        }

        const result = yield* warmKeysImpl(keys, config.dataLoader);

        // Update task status
        yield* Ref.update(warmingTasks, (map) =>
          HashMap.set(map, task.id, {
            ...task,
            status: 'completed' as const,
            lastRun: new Date(),
            itemsWarmed: result.warmed,
          })
        );
      });

    // Start scheduled warming
    const startScheduledWarmingImpl = (task: WarmingTask) =>
      Effect.gen(function* () {
        if (!task.config.schedule) {
          return yield* Effect.fail(
            new CacheError({
              message: 'No schedule provided for scheduled warming',
              operation: 'startScheduledWarming',
            })
          );
        }

        const fiber = yield* Effect.fork(
          Effect.repeat(startEagerWarmingImpl(task), task.config.schedule)
        );

        // Update task with fiber
        yield* Ref.update(warmingTasks, (map) =>
          HashMap.set(map, task.id, {
            ...task,
            status: 'running' as const,
            fiber: fiber as Fiber.RuntimeFiber<void, unknown>,
          })
        );
      });

    // Start predictive warming
    const startPredictiveWarmingImpl = (task: WarmingTask) =>
      Effect.gen(function* () {
        // Analyze access patterns
        const patterns = yield* Ref.get(accessPatterns);

        // Predict keys likely to be accessed
        const predictedKeys: string[] = [];
        const threshold = Date.now() - 3600000; // 1 hour

        for (const [key, pattern] of patterns) {
          if (pattern.lastAccess.getTime() > threshold && pattern.count > 5) {
            predictedKeys.push(key);
          }
        }

        if (predictedKeys.length > 0) {
          const result = yield* warmKeysImpl(
            predictedKeys,
            task.config.dataLoader
          );

          yield* Ref.update(warmingTasks, (map) =>
            HashMap.set(map, task.id, {
              ...task,
              status: 'completed' as const,
              lastRun: new Date(),
              itemsWarmed: result.warmed,
            })
          );
        }
      });

    return {
      registerWarmingTask: (
        config: CacheWarmingConfig
      ): Effect.Effect<string, CacheError, never> =>
        Effect.gen(function* () {
          const taskId = `warming-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

          const task: WarmingTask = {
            id: taskId,
            config,
            status: 'pending',
          };

          yield* Ref.update(warmingTasks, (map) =>
            HashMap.set(map, taskId, task)
          );

          // Start task based on strategy
          switch (config.strategy) {
            case 'eager':
              yield* startEagerWarmingImpl(task);
              break;

            case 'scheduled':
              yield* startScheduledWarmingImpl(task);
              break;

            case 'predictive':
              yield* startPredictiveWarmingImpl(task);
              break;

            // Lazy warming happens on cache miss
          }

          return taskId;
        }) as Effect.Effect<string, CacheError, never>,

      warmKeys: (
        keys: string[],
        dataLoader: (key: string) => Effect.Effect<any, Error>
      ) => warmKeysImpl(keys, dataLoader),

      startEagerWarming: (
        taskId: string
      ): Effect.Effect<void, CacheError, never> =>
        Effect.gen(function* () {
          const tasks = yield* Ref.get(warmingTasks);
          const task = HashMap.get(tasks, taskId);

          if (Option.isNone(task)) {
            return yield* Effect.fail(
              new CacheError({
                message: `Task ${taskId} not found`,
                operation: 'startEagerWarming',
              })
            );
          }

          yield* startEagerWarmingImpl(task.value);
        }),

      startScheduledWarming: (
        taskId: string
      ): Effect.Effect<void, CacheError, never> =>
        Effect.gen(function* () {
          const tasks = yield* Ref.get(warmingTasks);
          const task = HashMap.get(tasks, taskId);

          if (Option.isNone(task)) {
            return yield* Effect.fail(
              new CacheError({
                message: `Task ${taskId} not found`,
                operation: 'startScheduledWarming',
              })
            );
          }

          yield* startScheduledWarmingImpl(task.value);
        }) as Effect.Effect<void, CacheError, never>,

      startPredictiveWarming: (
        taskId: string
      ): Effect.Effect<void, CacheError, never> =>
        Effect.gen(function* () {
          const tasks = yield* Ref.get(warmingTasks);
          const task = HashMap.get(tasks, taskId);

          if (Option.isNone(task)) {
            return yield* Effect.fail(
              new CacheError({
                message: `Task ${taskId} not found`,
                operation: 'startPredictiveWarming',
              })
            );
          }

          yield* startPredictiveWarmingImpl(task.value);
        }),

      stopWarming: (taskId: string): Effect.Effect<void, CacheError, never> =>
        Effect.gen(function* () {
          const tasks = yield* Ref.get(warmingTasks);
          const task = HashMap.get(tasks, taskId);

          if (Option.isNone(task)) {
            return yield* Effect.fail(
              new CacheError({
                message: `Task ${taskId} not found`,
                operation: 'stopWarming',
              })
            );
          }

          // Interrupt fiber if running
          if (task.value.fiber) {
            yield* Fiber.interrupt(task.value.fiber);
          }

          // Update status
          yield* Ref.update(warmingTasks, (map) =>
            HashMap.set(map, taskId, {
              ...task.value,
              status: 'completed' as const,
              fiber: undefined,
            })
          );
        }),

      getStats: (): Effect.Effect<WarmingStats, never, never> =>
        Effect.gen(function* () {
          const tasks = yield* Ref.get(warmingTasks);
          const taskList = Array.from(HashMap.values(tasks));

          return {
            totalTasks: taskList.length,
            activeTasks: taskList.filter((t) => t.status === 'running').length,
            completedTasks: taskList.filter((t) => t.status === 'completed')
              .length,
            failedTasks: taskList.filter((t) => t.status === 'failed').length,
            totalItemsWarmed: taskList.reduce(
              (sum, t) => sum + (t.itemsWarmed || 0),
              0
            ),
            lastWarmingTime: taskList
              .filter((t) => t.lastRun)
              .sort(
                (a, b) =>
                  (b.lastRun?.getTime() || 0) - (a.lastRun?.getTime() || 0)
              )[0]?.lastRun,
          };
        }),

      predictAccess: (pattern: string): Effect.Effect<string[], never, never> =>
        Effect.gen(function* () {
          const patterns = yield* Ref.get(accessPatterns);
          const regex = new RegExp(pattern.replace(/\*/g, '.*'));

          const matched: string[] = [];
          for (const [key] of patterns) {
            if (regex.test(key)) {
              matched.push(key);
            }
          }

          return matched;
        }),
    };
  })
);

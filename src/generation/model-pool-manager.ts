/**
 * Model Pool Manager - Manage pool of AI models for parallel operations
 */

import { Duration, Effect, pipe, Ref, Stream } from 'effect';
import type { AiModel } from './types';
import {
  type ModelPool,
  type ModelPoolConfig,
  PoolError,
  type PoolMetrics,
} from './types';

/**
 * Manages a pool of AI models for parallel execution
 */
export class ModelPoolManager {
  private pools = new Map<string, ModelPoolInstance>();

  /**
   * Create a new model pool
   */
  create(config: ModelPoolConfig): Effect.Effect<ModelPool, never> {
    const pool = new ModelPoolInstance(config);
    const poolId = this.generatePoolId(config);
    this.pools.set(poolId, pool);
    return Effect.succeed(pool);
  }

  /**
   * Get pool metrics
   */
  getMetrics(pool: ModelPool): Effect.Effect<PoolMetrics, never> {
    if (pool instanceof ModelPoolInstance) {
      return pool.getMetrics();
    }
    return Effect.succeed({
      totalRequests: 0,
      modelUsage: new Map<string, number>(),
      averageLatency: 0,
      errorRate: 0,
    });
  }

  /**
   * Shutdown all pools
   */
  shutdown(): Effect.Effect<void, never> {
    return Effect.forEach(Array.from(this.pools.values()), (pool) =>
      pool.shutdown()
    ).pipe(Effect.map(() => undefined));
  }

  private generatePoolId(config: ModelPoolConfig): string {
    return `pool-${config.strategy}-${config.models.length}`;
  }
}

/**
 * Internal model pool implementation
 */
class ModelPoolInstance implements ModelPool {
  private modelUsage: Ref.Ref<Map<string, number>>;
  private metrics: Ref.Ref<PoolMetrics>;
  private currentIndex: Ref.Ref<number>;
  private isShutdown = false;

  constructor(private config: ModelPoolConfig) {
    // Initialize refs
    this.modelUsage = Ref.unsafeMake(new Map<string, number>());
    this.currentIndex = Ref.unsafeMake(0);
    this.metrics = Ref.unsafeMake({
      totalRequests: 0,
      modelUsage: new Map<string, number>(),
      averageLatency: 0,
      errorRate: 0,
    });

    // Populate queue based on concurrency
    this.initializePool();
  }

  /**
   * Acquire a model from the pool
   */
  acquire(): Effect.Effect<AiModel, PoolError> {
    if (this.isShutdown) {
      return Effect.fail(new PoolError('Pool is shutdown'));
    }

    return pipe(
      this.selectModel(),
      Effect.tap((model) => this.trackUsage(model)),
      Effect.timeout(this.config.timeout ?? Duration.seconds(30)),
      Effect.catchAll(() =>
        this.config.fallback
          ? Effect.succeed(this.config.fallback)
          : Effect.fail(new PoolError('Failed to acquire model'))
      )
    );
  }

  /**
   * Release a model back to the pool
   */
  release(_model: AiModel): Effect.Effect<void, never> {
    return Effect.succeed(undefined);
  }

  /**
   * Execute operation with pool
   */
  executeWithPool<T>(
    items: T[],
    operation: (item: T, model: AiModel) => Effect.Effect<unknown, unknown>
  ): Stream.Stream<any, PoolError> {
    const concurrency = Math.min(
      this.config.maxConcurrency,
      this.config.models.length,
      items.length
    );

    return Stream.fromIterable(items).pipe(
      Stream.mapEffect(
        (item) =>
          pipe(
            this.acquire(),
            Effect.flatMap((model) =>
              pipe(
                operation(item, model),
                Effect.catchAll((err) =>
                  Effect.fail(
                    err instanceof PoolError ? err : new PoolError(String(err))
                  )
                ),
                Effect.ensuring(this.release(model))
              )
            )
          ),
        { concurrency }
      )
    );
  }

  /**
   * Get pool metrics
   */
  getMetrics(): Effect.Effect<PoolMetrics, never> {
    return Ref.get(this.metrics);
  }

  /**
   * Shutdown the pool
   */
  shutdown(): Effect.Effect<void, never> {
    this.isShutdown = true;
    return Effect.succeed(undefined);
  }

  // Private methods

  private initializePool(): void {
    // No-op for now; selection is managed via refs
  }

  private selectModel(): Effect.Effect<AiModel, PoolError> {
    switch (this.config.strategy) {
      case 'round-robin':
        return this.selectRoundRobin();
      case 'least-loaded':
        return this.selectLeastLoaded();
      case 'random':
        return this.selectRandom();
      default:
        return this.selectRoundRobin();
    }
  }

  private selectRoundRobin(): Effect.Effect<AiModel, PoolError> {
    return pipe(
      Ref.updateAndGet(
        this.currentIndex,
        (i) => (i + 1) % this.config.models.length
      ),
      Effect.map((index) => this.config.models[index]!)
    );
  }

  private selectLeastLoaded(): Effect.Effect<AiModel, PoolError> {
    return pipe(
      Ref.get(this.modelUsage),
      Effect.map((usage) => {
        let minUsage = Infinity;
        let selectedModel = this.config.models[0]!;

        this.config.models.forEach((model) => {
          const modelKey = this.getModelKey(model);
          const currentUsage = usage.get(modelKey) || 0;
          if (currentUsage < minUsage) {
            minUsage = currentUsage;
            selectedModel = model;
          }
        });

        return selectedModel;
      })
    );
  }

  private selectRandom(): Effect.Effect<AiModel, PoolError> {
    const index = Math.floor(Math.random() * this.config.models.length);
    return Effect.succeed(this.config.models[index]!);
  }

  private trackUsage(model: AiModel): Effect.Effect<void, never> {
    return pipe(
      Ref.update(this.modelUsage, (usage) => {
        const key = this.getModelKey(model);
        const current = usage.get(key) ?? 0;
        usage.set(key, current + 1);
        return usage;
      }),
      Effect.flatMap(() => Ref.get(this.modelUsage)),
      Effect.flatMap((usageMap) =>
        Ref.update(this.metrics, (metrics) => ({
          ...metrics,
          totalRequests: metrics.totalRequests + 1,
          modelUsage: new Map(usageMap),
        }))
      ),
      Effect.map(() => undefined)
    );
  }

  private getModelKey(model: AiModel): string {
    // Generate a key for the model
    // In real implementation would have proper model identification
    const anyModel = model as any;
    return String(
      anyModel?.id ?? anyModel?.name ?? model.constructor?.name ?? 'model'
    );
  }
}

/**
 * Global model pool manager instance
 */
export const modelPoolManager = new ModelPoolManager();

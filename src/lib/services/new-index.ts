/**
 * Export all new Effect Service implementations
 */

// Cache Service
export { CacheService } from './cache/service';
export { InMemoryCacheLive } from './cache/in-memory';
export { DistributedCacheLive } from './cache/distributed';
export { WeakCacheLive } from './cache/weak';
export { CacheTest, CacheTestWithStorage } from './cache/test';

// Model Pool Service
export {
  ModelPoolService,
  type ModelInstance,
  type PoolStats,
} from './model-pool/service';
export { OpenAIPoolLive } from './model-pool/openai';
export { AnthropicPoolLive } from './model-pool/anthropic';
export { ModelPoolTest } from './model-pool/test';
export { ModelPoolLive } from './model-pool';

// Dynamic Flow Service
export { DynamicFlowService } from './flow/service';
export { DynamicFlowOrchestrator, DynamicFlow } from './flow/adapter';

// IR Executor Service
export { IRExecutorService, type ExecutionResult } from './executor/service';

// State Service
export { StateService } from './state/service';

// Persistence Service
export {
  PersistenceService,
  type PersistenceMetadata,
} from './persistence/service';

// Config Service (already exists, re-export new one if needed)
export { ConfigService, type Config } from './config/service';

// Layer Compositions
export { AppLive, MinimalLive } from '../layers/app';
export { TestLive } from '../layers/test';

/**
 * Convenience function to run an Effect with all services
 */
import { Effect, Layer } from 'effect';
import { AppLive } from '../layers/app';

export const runWithServices = <A, E>(
  effect: Effect.Effect<A, E, any>
): Promise<A> => {
  return Effect.runPromise(
    effect.pipe(Effect.provide(AppLive)) as Effect.Effect<A, E, never>
  );
};

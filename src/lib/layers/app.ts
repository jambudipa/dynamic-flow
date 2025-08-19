import { Layer, Effect } from 'effect';
import { ConfigService } from '../services/config/service';
import { CacheService, InMemoryCacheLive } from '../services/cache';
import { ModelPoolService } from '../services/model-pool/service';
import { ModelPoolLive } from '../services/model-pool';
import { DynamicFlowService } from '../services/flow/service';
import { IRExecutorService } from '../services/executor/service';
import { StateService } from '../services/state/service';
import { PersistenceService } from '../services/persistence/service';

// Import existing service layers if available
import { ConfigServiceLive } from '../services/config';
import { StateServiceLive } from '../services/state';
import { PersistenceServiceLive } from '../services/persistence';

/**
 * Production application layer with all services
 */
export const AppLive = Layer.mergeAll(
  ConfigServiceLive,
  InMemoryCacheLive(),
  ModelPoolLive,
  DynamicFlowService.Default,
  IRExecutorService.Default,
  StateServiceLive,
  PersistenceServiceLive
);

/**
 * Minimal layer for basic functionality
 */
export const MinimalLive = Layer.mergeAll(
  ConfigServiceLive,
  InMemoryCacheLive({ maxSize: 100 }),
  Layer.succeed(ModelPoolService, {
    acquire: () => Effect.fail(new Error('No model pool configured')),
    release: () => Effect.void,
    releaseAll: () => Effect.void,
    stats: () =>
      Effect.succeed({ total: 0, available: 0, inUse: 0, waitingRequests: 0 }),
    resize: () => Effect.void,
    health: () => Effect.succeed(false),
  } as any),
  DynamicFlowService.Default,
  IRExecutorService.Default
);

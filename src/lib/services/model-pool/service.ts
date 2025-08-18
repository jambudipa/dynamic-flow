import { Context, Effect } from 'effect'
import { PoolError } from '../../errors'

export interface ModelInstance {
  readonly id: string
  readonly provider: string
  readonly model: string
  readonly inUse: boolean
  readonly lastUsed: Date
}

export interface PoolStats {
  readonly total: number
  readonly available: number
  readonly inUse: number
  readonly waitingRequests: number
}

/**
 * Model pool service for managing LLM instances.
 * Uses Context.Tag to support different providers:
 * - OpenAI pool
 * - Anthropic pool
 * - Local model pool
 * - Custom provider pools
 */
export interface ModelPoolService {
  readonly acquire: (model: string) => Effect.Effect<ModelInstance, PoolError>
  readonly release: (instance: ModelInstance) => Effect.Effect<void, never>
  readonly releaseAll: () => Effect.Effect<void, never>
  readonly stats: () => Effect.Effect<PoolStats, never>
  readonly resize: (size: number) => Effect.Effect<void, PoolError>
  readonly health: () => Effect.Effect<boolean, never>
}

export const ModelPoolService = Context.GenericTag<ModelPoolService>('ModelPoolService')
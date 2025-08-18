import { Context, Effect, Option } from 'effect'
import { StateError } from '../../errors'

/**
 * State management service for execution contexts.
 * Uses Context.Tag to support different storage strategies:
 * - In-memory state
 * - Persistent state
 * - Distributed state
 */
export interface StateService {
  readonly get: <T>(key: string) => Effect.Effect<Option.Option<T>, StateError>
  readonly set: <T>(key: string, value: T) => Effect.Effect<void, StateError>
  readonly has: (key: string) => Effect.Effect<boolean, never>
  readonly delete: (key: string) => Effect.Effect<void, StateError>
  readonly getAll: () => Effect.Effect<Record<string, unknown>, never>
  readonly clear: () => Effect.Effect<void, never>
  readonly initialise: (initial: Record<string, unknown>) => Effect.Effect<void, never>
  readonly checkpoint: () => Effect.Effect<string, StateError>
  readonly restore: (checkpointId: string) => Effect.Effect<void, StateError>
  readonly getLogs: () => Effect.Effect<string[], never>
  readonly log: (message: string) => Effect.Effect<void, never>
}

export const StateService = Context.GenericTag<StateService>('StateService')
import { Context, Effect, Option, Layer, Ref } from 'effect';
import { StateError } from '../../errors';

/**
 * State management service for execution contexts.
 * Uses Context.Tag to support different storage strategies:
 * - In-memory state
 * - Persistent state
 * - Distributed state
 */
export interface StateService {
  readonly get: <T>(key: string) => Effect.Effect<Option.Option<T>, StateError>;
  readonly set: <T>(key: string, value: T) => Effect.Effect<void, StateError>;
  readonly has: (key: string) => Effect.Effect<boolean, never>;
  readonly delete: (key: string) => Effect.Effect<void, StateError>;
  readonly getAll: () => Effect.Effect<Record<string, unknown>, never>;
  readonly clear: () => Effect.Effect<void, never>;
  readonly initialise: (
    initial: Record<string, unknown>
  ) => Effect.Effect<void, never>;
  readonly checkpoint: () => Effect.Effect<string, StateError>;
  readonly restore: (checkpointId: string) => Effect.Effect<void, StateError>;
  readonly getLogs: () => Effect.Effect<string[], never>;
  readonly log: (message: string) => Effect.Effect<void, never>;
}

export const StateService = Context.GenericTag<StateService>('StateService');

/**
 * In-memory implementation of StateService
 */
export const StateServiceLive = Layer.effect(
  StateService,
  Effect.gen(function* () {
    const state = yield* Ref.make<Map<string, unknown>>(new Map());
    const checkpoints = yield* Ref.make<Map<string, Map<string, unknown>>>(
      new Map()
    );
    const logs = yield* Ref.make<string[]>([]);

    return {
      get: <T>(key: string) =>
        Effect.gen(function* () {
          const currentState = yield* Ref.get(state);
          const value = currentState.get(key);
          return value !== undefined ? Option.some(value as T) : Option.none();
        }),

      set: <T>(key: string, value: T) =>
        Effect.gen(function* () {
          yield* Ref.update(state, (s) => {
            const newState = new Map(s);
            newState.set(key, value);
            return newState;
          });
        }),

      has: (key: string) =>
        Effect.gen(function* () {
          const currentState = yield* Ref.get(state);
          return currentState.has(key);
        }),

      delete: (key: string) =>
        Effect.gen(function* () {
          yield* Ref.update(state, (s) => {
            const newState = new Map(s);
            newState.delete(key);
            return newState;
          });
        }),

      getAll: () =>
        Effect.gen(function* () {
          const currentState = yield* Ref.get(state);
          return Object.fromEntries(currentState.entries());
        }),

      clear: () =>
        Effect.gen(function* () {
          yield* Ref.set(state, new Map());
        }),

      initialise: (initial: Record<string, unknown>) =>
        Effect.gen(function* () {
          const newState = new Map(Object.entries(initial));
          yield* Ref.set(state, newState);
        }),

      checkpoint: () =>
        Effect.gen(function* () {
          const currentState = yield* Ref.get(state);
          const checkpointId = `checkpoint-${Date.now()}`;
          yield* Ref.update(checkpoints, (c) => {
            const newCheckpoints = new Map(c);
            newCheckpoints.set(checkpointId, new Map(currentState));
            return newCheckpoints;
          });
          return checkpointId;
        }),

      restore: (checkpointId: string) =>
        Effect.gen(function* () {
          const allCheckpoints = yield* Ref.get(checkpoints);
          const checkpoint = allCheckpoints.get(checkpointId);
          if (!checkpoint) {
            return yield* Effect.fail(
              new StateError({
                message: `Checkpoint ${checkpointId} not found`,
              })
            );
          }
          yield* Ref.set(state, new Map(checkpoint));
        }),

      getLogs: () => Ref.get(logs),

      log: (message: string) =>
        Effect.gen(function* () {
          yield* Ref.update(logs, (l) => [
            ...l,
            `[${new Date().toISOString()}] ${message}`,
          ]);
        }),
    };
  })
);

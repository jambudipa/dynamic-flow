/**
 * Base Service Infrastructure for DynamicFlow
 *
 * This module provides the foundational patterns for converting
 * class-based implementations to Effect services, eliminating
 * the need for `self = this` anti-patterns.
 */

import { Context, Effect, Layer, Ref, Option } from 'effect';
import type { Scope } from 'effect';

/**
 * Base service trait that all services should implement
 */
export interface BaseService {
  readonly _tag: string;
}

/**
 * Service lifecycle hooks
 */
export interface ServiceLifecycle {
  readonly initialize?: Effect.Effect<void>;
  readonly dispose?: Effect.Effect<void>;
}

/**
 * Helper to create a service with Ref-based state
 */
export const createStatefulService = <State, Service extends BaseService>(
  tag: Context.Tag<Service, Service>,
  initialState: State,
  implementation: (state: Ref.Ref<State>) => Service
): Layer.Layer<Service, never, never> =>
  Layer.effect(
    tag,
    Effect.gen(function* () {
      const state = yield* Ref.make(initialState);
      return implementation(state);
    })
  );

/**
 * Helper to create a service with scoped resources
 */
export const createScopedService = <Service extends BaseService, R = never>(
  tag: Context.Tag<Service, Service>,
  acquire: Effect.Effect<Service, never, R | Scope.Scope>
): Layer.Layer<Service, never, R> => Layer.scoped(tag, acquire);

/**
 * State update helper that eliminates the need for self=this
 */
export const updateState =
  <State>(stateRef: Ref.Ref<State>) =>
  <K extends keyof State>(
    key: K,
    updater: (value: State[K]) => State[K]
  ): Effect.Effect<void> =>
    Ref.update(stateRef, (state) => ({
      ...state,
      [key]: updater(state[key]),
    }));

/**
 * State getter helper
 */
export const getState =
  <State>(stateRef: Ref.Ref<State>) =>
  <K extends keyof State>(key: K): Effect.Effect<State[K]> =>
    Ref.get(stateRef).pipe(Effect.map((state) => state[key]));

/**
 * Async queue implementation for task queues
 */
export interface AsyncQueue<T> {
  readonly offer: (value: T) => Effect.Effect<void>;
  readonly take: Effect.Effect<T>;
  readonly size: Effect.Effect<number>;
  readonly clear: Effect.Effect<void>;
}

/**
 * Create an async queue backed by Ref
 */
export const createAsyncQueue = <T>(): Effect.Effect<AsyncQueue<T>> =>
  Effect.gen(function* () {
    const queue = yield* Ref.make<T[]>([]);
    const waiting = yield* Ref.make<Array<(value: T) => void>>([]);

    return {
      offer: (value: T) =>
        Effect.gen(function* () {
          const waiters = yield* Ref.get(waiting);
          if (waiters.length > 0) {
            const waiter = waiters[0];
            yield* Ref.update(waiting, (ws) => ws.slice(1));
            waiter!(value);
          } else {
            yield* Ref.update(queue, (q) => [...q, value]);
          }
        }),

      take: Effect.async<T>((resume) => {
        Effect.gen(function* () {
          const items = yield* Ref.get(queue);
          if (items.length > 0) {
            const item = items[0];
            yield* Ref.update(queue, (q) => q.slice(1));
            resume(Effect.succeed(item!));
          } else {
            yield* Ref.update(waiting, (ws) => [
              ...ws,
              (value: T) => resume(Effect.succeed(value)),
            ]);
          }
        }).pipe(Effect.runSync);
      }),

      size: Ref.get(queue).pipe(Effect.map((q) => q.length)),

      clear: Ref.set(queue, []),
    };
  });

/**
 * Service composition helper
 */
export const composeServices = <
  Services extends Record<string, Context.Tag<any, any>>,
>(
  services: Services
): Layer.Layer<
  {
    [K in keyof Services]: Services[K] extends Context.Tag<any, infer S>
      ? S
      : never;
  }[keyof Services],
  never,
  never
> => {
  const layers = Object.values(services).map((tag) =>
    Layer.succeed(tag as any, {} as any)
  );
  if (layers.length === 0) {
    return Layer.empty as any;
  }
  if (layers.length === 1) {
    return layers[0] as any;
  }
  // Fix: Ensure layers[0] is not undefined before spreading
  const [first, ...rest] = layers;
  if (!first) {
    return Layer.empty as any;
  }
  return Layer.mergeAll(first, ...rest) as any;
};

/**
 * Helper to convert promise-based APIs to Effect services
 */
export const fromPromiseAPI = <
  Methods extends Record<string, (...args: any[]) => Promise<any>>,
>(
  api: Methods
): {
  [K in keyof Methods]: (
    ...args: Parameters<Methods[K]>
  ) => Effect.Effect<Awaited<ReturnType<Methods[K]>>, Error>;
} => {
  const result = {} as any;
  for (const [key, method] of Object.entries(api)) {
    result[key] = (...args: any[]) =>
      Effect.tryPromise({
        try: () => method(...args),
        catch: (error) =>
          error instanceof Error ? error : new Error(String(error)),
      });
  }
  return result;
};

/**
 * Mutable state container that replaces class properties
 */
export interface MutableState<T> {
  readonly get: Effect.Effect<T>;
  readonly set: (value: T) => Effect.Effect<void>;
  readonly update: (f: (value: T) => T) => Effect.Effect<void>;
  readonly modify: <B>(f: (value: T) => [B, T]) => Effect.Effect<B>;
}

/**
 * Create a mutable state container
 */
export const createMutableState = <T>(
  initial: T
): Effect.Effect<MutableState<T>> =>
  Effect.gen(function* () {
    const ref = yield* Ref.make(initial);

    return {
      get: Ref.get(ref),
      set: (value: T) => Ref.set(ref, value),
      update: (f: (value: T) => T) => Ref.update(ref, f),
      modify: <B>(f: (value: T) => [B, T]) => Ref.modify(ref, f),
    };
  });

/**
 * Optional state helper for nullable values
 */
export const createOptionalState = <T>(
  initial?: T
): Effect.Effect<MutableState<Option.Option<T>>> =>
  createMutableState(
    initial !== undefined ? Option.some(initial) : Option.none()
  );

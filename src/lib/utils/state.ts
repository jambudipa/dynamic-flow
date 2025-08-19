/**
 * State Management Utilities
 *
 * Ref-based state patterns that eliminate the need for `self = this`
 * in Effect generators. These utilities provide clean, functional
 * alternatives to mutable class state.
 */

import { Effect, Ref, Option, Either, pipe } from 'effect';

/**
 * Atomic counter for managing numeric state
 */
export interface Counter {
  readonly get: Effect.Effect<number>;
  readonly increment: Effect.Effect<number>;
  readonly decrement: Effect.Effect<number>;
  readonly add: (n: number) => Effect.Effect<number>;
  readonly reset: Effect.Effect<void>;
}

export const createCounter = (initial: number = 0): Effect.Effect<Counter> =>
  Effect.gen(function* () {
    const ref = yield* Ref.make(initial);

    return {
      get: Ref.get(ref),
      increment: Ref.updateAndGet(ref, (n) => n + 1),
      decrement: Ref.updateAndGet(ref, (n) => n - 1),
      add: (n: number) => Ref.updateAndGet(ref, (v) => v + n),
      reset: Ref.set(ref, initial),
    };
  });

/**
 * Toggle state for boolean flags
 */
export interface Toggle {
  readonly get: Effect.Effect<boolean>;
  readonly set: (value: boolean) => Effect.Effect<void>;
  readonly toggle: Effect.Effect<boolean>;
  readonly when: <A>(
    onTrue: Effect.Effect<A>,
    onFalse: Effect.Effect<A>
  ) => Effect.Effect<A>;
}

export const createToggle = (initial: boolean = false): Effect.Effect<Toggle> =>
  Effect.gen(function* () {
    const ref = yield* Ref.make(initial);

    return {
      get: Ref.get(ref),
      set: (value: boolean) => Ref.set(ref, value),
      toggle: Ref.updateAndGet(ref, (v) => !v),
      when: <A>(onTrue: Effect.Effect<A>, onFalse: Effect.Effect<A>) =>
        Effect.gen(function* () {
          const value = yield* Ref.get(ref);
          return yield* value ? onTrue : onFalse;
        }),
    };
  });

/**
 * Stack data structure with Ref
 */
export interface Stack<T> {
  readonly push: (value: T) => Effect.Effect<void>;
  readonly pop: Effect.Effect<Option.Option<T>>;
  readonly peek: Effect.Effect<Option.Option<T>>;
  readonly size: Effect.Effect<number>;
  readonly clear: Effect.Effect<void>;
}

export const createStack = <T>(): Effect.Effect<Stack<T>> =>
  Effect.gen(function* () {
    const ref = yield* Ref.make<T[]>([]);

    return {
      push: (value: T) => Ref.update(ref, (stack) => [...stack, value]),

      pop: Ref.modify(ref, (stack) => {
        if (stack.length === 0) {
          return [Option.none(), stack];
        }
        const newStack = [...stack];
        const value = newStack.pop();
        return [Option.some(value!), newStack];
      }),

      peek: Ref.get(ref).pipe(
        Effect.map((stack) =>
          stack.length > 0
            ? Option.some(stack[stack.length - 1]!)
            : Option.none()
        )
      ),

      size: Ref.get(ref).pipe(Effect.map((s) => s.length)),

      clear: Ref.set(ref, []),
    };
  });

/**
 * Map-like state container
 */
export interface StateMap<K, V> {
  readonly get: (key: K) => Effect.Effect<Option.Option<V>>;
  readonly set: (key: K, value: V) => Effect.Effect<void>;
  readonly has: (key: K) => Effect.Effect<boolean>;
  readonly delete: (key: K) => Effect.Effect<boolean>;
  readonly clear: Effect.Effect<void>;
  readonly size: Effect.Effect<number>;
  readonly entries: Effect.Effect<[K, V][]>;
}

export const createStateMap = <K, V>(): Effect.Effect<StateMap<K, V>> =>
  Effect.gen(function* () {
    const ref = yield* Ref.make<Map<K, V>>(new Map());

    return {
      get: (key: K) =>
        Ref.get(ref).pipe(
          Effect.map((map) => {
            const value = map.get(key);
            return value !== undefined ? Option.some(value) : Option.none();
          })
        ),

      set: (key: K, value: V) =>
        Ref.update(ref, (map) => {
          const newMap = new Map(map);
          newMap.set(key, value);
          return newMap;
        }),

      has: (key: K) => Ref.get(ref).pipe(Effect.map((map) => map.has(key))),

      delete: (key: K) =>
        Ref.modify(ref, (map) => {
          const newMap = new Map(map);
          const existed = newMap.delete(key);
          return [existed, newMap];
        }),

      clear: Ref.set(ref, new Map()),

      size: Ref.get(ref).pipe(Effect.map((map) => map.size)),

      entries: Ref.get(ref).pipe(
        Effect.map((map) => Array.from(map.entries()))
      ),
    };
  });

/**
 * State with history tracking
 */
export interface HistoryState<T> {
  readonly current: Effect.Effect<T>;
  readonly set: (value: T) => Effect.Effect<void>;
  readonly undo: Effect.Effect<Option.Option<T>>;
  readonly redo: Effect.Effect<Option.Option<T>>;
  readonly history: Effect.Effect<T[]>;
  readonly clearHistory: Effect.Effect<void>;
}

export const createHistoryState = <T>(
  initial: T,
  maxHistory: number = 100
): Effect.Effect<HistoryState<T>> =>
  Effect.gen(function* () {
    const state = yield* Ref.make({
      current: initial,
      history: [] as T[],
      future: [] as T[],
    });

    return {
      current: Ref.get(state).pipe(Effect.map((s) => s.current)),

      set: (value: T) =>
        Ref.update(state, (s) => ({
          current: value,
          history: [...s.history, s.current].slice(-maxHistory),
          future: [],
        })),

      undo: Ref.modify(state, (s) => {
        if (s.history.length === 0) {
          return [Option.none(), s];
        }
        const previous = s.history[s.history.length - 1]!;
        return [
          Option.some(previous),
          {
            current: previous,
            history: s.history.slice(0, -1),
            future: [s.current, ...s.future],
          },
        ];
      }),

      redo: Ref.modify(state, (s) => {
        if (s.future.length === 0) {
          return [Option.none(), s];
        }
        const next = s.future[0]!;
        return [
          Option.some(next),
          {
            current: next,
            history: [...s.history, s.current].slice(-maxHistory),
            future: s.future.slice(1),
          },
        ];
      }),

      history: Ref.get(state).pipe(Effect.map((s) => s.history)),

      clearHistory: Ref.update(state, (s) => ({
        ...s,
        history: [],
        future: [],
      })),
    };
  });

/**
 * Computed state derived from other state
 */
export const createComputedState = <T, R>(
  source: Effect.Effect<T>,
  compute: (value: T) => R
): Effect.Effect<R> => pipe(source, Effect.map(compute));

/**
 * State that can be locked for exclusive access
 */
export interface LockableState<T> {
  readonly get: Effect.Effect<T>;
  readonly withLock: <R>(f: (value: T) => Effect.Effect<R>) => Effect.Effect<R>;
  readonly tryWithLock: <R>(
    f: (value: T) => Effect.Effect<R>
  ) => Effect.Effect<Option.Option<R>>;
}

export const createLockableState = <T>(
  initial: T
): Effect.Effect<LockableState<T>> =>
  Effect.gen(function* () {
    const state = yield* Ref.make(initial);
    const lock = yield* Ref.make(false);

    return {
      get: Ref.get(state),

      withLock: <R>(f: (value: T) => Effect.Effect<R>) =>
        Effect.gen(function* () {
          // Wait for lock to be available
          while (yield* Ref.get(lock)) {
            yield* Effect.sleep('10 millis');
          }

          yield* Ref.set(lock, true);
          const value = yield* Ref.get(state);
          return yield* pipe(f(value), Effect.ensuring(Ref.set(lock, false)));
        }),

      tryWithLock: <R>(f: (value: T) => Effect.Effect<R>) =>
        Effect.gen(function* () {
          const acquired = yield* Ref.modify(lock, (isLocked) =>
            isLocked ? [false, true] : [true, true]
          );

          if (!acquired) {
            return Option.none<R>();
          }

          const value = yield* Ref.get(state);
          const result = yield* pipe(
            f(value),
            Effect.ensuring(Ref.set(lock, false))
          );
          return Option.some(result) as Option.Option<R>;
        }),
    };
  });

/**
 * Effect helper utilities for common patterns.
 * These functions provide idiomatic ways to work with Effect.
 */

import { Duration, Effect, Option, pipe, Schedule } from 'effect';

/**
 * Wraps a promise with proper error handling.
 * Converts promise rejections into typed errors.
 */
export const tryPromiseWithError = <A, E extends { readonly _tag: string }>(
  promise: () => Promise<A>,
  onError: (error: unknown) => E
): Effect.Effect<A, E> =>
  Effect.tryPromise({
    try: promise,
    catch: onError,
  });

/**
 * Wraps a synchronous function that might throw.
 * Converts exceptions into typed errors.
 */
export const tryWithError = <A, E extends { readonly _tag: string }>(
  fn: () => A,
  onError: (error: unknown) => E
): Effect.Effect<A, E> =>
  Effect.try({
    try: fn,
    catch: onError,
  });

/**
 * Safely gets a property from an unknown object.
 * Returns an Option to handle missing properties.
 */
export const safeGet = <K extends string>(
  obj: unknown,
  key: K
): Effect.Effect<Option.Option<unknown>, never> =>
  Effect.sync(() => {
    if (typeof obj === 'object' && obj !== null && key in obj) {
      return Option.some((obj as Record<string, unknown>)[key]);
    }
    return Option.none();
  });

/**
 * Executes an effect with a timeout.
 * Returns a TimeoutError if the duration is exceeded.
 */
export const withTimeout = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  duration: Duration.Duration,
  onTimeout: () => E
): Effect.Effect<A, E, R> =>
  pipe(
    effect,
    Effect.timeoutFail({
      duration,
      onTimeout,
    })
  );

/**
 * Retries an effect with exponential backoff.
 */
export const withRetry = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  options?: {
    times?: number;
    initialDelay?: Duration.Duration;
    maxDelay?: Duration.Duration;
    factor?: number;
  }
): Effect.Effect<A, E, R> => {
  const schedule = Schedule.exponential(
    options?.initialDelay || Duration.millis(100),
    options?.factor || 2
  ).pipe(
    Schedule.either(Schedule.recurs(options?.times || 3)),
    Schedule.compose(
      Schedule.elapsed.pipe(
        Schedule.whileOutput(
          Duration.lessThanOrEqualTo(options?.maxDelay || Duration.seconds(10))
        )
      )
    )
  );

  return Effect.retry(effect, schedule);
};

/**
 * Taps into an effect for logging without affecting the result.
 */
export const tapLog = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  message: (a: A) => string
): Effect.Effect<A, E, R> =>
  pipe(
    effect,
    Effect.tap((a) => Effect.log(message(a)))
  );

/**
 * Taps into an effect's error for logging.
 */
export const tapError = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  message: (e: E) => string
): Effect.Effect<A, E, R> =>
  pipe(
    effect,
    Effect.tapError((e) => Effect.log(message(e)))
  );

/**
 * Maps an error to a different error type.
 */
export const mapErrorTo = <A, E, R, E2 extends { readonly _tag: string }>(
  effect: Effect.Effect<A, E, R>,
  fn: (error: E) => E2
): Effect.Effect<A, E2, R> => pipe(effect, Effect.mapError(fn));

/**
 * Provides a default value if the effect fails.
 */
export const withDefault = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  defaultValue: A
): Effect.Effect<A, never, R> =>
  pipe(
    effect,
    Effect.orElse(() => Effect.succeed(defaultValue))
  );

/**
 * Converts an Effect to an Option, returning None on failure.
 */
export const toOption = <A, E, R>(
  effect: Effect.Effect<A, E, R>
): Effect.Effect<Option.Option<A>, never, R> =>
  pipe(
    effect,
    Effect.map(Option.some),
    Effect.orElse(() => Effect.succeed(Option.none()))
  );

/**
 * Executes effects in parallel with a concurrency limit.
 */
export const forEachPar = <A, B, E, R>(
  items: ReadonlyArray<A>,
  fn: (a: A, index: number) => Effect.Effect<B, E, R>,
  concurrency?: number
): Effect.Effect<ReadonlyArray<B>, E, R> =>
  Effect.forEach(items, fn, {
    concurrency: concurrency || 'unbounded',
  });

/**
 * Executes effects sequentially.
 */
export const forEachSeq = <A, B, E, R>(
  items: ReadonlyArray<A>,
  fn: (a: A, index: number) => Effect.Effect<B, E, R>
): Effect.Effect<ReadonlyArray<B>, E, R> =>
  Effect.forEach(items, fn, {
    concurrency: 1,
  });

/**
 * Validates a value and returns an Effect.
 */
export const validate = <A, E extends { readonly _tag: string }>(
  value: unknown,
  predicate: (value: unknown) => value is A,
  onError: () => E
): Effect.Effect<A, E> =>
  predicate(value) ? Effect.succeed(value) : Effect.fail(onError());

/**
 * Ensures an effect's error is of a specific type.
 */
export const ensureError = <A, E, R, E2 extends { readonly _tag: string }>(
  effect: Effect.Effect<A, E, R>,
  mapError: (error: E) => E2
): Effect.Effect<A, E2, R> => pipe(effect, Effect.mapError(mapError));

/**
 * Wraps a value in an Effect context.
 */
export const fromValue = <A>(value: A): Effect.Effect<A> =>
  Effect.succeed(value);

/**
 * Wraps an error in an Effect context.
 */
export const fromError = <E>(error: E): Effect.Effect<never, E> =>
  Effect.fail(error);

/**
 * Creates an Effect that succeeds with None.
 */
export const none = <A = unknown>(): Effect.Effect<Option.Option<A>, never> =>
  Effect.succeed(Option.none());

/**
 * Creates an Effect that succeeds with Some(value).
 */
export const some = <A>(value: A): Effect.Effect<Option.Option<A>, never> =>
  Effect.succeed(Option.some(value));

/**
 * Filters an Effect's success value with a predicate, returning Option.
 */
export const filterOption =
  <A>(predicate: (value: A) => boolean) =>
  <E, R>(
    effect: Effect.Effect<A, E, R>
  ): Effect.Effect<Option.Option<A>, E, R> =>
    pipe(
      effect,
      Effect.map((value) =>
        predicate(value) ? Option.some(value) : Option.none()
      )
    );

/**
 * Chains multiple effects with error accumulation.
 */
export const chainWithErrors = <A, E, R>(
  effects: ReadonlyArray<Effect.Effect<A, E, R>>
): Effect.Effect<ReadonlyArray<A>, ReadonlyArray<E>, R> => {
  return Effect.gen(function* () {
    const results = yield* Effect.forEach(
      effects,
      (effect) => Effect.either(effect),
      { concurrency: 'unbounded' }
    );

    const errors: E[] = [];
    const values: A[] = [];

    for (const result of results) {
      if (result._tag === 'Left') {
        errors.push(result.left);
      } else {
        values.push(result.right);
      }
    }

    if (errors.length > 0) {
      yield* Effect.fail(errors as ReadonlyArray<E>);
    }

    return values as ReadonlyArray<A>;
  });
};

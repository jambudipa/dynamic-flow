/**
 * Effect Patterns - Common Effect patterns and utilities for DynamicFlow.
 * Provides idiomatic Effect patterns for the DynamicFlow library.
 */

import type { Scope } from 'effect';
import {
  Array as EffectArray,
  Duration,
  Effect,
  Option,
  pipe,
  Schedule,
} from 'effect';
import type { DynamicFlowError } from '../errors/base';

// ============= Pattern Types =============

/**
 * Result pattern for operations that can succeed or fail.
 */
export type Result<T, E = DynamicFlowError> = Effect.Effect<T, E>;

/**
 * Resource pattern for resources that need cleanup.
 */
export interface Resource<T> {
  readonly acquire: Effect.Effect<T>;
  readonly release: (resource: T) => Effect.Effect<void>;
}

/**
 * Validation pattern result.
 */
export type ValidationResult<T, E = DynamicFlowError> = Effect.Effect<T, E>;

// ============= Core Patterns =============

/**
 * Pattern: Safe operation that converts exceptions to tagged errors.
 *
 * @example
 * ```typescript
 * const safeParseJson = safeOp(
 *   (input: string) => JSON.parse(input),
 *   (error) => new ParseError({ input, expected: 'JSON', message: String(error) })
 * );
 * ```
 */
export const safeOp = <A, E extends { readonly _tag: string }>(
  operation: () => A,
  onError: (error: unknown) => E
): Effect.Effect<A, E> =>
  Effect.try({
    try: operation,
    catch: onError,
  });

/**
 * Pattern: Safe async operation that converts rejections to tagged errors.
 *
 * @example
 * ```typescript
 * const safeFetch = safeAsyncOp(
 *   () => fetch('/api/data'),
 *   (error) => new NetworkError({ message: String(error) })
 * );
 * ```
 */
export const safeAsyncOp = <A, E extends { readonly _tag: string }>(
  operation: () => Promise<A>,
  onError: (error: unknown) => E
): Effect.Effect<A, E> =>
  Effect.tryPromise({
    try: operation,
    catch: onError,
  });

/**
 * Pattern: Resource management with acquire/release.
 *
 * @example
 * ```typescript
 * const withConnection = managed(
 *   () => Effect.promise(() => createConnection()),
 *   (conn) => Effect.promise(() => conn.close())
 * );
 *
 * const result = pipe(
 *   withConnection,
 *   Effect.flatMap(conn => performQuery(conn))
 * );
 * ```
 */
export const managed = <T, E, R>(
  acquire: Effect.Effect<T, E, R>,
  release: (resource: T) => Effect.Effect<void>
): Effect.Effect<T, E, R | Scope.Scope> =>
  Effect.acquireRelease(acquire, release);

/**
 * Pattern: Validation with accumulation of errors.
 *
 * @example
 * ```typescript
 * const validateUser = validate([
 *   (user) => validateEmail(user.email),
 *   (user) => validateAge(user.age),
 *   (user) => validateName(user.name)
 * ]);
 * ```
 */
export const validate =
  <T, E>(validations: Array<(input: T) => Effect.Effect<T, E>>) =>
  (input: T): Effect.Effect<T, Array<E>> =>
    pipe(
      validations,
      EffectArray.map((validation) => pipe(validation(input), Effect.either)),
      Effect.all,
      Effect.map((results) => {
        const errors: E[] = [];
        const valid = input;

        for (const result of results) {
          if (result._tag === 'Left') {
            errors.push(result.left);
          }
        }

        return errors.length > 0 ? Effect.fail(errors) : Effect.succeed(valid);
      }),
      Effect.flatten
    );

/**
 * Pattern: Conditional execution based on predicates.
 *
 * @example
 * ```typescript
 * const processIfValid = conditional(
 *   (input) => input.length > 0,
 *   (input) => processInput(input),
 *   () => Effect.succeed('Empty input handled')
 * );
 * ```
 */
export const conditional =
  <T, A, E, R>(
    predicate: (input: T) => boolean,
    onTrue: (input: T) => Effect.Effect<A, E, R>,
    onFalse: (input: T) => Effect.Effect<A, E, R>
  ) =>
  (input: T): Effect.Effect<A, E, R> =>
    predicate(input) ? onTrue(input) : onFalse(input);

/**
 * Pattern: Match on tagged types for flow control.
 *
 * @example
 * ```typescript
 * const handleEvent = matchTagged({
 *   UserCreated: (event) => handleUserCreated(event),
 *   UserUpdated: (event) => handleUserUpdated(event),
 *   UserDeleted: (event) => handleUserDeleted(event)
 * });
 * ```
 */
export const matchTagged =
  <T extends { _tag: string }, A, E, R>(matchers: {
    [K in T['_tag']]: (
      value: Extract<T, { _tag: K }>
    ) => Effect.Effect<A, E, R>;
  }) =>
  (value: T): Effect.Effect<A, E, R> => {
    const matcher = matchers[value._tag as T['_tag']];
    return matcher(value as any);
  };

/**
 * Pattern: Batch processing with concurrency control.
 *
 * @example
 * ```typescript
 * const processItems = batchProcess(
 *   items,
 *   (item) => processItem(item),
 *   { concurrency: 5, batchSize: 10 }
 * );
 * ```
 */
export const batchProcess = <T, A, E, R>(
  items: ReadonlyArray<T>,
  processor: (item: T) => Effect.Effect<A, E, R>,
  options?: {
    concurrency?: number;
    batchSize?: number;
  }
): Effect.Effect<ReadonlyArray<A>, E, R> => {
  const concurrency = options?.concurrency || 'unbounded';
  const batchSize = options?.batchSize;

  if (batchSize && items.length > batchSize) {
    // Process in batches
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }

    return pipe(
      batches,
      Effect.forEach(
        (batch) => Effect.forEach(batch, processor, { concurrency }),
        { concurrency: 1 }
      ),
      Effect.map((results) => results.flat())
    );
  }

  return Effect.forEach(items, processor, { concurrency });
};

/**
 * Pattern: Retry with exponential backoff and jitter.
 *
 * @example
 * ```typescript
 * const reliableOperation = retryWithBackoff(
 *   operation,
 *   { maxAttempts: 3, initialDelay: 100, maxDelay: 5000 }
 * );
 * ```
 */
export const retryWithBackoff = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  options?: {
    maxAttempts?: number;
    initialDelay?: number;
    maxDelay?: number;
    factor?: number;
  }
): Effect.Effect<A, E, R> => {
  const maxAttempts = options?.maxAttempts || 3;
  const initialDelay = options?.initialDelay || 100;
  const maxDelay = options?.maxDelay || 5000;
  const factor = options?.factor || 2;

  const schedule = pipe(
    Schedule.exponential(`${initialDelay} millis`),
    Schedule.either(Schedule.recurs(maxAttempts - 1)),
    Schedule.compose(
      pipe(
        Schedule.elapsed,
        Schedule.whileOutput(
          (duration) => Duration.toMillis(duration) <= maxDelay
        )
      )
    )
  );

  return Effect.retry(effect, schedule);
};

/**
 * Pattern: Cache results with TTL.
 *
 * @example
 * ```typescript
 * const cachedFetch = cached(
 *   (url) => fetch(url).then(r => r.json()),
 *   { ttl: 60000 } // 1 minute
 * );
 * ```
 */
export const cached = <K, V, E, R>(
  computation: (key: K) => Effect.Effect<V, E, R>,
  options?: { ttl?: number }
): ((key: K) => Effect.Effect<V, E, R>) => {
  const cache = new Map<K, { value: V; expires: number }>();
  const ttl = options?.ttl || 60000; // 1 minute default

  return (key: K) =>
    Effect.gen(function* () {
      const now = Date.now();
      const cached = cache.get(key);

      if (cached && cached.expires > now) {
        return cached.value;
      }

      const value = yield* computation(key);
      cache.set(key, { value, expires: now + ttl });
      return value;
    });
};

/**
 * Pattern: Circuit breaker for fault tolerance.
 *
 * @example
 * ```typescript
 * const protectedOperation = circuitBreaker(
 *   operation,
 *   { failureThreshold: 5, resetTimeout: 60000 }
 * );
 * ```
 */
export const circuitBreaker = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  options?: {
    failureThreshold?: number;
    resetTimeout?: number;
  }
): Effect.Effect<A, E | { readonly _tag: 'CircuitBreakerOpen' }, R> => {
  const failureThreshold = options?.failureThreshold || 5;
  const resetTimeout = options?.resetTimeout || 60000;

  let state: 'closed' | 'open' | 'half-open' = 'closed';
  let failureCount = 0;
  let lastFailureTime = 0;

  const CircuitBreakerOpenError = {
    _tag: 'CircuitBreakerOpen' as const,
    message: 'Circuit breaker is open',
  };

  return Effect.gen(function* () {
    const now = Date.now();

    // Check if we should reset from open to half-open
    if (state === 'open' && now - lastFailureTime > resetTimeout) {
      state = 'half-open';
      failureCount = 0;
    }

    // Reject if circuit is open
    if (state === 'open') {
      return yield* Effect.fail(CircuitBreakerOpenError);
    }

    return yield* pipe(
      effect,
      Effect.tap(() =>
        Effect.sync(() => {
          // Success: reset failure count and close circuit
          if (state === 'half-open') {
            state = 'closed';
          }
          failureCount = 0;
        })
      ),
      Effect.tapError(() =>
        Effect.sync(() => {
          // Failure: increment count and potentially open circuit
          failureCount++;
          lastFailureTime = now;

          if (failureCount >= failureThreshold) {
            state = 'open';
          }
        })
      )
    );
  });
};

/**
 * Pattern: Optional operation that returns Option instead of failing.
 *
 * @example
 * ```typescript
 * const maybeUser = optional(
 *   () => findUser(id),
 *   (error) => error.code === 'NOT_FOUND'
 * );
 * ```
 */
export const optional = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  isOptional: (error: E) => boolean
): Effect.Effect<Option.Option<A>, E, R> =>
  pipe(
    effect,
    Effect.map(Option.some),
    Effect.catchAll((error) =>
      isOptional(error) ? Effect.succeed(Option.none()) : Effect.fail(error)
    )
  );

/**
 * Pattern: Collect results with error accumulation.
 *
 * @example
 * ```typescript
 * const results = collectWithErrors([
 *   operation1(),
 *   operation2(),
 *   operation3()
 * ]);
 * ```
 */
export const collectWithErrors = <A, E, R>(
  effects: ReadonlyArray<Effect.Effect<A, E, R>>
): Effect.Effect<
  {
    successes: ReadonlyArray<A>;
    errors: ReadonlyArray<E>;
  },
  never,
  R
> =>
  pipe(
    effects,
    Effect.forEach((effect) => Effect.either(effect), {
      concurrency: 'unbounded',
    }),
    Effect.map((results) => {
      const successes: A[] = [];
      const errors: E[] = [];

      for (const result of results) {
        if (result._tag === 'Left') {
          errors.push(result.left);
        } else {
          successes.push(result.right);
        }
      }

      return { successes, errors };
    })
  );

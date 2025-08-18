/**
 * Concurrency Utilities - Effect-based concurrency patterns for DynamicFlow.
 * Provides structured concurrency with proper Fiber management.
 */

import {
  Array as EffectArray,
  Data,
  Duration,
  Effect,
  Fiber,
  pipe,
  Queue,
  Ref,
  Schedule,
} from 'effect';
import { createFlowContext, logDebug, logError } from './logging';

// ============= Fiber Management =============

/**
 * Fiber pool for managing concurrent operations.
 */
export interface FiberPool {
  readonly submit: <A, E>(
    effect: Effect.Effect<A, E>
  ) => Effect.Effect<Fiber.RuntimeFiber<A, E>>;
  readonly shutdown: Effect.Effect<void>;
  readonly awaitAll: Effect.Effect<ReadonlyArray<unknown>>;
}

/**
 * Create a fiber pool with controlled concurrency.
 */
export const createFiberPool = (
  maxConcurrency: number
): Effect.Effect<FiberPool> =>
  Effect.gen(function* () {
    const fibers = yield* Ref.make<Set<Fiber.RuntimeFiber<unknown, unknown>>>(
      new Set()
    );
    const semaphore = yield* Effect.makeSemaphore(maxConcurrency);

    const submit = <A, E>(
      effect: Effect.Effect<A, E>
    ): Effect.Effect<Fiber.RuntimeFiber<A, E>, never, never> =>
      Effect.gen(function* () {
        const fiber = yield* pipe(
          semaphore.withPermits(1)(effect),
          Effect.fork
        );

        // Add to tracking set
        yield* Ref.update(fibers, (set) => new Set([...set, fiber as any]));

        // Remove from tracking when done
        yield* pipe(
          fiber.await,
          Effect.ensuring(
            Ref.update(fibers, (set) => {
              const newSet = new Set(set);
              newSet.delete(fiber as any);
              return newSet;
            })
          ),
          Effect.fork
        );

        return fiber;
      });

    const shutdown = pipe(
      Ref.get(fibers),
      Effect.flatMap((fiberSet) =>
        pipe(
          Array.from(fiberSet),
          Effect.forEach((fiber) => Fiber.interrupt(fiber), {
            concurrency: 'unbounded',
          })
        )
      ),
      Effect.flatMap(() => Ref.set(fibers, new Set())),
      Effect.asVoid
    );

    const awaitAll = pipe(
      Ref.get(fibers),
      Effect.flatMap((fiberSet) =>
        pipe(
          Array.from(fiberSet),
          Effect.forEach((fiber) => Fiber.await(fiber), {
            concurrency: 'unbounded',
          })
        )
      )
    );

    return { submit, shutdown, awaitAll };
  });

// ============= Parallel Patterns =============

/**
 * Execute effects in parallel with configurable concurrency and error handling.
 */
export const parallelWithConfig = <T, A, E, R>(
  items: ReadonlyArray<T>,
  processor: (item: T, index: number) => Effect.Effect<A, E, R>,
  config?: {
    concurrency?: number | 'unbounded';
    failFast?: boolean;
    timeout?: Duration.Duration;
  }
): Effect.Effect<ReadonlyArray<A>, E, R> => {
  const concurrency = config?.concurrency || 'unbounded';
  const failFast = config?.failFast || true;
  const timeout = config?.timeout;

  let processorWithTimeout = processor;

  if (timeout) {
    processorWithTimeout = (item: T, index: number) =>
      pipe(processor(item, index), Effect.timeout(timeout)) as Effect.Effect<
        A,
        E,
        R
      >;
  }

  if (failFast) {
    return Effect.forEach(items, processorWithTimeout, { concurrency });
  }

  // Collect successes and failures separately
  return pipe(
    items,
    Effect.forEach(
      (item, index) => pipe(processorWithTimeout(item, index), Effect.either),
      { concurrency }
    ),
    Effect.flatMap((results) => {
      const successes: A[] = [];
      const errors: E[] = [];

      for (const result of results) {
        if (result._tag === 'Left') {
          errors.push(result.left);
        } else {
          successes.push(result.right);
        }
      }

      if (errors.length > 0) {
        return Effect.fail(errors[0]!); // Return first error
      }

      return Effect.succeed(successes as ReadonlyArray<A>);
    })
  );
};

/**
 * Execute effects in parallel batches.
 */
export const parallelBatches = <T, A, E, R>(
  items: ReadonlyArray<T>,
  processor: (item: T) => Effect.Effect<A, E, R>,
  batchSize: number,
  concurrency: number = 1
): Effect.Effect<ReadonlyArray<A>, E, R> => {
  const batches: ReadonlyArray<T>[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }

  return pipe(
    batches,
    Effect.forEach(
      (batch) => Effect.forEach(batch, processor, { concurrency: 'unbounded' }),
      { concurrency }
    ),
    Effect.map((results) => results.flat())
  );
};

/**
 * Race multiple effects and return the first successful result.
 */
export const raceSuccess = <A, E, R>(
  effects: ReadonlyArray<Effect.Effect<A, E, R>>
): Effect.Effect<A, E, R> => {
  if (effects.length === 0) {
    return Effect.die(new Error('Cannot race empty array of effects'));
  }

  if (effects.length === 1) {
    return effects[0]!;
  }

  return Effect.raceAll(effects);
};

/**
 * Execute effects with a circuit breaker pattern.
 */
export const withCircuitBreaker = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  config?: {
    failureThreshold?: number;
    resetTimeout?: Duration.Duration;
    onOpen?: () => Effect.Effect<void>;
    onClose?: () => Effect.Effect<void>;
  }
): Effect.Effect<A, E | CircuitBreakerError, R> => {
  const failureThreshold = config?.failureThreshold || 5;
  const resetTimeout = config?.resetTimeout || Duration.seconds(60);

  // This would typically use a shared state manager
  // For now, we'll create a simplified version
  return Effect.gen(function* () {
    const state = yield* Ref.make<{
      failures: number;
      lastFailure: number;
      isOpen: boolean;
    }>({ failures: 0, lastFailure: 0, isOpen: false });

    const currentState = yield* Ref.get(state);
    const now = Date.now();

    // Check if we should reset from open to closed
    if (
      currentState.isOpen &&
      now - currentState.lastFailure > Duration.toMillis(resetTimeout)
    ) {
      yield* Ref.update(state, (s) => ({ ...s, isOpen: false, failures: 0 }));
      yield* config?.onClose?.() || Effect.void;
    }

    // If circuit is open, fail immediately
    if (currentState.isOpen) {
      return yield* Effect.fail(
        new CircuitBreakerError({ message: 'Circuit breaker is open' })
      );
    }

    return yield* pipe(
      effect,
      Effect.tap(() => Ref.update(state, (s) => ({ ...s, failures: 0 }))),
      Effect.tapError((error) =>
        Effect.gen(function* () {
          const newFailures = currentState.failures + 1;
          const shouldOpen = newFailures >= failureThreshold;

          yield* Ref.update(state, (s) => ({
            failures: newFailures,
            lastFailure: now,
            isOpen: shouldOpen,
          }));

          if (shouldOpen) {
            yield* config?.onOpen?.() || Effect.void;
          }
        })
      )
    );
  });
};

/**
 * Circuit breaker error type.
 */
export class CircuitBreakerError extends Data.TaggedError(
  'CircuitBreakerError'
)<{
  readonly message: string;
  readonly operation?: string;
  readonly failureCount?: number;
  readonly threshold?: number;
}> {
  get displayMessage(): string {
    const operation = this.operation
      ? ` for operation '${this.operation}'`
      : '';
    const stats =
      this.failureCount && this.threshold
        ? ` (${this.failureCount}/${this.threshold} failures)`
        : '';
    return `Circuit breaker open${operation}${stats}: ${this.message}`;
  }
}

// ============= Queue-Based Patterns =============

/**
 * Create a worker pool that processes items from a queue.
 */
export const createWorkerPool = <T, A, E>(
  processor: (item: T) => Effect.Effect<A, E>,
  config?: {
    workerCount?: number;
    queueCapacity?: number;
    onError?: (error: E, item: T) => Effect.Effect<void>;
  }
): Effect.Effect<{
  submit: (item: T) => Effect.Effect<void>;
  shutdown: Effect.Effect<void>;
  results: Queue.Queue<A>;
}> =>
  Effect.gen(function* () {
    const workerCount = config?.workerCount || 4;
    const queueCapacity = config?.queueCapacity || 100;

    const inputQueue = yield* Queue.bounded<T>(queueCapacity);
    const resultQueue = yield* Queue.unbounded<A>();
    const workers = yield* Ref.make<
      ReadonlyArray<Fiber.RuntimeFiber<void, never>>
    >([]);

    // Start worker fibers
    const workerFibers = yield* pipe(
      EffectArray.range(0, workerCount - 1),
      Effect.forEach(() =>
        pipe(
          Queue.take(inputQueue),
          Effect.flatMap((item) =>
            pipe(
              processor(item),
              Effect.flatMap((result) => Queue.offer(resultQueue, result)),
              Effect.catchAll(
                (error) =>
                  config?.onError?.(error, item) ??
                  logError('Worker error', { error })
              )
            )
          ),
          Effect.forever,
          Effect.fork
        )
      )
    );

    yield* Ref.set(workers, workerFibers);

    const submit = (item: T) => Queue.offer(inputQueue, item);

    const shutdown = pipe(
      Ref.get(workers),
      Effect.flatMap((fibers) =>
        Effect.forEach(fibers, Fiber.interrupt, { concurrency: 'unbounded' })
      ),
      Effect.asVoid
    );

    return {
      submit,
      shutdown,
      results: resultQueue,
    };
  });

// ============= Flow-Specific Concurrency =============

/**
 * Execute flow steps in parallel with proper dependency management.
 */
export const executeParallelSteps = <T, A, E, R>(
  steps: ReadonlyArray<{
    id: string;
    dependencies: ReadonlyArray<string>;
    execute: (input: T) => Effect.Effect<A, E, R>;
  }>,
  input: T
): Effect.Effect<ReadonlyArray<{ stepId: string; result: A }>, E, R> =>
  Effect.gen(function* () {
    const completed = yield* Ref.make<Set<string>>(new Set());
    const results = yield* Ref.make<Map<string, A>>(new Map());

    const executeStep = (step: (typeof steps)[0]): Effect.Effect<void, E, R> =>
      Effect.gen(function* () {
        // Wait for dependencies
        yield* Effect.repeat(
          pipe(
            Ref.get(completed),
            Effect.map((completedSet) =>
              step.dependencies.every((dep) => completedSet.has(dep))
            ),
            Effect.filterOrFail(
              (ready) => ready,
              () => 'Dependencies not ready' as E
            )
          ),
          Schedule.fixed(Duration.millis(10))
        );

        // Execute step
        yield* logDebug(
          `Executing step ${step.id}`,
          createFlowContext('parallel')
        );
        const result = yield* step.execute(input);

        // Mark as completed
        yield* Ref.update(completed, (set) => new Set([...set, step.id]));
        yield* Ref.update(
          results,
          (map) => new Map([...map, [step.id, result]])
        );
      });

    // Start all steps in parallel
    yield* pipe(
      steps,
      Effect.forEach((step) => pipe(executeStep(step), Effect.fork), {
        concurrency: 'unbounded',
      }),
      Effect.flatMap((fibers) =>
        Effect.forEach(fibers, Fiber.await, { concurrency: 'unbounded' })
      )
    );

    // Collect results in original order
    const finalResults = yield* Ref.get(results);
    return steps.map((step) => ({
      stepId: step.id,
      result: finalResults.get(step.id)!,
    }));
  });

/**
 * Execute with automatic retries and backoff.
 */
export const executeWithRetry = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  config?: {
    maxAttempts?: number;
    initialDelay?: Duration.Duration;
    maxDelay?: Duration.Duration;
    backoffFactor?: number;
    shouldRetry?: (error: E, attempt: number) => boolean;
  }
): Effect.Effect<A, E, R> => {
  const maxAttempts = config?.maxAttempts || 3;
  const initialDelay = config?.initialDelay || Duration.millis(100);
  const maxDelay = config?.maxDelay || Duration.seconds(10);
  const backoffFactor = config?.backoffFactor || 2;
  const shouldRetry = config?.shouldRetry || (() => true);

  const schedule = pipe(
    Schedule.exponential(initialDelay, backoffFactor),
    Schedule.either(Schedule.recurs(maxAttempts - 1)),
    Schedule.whileInput((error: E) => shouldRetry(error, 0)),
    Schedule.compose(
      pipe(
        Schedule.elapsed,
        Schedule.whileOutput(Duration.lessThanOrEqualTo(maxDelay))
      )
    )
  );

  return Effect.retry(effect, schedule);
};

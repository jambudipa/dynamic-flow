import { Effect, Schedule, Duration, Ref, HashMap, Option } from 'effect';
import { ExecutionError, RecoveryError } from '../../errors';

/**
 * Error recovery strategy types
 */
export type RecoveryStrategy =
  | 'retry'
  | 'fallback'
  | 'circuit-breaker'
  | 'skip'
  | 'compensate'
  | 'escalate';

/**
 * Recovery configuration
 */
export interface RecoveryConfig {
  strategy: RecoveryStrategy;
  maxRetries?: number;
  retryDelay?: number;
  backoffMultiplier?: number;
  fallbackValue?: any;
  compensationAction?: () => Effect.Effect<void, Error>;
  circuitBreakerThreshold?: number;
  circuitBreakerTimeout?: number;
  escalationHandler?: (error: Error) => Effect.Effect<void, never>;
}

/**
 * Circuit breaker state
 */
export interface CircuitBreakerState {
  failures: number;
  lastFailureTime?: Date;
  state: 'closed' | 'open' | 'half-open';
  successCount: number;
}

/**
 * Recovery result
 */
export interface RecoveryResult<T> {
  success: boolean;
  value?: T;
  error?: Error;
  strategy: RecoveryStrategy;
  attempts: number;
  recovered: boolean;
}

/**
 * Error Recovery Service
 * Provides various error recovery strategies
 */
export class ErrorRecoveryService extends Effect.Service<ErrorRecoveryService>()(
  'ErrorRecoveryService',
  {
    effect: Effect.gen(function* () {
      // Circuit breaker states
      const circuitBreakers = yield* Ref.make<
        HashMap.HashMap<string, CircuitBreakerState>
      >(HashMap.empty());

      return {
        /**
         * Execute with recovery
         */
        executeWithRecovery: <T>(
          operation: () => Effect.Effect<T, Error>,
          config: RecoveryConfig
        ): Effect.Effect<RecoveryResult<T>, RecoveryError> =>
          Effect.gen(function* () {
            let attempts = 0;
            let lastError: Error | undefined;

            switch (config.strategy) {
              case 'retry':
                return yield* retryStrategy(operation, config);

              case 'fallback':
                return yield* fallbackStrategy(operation, config);

              case 'circuit-breaker':
                return yield* circuitBreakerStrategy(operation, config);

              case 'skip':
                return yield* skipStrategy(operation, config);

              case 'compensate':
                return yield* compensateStrategy(operation, config);

              case 'escalate':
                return yield* escalateStrategy(operation, config);

              default:
                return yield* Effect.fail(
                  new RecoveryError({
                    strategy: config.strategy,
                    message: `Unknown recovery strategy: ${config.strategy}`,
                  })
                );
            }
          }),

        /**
         * Create retry schedule
         */
        createRetrySchedule: (config: RecoveryConfig) => {
          const maxRetries = config.maxRetries || 3;
          const baseDelay = config.retryDelay || 1000;
          const multiplier = config.backoffMultiplier || 2;

          return Schedule.exponential(
            Duration.millis(baseDelay),
            multiplier
          ).pipe(Schedule.compose(Schedule.recurs(maxRetries)));
        },

        /**
         * Check circuit breaker state
         */
        getCircuitBreakerState: (id: string) =>
          Effect.gen(function* () {
            const breakers = yield* Ref.get(circuitBreakers);
            const state = HashMap.get(breakers, id);

            if (Option.isNone(state)) {
              return {
                failures: 0,
                state: 'closed' as const,
                successCount: 0,
              };
            }

            return state.value;
          }),

        /**
         * Reset circuit breaker
         */
        resetCircuitBreaker: (id: string) =>
          Effect.gen(function* () {
            yield* Ref.update(circuitBreakers, HashMap.remove(id));
          }),

        /**
         * Apply compensation
         */
        applyCompensation: (
          compensations: Array<() => Effect.Effect<void, Error>>
        ) =>
          Effect.gen(function* () {
            const results: Array<{ success: boolean; error?: Error }> = [];

            // Execute compensations in reverse order
            for (const compensation of compensations.reverse()) {
              const result = yield* compensation().pipe(
                Effect.map(() => ({ success: true })),
                Effect.catchAll((error) =>
                  Effect.succeed({ success: false, error })
                )
              );
              results.push(result);
            }

            return results;
          }),

        /**
         * Create fallback chain
         */
        createFallbackChain: <T>(
          operations: Array<() => Effect.Effect<T, Error>>
        ) =>
          Effect.gen(function* () {
            let lastError: Error | undefined;

            for (const operation of operations) {
              const result = yield* operation().pipe(
                Effect.map((value) => ({ success: true as const, value })),
                Effect.catchAll((error) => {
                  lastError = error;
                  return Effect.succeed({ success: false as const });
                })
              );

              if (result.success) {
                return result.value;
              }
            }

            return yield* Effect.fail(
              lastError || new Error('All fallbacks failed')
            );
          }),

        /**
         * Bulkhead pattern - limit concurrent executions
         */
        bulkhead: <T>(
          operation: () => Effect.Effect<T, Error>,
          maxConcurrent: number
        ) => {
          const semaphore = Effect.makeSemaphore(maxConcurrent);

          return Effect.gen(function* () {
            const sem = yield* semaphore;
            return yield* sem.withPermits(1)(operation());
          });
        },

        /**
         * Timeout with fallback
         */
        timeoutWithFallback: <T>(
          operation: () => Effect.Effect<T, Error>,
          timeout: number,
          fallback: T
        ) =>
          operation().pipe(
            Effect.timeout(Duration.millis(timeout)),
            Effect.map((opt) =>
              Option.match(opt as Option.Option<T>, {
                onNone: () => fallback,
                onSome: (value) => value,
              })
            )
          ),

        /**
         * Dead letter queue for failed operations
         */
        sendToDeadLetterQueue: (error: Error, context: any) =>
          Effect.gen(function* () {
            // In a real implementation, this would send to an actual DLQ
            console.error('Dead letter queue:', { error, context });
            return { queued: true, timestamp: new Date() };
          }),

        /**
         * Health check with recovery
         */
        healthCheckWithRecovery: (
          service: string,
          healthCheck: () => Effect.Effect<boolean, Error>,
          recovery: () => Effect.Effect<void, Error>
        ) =>
          Effect.gen(function* () {
            const isHealthy = yield* healthCheck().pipe(
              Effect.catchAll(() => Effect.succeed(false))
            );

            if (!isHealthy) {
              yield* recovery();
              // Re-check after recovery
              return yield* healthCheck();
            }

            return true;
          }),
      };

      // Recovery strategy implementations
      // Helper function to create retry schedule
      function createRetrySchedule(config: RecoveryConfig) {
        const maxRetries = config.maxRetries ?? 3;
        const baseDelay = config.retryDelay ?? 1000;
        const multiplier = config.backoffMultiplier ?? 2;

        return Schedule.exponential(
          Duration.millis(baseDelay),
          multiplier
        ).pipe(Schedule.compose(Schedule.recurs(maxRetries)));
      }

      function retryStrategy<T>(
        operation: () => Effect.Effect<T, Error>,
        config: RecoveryConfig
      ): Effect.Effect<RecoveryResult<T>, never> {
        return Effect.gen(function* () {
          const schedule = createRetrySchedule(config);
          let attempts = 0;

          const result = yield* operation().pipe(
            Effect.tap(() =>
              Effect.sync(() => {
                attempts++;
              })
            ),
            Effect.retry(schedule),
            Effect.map((value) => ({
              success: true,
              value,
              strategy: 'retry' as const,
              attempts,
              recovered: attempts > 1,
            })),
            Effect.catchAll((error) =>
              Effect.succeed({
                success: false,
                error,
                strategy: 'retry' as const,
                attempts,
                recovered: false,
              })
            )
          );

          return result;
        });
      }

      function fallbackStrategy<T>(
        operation: () => Effect.Effect<T, Error>,
        config: RecoveryConfig
      ): Effect.Effect<RecoveryResult<T>, never> {
        return Effect.gen(function* () {
          const result = yield* operation().pipe(
            Effect.map((value) => ({
              success: true,
              value,
              strategy: 'fallback' as const,
              attempts: 1,
              recovered: false,
            })),
            Effect.catchAll(() =>
              Effect.succeed({
                success: true,
                value: config.fallbackValue,
                strategy: 'fallback' as const,
                attempts: 1,
                recovered: true,
              })
            )
          );

          return result;
        });
      }

      function circuitBreakerStrategy<T>(
        operation: () => Effect.Effect<T, Error>,
        config: RecoveryConfig
      ): Effect.Effect<RecoveryResult<T>, never> {
        return Effect.gen(function* () {
          const id = `circuit-${Date.now()}`;
          const threshold = config.circuitBreakerThreshold || 5;
          const timeout = config.circuitBreakerTimeout || 60000;

          // Get or create circuit breaker state
          const currentStateOpt = yield* Ref.get(circuitBreakers).pipe(
            Effect.map((map) => HashMap.get(map, id))
          );

          const state = Option.match(currentStateOpt, {
            onNone: () => ({
              failures: 0,
              state: 'closed' as const,
              successCount: 0,
              lastFailureTime: undefined,
            }),
            onSome: (s) => s,
          });

          // Check if circuit is open
          if (state.state === 'open') {
            const timeSinceFailure = state.lastFailureTime
              ? Date.now() - state.lastFailureTime.getTime()
              : Infinity;

            if (timeSinceFailure < timeout) {
              return {
                success: false,
                error: new Error('Circuit breaker is open'),
                strategy: 'circuit-breaker' as const,
                attempts: 0,
                recovered: false,
              };
            }

            // Try half-open
            yield* Ref.update(circuitBreakers, (map) =>
              HashMap.set(map, id, { ...state, state: 'half-open' as const })
            );
          }

          const result = yield* operation().pipe(
            Effect.map((value) => {
              // Success - reset or close circuit
              Effect.gen(function* () {
                yield* Ref.update(circuitBreakers, (map) =>
                  HashMap.set(map, id, {
                    failures: 0,
                    state: 'closed' as const,
                    successCount: state.successCount + 1,
                    lastFailureTime: undefined,
                  })
                );
              }).pipe(Effect.runSync);

              return {
                success: true,
                value,
                strategy: 'circuit-breaker' as const,
                attempts: 1,
                recovered: false,
              };
            }),
            Effect.catchAll((error) => {
              // Failure - update circuit state
              const newFailures = state.failures + 1;
              const newState = newFailures >= threshold ? 'open' : state.state;

              Effect.gen(function* () {
                yield* Ref.update(circuitBreakers, (map) =>
                  HashMap.set(map, id, {
                    failures: newFailures,
                    state: newState as 'open' | 'closed' | 'half-open',
                    lastFailureTime: new Date(),
                    successCount: 0,
                  })
                );
              }).pipe(Effect.runSync);

              return Effect.succeed({
                success: false,
                error,
                strategy: 'circuit-breaker' as const,
                attempts: 1,
                recovered: false,
              });
            })
          );

          return result as RecoveryResult<T>;
        });
      }

      function skipStrategy<T>(
        operation: () => Effect.Effect<T, Error>,
        config: RecoveryConfig
      ): Effect.Effect<RecoveryResult<T>, never> {
        return operation().pipe(
          Effect.map((value) => ({
            success: true,
            value,
            strategy: 'skip' as const,
            attempts: 1,
            recovered: false,
          })),
          Effect.catchAll(() =>
            Effect.succeed({
              success: true,
              value: undefined as any,
              strategy: 'skip' as const,
              attempts: 1,
              recovered: true,
            })
          )
        );
      }

      function compensateStrategy<T>(
        operation: () => Effect.Effect<T, Error>,
        config: RecoveryConfig
      ): Effect.Effect<RecoveryResult<T>, never> {
        return Effect.gen(function* () {
          const result = yield* operation().pipe(
            Effect.map((value) => ({
              success: true,
              value,
              strategy: 'compensate' as const,
              attempts: 1,
              recovered: false,
            })),
            Effect.catchAll((error) =>
              Effect.gen(function* () {
                if (config.compensationAction) {
                  yield* config
                    .compensationAction()
                    .pipe(Effect.catchAll(() => Effect.void));
                }

                return {
                  success: false,
                  error,
                  strategy: 'compensate' as const,
                  attempts: 1,
                  recovered: true,
                };
              })
            )
          );

          return result;
        });
      }

      function escalateStrategy<T>(
        operation: () => Effect.Effect<T, Error>,
        config: RecoveryConfig
      ): Effect.Effect<RecoveryResult<T>, never> {
        return Effect.gen(function* () {
          const result = yield* operation().pipe(
            Effect.map((value) => ({
              success: true,
              value,
              strategy: 'escalate' as const,
              attempts: 1,
              recovered: false,
            })),
            Effect.catchAll((error) =>
              Effect.gen(function* () {
                if (config.escalationHandler) {
                  yield* config.escalationHandler(error);
                }

                return {
                  success: false,
                  error,
                  strategy: 'escalate' as const,
                  attempts: 1,
                  recovered: false,
                };
              })
            )
          );

          return result;
        });
      }

      function updateCircuitBreaker(id: string, state: CircuitBreakerState) {
        return Ref.update(circuitBreakers, HashMap.set(id, state));
      }
    }),
  }
) {}

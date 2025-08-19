import { Effect, Context, Schema } from 'effect';
import { OperatorError, ValidationError } from '../../errors';
import { ExecutionContextService } from '../execution/context';
import type { ExecutionContext } from '../execution/context-fix';

/**
 * Loop configuration schema
 */
export interface LoopConfig {
  id: string;
  loop: string;
  while?: any;
  times?: number;
  with: any;
  output?: string;
  maxIterations?: number;
  timeout?: number;
  retry?: number;
  description?: string;
}

/**
 * Loop result type
 */
export interface LoopResult {
  value: any[];
  metadata?: {
    iterations: number;
    executionTime: number;
    terminatedEarly: boolean;
  };
}

/**
 * Loop Operator Service
 * Uses Effect.Service for single loop implementation
 */
export class LoopOperatorService extends Effect.Service<LoopOperatorService>()(
  'LoopOperatorService',
  {
    effect: Effect.gen(function* () {
      const executionContext = yield* ExecutionContextService;

      return {
        /**
         * Execute loop
         */
        execute: (
          config: LoopConfig,
          input: any,
          context: ExecutionContext
        ): Effect.Effect<LoopResult, OperatorError, never> =>
          Effect.gen(function* () {
            const startTime = Date.now();
            const results: any[] = [];
            const maxIterations = config.maxIterations || 1000; // Safety limit
            let iterations = 0;
            let terminatedEarly = false;

            // Determine loop type
            const isWhileLoop = config.while !== undefined;
            const isTimesLoop = config.times !== undefined;

            if (!isWhileLoop && !isTimesLoop) {
              return yield* Effect.fail(
                new OperatorError({
                  operator: 'loop',
                  message:
                    'Loop must have either "while" condition or "times" count',
                  cause: { config },
                })
              );
            }

            // Times-based loop
            if (isTimesLoop) {
              const times = config.times;

              if (typeof times !== 'number' || times < 0) {
                return yield* Effect.fail(
                  new OperatorError({
                    operator: 'loop',
                    message: 'Loop times must be a non-negative number',
                    cause: { times },
                  })
                );
              }

              for (let i = 0; i < times && i < maxIterations; i++) {
                iterations++;

                try {
                  // Set loop variables
                  yield* context.setVariable(`${config.loop}_index`, i);
                  yield* context.setVariable(`${config.loop}_iteration`, i + 1);

                  // Execute loop body
                  const result = yield* Effect.try(() => {
                    if (typeof config.with === 'function') {
                      return config.with(input, i);
                    }
                    return config.with;
                  }).pipe(
                    Effect.mapError(
                      (error) =>
                        new OperatorError({
                          operator: 'loop',
                          message: `Loop body execution failed at iteration ${i}`,
                          cause: { error, iteration: i },
                        })
                    )
                  );

                  results.push(result);
                } finally {
                  // Clean up loop variables
                  yield* context.clearVariable(`${config.loop}_index`);
                  yield* context.clearVariable(`${config.loop}_iteration`);
                }
              }

              if (times > maxIterations) {
                terminatedEarly = true;
              }
            }

            // While-based loop
            if (isWhileLoop) {
              while (iterations < maxIterations) {
                // Evaluate condition
                const shouldContinue = yield* Effect.try(() => {
                  if (typeof config.while === 'function') {
                    return config.while(input, iterations);
                  }
                  // If it's a variable reference
                  if (
                    typeof config.while === 'string' &&
                    config.while.startsWith('$')
                  ) {
                    return context.getVariable(config.while.slice(1));
                  }
                  return Boolean(config.while);
                }).pipe(
                  Effect.flatten,
                  Effect.mapError(
                    (error) =>
                      new OperatorError({
                        operator: 'loop',
                        message: `Failed to evaluate while condition at iteration ${iterations}`,
                        cause: { error, condition: config.while },
                      })
                  )
                );

                if (!shouldContinue) {
                  break;
                }

                try {
                  // Set loop variables
                  yield* context.setVariable(
                    `${config.loop}_index`,
                    iterations
                  );
                  yield* context.setVariable(
                    `${config.loop}_iteration`,
                    iterations + 1
                  );

                  // Execute loop body
                  const result = yield* Effect.try(() => {
                    if (typeof config.with === 'function') {
                      return config.with(input, iterations);
                    }
                    return config.with;
                  }).pipe(
                    Effect.mapError(
                      (error) =>
                        new OperatorError({
                          operator: 'loop',
                          message: `Loop body execution failed at iteration ${iterations}`,
                          cause: { error, iteration: iterations },
                        })
                    )
                  );

                  results.push(result);
                  iterations++;
                } finally {
                  // Clean up loop variables
                  yield* context.clearVariable(`${config.loop}_index`);
                  yield* context.clearVariable(`${config.loop}_iteration`);
                }
              }

              if (iterations >= maxIterations) {
                terminatedEarly = true;
              }
            }

            // Store output if specified
            if (config.output && context) {
              context.setVariable(config.output, results);
            }

            return {
              value: results,
              metadata: {
                iterations,
                executionTime: Date.now() - startTime,
                terminatedEarly,
              },
            };
          }) as Effect.Effect<LoopResult, OperatorError, never>,

        /**
         * Validate loop configuration
         */
        validate: (config: LoopConfig) =>
          Effect.gen(function* () {
            // Validate required fields
            if (!config.id || !config.loop) {
              return yield* Effect.fail(
                new ValidationError({
                  field: !config.id ? 'id' : 'loop',
                  message: 'Required field is missing',
                })
              );
            }

            // Validate loop type
            const hasWhile = config.while !== undefined;
            const hasTimes = config.times !== undefined;

            if (!hasWhile && !hasTimes) {
              return yield* Effect.fail(
                new ValidationError({
                  field: 'while/times',
                  message:
                    'Loop must have either "while" condition or "times" count',
                })
              );
            }

            if (hasWhile && hasTimes) {
              return yield* Effect.fail(
                new ValidationError({
                  field: 'while/times',
                  message:
                    'Loop cannot have both "while" and "times" specified',
                })
              );
            }

            // Validate times if specified
            if (hasTimes) {
              if (typeof config.times !== 'number') {
                return yield* Effect.fail(
                  new ValidationError({
                    field: 'times',
                    message: 'Loop times must be a number',
                  })
                );
              }

              if (config.times < 0) {
                return yield* Effect.fail(
                  new ValidationError({
                    field: 'times',
                    message: 'Loop times must be non-negative',
                  })
                );
              }
            }

            // Validate loop body
            if (config.with === undefined) {
              return yield* Effect.fail(
                new ValidationError({
                  field: 'with',
                  message: 'Loop body (with) is required',
                })
              );
            }

            // Validate max iterations if specified
            if (config.maxIterations !== undefined) {
              if (
                typeof config.maxIterations !== 'number' ||
                config.maxIterations < 1
              ) {
                return yield* Effect.fail(
                  new ValidationError({
                    field: 'maxIterations',
                    message: 'Max iterations must be a positive number',
                  })
                );
              }
            }

            return true;
          }),

        /**
         * Get operator name
         */
        getName: () => 'loop',

        /**
         * Get operator description
         */
        getDescription: () =>
          'Executes a block repeatedly based on condition or count',
      };
    }),
  }
) {}

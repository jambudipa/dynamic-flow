import { Effect, Context, Schema, Chunk } from 'effect';
import { OperatorError, ValidationError } from '../../errors';
import { ExecutionContextService } from '../execution/context';
import type { ExecutionContext } from '../execution/context-fix';

/**
 * Map configuration schema
 */
export interface MapConfig {
  id: string;
  map: string;
  with: any;
  output?: string;
  timeout?: number;
  retry?: number;
  parallel?: boolean;
  concurrency?: number;
  description?: string;
}

/**
 * Map result type
 */
export interface MapResult {
  value: any[];
  metadata?: {
    itemsProcessed: number;
    executionTime: number;
    parallel: boolean;
  };
}

/**
 * Map Operator Service Interface
 * Uses Context.Tag for multiple map strategy implementations
 */
export interface MapOperatorService {
  readonly execute: (
    config: MapConfig,
    input: any,
    context: ExecutionContext
  ) => Effect.Effect<MapResult, OperatorError, never>;

  readonly validate: (
    config: MapConfig
  ) => Effect.Effect<boolean, ValidationError, never>;

  readonly getName: () => string;
  readonly getDescription: () => string;
}

/**
 * Map Operator Service Tag
 */
export const MapOperatorService =
  Context.GenericTag<MapOperatorService>('MapOperatorService');

/**
 * Sequential Map Implementation
 */
export const SequentialMapOperatorService = Effect.gen(function* () {
  const executionContext = yield* ExecutionContextService;

  return MapOperatorService.of({
    execute: (config, input, context) =>
      Effect.gen(function* () {
        const startTime = Date.now();

        // Validate input is iterable
        if (
          !Array.isArray(input) &&
          typeof input[Symbol.iterator] !== 'function'
        ) {
          return yield* Effect.fail(
            new OperatorError({
              operator: 'map',
              message: 'Input must be an iterable',
              cause: { input },
            })
          );
        }

        const items = Array.isArray(input) ? input : Array.from(input);
        const results: any[] = [];

        // Process each item sequentially
        for (let i = 0; i < items.length; i++) {
          try {
            // Set loop variables
            // Set loop variables using context methods
            context.setVariable(`${config.map}_index`, i);
            context.setVariable(`${config.map}_item`, items[i]);

            // Execute the mapper function (config.with)
            const result = yield* Effect.try(() => {
              // In real implementation, this would execute the nested step
              if (typeof config.with === 'function') {
                return config.with(items[i], i);
              }
              return config.with;
            }).pipe(
              Effect.mapError(
                (error) =>
                  new OperatorError({
                    operator: 'map',
                    message: `Mapping failed at index ${i}`,
                    cause: { error, item: items[i] },
                  })
              )
            );

            results.push(result);
          } finally {
            // Clean up loop variables
            // Clear loop variables
            context.clearVariable(`${config.map}_index`);
            context.clearVariable(`${config.map}_item`);
          }
        }

        // Store output if specified
        if (config.output) {
          context.setVariable(config.output, results);
        }

        return {
          value: results,
          metadata: {
            itemsProcessed: items.length,
            executionTime: Date.now() - startTime,
            parallel: false,
          },
        };
      }) as Effect.Effect<MapResult, OperatorError, never>,

    validate: (config) =>
      Effect.gen(function* () {
        // Validate required fields
        if (!config.id || !config.map) {
          return yield* Effect.fail(
            new ValidationError({
              field: !config.id ? 'id' : 'map',
              message: 'Required field is missing',
            })
          );
        }

        // Validate mapper function/step
        if (!config.with) {
          return yield* Effect.fail(
            new ValidationError({
              field: 'with',
              message: 'Mapper function or step is required',
            })
          );
        }

        return true;
      }) as Effect.Effect<boolean, ValidationError, never>,

    getName: () => 'sequential-map',
    getDescription: () => 'Maps each item in a collection sequentially',
  });
});

/**
 * Parallel Map Implementation
 */
export const ParallelMapOperatorService = Effect.gen(function* () {
  const executionContext = yield* ExecutionContextService;

  return MapOperatorService.of({
    execute: (config, input, context) =>
      Effect.gen(function* () {
        const startTime = Date.now();

        // Validate input is iterable
        if (
          !Array.isArray(input) &&
          typeof input[Symbol.iterator] !== 'function'
        ) {
          return yield* Effect.fail(
            new OperatorError({
              operator: 'map',
              message: 'Input must be an iterable',
              cause: { input },
            })
          );
        }

        const items = Array.isArray(input) ? input : Array.from(input);
        const concurrency = config.concurrency || 10;

        // Process items in parallel with concurrency control
        const effects = items.map((item, index) =>
          Effect.gen(function* () {
            // Create isolated context for parallel execution
            // Create child context
            const childContext = context.createChildContext();

            childContext.setVariable(`${config.map}_index`, index);
            childContext.setVariable(`${config.map}_item`, item);

            const result = yield* Effect.try(() => {
              if (typeof config.with === 'function') {
                return config.with(item, index);
              }
              return config.with;
            }).pipe(
              Effect.mapError(
                (error) =>
                  new OperatorError({
                    operator: 'map',
                    message: `Parallel mapping failed at index ${index}`,
                    cause: { error, item },
                  })
              )
            );

            return result;
          })
        );

        // Execute with concurrency limit
        const results = yield* Effect.all(effects, {
          concurrency,
          batching: true,
        });

        // Store output if specified
        if (config.output) {
          context.setVariable(config.output, results);
        }

        return {
          value: results,
          metadata: {
            itemsProcessed: items.length,
            executionTime: Date.now() - startTime,
            parallel: true,
          },
        };
      }) as Effect.Effect<MapResult, OperatorError, never>,

    validate: (config) =>
      Effect.gen(function* () {
        // Use base validation
        const baseValid = yield* SequentialMapOperatorService.pipe(
          Effect.flatMap((service) => service.validate(config))
        );

        // Additional validation for parallel config
        if (config.concurrency && config.concurrency < 1) {
          return yield* Effect.fail(
            new ValidationError({
              field: 'concurrency',
              message: 'Concurrency must be at least 1',
            })
          );
        }

        return baseValid;
      }) as Effect.Effect<boolean, ValidationError, never>,

    getName: () => 'parallel-map',
    getDescription: () => 'Maps items in parallel with concurrency control',
  });
});

/**
 * Batched Map Implementation
 * Processes items in batches for efficiency
 */
export const BatchedMapOperatorService = Effect.gen(function* () {
  const executionContext = yield* ExecutionContextService;

  return MapOperatorService.of({
    execute: (config, input, context) =>
      Effect.gen(function* () {
        const startTime = Date.now();
        const batchSize = config.concurrency || 10;

        // Validate input
        if (!Array.isArray(input)) {
          return yield* Effect.fail(
            new OperatorError({
              operator: 'map',
              message: 'Batched map requires array input',
              cause: { input },
            })
          );
        }

        const results: any[] = [];

        // Process in batches
        for (let i = 0; i < input.length; i += batchSize) {
          const batch = input.slice(i, Math.min(i + batchSize, input.length));

          const batchResults = yield* Effect.all(
            batch.map((item, batchIndex) => {
              const index = i + batchIndex;
              return Effect.try(() => {
                if (typeof config.with === 'function') {
                  return config.with(item, index);
                }
                return config.with;
              });
            })
          );

          results.push(...batchResults);
        }

        // Store output
        if (config.output) {
          context.setVariable(config.output, results);
        }

        return {
          value: results,
          metadata: {
            itemsProcessed: input.length,
            executionTime: Date.now() - startTime,
            parallel: true,
          },
        };
      }) as Effect.Effect<MapResult, OperatorError, never>,

    validate: (config) =>
      Effect.gen(function* () {
        if (!config.id || !config.map) {
          return yield* Effect.fail(
            new ValidationError({
              message: 'Map operator requires id and map fields',
              value: config,
            })
          );
        }
        return true;
      }) as Effect.Effect<boolean, ValidationError, never>,

    getName: () => 'batched-map',
    getDescription: () => 'Maps items in batches for optimal performance',
  });
});

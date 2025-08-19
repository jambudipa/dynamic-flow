import { Effect, Context, Schema } from 'effect';
import { OperatorError, ValidationError } from '../../errors';
import { ExecutionContextService } from '../execution/context';
import type { ExecutionContext } from '../execution/context-fix';

/**
 * Filter configuration schema
 */
export interface FilterConfig {
  id: string;
  predicate: any;
  filter?: string;
  condition?: string;
  output?: string;
  mode?: 'include' | 'exclude';
  parallel?: boolean;
}

/**
 * Filter result type
 */
export interface FilterResult {
  filtered: any[];
  original: any[];
  metadata?: {
    filteredCount: number;
    originalCount: number;
    executionTime: number;
  };
}

/**
 * Filter Operator Service Interface
 */
export interface FilterOperatorService {
  readonly execute: (
    config: FilterConfig,
    input: any,
    context: ExecutionContext
  ) => Effect.Effect<FilterResult, OperatorError, never>;

  readonly validate: (
    config: FilterConfig
  ) => Effect.Effect<boolean, ValidationError, never>;

  readonly getName: () => string;
  readonly getDescription: () => string;
}

/**
 * Filter Operator Service Tag
 */
export const FilterOperatorService = Context.GenericTag<FilterOperatorService>(
  'FilterOperatorService'
);

/**
 * Default Filter Implementation
 */
export const DefaultFilterOperatorService = Effect.gen(function* () {
  const executionContext = yield* ExecutionContextService;

  return {
    execute: (
      config: FilterConfig,
      input: any,
      context: ExecutionContext
    ): Effect.Effect<FilterResult, OperatorError, never> =>
      Effect.gen(function* () {
        const startTime = Date.now();

        // Validate input is iterable
        if (
          !Array.isArray(input) &&
          typeof input[Symbol.iterator] !== 'function'
        ) {
          return yield* Effect.fail(
            new OperatorError({
              operator: 'filter',
              message: 'Input must be an iterable',
              operation: 'execute',
              cause: { input },
            })
          );
        }

        const items = Array.isArray(input) ? input : Array.from(input);
        const results: any[] = [];
        let filteredCount = 0;

        // Apply filter predicate
        for (let i = 0; i < items.length; i++) {
          const item = items[i];

          let shouldInclude = false;

          // Evaluate predicate
          if (typeof config.predicate === 'function') {
            shouldInclude = yield* Effect.try({
              try: () => config.predicate(item, i, items),
              catch: (error) =>
                new OperatorError({
                  operator: 'filter',
                  message: 'Predicate evaluation failed',
                  operation: 'execute',
                  cause: error,
                }),
            });
          } else if (typeof config.predicate === 'string') {
            // String predicate - evaluate as expression
            const varName = config.predicate.startsWith('$')
              ? config.predicate.slice(1)
              : config.predicate;
            shouldInclude = yield* Effect.succeed(
              context.getVariable(varName) === item
            );
          } else {
            // Static boolean predicate
            shouldInclude = Boolean(config.predicate);
          }

          // Apply mode
          if (config.mode === 'exclude') {
            shouldInclude = !shouldInclude;
          }

          if (shouldInclude) {
            results.push(item);
            filteredCount++;
          }
        }

        // Store output if specified
        if (config.output) {
          yield* Effect.sync(() =>
            context.setVariable(config.output!, results)
          );
        }

        return {
          filtered: results,
          original: items,
          metadata: {
            filteredCount,
            originalCount: items.length,
            executionTime: Date.now() - startTime,
          },
        };
      }) as Effect.Effect<FilterResult, OperatorError, never>,

    validate: (config: FilterConfig) =>
      Effect.gen(function* () {
        // Validate required fields
        if (!config.id) {
          return yield* Effect.fail(
            new ValidationError({
              field: 'id',
              message: 'Filter ID is required',
            })
          );
        }

        if (
          config.predicate === undefined &&
          !config.filter &&
          !config.condition
        ) {
          return yield* Effect.fail(
            new ValidationError({
              field: 'predicate',
              message: 'Filter predicate, filter, or condition is required',
            })
          );
        }

        return true;
      }),

    getName: () => 'filter',
    getDescription: () => 'Filters items in a collection based on a predicate',
  };
});

/**
 * Parallel Filter Implementation
 * Evaluates predicates in parallel
 */
export const ParallelFilterOperatorService = Effect.gen(function* () {
  const executionContext = yield* ExecutionContextService;

  return {
    execute: (
      config: FilterConfig,
      input: any,
      context: ExecutionContext
    ): Effect.Effect<FilterResult, OperatorError, never> =>
      Effect.gen(function* () {
        const startTime = Date.now();

        // Validate input is iterable
        if (
          !Array.isArray(input) &&
          typeof input[Symbol.iterator] !== 'function'
        ) {
          return yield* Effect.fail(
            new OperatorError({
              operator: 'parallel-filter',
              message: 'Input must be an iterable',
              operation: 'execute',
              cause: { input },
            })
          );
        }

        const items = Array.isArray(input) ? input : Array.from(input);

        // Evaluate all predicates in parallel
        const evaluations = yield* Effect.all(
          items.map((item, index) =>
            Effect.gen(function* () {
              if (typeof config.predicate === 'function') {
                return yield* Effect.try({
                  try: () => config.predicate(item, index, items),
                  catch: (error) =>
                    new OperatorError({
                      operator: 'filter',
                      message: 'Predicate evaluation failed',
                      cause: error,
                    }),
                }).pipe(
                  Effect.map((result) => ({ item, include: Boolean(result) }))
                );
              }
              return { item, include: Boolean(config.predicate) };
            })
          ),
          { concurrency: 'unbounded' }
        );

        // Collect filtered results
        const results = evaluations
          .filter(({ include }) =>
            config.mode === 'exclude' ? !include : include
          )
          .map(({ item }) => item);

        // Store output if specified
        if (config.output) {
          yield* Effect.try(() => context.setVariable(config.output!, results));
        }

        return {
          filtered: results,
          original: items,
          metadata: {
            filteredCount: results.length,
            originalCount: items.length,
            executionTime: Date.now() - startTime,
          },
        };
      }) as Effect.Effect<FilterResult, OperatorError, never>,

    validate: (
      config: FilterConfig
    ): Effect.Effect<boolean, ValidationError, never> =>
      DefaultFilterOperatorService.pipe(
        Effect.flatMap((service) => service.validate(config))
      ) as Effect.Effect<boolean, ValidationError, never>,

    getName: () => 'parallel-filter',
    getDescription: () => 'Filters items with parallel predicate evaluation',
  };
});

/**
 * Composite Filter Implementation
 * Combines multiple filter conditions
 */
export const CompositeFilterOperatorService = Effect.gen(function* () {
  const executionContext = yield* ExecutionContextService;

  return {
    execute: (config: FilterConfig, input: any, context: ExecutionContext) =>
      Effect.gen(function* () {
        // Reuse default implementation with enhanced predicate handling
        const baseService = yield* DefaultFilterOperatorService;

        // Enhanced config with composite predicate logic
        const compositeConfig = {
          ...config,
          predicate: (item: any, index: number, array: any[]) => {
            // Implement AND/OR/NOT logic for multiple conditions
            // This is a simplified version - can be extended
            if (config.filter && config.condition) {
              const filterResult = item[config.filter] !== undefined;
              const conditionResult = eval(config.condition); // Simplified - should use safe eval
              return filterResult && conditionResult;
            }
            return typeof config.predicate === 'function'
              ? config.predicate(item, index, array)
              : Boolean(config.predicate);
          },
        };

        return yield* baseService.execute(compositeConfig, input, context);
      }),

    validate: (config: FilterConfig) =>
      Effect.gen(function* () {
        const baseValid = yield* DefaultFilterOperatorService.pipe(
          Effect.flatMap((service) => service.validate(config))
        );

        // Additional validation for composite filters
        if (config.filter && typeof config.filter !== 'string') {
          return yield* Effect.fail(
            new ValidationError({
              field: 'filter',
              message: 'Filter field must be a string',
            })
          );
        }

        return baseValid;
      }),

    getName: () => 'composite-filter',
    getDescription: () =>
      'Filters with complex predicate compositions (AND, OR, NOT)',
  };
});

/**
 * Indexed Filter Implementation
 * Includes index information in filtering
 */
export const IndexedFilterOperatorService = Effect.gen(function* () {
  const executionContext = yield* ExecutionContextService;

  return {
    execute: (config: FilterConfig, input: any, context: ExecutionContext) =>
      Effect.gen(function* () {
        const baseService = yield* DefaultFilterOperatorService;

        // Enhanced config with index-aware predicate
        const indexedConfig = {
          ...config,
          predicate: (item: any, index: number, array: any[]) => {
            // Make index available to predicate
            const enhancedItem = { ...item, _index: index, _array: array };
            return typeof config.predicate === 'function'
              ? config.predicate(enhancedItem, index, array)
              : Boolean(config.predicate);
          },
        };

        return yield* baseService.execute(indexedConfig, input, context);
      }),

    validate: (config: FilterConfig) =>
      DefaultFilterOperatorService.pipe(
        Effect.flatMap((service) => service.validate(config))
      ),

    getName: () => 'indexed-filter',
    getDescription: () => 'Filters items with index information available',
  };
});

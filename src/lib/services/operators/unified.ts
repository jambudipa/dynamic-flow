import { Effect, Layer, HashMap, Ref } from 'effect';
import { OperatorError, ValidationError } from '../../errors';
import { ExecutionContextService } from '../execution/context';
import type { ExecutionContext } from '../execution/context-fix';
import { OperatorRegistryService } from './registry';
import {
  ReduceOperatorService,
  DefaultReduceOperatorService,
  ParallelReduceOperatorService,
  StreamingReduceOperatorService,
} from './reduce';
import {
  MapOperatorService,
  SequentialMapOperatorService,
  ParallelMapOperatorService,
  BatchedMapOperatorService,
} from './map';
import {
  FilterOperatorService,
  DefaultFilterOperatorService,
  ParallelFilterOperatorService,
  CompositeFilterOperatorService,
} from './filter';
import { SwitchOperatorService } from './switch';
import { LoopOperatorService } from './loop';
import {
  ConditionalOperatorService,
  DefaultConditionalOperatorService,
  NestedConditionalOperatorService,
  TernaryConditionalOperatorService,
} from './conditional';

/**
 * Operator configuration type
 */
export type OperatorConfig =
  | { type: 'reduce'; config: any }
  | { type: 'map'; config: any }
  | { type: 'filter'; config: any }
  | { type: 'switch'; config: any }
  | { type: 'loop'; config: any }
  | { type: 'conditional'; config: any };

/**
 * Unified Operator Service
 * Consolidates all operator services into a single interface
 */
export class OperatorService extends Effect.Service<OperatorService>()(
  'OperatorService',
  {
    effect: Effect.gen(function* () {
      const registry = yield* OperatorRegistryService;
      const executionContext = yield* ExecutionContextService;

      // Get operator service instances
      const reduceService = yield* ReduceOperatorService;
      const mapService = yield* MapOperatorService;
      const filterService = yield* FilterOperatorService;
      const switchService = yield* SwitchOperatorService;
      const loopService = yield* LoopOperatorService;
      const conditionalService = yield* ConditionalOperatorService;

      // Register all operators in the registry
      // Note: These are simplified registrations - in production, you'd need full UnifiedOperator implementations
      yield* Effect.all([
        registry.register('reduce', {} as any),
        registry.register('map', {} as any),
        registry.register('filter', {} as any),
        registry.register('switch', {} as any),
        registry.register('loop', {} as any),
        registry.register('conditional', {} as any),
      ]);

      const service = {
        /**
         * Execute an operator by type
         */
        execute: (type: string, config: any, input: any) =>
          Effect.gen(function* () {
            const operator = yield* registry.get(type);

            if (!operator) {
              return yield* Effect.fail(
                new ValidationError({
                  field: 'operator',
                  message: `Operator '${type}' not found. Available: ${(yield* registry.listTypes()).join(', ')}`,
                })
              );
            }

            // Create execution context for operators
            // Create a proper ExecutionContext with the required methods
            const variablesMap = new Map<string, any>();
            const context: ExecutionContext = {
              getVariable: (name: string) => variablesMap.get(name),
              setVariable: (name: string, value: any) => {
                variablesMap.set(name, value);
                return value;
              },
              hasVariable: (name: string) => variablesMap.has(name),
              clearVariable: (name: string) => variablesMap.delete(name),
              createChildContext: () => context, // For now, return self
            };

            // Since operators are simplified, execute directly based on type
            switch (type) {
              case 'reduce':
                return yield* reduceService.execute(config, input, context);
              case 'map':
                return yield* mapService.execute(config, input, context);
              case 'filter':
                return yield* filterService.execute(config, input, context);
              case 'switch':
                return yield* switchService.execute(config, input, context);
              case 'loop':
                return yield* loopService.execute(config, input, context);
              case 'conditional':
                return yield* conditionalService.execute(
                  config,
                  input,
                  context
                );
              default:
                return yield* Effect.fail(
                  new OperatorError({
                    operator: type,
                    message: 'Unknown operator type',
                  })
                );
            }
          }),

        /**
         * Validate an operator configuration
         */
        validate: (type: string, config: any) =>
          Effect.gen(function* () {
            const operator = yield* registry.get(type);

            if (!operator) {
              return yield* Effect.fail(
                new ValidationError({
                  field: 'operator',
                  message: `Operator '${type}' not found. Available: ${(yield* registry.listTypes()).join(', ')}`,
                })
              );
            }

            // If operator doesn't have validate method, return true
            return true;
          }),

        /**
         * Get a specific operator
         */
        getOperator: (type: string) => registry.get(type),

        /**
         * List all available operator types
         */
        listOperatorTypes: () => registry.listTypes(),

        /**
         * Execute with specific strategy (for operators with multiple implementations)
         */
        executeWithStrategy: (
          type: string,
          strategy: string,
          config: any,
          input: any
        ) =>
          Effect.gen(function* () {
            // This would select specific implementations based on strategy
            // For now, delegate to default execute
            return yield* service.execute(type, config, input);
          }),

        /**
         * Batch execute multiple operators
         */
        executeBatch: (
          operations: Array<{ type: string; config: any; input: any }>
        ) =>
          Effect.all(
            operations.map((op) =>
              service.execute(op.type, op.config, op.input)
            ),
            { concurrency: 'unbounded' }
          ),

        /**
         * Pipeline operators (output of one feeds into next)
         */
        executePipeline: (
          operations: Array<{ type: string; config: any }>,
          initialInput: any
        ) =>
          Effect.reduce(operations, initialInput, (input, op) =>
            service.execute(op.type, op.config, input)
          ),
      };

      return service;
    }),
  }
) {}

/**
 * Live layer with default operator implementations
 */
export const OperatorServiceLive = Layer.mergeAll(
  Layer.effect(
    ReduceOperatorService,
    DefaultReduceOperatorService.pipe(
      Effect.provideService(
        ExecutionContextService,
        ExecutionContextService.of({} as any)
      )
    )
  ),
  Layer.effect(
    MapOperatorService,
    SequentialMapOperatorService.pipe(
      Effect.provideService(
        ExecutionContextService,
        ExecutionContextService.of({} as any)
      )
    )
  ),
  Layer.effect(
    FilterOperatorService,
    DefaultFilterOperatorService.pipe(
      Effect.provideService(
        ExecutionContextService,
        ExecutionContextService.of({} as any)
      )
    )
  ),
  SwitchOperatorService.Default,
  LoopOperatorService.Default,
  Layer.effect(
    ConditionalOperatorService,
    DefaultConditionalOperatorService.pipe(
      Effect.provideService(
        ExecutionContextService,
        ExecutionContextService.of({} as any)
      )
    )
  )
).pipe(
  Layer.provide(OperatorRegistryService.Default),
  Layer.provide(ExecutionContextService.Default)
);

/**
 * Live layer with parallel operator implementations
 */
export const OperatorServiceParallel = Layer.mergeAll(
  Layer.effect(
    ReduceOperatorService,
    ParallelReduceOperatorService.pipe(
      Effect.provideService(
        ExecutionContextService,
        ExecutionContextService.of({} as any)
      )
    )
  ),
  Layer.effect(
    MapOperatorService,
    ParallelMapOperatorService.pipe(
      Effect.provideService(
        ExecutionContextService,
        ExecutionContextService.of({} as any)
      )
    )
  ),
  Layer.effect(
    FilterOperatorService,
    ParallelFilterOperatorService.pipe(
      Effect.provideService(
        ExecutionContextService,
        ExecutionContextService.of({} as any)
      )
    )
  ),
  SwitchOperatorService.Default,
  LoopOperatorService.Default,
  Layer.effect(
    ConditionalOperatorService,
    DefaultConditionalOperatorService.pipe(
      Effect.provideService(
        ExecutionContextService,
        ExecutionContextService.of({} as any)
      )
    )
  )
).pipe(
  Layer.provide(OperatorRegistryService.Default),
  Layer.provide(ExecutionContextService.Default)
);

/**
 * Test layer with mock implementations
 */
export const OperatorServiceTest = Layer.effect(
  OperatorService,
  Effect.gen(function* () {
    const operators = yield* Ref.make<HashMap.HashMap<string, any>>(
      HashMap.empty()
    );

    return {
      execute: (type: string, config: any, input: any) => {
        // Return appropriate mock result based on operator type
        switch (type) {
          case 'reduce':
            return Effect.succeed({
              value: 'test-reduced',
              metadata: {
                itemsProcessed: 0,
                executionTime: 0,
              },
            });
          case 'map':
            return Effect.succeed({
              value: ['test-mapped'],
              metadata: {
                itemsProcessed: 1,
                executionTime: 0,
                parallel: false,
              },
            });
          case 'filter':
            return Effect.succeed({
              filtered: ['test-filtered'],
              original: [input],
              metadata: {
                filteredCount: 1,
                originalCount: 1,
                executionTime: 0,
              },
            });
          case 'switch':
            return Effect.succeed({
              value: 'test-case',
              metadata: {
                selectedCase: 0,
                evaluationTime: 0,
              },
            });
          case 'loop':
            return Effect.succeed({
              results: ['test-loop'],
              metadata: {
                iterations: 1,
                executionTime: 0,
              },
            });
          case 'conditional':
            return Effect.succeed({
              value: 'test-then',
              metadata: {
                branch: 'then' as const,
                conditionValue: true,
                executionTime: 0,
              },
            });
          default:
            return Effect.succeed({ value: 'test-result' } as any);
        }
      },

      validate: () => Effect.succeed(true),

      getOperator: (type: string) => Effect.succeed(null as any),

      listOperatorTypes: () =>
        Effect.succeed([
          'reduce',
          'map',
          'filter',
          'switch',
          'loop',
          'conditional',
        ]),

      executeWithStrategy: (
        type: string,
        strategy: string,
        config: any,
        input: any
      ) => {
        // Delegate to execute for testing
        const service = OperatorService.of({
          execute: (type: string, config: any, input: any) => {
            // Return appropriate mock result based on operator type
            switch (type) {
              case 'reduce':
                return Effect.succeed({
                  value: 'test-reduced',
                  metadata: {
                    itemsProcessed: 0,
                    executionTime: 0,
                  },
                });
              default:
                return Effect.succeed({ value: 'test-result' } as any);
            }
          },
        } as any);
        return service.execute(type, config, input);
      },

      executeBatch: (operations: any[]) => {
        const executeOp = (op: any) => {
          switch (op.type) {
            case 'reduce':
              return Effect.succeed({
                value: 'test-reduced',
                metadata: {
                  itemsProcessed: 0,
                  executionTime: 0,
                },
              });
            case 'map':
              return Effect.succeed({
                value: ['test-mapped'],
                metadata: {
                  itemsProcessed: 1,
                  executionTime: 0,
                  parallel: false,
                },
              });
            case 'filter':
              return Effect.succeed({
                filtered: ['test-filtered'],
                original: [op.input],
                metadata: {
                  filteredCount: 1,
                  originalCount: 1,
                  executionTime: 0,
                },
              });
            default:
              return Effect.succeed({ value: 'test-result' } as any);
          }
        };
        return Effect.all(operations.map(executeOp));
      },

      executePipeline: (operations: any[], initialInput: any) => {
        const executeOp = (input: any, op: any) => {
          switch (op.type) {
            case 'reduce':
              return Effect.succeed({
                value: 'test-reduced',
                metadata: {
                  itemsProcessed: 0,
                  executionTime: 0,
                },
              });
            default:
              return Effect.succeed({ value: 'test-result' } as any);
          }
        };
        return Effect.reduce(operations, initialInput, executeOp);
      },
    } as any as OperatorService;
  })
);

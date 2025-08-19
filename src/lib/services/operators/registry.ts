import { Effect, Ref, Option, HashMap, Layer } from 'effect';
import { ValidationError } from '../../errors';
import type { UnifiedOperator } from '../../operators/base';

/**
 * Operator Registry Service - Manages operator registration and retrieval
 * Uses Effect.Service for singleton behavior
 */
export class OperatorRegistryService extends Effect.Service<OperatorRegistryService>()(
  'OperatorRegistryService',
  {
    effect: Effect.gen(function* () {
      // Internal registry state - singleton through service
      const operators = yield* Ref.make<
        HashMap.HashMap<string, UnifiedOperator<any>>
      >(HashMap.empty());

      return {
        /**
         * Register an operator
         */
        register: (type: string, operator: UnifiedOperator<any>) =>
          Effect.gen(function* () {
            yield* Ref.update(operators, HashMap.set(type, operator));
          }),

        /**
         * Get an operator by type
         */
        get: (type: string) =>
          Effect.gen(function* () {
            const currentOperators = yield* Ref.get(operators);
            const operator = HashMap.get(currentOperators, type);

            if (Option.isNone(operator)) {
              return yield* Effect.fail(
                new ValidationError({
                  message: `Operator type '${type}' not found`,
                  field: 'type',
                })
              );
            }

            return operator.value;
          }),

        /**
         * List all operator types
         */
        listTypes: () =>
          Effect.gen(function* () {
            const currentOperators = yield* Ref.get(operators);
            return Array.from(HashMap.keys(currentOperators));
          }),

        /**
         * Check if operator exists
         */
        has: (type: string) =>
          Effect.gen(function* () {
            const currentOperators = yield* Ref.get(operators);
            return HashMap.has(currentOperators, type);
          }),

        /**
         * Clear all operators
         */
        clear: () =>
          Effect.gen(function* () {
            yield* Ref.set(operators, HashMap.empty());
          }),

        /**
         * Get count of registered operators
         */
        size: () =>
          Effect.gen(function* () {
            const currentOperators = yield* Ref.get(operators);
            return HashMap.size(currentOperators);
          }),
      };
    }),
  }
) {}

/**
 * Test implementation
 */
export const OperatorRegistryTest = Layer.succeed(OperatorRegistryService, {
  _tag: 'OperatorRegistryService' as const,
  register: () => Effect.void,
  get: (type: string) =>
    Effect.fail(
      new ValidationError({
        message: `Operator ${type} not found`,
        field: 'type',
      })
    ),
  listTypes: () => Effect.succeed([]),
  has: () => Effect.succeed(false),
  clear: () => Effect.void,
  size: () => Effect.succeed(0),
});

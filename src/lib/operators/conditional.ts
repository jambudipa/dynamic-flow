/**
 * Conditional Operator - Branches based on condition
 */

import { Effect, Schema } from 'effect';
import {
  BaseFields,
  type ExecutionContext,
  type IRGenerationContext,
  type StepResolver,
  type UnifiedOperator,
} from './base';
import { evaluateCondition, inferType } from './utils';
import type { IRNode } from '@/lib/ir';
import { OperatorRegistry } from './registry';

export interface ConditionalConfig {
  id: string;
  condition: string;
  if_true?: Array<any>;
  if_false?: Array<any>;
  output?: string;
  timeout?: number;
  retry?: number;
  description?: string;
}

// Forward declaration - will be imported from registry
declare function getOperator(type: string): UnifiedOperator | undefined;

export class ConditionalOperator implements UnifiedOperator<ConditionalConfig> {
  readonly name = 'conditional';
  readonly type = 'conditional';
  readonly description = 'Executes different branches based on a condition';

  readonly recursiveSchema = Schema.Struct({
    ...BaseFields,
    condition: Schema.String,
    if_true: Schema.optional(
      Schema.mutable(Schema.Array(Schema.suspend(() => Schema.Unknown)))
    ), // Will be replaced with Step union
    if_false: Schema.optional(
      Schema.mutable(Schema.Array(Schema.suspend(() => Schema.Unknown)))
    ),
  }) as Schema.Schema<ConditionalConfig>;

  readonly flatSchema = Schema.Struct({
    ...BaseFields,
    type: Schema.Literal('conditional'),
    condition: Schema.String,
    ifTrueIds: Schema.optional(Schema.Array(Schema.String)),
    ifFalseIds: Schema.optional(Schema.Array(Schema.String)),
  });

  execute(
    input: any,
    config: ConditionalConfig,
    ctx: ExecutionContext
  ): Effect.Effect<any, any, any> {
    return Effect.gen(function* () {
      // Evaluate condition
      const conditionResult = evaluateCondition(
        config.condition,
        ctx.variables
      );

      // Select branch
      const branch = conditionResult ? config.if_true : config.if_false;
      if (branch === null || branch === undefined || branch.length === 0) {
        return input; // Pass through if no branch
      }

      // Execute branch steps sequentially
      let result = input;
      for (const step of branch) {
        // Use the imported OperatorRegistry
        const operator = OperatorRegistry.getInstance().get(
          step.type || inferType(step)
        );

        if (operator) {
          result = yield* operator.execute(result, step, ctx);
        }
      }

      // Store output if specified
      if (config.output) {
        ctx.variables.set(config.output, result);
      }

      return result;
    });
  }

  toFlat(recursive: ConditionalConfig): any {
    const { if_true, if_false, ...rest } = recursive;
    return {
      ...rest,
      type: 'conditional',
      ifTrueIds: if_true?.map((s: any) => s.id) || [],
      ifFalseIds: if_false?.map((s: any) => s.id) || [],
    };
  }

  fromFlat(flat: any, resolver?: StepResolver): ConditionalConfig {
    const { ifTrueIds, ifFalseIds, type, ...rest } = flat;
    return {
      ...rest,
      if_true: resolver ? resolver.resolveMany(ifTrueIds || []) : [],
      if_false: resolver ? resolver.resolveMany(ifFalseIds || []) : [],
    };
  }

  toIR(config: ConditionalConfig, ctx: IRGenerationContext): IRNode {
    // Convert nested steps to IR nodes
    const trueBranch: string[] = [];
    const falseBranch: string[] = [];

    // Get operators for nested steps from registry (handle both if_true/then)
    const trueSteps = config.if_true || (config as any).then;
    if (trueSteps) {
      for (const step of trueSteps) {
        const operator = OperatorRegistry.getInstance().get(
          step.type || inferType(step)
        );
        if (operator) {
          const node = operator.toIR(step, ctx);
          trueBranch.push(node.id);
          ctx.addNode(node);
        }
      }
    }

    const falseSteps = config.if_false || (config as any).else;
    if (falseSteps) {
      for (const step of falseSteps) {
        const operator = OperatorRegistry.getInstance().get(
          step.type || inferType(step)
        );
        if (operator) {
          const node = operator.toIR(step, ctx);
          falseBranch.push(node.id);
          ctx.addNode(node);
        }
      }
    }

    return {
      id: config.id || ctx.nodeIdGenerator(),
      type: 'conditional',
      condition: {
        type: 'expression',
        value: config.condition,
      },
      thenBranch: trueBranch,
      elseBranch: falseBranch.length > 0 ? falseBranch : undefined,
      config: {
        timeout: config.timeout,
        retries: config.retry,
      },
    } as IRNode;
  }
}

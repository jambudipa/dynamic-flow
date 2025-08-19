/**
 * Loop Operator - Iterates over data or condition
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

export interface LoopConfig {
  id: string;
  loop: 'for' | 'while';
  over?: string;
  condition?: string;
  body: Array<any>;
  output?: string;
  timeout?: number;
  retry?: number;
  description?: string;
}

export class LoopOperator implements UnifiedOperator<LoopConfig> {
  readonly name = 'loop';
  readonly type = 'loop';
  readonly description =
    'Iterates over a collection or while a condition is true';

  readonly recursiveSchema = Schema.Struct({
    ...BaseFields,
    loop: Schema.Literal('for', 'while'),
    over: Schema.optional(Schema.String),
    condition: Schema.optional(Schema.String),
    body: Schema.mutable(Schema.Array(Schema.suspend(() => Schema.Unknown))), // Will be replaced with Step union
  }) as Schema.Schema<LoopConfig>;

  readonly flatSchema = Schema.Struct({
    ...BaseFields,
    type: Schema.Literal('loop'),
    loop: Schema.Literal('for', 'while'),
    over: Schema.optional(Schema.String),
    condition: Schema.optional(Schema.String),
    bodyIds: Schema.Array(Schema.String),
  });

  execute(
    input: any,
    config: LoopConfig,
    ctx: ExecutionContext
  ): Effect.Effect<any, any, any> {
    return Effect.gen(function* () {
      const results: any[] = [];

      if (config.loop === 'for') {
        // For loop - iterate over collection
        let collection: any[];

        if (config.over) {
          // Get collection from variable
          if (config.over.startsWith('$')) {
            collection = ctx.variables.get(config.over.slice(1));
          } else {
            collection = ctx.variables.get(config.over);
          }
        } else {
          collection = input;
        }

        if (!Array.isArray(collection)) {
          return yield* Effect.fail(
            new Error(`For loop requires array input, got ${typeof collection}`)
          );
        }

        // Execute body for each item
        for (const item of collection) {
          ctx.variables.set('item', item);

          let result = item;
          for (const step of config.body) {
            const operator = OperatorRegistry.getInstance().get(
              step.type || inferType(step)
            );

            if (operator) {
              result = yield* operator.execute(result, step, ctx);
            }
          }
          results.push(result);
        }
      } else {
        // While loop - iterate while condition is true
        let iterations = 0;
        const MAX_ITERATIONS = 1000; // Safety limit

        while (evaluateCondition(config.condition || 'false', ctx.variables)) {
          if (iterations++ > MAX_ITERATIONS) {
            return yield* Effect.fail(
              new Error('While loop exceeded maximum iterations')
            );
          }

          let result = input;
          for (const step of config.body) {
            const operator = OperatorRegistry.getInstance().get(
              step.type || inferType(step)
            );

            if (operator) {
              result = yield* operator.execute(result, step, ctx);
            }
          }
          results.push(result);
        }
      }

      // Store output if specified
      if (config.output) {
        ctx.variables.set(config.output, results);
      }

      return results;
    });
  }

  toFlat(recursive: LoopConfig): any {
    const { body, ...rest } = recursive;
    return {
      ...rest,
      type: 'loop',
      bodyIds: body?.map((s: any) => s.id) || [],
    };
  }

  fromFlat(flat: any, resolver?: StepResolver): LoopConfig {
    const { bodyIds, type, ...rest } = flat;
    return {
      ...rest,
      body: resolver ? resolver.resolveMany(bodyIds || []) : [],
    };
  }

  toIR(config: LoopConfig, ctx: IRGenerationContext): IRNode {
    // Convert body steps to IR nodes
    const bodyNodes: string[] = [];

    for (const step of config.body) {
      const operator = OperatorRegistry.getInstance().get(
        step.type || inferType(step)
      );
      if (operator) {
        const node = operator.toIR(step, ctx);
        bodyNodes.push(node.id);
        ctx.addNode(node);
      }
    }

    return {
      id: config.id || ctx.nodeIdGenerator(),
      type: 'loop',
      loopType: config.loop,
      collection:
        config.loop === 'for'
          ? { type: 'variable', name: config.over || 'input' }
          : undefined,
      condition:
        config.loop === 'while'
          ? { type: 'expression', value: config.condition || 'false' }
          : undefined,
      iteratorVar: config.loop === 'for' ? 'item' : undefined,
      body: bodyNodes,
      outputVar: config.output,
      config: {
        timeout: config.timeout,
        retries: config.retry,
      },
    } as IRNode;
  }
}

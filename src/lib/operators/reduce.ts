/**
 * Reduce Operator - Reduces a collection to a single value
 */

import { Effect, Schema } from 'effect';
import {
  BaseFields,
  type ExecutionContext,
  type IRGenerationContext,
  type StepResolver,
  type UnifiedOperator,
} from './base';
import { inferType } from './utils';
import type { IRNode } from '@/lib/ir';
import { OperatorRegistry } from './registry';

export interface ReduceConfig {
  id: string;
  reduce: string;
  initial: any;
  with: any;
  output?: string;
  timeout?: number;
  retry?: number;
  description?: string;
}

export class ReduceOperator implements UnifiedOperator<ReduceConfig> {
  readonly name = 'reduce';
  readonly type = 'reduce';
  readonly description = 'Reduces a collection to a single value';

  readonly recursiveSchema = Schema.Struct({
    ...BaseFields,
    reduce: Schema.String,
    initial: Schema.Unknown,
    with: Schema.suspend(() => Schema.Unknown), // Will be replaced with Step
  }) as Schema.Schema<ReduceConfig>;

  // JSON-compatible type for initial value
  private readonly JsonValue = Schema.Union(
    Schema.String,
    Schema.Number,
    Schema.Boolean,
    Schema.Null,
    Schema.Array(
      Schema.Union(Schema.String, Schema.Number, Schema.Boolean, Schema.Null)
    ),
    Schema.Record({
      key: Schema.String,
      value: Schema.Union(
        Schema.String,
        Schema.Number,
        Schema.Boolean,
        Schema.Null
      ),
    })
  );

  readonly flatSchema = Schema.Struct({
    ...BaseFields,
    type: Schema.Literal('reduce'),
    reduce: Schema.String,
    initial: this.JsonValue,
    withId: Schema.String,
  });

  execute(
    input: any,
    config: ReduceConfig,
    ctx: ExecutionContext
  ): Effect.Effect<any, any, any> {
    return Effect.gen(function* () {
      // Get collection to reduce
      let collection: any[];

      if (config.reduce.startsWith('$')) {
        collection = ctx.variables.get(config.reduce.slice(1));
      } else {
        collection = ctx.variables.get(config.reduce) || input;
      }

      if (!Array.isArray(collection)) {
        return yield* Effect.fail(
          new Error(`Reduce requires array input, got ${typeof collection}`)
        );
      }

      let accumulator = config.initial;

      // Process each item
      for (const item of collection) {
        ctx.variables.set('item', item);
        ctx.variables.set('acc', accumulator);

        const operator = OperatorRegistry.getInstance().get(
          config.with.type || inferType(config.with)
        );

        if (operator) {
          accumulator = yield* operator.execute(
            { item, acc: accumulator },
            config.with,
            ctx
          );
        }
      }

      // Store output if specified
      if (config.output) {
        ctx.variables.set(config.output, accumulator);
      }

      return accumulator;
    });
  }

  toFlat(recursive: ReduceConfig): any {
    const { with: withStep, ...rest } = recursive;
    return {
      ...rest,
      type: 'reduce',
      withId: withStep?.id,
    };
  }

  fromFlat(flat: any, resolver?: StepResolver): ReduceConfig {
    const { withId, type, ...rest } = flat;
    return {
      ...rest,
      with: resolver ? resolver.resolve(withId) : null,
    };
  }

  toIR(config: ReduceConfig, ctx: IRGenerationContext): IRNode {
    // Reduce with nested operation
    const bodyNodes: string[] = [];
    if (config.with) {
      const operator = OperatorRegistry.getInstance().get(
        config.with.type || inferType(config.with)
      );
      if (operator) {
        const node = operator.toIR(config.with, ctx);
        bodyNodes.push(node.id);
        ctx.addNode(node);
      }
    }

    return {
      id: config.id || ctx.nodeIdGenerator(),
      type: 'loop',
      loopType: 'reduce',
      collection: { type: 'variable', name: config.reduce },
      iteratorVar: 'item',
      accumulator: { type: 'literal', value: config.initial },
      body: bodyNodes,
      outputVar: config.output,
      config: {
        timeout: config.timeout,
        retries: config.retry,
      },
    } as IRNode;
  }
}

/**
 * Map Operator - Transforms each item in a collection
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

export interface MapConfig {
  id: string;
  map: string;
  with: any;
  output?: string;
  timeout?: number;
  retry?: number;
  description?: string;
}

export class MapOperator implements UnifiedOperator<MapConfig> {
  readonly name = 'map';
  readonly type = 'map';
  readonly description = 'Transforms each item in a collection';

  readonly recursiveSchema = Schema.Struct({
    ...BaseFields,
    map: Schema.String,
    with: Schema.suspend(() => Schema.Unknown), // Will be replaced with Step
  }) as Schema.Schema<MapConfig>;

  readonly flatSchema = Schema.Struct({
    ...BaseFields,
    type: Schema.Literal('map'),
    map: Schema.String,
    withId: Schema.String,
  });

  execute(
    input: any,
    config: MapConfig,
    ctx: ExecutionContext
  ): Effect.Effect<any, any, any> {
    return Effect.gen(function* () {
      // Get collection to map
      let collection: any[];

      if (config.map.startsWith('$')) {
        collection = ctx.variables.get(config.map.slice(1));
      } else {
        collection = ctx.variables.get(config.map) || input;
      }

      if (!Array.isArray(collection)) {
        return yield* Effect.fail(
          new Error(`Map requires array input, got ${typeof collection}`)
        );
      }

      const results: any[] = [];

      // Process each item
      for (const item of collection) {
        ctx.variables.set('item', item);

        const operator = OperatorRegistry.getInstance().get(
          config.with.type || inferType(config.with)
        );

        if (operator) {
          const result = yield* operator.execute(item, config.with, ctx);
          results.push(result);
        } else {
          results.push(item);
        }
      }

      // Store output if specified
      if (config.output) {
        ctx.variables.set(config.output, results);
      }

      return results;
    });
  }

  toFlat(recursive: MapConfig): any {
    const { with: withStep, ...rest } = recursive;
    return {
      ...rest,
      type: 'map',
      withId: withStep?.id,
    };
  }

  fromFlat(flat: any, resolver?: StepResolver): MapConfig {
    const { withId, type, ...rest } = flat;
    return {
      ...rest,
      with: resolver ? resolver.resolve(withId) : null,
    };
  }

  toIR(config: MapConfig, ctx: IRGenerationContext): IRNode {
    // Map with nested operation
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
      loopType: 'map',
      collection: { type: 'variable', name: config.map },
      iteratorVar: 'item',
      body: bodyNodes,
      outputVar: config.output,
      config: {
        timeout: config.timeout,
        retries: config.retry,
        parallel: (config as any).parallel,
      },
    } as IRNode;
  }
}

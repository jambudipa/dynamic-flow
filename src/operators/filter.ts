/**
 * Filter Operator - Filters data based on condition
 */

import { Effect, Schema } from 'effect';
import {
  BaseFields,
  type ExecutionContext,
  type IRGenerationContext,
  type UnifiedOperator,
} from './base';
import { evaluateCondition } from './utils';
import type { IRNode, IRValue } from '@/ir';

export interface FilterConfig {
  id: string;
  filter: string;
  condition: string;
  output?: string;
  timeout?: number;
  retry?: number;
  description?: string;
}

export class FilterOperator implements UnifiedOperator<FilterConfig> {
  readonly name = 'filter';
  readonly type = 'filter';
  readonly description = 'Filters array data based on a condition';

  readonly recursiveSchema = Schema.Struct({
    ...BaseFields,
    filter: Schema.String,
    condition: Schema.String,
  }) as Schema.Schema<FilterConfig>;

  // Filters don't nest, so flat schema is similar with type field
  readonly flatSchema = Schema.Struct({
    ...BaseFields,
    type: Schema.Literal('filter'),
    filter: Schema.String,
    condition: Schema.String,
  });

  execute(
    input: any,
    config: FilterConfig,
    ctx: ExecutionContext
  ): Effect.Effect<any, any, any> {
    return Effect.gen(function* (_) {
      // Get data to filter (from variable or input)
      const data = config.filter.startsWith('$')
        ? ctx.variables.get(config.filter.slice(1))
        : ctx.variables.get(config.filter) || input;

      if (!Array.isArray(data)) {
        return yield* Effect.fail(
          new Error(`Filter input must be an array, got ${typeof data}`)
        );
      }

      // Evaluate condition for each item
      const filtered = data.filter((item) => {
        // Create temp context with item variable
        const tempVars = new Map(ctx.variables);
        tempVars.set('item', item);
        return evaluateCondition(config.condition, tempVars);
      });

      // Store output if specified
      if (config.output) {
        ctx.variables.set(config.output, filtered);
      }

      return filtered;
    });
  }

  toFlat(recursive: FilterConfig): any {
    return { ...recursive, type: 'filter' };
  }

  fromFlat(flat: any): FilterConfig {
    const { type, ...rest } = flat;
    return rest;
  }

  toIR(config: FilterConfig, ctx: IRGenerationContext): IRNode {
    // Filter is implemented as a specialized tool node
    const inputs: Record<string, IRValue> = {
      collection: { type: 'variable', name: config.filter },
      condition: { type: 'expression', expr: config.condition },
    };

    return {
      id: config.id || ctx.nodeIdGenerator(),
      type: 'tool',
      tool: '__builtin_filter',
      inputs,
      outputVar: config.output,
      config: {
        timeout: config.timeout,
        retries: config.retry,
      },
    } as IRNode;
  }
}

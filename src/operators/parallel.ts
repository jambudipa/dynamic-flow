/**
 * Parallel Operator - Executes steps concurrently
 */

import { Effect, Schema } from 'effect';
import {
  BaseFields,
  type ExecutionContext,
  type IRGenerationContext,
  type StepResolver,
  type UnifiedOperator
} from './base';
import { inferType } from './utils';
import type { IRNode } from '@/ir';

export interface ParallelConfig {
  id: string;
  parallel: Array<any>;
  output?: string;
  timeout?: number;
  retry?: number;
  description?: string;
}

export class ParallelOperator implements UnifiedOperator<ParallelConfig> {
  readonly name = 'parallel';
  readonly type = 'parallel';
  readonly description = 'Executes multiple steps concurrently';

  readonly recursiveSchema = Schema.Struct({
    ...BaseFields,
    parallel: Schema.mutable(
      Schema.Array(Schema.suspend(() => Schema.Unknown))
    ), // Will be replaced with Step union
  }) as Schema.Schema<ParallelConfig>;

  readonly flatSchema = Schema.Struct({
    ...BaseFields,
    type: Schema.Literal('parallel'),
    parallelIds: Schema.Array(Schema.String),
  });

  execute(
    input: any,
    config: ParallelConfig,
    ctx: ExecutionContext
  ): Effect.Effect<any, any, any> {
    return Effect.gen(function* (_) {
      // Import registry dynamically
      const { OperatorRegistry } = yield* Effect.promise(
        () => import('./registry')
      );

      // Create effects for each parallel step
      const effects = config.parallel.map((step: any) => {
        const operator = OperatorRegistry.getInstance().get(
          step.type || inferType(step)
        );
        if (operator) {
          return operator.execute(input, step, ctx);
        }
        return Effect.succeed(null);
      });

      // Execute all effects concurrently
      const results = yield* Effect.all(effects, { concurrency: 'unbounded' });

      // Store output if specified
      if (config.output) {
        ctx.variables.set(config.output, results);
      }

      return results;
    });
  }

  toFlat(recursive: ParallelConfig): any {
    const { parallel, ...rest } = recursive;
    return {
      ...rest,
      type: 'parallel',
      parallelIds: parallel?.map((s: any) => s.id) || [],
    };
  }

  fromFlat(flat: any, resolver?: StepResolver): ParallelConfig {
    const { parallelIds, type, ...rest } = flat;
    return {
      ...rest,
      parallel: resolver ? resolver.resolveMany(parallelIds || []) : [],
    };
  }

  toIR(config: ParallelConfig, ctx: IRGenerationContext): IRNode {
    // Convert parallel steps to IR nodes
    const branches: [string[]] = [[]];

    for (const step of config.parallel) {
      const { OperatorRegistry } = require('./registry');
      const operator = OperatorRegistry.getInstance().get(
        step.type || inferType(step)
      );
      if (operator) {
        const node = operator.toIR(step, ctx);
        const id = (node as IRNode | undefined)?.id;
        if (id) {
          branches[0].push(id);
        }
      }
    }

    return {
      id: config.id || ctx.nodeIdGenerator(),
      type: 'parallel',
      branches,
      joinStrategy: 'all',
      outputVar: config.output,
      config: {
        timeout: config.timeout,
        retries: config.retry,
      },
    } as IRNode;
  }
}

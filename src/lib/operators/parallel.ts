/**
 * Parallel Operator - Executes steps concurrently
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
    return Effect.gen(function* () {
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
    const branches: string[][] = [];

    // Handle both 'parallel' and 'branches' properties for backward compatibility
    const inputBranches = (config as any).branches;

    if (inputBranches && Array.isArray(inputBranches)) {
      // Handle branches format: array of arrays
      for (const branch of inputBranches) {
        const branchNodeIds: string[] = [];
        if (Array.isArray(branch)) {
          for (const step of branch) {
            const operator = OperatorRegistry.getInstance().get(
              step.type || inferType(step)
            );
            if (operator) {
              const node = operator.toIR(step, ctx);
              branchNodeIds.push(node.id);
              ctx.addNode(node);
            }
          }
        }
        branches.push(branchNodeIds);
      }
    } else if (config.parallel && Array.isArray(config.parallel)) {
      // Handle parallel format: flat array of steps
      const branchNodeIds: string[] = [];
      for (const step of config.parallel) {
        const operator = OperatorRegistry.getInstance().get(
          step.type || inferType(step)
        );
        if (operator) {
          const node = operator.toIR(step, ctx);
          branchNodeIds.push(node.id);
          ctx.addNode(node);
        }
      }
      branches.push(branchNodeIds);
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
        maxConcurrency: (config as any).maxConcurrency,
      },
    } as IRNode;
  }
}

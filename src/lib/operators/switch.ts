/**
 * Switch Operator - Multi-way branching based on LLM choice
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
import { structuredChoice } from '@/lib/llm/structured';
import type { IRNode, IRValue } from '@/lib/ir';

export interface SwitchConfig {
  id: string;
  switch: string; // The prompt for LLM
  options: Array<{
    id: string;
    name: string;
    description: string;
  }>;
  branches: Record<string, Array<any>>; // Map of option ID to steps
  output?: string;
  timeout?: number;
  retry?: number;
  description?: string;
}

export class SwitchOperator implements UnifiedOperator<SwitchConfig> {
  readonly name = 'switch';
  readonly type = 'switch';
  readonly description = 'Multi-way branching using LLM to select path';

  readonly recursiveSchema = Schema.Struct({
    ...BaseFields,
    switch: Schema.String,
    options: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        name: Schema.String,
        description: Schema.String,
      })
    ),
    branches: Schema.Record({
      key: Schema.String,
      value: Schema.mutable(Schema.Array(Schema.suspend(() => Schema.Unknown))),
    }),
  }) as unknown as Schema.Schema<SwitchConfig>;

  readonly flatSchema = Schema.Struct({
    ...BaseFields,
    type: Schema.Literal('switch'),
    switch: Schema.String,
    options: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        name: Schema.String,
        description: Schema.String,
      })
    ),
    branchIds: Schema.Record({
      key: Schema.String,
      value: Schema.Array(Schema.String),
    }),
  });

  execute(
    input: any,
    config: SwitchConfig,
    ctx: ExecutionContext
  ): Effect.Effect<any, any, any> {
    return Effect.gen(function* () {
      // Use LLM to choose branch
      const choice = yield* structuredChoice(config.switch, config.options, {
        retries: config.retry || 2,
      });

      // Get selected branch
      const branch = config.branches[choice.choice];
      if (!branch) {
        return yield* Effect.fail(
          new Error(`Switch selected unknown branch '${choice.choice}'`)
        );
      }

      // Execute branch steps sequentially
      let result = input;

      // Import registry dynamically
      const { OperatorRegistry } = yield* Effect.promise(
        () => import('./registry')
      );

      for (const step of branch) {
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

  toFlat(recursive: SwitchConfig): any {
    const { branches, ...rest } = recursive;
    const branchIds: Record<string, string[]> = {};

    for (const [key, steps] of Object.entries(branches)) {
      branchIds[key] = steps.map((s: any) => s.id);
    }

    return {
      ...rest,
      type: 'switch',
      branchIds,
    };
  }

  fromFlat(flat: any, resolver?: StepResolver): SwitchConfig {
    const { branchIds, type, ...rest } = flat;
    const branches: Record<string, any[]> = {};

    if (branchIds && resolver) {
      for (const [key, ids] of Object.entries(branchIds)) {
        branches[key] = resolver.resolveMany(ids as string[]);
      }
    }

    return {
      ...rest,
      branches,
    };
  }

  toIR(config: SwitchConfig, ctx: IRGenerationContext): IRNode {
    // Switch is a special tool that selects a branch using LLM
    const inputs: Record<string, IRValue> = {
      prompt: { type: 'literal', value: config.switch },
      options: { type: 'literal', value: config.options },
    };

    // Convert branch steps to node IDs
    const branchIds: Record<string, string[]> = {};
    for (const [key, steps] of Object.entries(config.branches)) {
      branchIds[key] = [];
      for (const step of steps) {
        const { OperatorRegistry } = require('./registry');
        const operator = OperatorRegistry.getInstance().get(
          step.type || inferType(step)
        );
        if (operator) {
          const node = operator.toIR(step, ctx);
          branchIds[key].push(node.id);
        }
      }
    }

    inputs.branches = { type: 'literal', value: branchIds };

    return {
      id: config.id || ctx.nodeIdGenerator(),
      type: 'tool',
      tool: '__builtin_switch',
      inputs,
      outputVar: config.output,
      config: {
        timeout: config.timeout,
        retries: config.retry,
      },
    } as IRNode;
  }
}

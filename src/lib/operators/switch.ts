/**
 * Switch Operator - Multi-way branching based on LLM choice
 *
 * Refactored to use idiomatic Effect patterns:
 * - Effect.gen for structured concurrency
 * - Data.Struct for configuration
 * - Either for error handling
 * - HashMap for efficient lookups
 * - Option for optional values
 */

import { Effect, Schema, Data, Either, HashMap, Option, Chunk } from 'effect';
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
import { NodeId } from '@/lib/ir/core-types';
import { OperatorRegistry } from './registry';

/**
 * Switch option using Data.struct for immutability and structural equality
 */
export interface SwitchOption {
  readonly id: string;
  readonly name: string;
  readonly description: string;
}

export const SwitchOption = (params: {
  id: string;
  name: string;
  description: string;
}): SwitchOption => Data.struct(params);

/**
 * Switch configuration using Data.struct with proper Effect types
 */
export interface SwitchConfig {
  readonly id: string;
  readonly switch: string;
  readonly options: Chunk.Chunk<SwitchOption>;
  readonly branches: HashMap.HashMap<string, Chunk.Chunk<unknown>>; // Steps for each branch
  readonly output: Option.Option<string>;
  readonly timeout: Option.Option<number>;
  readonly retry: Option.Option<number>;
  readonly description: Option.Option<string>;
}

export const SwitchConfig = (params: {
  id: string;
  switch: string;
  options: readonly SwitchOption[];
  branches: Record<string, readonly unknown[]>;
  output?: string;
  timeout?: number;
  retry?: number;
  description?: string;
}): SwitchConfig =>
  Data.struct({
    id: params.id,
    switch: params.switch,
    options: Chunk.fromIterable(params.options),
    branches: HashMap.fromIterable(
      Object.entries(params.branches).map(
        ([key, steps]) => [key, Chunk.fromIterable(steps)] as const
      )
    ),
    output: params.output ? Option.some(params.output) : Option.none(),
    timeout: params.timeout ? Option.some(params.timeout) : Option.none(),
    retry: params.retry ? Option.some(params.retry) : Option.none(),
    description: params.description
      ? Option.some(params.description)
      : Option.none(),
  });

/**
 * Switch execution error using Data.TaggedError
 */
export class SwitchExecutionError extends Data.TaggedError(
  'SwitchExecutionError'
)<{
  readonly message: string;
  readonly choice: Option.Option<string>;
  readonly context?: Record<string, unknown>;
}> {
  get displayMessage(): string {
    const choiceInfo = Option.isSome(this.choice)
      ? ` (choice: ${this.choice.value})`
      : '';
    return `Switch execution failed${choiceInfo}: ${this.message}`;
  }
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
  ): Effect.Effect<any, SwitchExecutionError, any> {
    return Effect.gen(function* () {
      // Use LLM to choose branch with proper error handling
      const optionsArray = Chunk.toArray(config.options);
      const retries = Option.getOrElse(config.retry, () => 2);

      const choice = yield* structuredChoice(config.switch, optionsArray, {
        retries,
      }).pipe(
        Effect.mapError(
          (error) =>
            new SwitchExecutionError({
              message: `Failed to get LLM choice: ${error}`,
              choice: Option.none(),
              context: { input, switch: config.switch },
            })
        )
      );

      // Get selected branch using HashMap
      const branchSteps = HashMap.get(config.branches, choice.choice);
      if (Option.isNone(branchSteps)) {
        return yield* Effect.fail(
          new SwitchExecutionError({
            message: `Selected branch '${choice.choice}' not found`,
            choice: Option.some(choice.choice),
            context: {
              availableBranches: Array.from(HashMap.keys(config.branches)),
            },
          })
        );
      }

      // Execute branch steps sequentially using Chunk operations
      const steps = Chunk.toArray(branchSteps.value);
      let result = input;

      for (const step of steps) {
        const operator = OperatorRegistry.getInstance().get(
          (step as any).type || inferType(step)
        );
        if (operator) {
          result = yield* operator.execute(result, step, ctx).pipe(
            Effect.mapError(
              (error) =>
                new SwitchExecutionError({
                  message: `Step execution failed: ${error}`,
                  choice: Option.some(choice.choice),
                  context: { step, currentResult: result },
                })
            )
          );
        }
      }

      // Store output if specified using Option pattern
      if (Option.isSome(config.output)) {
        (ctx.variables as any).set(config.output.value, result);
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
    // Convert branch steps to node IDs (handle both 'branches' and 'cases')
    const cases: Record<string, string[]> = {};
    const branches = (config as any).cases || config.branches || {};

    for (const [key, steps] of Object.entries(branches)) {
      cases[key] = [];
      for (const step of steps as any[]) {
        const operator = OperatorRegistry.getInstance().get(
          step.type || inferType(step)
        );
        if (operator) {
          const node = operator.toIR(step, ctx);
          cases[key].push(node.id);
          ctx.addNode(node);
        }
      }
    }

    // Handle default case
    let defaultCase: string[] | undefined;
    if ((config as any).default) {
      defaultCase = [];
      for (const step of (config as any).default as any[]) {
        const operator = OperatorRegistry.getInstance().get(
          step.type || inferType(step)
        );
        if (operator) {
          const node = operator.toIR(step, ctx);
          defaultCase.push(node.id);
          ctx.addNode(node);
        }
      }
    }

    // Determine discriminator value
    const discriminator: IRValue = (config as any).on
      ? { type: 'expression', expr: (config as any).on }
      : { type: 'literal', value: config.switch };

    return {
      id: config.id || ctx.nodeIdGenerator(),
      type: 'switch',
      discriminator,
      cases,
      defaultCase,
      outputVar: Option.getOrUndefined(config.output),
      config: {
        timeout: Option.getOrUndefined(config.timeout),
        retries: Option.getOrUndefined(config.retry),
      },
    } as IRNode;
  }
}

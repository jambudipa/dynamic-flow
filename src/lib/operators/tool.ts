/**
 * Tool Operator - Invokes a registered tool
 */

import { Effect, Schema } from 'effect';
import {
  BaseFields,
  type ExecutionContext,
  type IRGenerationContext,
  type UnifiedOperator,
} from './base';
import { resolveVariables } from './utils';
import type { IRNode, IRValue } from '@/lib/ir';

export interface ToolConfig {
  id: string;
  tool: string;
  args?: Record<string, any>;
  output?: string;
  timeout?: number;
  retry?: number;
  description?: string;
}

export class ToolOperator implements UnifiedOperator<ToolConfig> {
  readonly name = 'tool';
  readonly type = 'tool';
  readonly description = 'Invokes a registered tool with arguments';

  // Define a JSON-compatible args schema for OpenAI compatibility
  private readonly ArgsSchema = Schema.Record({
    key: Schema.String,
    value: Schema.Union(
      Schema.String,
      Schema.Number,
      Schema.Boolean,
      Schema.Null
    ),
  });

  readonly recursiveSchema = Schema.Struct({
    ...BaseFields,
    tool: Schema.String,
    args: Schema.optional(this.ArgsSchema),
  }) as Schema.Schema<ToolConfig>;

  // Tools don't have nested structures, so flat schema is the same
  readonly flatSchema = Schema.Struct({
    ...BaseFields,
    type: Schema.Literal('tool'),
    tool: Schema.String,
    args: Schema.optional(this.ArgsSchema),
  });

  execute(
    input: any,
    config: ToolConfig,
    ctx: ExecutionContext
  ): Effect.Effect<any, any, any> {
    return Effect.gen(function* () {
      const tool = ctx.tools.get(config.tool);
      if (!tool) {
        return yield* Effect.fail(new Error(`Tool not found: ${config.tool}`));
      }

      // Resolve arguments (handle variable references like $step1.output)
      const args = resolveVariables(config.args || {}, ctx.variables);

      // Execute tool
      const result = yield* tool.execute(args, input);

      // Store output if specified
      if (config.output) {
        ctx.variables.set(config.output, result);
      }

      return result;
    });
  }

  toFlat(recursive: ToolConfig): any {
    return { ...recursive, type: 'tool' };
  }

  fromFlat(flat: any): ToolConfig {
    const { type, ...rest } = flat;
    return rest;
  }

  toIR(config: ToolConfig, ctx: IRGenerationContext): IRNode {
    // Validate tool exists if tools are provided
    if (ctx.validateConnections && ctx.tools && !ctx.tools.has(config.tool)) {
      throw new Error(`Tool '${config.tool}' not found in registry`);
    }

    // Convert args to IRValue format
    const inputs: Record<string, IRValue> = {};
    if (config.args) {
      for (const [key, value] of Object.entries(config.args)) {
        // Check if value is a variable reference
        if (typeof value === 'string' && value.startsWith('$')) {
          // Parse variable reference: $nodeId.output or $nodeId
          const parts = value.slice(1).split('.');
          if (parts.length === 2 && parts[0] && parts[1]) {
            // Reference to specific output: $nodeId.output
            inputs[key] = {
              type: 'reference',
              nodeId: parts[0],
              output: parts[1],
            };
          } else if (parts.length === 1 && parts[0]) {
            // Reference to entire node output: $nodeId
            inputs[key] = { type: 'reference', nodeId: parts[0] };
          } else {
            // Complex path or invalid - treat as variable
            inputs[key] = { type: 'variable', name: value.slice(1) || '' };
          }
        } else {
          // Literal value
          inputs[key] = { type: 'literal', value };
        }
      }
    }

    return {
      id: config.id || ctx.nodeIdGenerator(),
      type: 'tool',
      tool: config.tool,
      inputs,
      outputVar: config.output,
      config: {
        timeout: config.timeout,
        retries: config.retry,
      },
    } as IRNode;
  }
}

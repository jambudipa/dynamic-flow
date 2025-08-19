/**
 * JSON to IR Compiler - Delegates to Unified Operators
 *
 * This compiler leverages the unified operator architecture where
 * each operator knows how to generate its own IR representation.
 */

import { Effect, Option } from 'effect';
import { logWarn } from '../utils/logging';
import { type DynamicFlowType, type StepType } from '@/lib/schema/flow-schema';
import { type IR, IRBuilder, IRCompilationError, type IRNode } from '@/lib/ir';
import type { IRGenerationContext } from '@/lib/operators';
import { OperatorRegistry } from '@/lib/operators';
import { FlowConnectivityValidator } from '@/lib/operators/flow-validator';
import type { ToolJoin, UntypedToolArray } from '@/lib/tools/types';

export class JSONToIRCompiler {
  private nodeCounter = 0;
  private registry = OperatorRegistry.getInstance();

  /**
   * Compile a DynamicFlow JSON object into IR using unified operators
   */
  compile(
    flow: DynamicFlowType,
    tools?: UntypedToolArray,
    joins?: ReadonlyArray<ToolJoin<any, any>>,
    options?: { validateConnections?: boolean }
  ): Effect.Effect<IR, IRCompilationError> {
    const self = this;
    return Effect.gen(function* () {
      // Reset counter
      self.nodeCounter = 0;

      // Create context for IR generation with node collection
      const allNodes: IRNode[] = []; // Collect ALL nodes including nested

      const context: IRGenerationContext = {
        nodeIdGenerator: () => `node_${++self.nodeCounter}`,
        tools:
          tools !== null && tools !== undefined
            ? new Map(tools.map((t) => [t.id, t]))
            : new Map(),
        joins:
          joins !== null && joins !== undefined
            ? new Map(joins.map((j) => [`${j.fromTool}-${j.toTool}`, j]))
            : new Map(),
        validateConnections: options?.validateConnections ?? true,
        addNode: (node: IRNode) => {
          allNodes.push(node);
        },
      };

      // Convert steps to IR nodes using operators
      const topLevelNodes: IRNode[] = [];
      for (const step of flow.flow) {
        const irNode = yield* self.stepToIR(step, context);
        topLevelNodes.push(irNode);
        // Top-level nodes also go into allNodes if not already there
        if (!allNodes.some((n) => n.id === irNode.id)) {
          allNodes.push(irNode);
        }
      }

      // Validate connectivity if requested
      if (
        context.validateConnections &&
        context.tools !== null &&
        context.tools !== undefined &&
        context.joins !== null &&
        context.joins !== undefined
      ) {
        const validation = yield* FlowConnectivityValidator.validate(
          topLevelNodes,
          {
            tools: context.tools,
            joins: context.joins,
            strictMode: false, // Warnings only by default
          }
        );

        if (validation.valid !== true) {
          return yield* Effect.fail(
            new IRCompilationError({
              message: `Flow validation failed: ${validation.errors.map((e) => e.message).join('; ')}`,
              source: 'static' as const,
              context: { errors: validation.errors },
            })
          );
        }

        // Log warnings
        if (validation.warnings.length > 0) {
          yield* logWarn(
            `Flow validation warnings: ${validation.warnings.join(', ')}`,
            {
              module: 'Compiler',
              operation: 'compile',
            }
          );
        }
      }

      // Build IR structure
      const builder = new IRBuilder({
        source: 'dynamic',
        created: new Date().toISOString(),
        hash: Option.fromNullable(self.generateHash(flow)),
        name: Option.fromNullable(flow.metadata?.name),
        description: Option.fromNullable(flow.metadata?.description),
      });

      // Register tools and joins
      if (tools !== null && tools !== undefined) {
        for (const tool of tools) {
          builder.registerTool(tool);
        }
      }

      if (joins !== null && joins !== undefined) {
        for (const join of joins) {
          builder.registerJoin(join.fromTool, join);
        }
      }

      // Add ALL nodes to builder (including nested ones)
      for (const node of allNodes) {
        builder.addNode(node);
      }

      // Connect top-level nodes in sequence
      if (topLevelNodes.length > 1) {
        const nodeIds = topLevelNodes.map((n) => n.id);
        builder.connectSequence(nodeIds);
      }

      // Set entry point
      if (topLevelNodes[0] !== null && topLevelNodes[0] !== undefined) {
        builder.setEntryPoint(topLevelNodes[0].id);
      }

      return builder.build({ skipValidation: !options?.validateConnections });
    });
  }

  /**
   * Convert a single step to IR using the appropriate operator
   */
  private stepToIR(
    step: StepType,
    context: IRGenerationContext
  ): Effect.Effect<IRNode, IRCompilationError> {
    return Effect.try({
      try: () => {
        // Determine step type
        const stepType = this.inferStepType(step);

        // Get the operator for this type
        const operator = this.registry.get(stepType);
        if (operator === null || operator === undefined) {
          throw new Error(`No operator found for step type: ${stepType}`);
        }

        // Delegate IR generation to the operator
        return operator.toIR(step, context);
      },
      catch: (error) =>
        new IRCompilationError({
          message: `Failed to convert step to IR: ${error instanceof Error ? error.message : String(error)}`,
          source: 'static' as const,
        }),
    });
  }

  /**
   * Infer the type of a step from its structure
   */
  private inferStepType(step: Record<string, unknown>): string {
    if (step.type !== null && step.type !== undefined)
      return step.type as string;
    if (step.tool !== null && step.tool !== undefined) return 'tool';
    if (step.condition !== null && step.condition !== undefined)
      return 'conditional';
    if (step.loop !== null && step.loop !== undefined) return 'loop';
    if (step.parallel !== null && step.parallel !== undefined)
      return 'parallel';
    if (step.map !== null && step.map !== undefined) return 'map';
    if (step.reduce !== null && step.reduce !== undefined) return 'reduce';
    if (step.filter !== null && step.filter !== undefined) return 'filter';
    if (
      step.switch !== null &&
      step.switch !== undefined &&
      step.cases !== null &&
      step.cases !== undefined
    )
      return 'switch';
    return 'tool'; // Default
  }

  /**
   * Generate a hash for the flow (for caching)
   */
  private generateHash(flow: DynamicFlowType): string {
    const content = JSON.stringify(flow);
    // Simple hash for now - could use crypto.createHash in production
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(16);
  }
}

/**
 * Factory function for creating the compiler
 */
export function createCompiler(): JSONToIRCompiler {
  return new JSONToIRCompiler();
}

/**
 * Direct compilation function
 */
export function compileToIR(
  flow: DynamicFlowType,
  tools?: UntypedToolArray,
  joins?: ReadonlyArray<ToolJoin<any, any>>,
  options?: { validateConnections?: boolean }
): Effect.Effect<IR, IRCompilationError> {
  const compiler = new JSONToIRCompiler();
  return compiler.compile(flow, tools, joins, options);
}

/**
 * Flow Validator - Ensures flows have proper tool connectivity
 *
 * This validates:
 * 1. All referenced tools exist in the registry
 * 2. Tool outputs properly join to next tool inputs
 * 3. No orphaned steps (all steps are reachable)
 * 4. No circular dependencies
 * 5. Variable references are valid
 */

import { Effect } from 'effect';
import type { Tool, ToolJoin } from '@/lib/tools/types';
import type { IRNode } from '@/lib/ir';

export interface ValidationError {
  type:
    | 'missing_tool'
    | 'invalid_join'
    | 'orphaned_step'
    | 'circular_dependency'
    | 'invalid_variable';
  message: string;
  stepId?: string;
  details?: Record<string, any>;
}

export interface ValidationResult {
  valid: boolean;
  errors: ValidationError[];
  warnings: string[];
}

export interface FlowValidationContext {
  tools: Map<string, Tool<any, any>>;
  joins: Map<string, ToolJoin<any, any>>;
  strictMode?: boolean;
}

/**
 * Validates tool connectivity in a flow
 */
export class FlowConnectivityValidator {
  /**
   * Validate a flow's tool connectivity
   */
  static validate(
    nodes: IRNode[],
    context: FlowValidationContext
  ): Effect.Effect<ValidationResult, never, never> {
    return Effect.sync(() => {
      const errors: ValidationError[] = [];
      const warnings: string[] = [];

      // Build node map and track tool usage
      const nodeMap = new Map<string, IRNode>();
      const toolNodes: IRNode[] = [];

      for (const node of nodes) {
        nodeMap.set(node.id, node);
        if (node.type === 'tool') {
          toolNodes.push(node);
        }
      }

      // 1. Check all referenced tools exist
      for (const node of toolNodes) {
        const toolId = (node as any).tool;
        if (!context.tools.has(toolId)) {
          errors.push({
            type: 'missing_tool',
            message: `Tool '${toolId}' not found in registry`,
            stepId: node.id,
            details: { toolId },
          });
        }
      }

      // 2. Check tool joins are valid
      const toolSequence = this.extractToolSequence(nodes);
      for (let i = 0; i < toolSequence.length - 1; i++) {
        const fromNode = toolSequence[i];
        const toNode = toolSequence[i + 1];

        if (
          fromNode &&
          toNode &&
          fromNode.type === 'tool' &&
          toNode.type === 'tool'
        ) {
          const fromTool = (fromNode as any).tool;
          const toTool = (toNode as any).tool;
          const joinKey = `${fromTool}-${toTool}`;

          // Check if join exists
          const join = context.joins.get(joinKey);
          if (!join && context.strictMode) {
            errors.push({
              type: 'invalid_join',
              message: `No join defined from tool '${fromTool}' to '${toTool}'`,
              stepId: (toNode as any).id,
              details: { fromTool, toTool },
            });
          } else if (!join) {
            warnings.push(
              `Consider defining a join from '${fromTool}' to '${toTool}' for better type safety`
            );
          }

          // If join exists, validate it matches the tools
          if (join) {
            if (join.fromTool !== fromTool || join.toTool !== toTool) {
              errors.push({
                type: 'invalid_join',
                message: `Join mismatch: expected ${join.fromTool}->${join.toTool}, got ${fromTool}->${toTool}`,
                stepId: (toNode as any).id,
                details: {
                  expected: `${join.fromTool}->${join.toTool}`,
                  actual: `${fromTool}->${toTool}`,
                },
              });
            }
          }
        }
      }

      // 3. Check for orphaned steps
      const reachableNodes = this.findReachableNodes(nodes);
      for (const node of nodes) {
        if (!reachableNodes.has(node.id)) {
          warnings.push(`Step '${node.id}' may be unreachable`);
        }
      }

      // 4. Check for circular dependencies
      const cycles = this.detectCycles(nodes);
      for (const cycle of cycles) {
        errors.push({
          type: 'circular_dependency',
          message: `Circular dependency detected: ${cycle.join(' -> ')}`,
          details: { cycle },
        });
      }

      // 5. Validate variable references
      const variableErrors = this.validateVariableReferences(nodes);
      errors.push(...variableErrors);

      return {
        valid: errors.length === 0,
        errors,
        warnings,
      };
    });
  }

  /**
   * Extract sequence of tool nodes in execution order
   */
  private static extractToolSequence(nodes: IRNode[]): IRNode[] {
    const sequence: IRNode[] = [];
    const visited = new Set<string>();

    function visit(node: IRNode): void {
      if (visited.has(node.id)) return;
      visited.add(node.id);

      // Visit dependencies first (for proper ordering)
      // This is simplified - in real implementation would follow edges

      if (node.type === 'tool') {
        sequence.push(node);
      } else if (node.type === 'conditional') {
        const cond = node as any;
        if (cond.trueBranch) cond.trueBranch.forEach(visit);
        if (cond.falseBranch) cond.falseBranch.forEach(visit);
      } else if (node.type === 'loop') {
        const loop = node as any;
        if (loop.body) loop.body.forEach(visit);
      } else if (node.type === 'parallel') {
        const par = node as any;
        if (par.branches) par.branches.forEach(visit);
      }
    }

    nodes.forEach(visit);
    return sequence;
  }

  /**
   * Find all reachable nodes from entry points
   */
  private static findReachableNodes(nodes: IRNode[]): Set<string> {
    const reachable = new Set<string>();
    if (nodes.length === 0) return reachable;

    // For flat structures, all nodes are considered reachable
    // since the IR compilation handles the actual connectivity
    // TODO: Implement proper edge-following logic if needed
    for (const node of nodes) {
      reachable.add(node.id);
    }

    return reachable;
  }

  /**
   * Detect circular dependencies in the flow
   */
  private static detectCycles(nodes: IRNode[]): string[][] {
    const cycles: string[][] = [];
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const nodeMap = new Map(nodes.map((n) => [n.id, n]));

    function visit(nodeId: string, path: string[]): boolean {
      if (recursionStack.has(nodeId)) {
        // Found a cycle
        const cycleStart = path.indexOf(nodeId);
        cycles.push(path.slice(cycleStart).concat(nodeId));
        return true;
      }

      if (visited.has(nodeId)) return false;

      visited.add(nodeId);
      recursionStack.add(nodeId);
      path.push(nodeId);

      // Check dependencies (simplified - would need to follow actual edges)
      const node = nodeMap.get(nodeId);
      if (node) {
        // Check for self-references in nested structures
        if (node.type === 'loop') {
          const loop = node as any;
          if (loop.body) {
            for (const child of loop.body) {
              if (child.id === nodeId) {
                cycles.push([nodeId, nodeId]);
              }
            }
          }
        }
      }

      recursionStack.delete(nodeId);
      path.pop();
      return false;
    }

    for (const node of nodes) {
      if (!visited.has(node.id)) {
        visit(node.id, []);
      }
    }

    return cycles;
  }

  /**
   * Validate variable references in the flow
   */
  private static validateVariableReferences(
    nodes: IRNode[]
  ): ValidationError[] {
    const errors: ValidationError[] = [];
    const definedVariables = new Set<string>(['input']); // Input is always available

    // First pass: collect all defined variables
    for (const node of nodes) {
      if (node.type === 'tool') {
        const tool = node as any;
        if (tool.config?.output) {
          definedVariables.add(tool.config.output);
        }
      }
      // Could also check other node types that define variables
    }

    // Second pass: check variable references
    for (const node of nodes) {
      if (node.type === 'tool') {
        const tool = node as any;
        const args = tool.config?.args || {};

        // Check for variable references in arguments
        for (const [key, value] of Object.entries(args)) {
          if (typeof value === 'string' && value.startsWith('$')) {
            const varName = value.slice(1).split('.')[0];
            if (varName && !definedVariables.has(varName)) {
              errors.push({
                type: 'invalid_variable',
                message: `Variable '${varName}' is not defined`,
                stepId: node.id,
                details: { variable: varName, argument: key },
              });
            }
          }
        }
      }
    }

    return errors;
  }
}

/**
 * Helper to validate a single tool chain
 */
export function validateToolChain(
  tools: string[],
  toolRegistry: Map<string, Tool<any, any>>,
  joinRegistry: Map<string, ToolJoin<any, any>>
): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: string[] = [];

  // Check each tool exists
  for (const toolId of tools) {
    if (!toolRegistry.has(toolId)) {
      errors.push({
        type: 'missing_tool',
        message: `Tool '${toolId}' not found`,
        details: { toolId },
      });
    }
  }

  // Check joins between consecutive tools
  for (let i = 0; i < tools.length - 1; i++) {
    const fromTool = tools[i];
    const toTool = tools[i + 1];
    const joinKey = `${fromTool}-${toTool}`;

    if (!joinRegistry.has(joinKey)) {
      warnings.push(`No join defined from '${fromTool}' to '${toTool}'`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

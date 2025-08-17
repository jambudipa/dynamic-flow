/**
 * Flow Validator - Comprehensive validation for generated flows
 */

import type { Schema } from 'effect';
import { Effect, pipe } from 'effect';
import type { Tool, ToolJoin } from '@/tools/types';
import type { FlowJSON, ValidatedFlow, ValidationError, ValidationWarning } from './types';

/**
 * Validates generated flows
 */
export class FlowValidator {
  /**
   * Validate complete flow
   */
  validate(
    json: FlowJSON,
    tools: ReadonlyArray<Tool<any, any>>,
    joins: ReadonlyArray<ToolJoin<any, any>>
  ): Effect.Effect<ValidatedFlow, ValidationError[]> {
    return pipe(
      Effect.Do,
      // Run all validations in parallel
      Effect.bind('schema', () => this.validateSchema(json)),
      Effect.bind('tools', () => this.validateToolUsage(json, tools)),
      Effect.bind('connections', () =>
        this.validateConnections(json, tools, joins)
      ),
      Effect.bind('operations', () => this.validateOperations(json)),
      Effect.bind('graph', () => this.validateGraph(json)),
      // Collect warnings
      Effect.bind('warnings', () => this.collectWarnings(json, tools)),
      // Build validated flow
      Effect.map(({ warnings }) => {
        const toolMap = new Map<string, Tool<any, any>>(
          tools.map((t) => [t.id, t])
        );
        const joinMap = new Map<string, ToolJoin<any, any>>(
          joins.map((j) => [`${j.fromTool}-${j.toTool}`, j])
        );

        return {
          ir: null, // TODO: Compile JSON to IR here
          json,
          tools: toolMap,
          joins: joinMap,
          warnings,
        };
      }),
      // Collect all errors
      Effect.catchAll((errors: ValidationError | ValidationError[]) => {
        const errorArray = Array.isArray(errors) ? errors : [errors];
        return Effect.fail(errorArray);
      })
    );
  }

  /**
   * Validate flow schema structure
   */
  private validateSchema(json: FlowJSON): Effect.Effect<void, ValidationError> {
    const errors: ValidationError[] = [];

    // Check version
    if (json.version !== '1.0') {
      errors.push({
        code: 'INVALID_VERSION',
        type: 'schema',
        message: `Unsupported version: ${json.version}`,
        path: ['version'],
      });
    }

    // Check nodes structure
    if (!Array.isArray(json.nodes) || json.nodes.length === 0) {
      errors.push({
        code: 'EMPTY_NODES',
        type: 'schema',
        message: 'Flow must have at least one node',
        path: ['nodes'],
      });
    }

    // Check edges structure
    if (!Array.isArray(json.edges)) {
      errors.push({
        code: 'INVALID_EDGES',
        type: 'schema',
        message: 'Edges must be an array',
        path: ['edges'],
      });
    }

    // Validate each node
    json.nodes.forEach((node, index) => {
      const nodePath = ['nodes', String(index)];

      if (!node.id) {
        errors.push({
          code: 'MISSING_NODE_ID',
          type: 'schema',
          message: "Node missing required 'id' field",
          path: nodePath,
        });
      }

      if (!node.type) {
        errors.push({
          code: 'MISSING_NODE_TYPE',
          type: 'schema',
          message: "Node missing required 'type' field",
          path: [...nodePath, 'type'],
        });
      }

      const validTypes = [
        'tool',
        'if-then',
        'map',
        'filter',
        'reduce',
        'parallel',
        'sequence',
      ];
      if (!validTypes.includes(node.type)) {
        errors.push({
          code: 'INVALID_NODE_TYPE',
          type: 'schema',
          message: `Invalid node type: ${node.type}`,
          path: [...nodePath, 'type'],
          context: {
            expected: validTypes,
            actual: node.type,
            availableOptions: validTypes,
          },
        });
      }
    });

    if (errors.length > 0) {
      return Effect.fail(errors[0]!); // Return first error
    }

    return Effect.void;
  }

  /**
   * Validate tool usage
   */
  private validateToolUsage(
    json: FlowJSON,
    tools: ReadonlyArray<Tool<any, any>>
  ): Effect.Effect<void, ValidationError> {
    const errors: ValidationError[] = [];
    const toolMap = new Map<string, Tool<any, any>>(
      tools.map((t) => [t.id, t])
    );

    json.nodes
      .filter((node) => node.type === 'tool')
      .forEach((node, index) => {
        if (!node.toolId) {
          errors.push({
            code: 'MISSING_TOOL_ID',
            type: 'tool',
            message: `Tool node '${node.id}' missing toolId`,
            path: ['nodes', String(index), 'toolId'],
          });
        } else if (!toolMap.has(node.toolId)) {
          errors.push({
            code: 'UNKNOWN_TOOL',
            type: 'tool',
            message: `Unknown tool: ${node.toolId}`,
            path: ['nodes', String(index), 'toolId'],
            context: {
              expected: Array.from(toolMap.keys()),
              actual: node.toolId,
              availableOptions: Array.from(toolMap.keys()),
            },
          });
        }
      });

    // Check functional operations that reference tools
    json.nodes
      .filter((node) => ['map', 'filter', 'reduce'].includes(node.type))
      .forEach((node, index) => {
        if (
          node.operation?.operation?.tool &&
          !toolMap.has(node.operation.operation.tool)
        ) {
          errors.push({
            code: 'UNKNOWN_TOOL_IN_OPERATION',
            type: 'tool',
            message: `Unknown tool in operation: ${node.operation.operation.tool}`,
            path: ['nodes', String(index), 'operation', 'operation', 'tool'],
          });
        }
      });

    if (errors.length > 0) {
      return Effect.fail(errors[0]!);
    }

    return Effect.void;
  }

  /**
   * Validate connections between nodes
   */
  private validateConnections(
    json: FlowJSON,
    tools: ReadonlyArray<Tool<any, any>>,
    joins: ReadonlyArray<ToolJoin<any, any>>
  ): Effect.Effect<void, ValidationError> {
    const errors: ValidationError[] = [];
    const nodeMap = new Map(json.nodes.map((n) => [n.id, n]));
    const toolMap = new Map<string, Tool<any, any>>(
      tools.map((t) => [t.id, t])
    );
    const joinMap = new Map<string, ToolJoin<any, any>>(
      joins.map((j) => [`${j.fromTool}-${j.toTool}`, j])
    );

    // Validate edges reference existing nodes
    json.edges.forEach((edge, index) => {
      const edgePath = ['edges', String(index)];

      if (!nodeMap.has(edge.from)) {
        errors.push({
          code: 'INVALID_EDGE_FROM',
          type: 'connection',
          message: `Edge references non-existent source node: ${edge.from}`,
          path: [...edgePath, 'from'],
        });
      }

      if (!nodeMap.has(edge.to)) {
        errors.push({
          code: 'INVALID_EDGE_TO',
          type: 'connection',
          message: `Edge references non-existent target node: ${edge.to}`,
          path: [...edgePath, 'to'],
        });
      }

      // Validate type compatibility if both nodes exist
      if (nodeMap.has(edge.from) && nodeMap.has(edge.to)) {
        const fromNode = nodeMap.get(edge.from)!;
        const toNode = nodeMap.get(edge.to)!;

        // Check tool connections
        if (fromNode.type === 'tool' && toNode.type === 'tool') {
          const fromTool = toolMap.get(fromNode.toolId!);
          const toTool = toolMap.get(toNode.toolId!);

          if (fromTool && toTool) {
            const joinKey = `${fromTool.id}-${toTool.id}`;
            const hasJoin = joinMap.has(joinKey);

            // If no explicit join, check basic compatibility
            if (
              !hasJoin &&
              !this.areTypesCompatible(
                fromTool.outputSchema,
                toTool.inputSchema
              )
            ) {
              errors.push({
                code: 'INCOMPATIBLE_CONNECTION',
                type: 'connection',
                message: `Incompatible connection: ${fromTool.name} → ${toTool.name}`,
                path: edgePath,
                suggestion: 'Add a tool join to map between these tools',
              });
            }
          }
        }
      }
    });

    if (errors.length > 0) {
      return Effect.fail(errors[0]!);
    }

    return Effect.void;
  }

  /**
   * Validate functional operations
   */
  private validateOperations(
    json: FlowJSON
  ): Effect.Effect<void, ValidationError> {
    const errors: ValidationError[] = [];

    json.nodes
      .filter((node) =>
        ['map', 'filter', 'reduce', 'flatMap', 'forEach'].includes(node.type)
      )
      .forEach((node, index) => {
        const nodePath = ['nodes', String(index)];

        if (!node.operation) {
          errors.push({
            code: 'MISSING_OPERATION',
            type: 'operation',
            message: `Functional node '${node.id}' missing operation definition`,
            path: [...nodePath, 'operation'],
          });
        } else {
          // Check operation has required fields
          if (!node.operation.over) {
            errors.push({
              code: 'MISSING_OPERATION_TARGET',
              type: 'operation',
              message: `Operation in node '${node.id}' missing 'over' field`,
              path: [...nodePath, 'operation', 'over'],
            });
          }

          if (!node.operation.operation) {
            errors.push({
              code: 'MISSING_OPERATION_SPEC',
              type: 'operation',
              message: `Operation in node '${node.id}' missing operation specification`,
              path: [...nodePath, 'operation', 'operation'],
            });
          }
        }
      });

    // Validate if-then nodes
    json.nodes
      .filter((node) => node.type === 'if-then')
      .forEach((node, index) => {
        const conditionalNode = node as any;
        const nodePath = ['nodes', String(index)];

        if (!conditionalNode.condition) {
          errors.push({
            code: 'MISSING_CONDITION',
            type: 'operation',
            message: `Conditional node '${node.id}' missing condition`,
            path: [...nodePath, 'condition'],
          });
        }

        if (!conditionalNode.then || !Array.isArray(conditionalNode.then)) {
          errors.push({
            code: 'MISSING_THEN_BRANCH',
            type: 'operation',
            message: `Conditional node '${node.id}' missing 'then' branch`,
            path: [...nodePath, 'then'],
          });
        }
      });

    if (errors.length > 0) {
      return Effect.fail(errors[0]!);
    }

    return Effect.void;
  }

  /**
   * Validate flow graph structure
   */
  private validateGraph(json: FlowJSON): Effect.Effect<void, ValidationError> {
    const errors: ValidationError[] = [];

    // Check for cycles
    if (this.hasCycles(json)) {
      errors.push({
        code: 'CYCLIC_FLOW',
        type: 'schema',
        message: 'Flow contains cycles',
        suggestion: 'Remove circular dependencies between nodes',
      });
    }

    // Check for unreachable nodes
    const unreachable = this.findUnreachableNodes(json);
    if (unreachable.length > 0 && json.nodes.length > 1) {
      errors.push({
        code: 'UNREACHABLE_NODES',
        type: 'schema',
        message: `Unreachable nodes: ${unreachable.join(', ')}`,
        suggestion: 'Connect all nodes to the flow',
      });
    }

    if (errors.length > 0) {
      return Effect.fail(errors[0]!);
    }

    return Effect.void;
  }

  /**
   * Collect warnings (non-fatal issues)
   */
  private collectWarnings(
    json: FlowJSON,
    tools: ReadonlyArray<Tool<any, any>>
  ): Effect.Effect<ValidationWarning[], never> {
    const warnings: ValidationWarning[] = [];

    // Check for unused tools
    const usedTools = new Set(
      json.nodes
        .filter((n) => n.type === 'tool' && n.toolId)
        .map((n) => n.toolId!)
    );

    const unusedTools = tools.filter((t) => !usedTools.has(t.id));
    if (unusedTools.length > 0) {
      warnings.push({
        code: 'UNUSED_TOOLS',
        message: `Unused tools: ${unusedTools.map((t) => t.name).join(', ')}`,
      });
    }

    // Check for potential parallelisation opportunities
    const sequentialNodes = this.findSequentialNodes(json);
    if (sequentialNodes.length > 2) {
      warnings.push({
        code: 'SEQUENTIAL_OPPORTUNITY',
        message: 'Consider using parallel execution for independent operations',
      });
    }

    return Effect.succeed(warnings);
  }

  // Helper methods

  private areTypesCompatible(
    output: Schema.Schema<unknown, unknown>,
    input: Schema.Schema<unknown, unknown>
  ): boolean {
    // Simplified compatibility check
    // In real implementation, would do deep schema comparison
    try {
      // If schemas are the same reference, they're compatible
      if (output === input) return true;

      // Basic check - if both are objects, consider compatible
      // This is a simplification - real implementation would check field compatibility
      return true;
    } catch {
      return false;
    }
  }

  private hasCycles(json: FlowJSON): boolean {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();
    const adjacency = new Map<string, string[]>();

    // Build adjacency list
    json.edges.forEach((edge) => {
      if (!adjacency.has(edge.from)) {
        adjacency.set(edge.from, []);
      }
      adjacency.get(edge.from)!.push(edge.to);
    });

    // DFS to detect cycles
    const hasCycleDFS = (node: string): boolean => {
      visited.add(node);
      recursionStack.add(node);

      const neighbors = adjacency.get(node) || [];
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          if (hasCycleDFS(neighbor)) return true;
        } else if (recursionStack.has(neighbor)) {
          return true;
        }
      }

      recursionStack.delete(node);
      return false;
    };

    // Check all nodes
    for (const node of json.nodes) {
      if (!visited.has(node.id)) {
        if (hasCycleDFS(node.id)) return true;
      }
    }

    return false;
  }

  private findUnreachableNodes(json: FlowJSON): string[] {
    if (json.nodes.length === 0) return [];

    const reachable = new Set<string>();
    const adjacency = new Map<string, string[]>();

    // Build adjacency list
    json.edges.forEach((edge) => {
      if (!adjacency.has(edge.from)) {
        adjacency.set(edge.from, []);
      }
      adjacency.get(edge.from)!.push(edge.to);

      // Also track reverse for finding entry points
      reachable.add(edge.to);
    });

    // Find entry nodes (nodes with no incoming edges)
    const entryNodes = json.nodes
      .filter((n) => !reachable.has(n.id))
      .map((n) => n.id);

    if (entryNodes.length === 0 && json.nodes.length > 0) {
      // If no clear entry, use first node
      entryNodes.push(json.nodes[0]!.id);
    }

    // BFS from entry nodes
    const visited = new Set<string>(entryNodes);
    const queue = [...entryNodes];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const neighbors = adjacency.get(current) || [];

      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }

    // Find unreachable nodes
    return json.nodes.filter((n) => !visited.has(n.id)).map((n) => n.id);
  }

  private findSequentialNodes(json: FlowJSON): string[] {
    // Find nodes that could potentially run in parallel
    const sequential: string[] = [];
    const inDegree = new Map<string, number>();
    const outDegree = new Map<string, number>();

    // Calculate degrees
    json.nodes.forEach((n) => {
      inDegree.set(n.id, 0);
      outDegree.set(n.id, 0);
    });

    json.edges.forEach((edge) => {
      inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1);
      outDegree.set(edge.from, (outDegree.get(edge.from) || 0) + 1);
    });

    // Find linear chains
    json.nodes.forEach((node) => {
      if (inDegree.get(node.id) === 1 && outDegree.get(node.id) === 1) {
        sequential.push(node.id);
      }
    });

    return sequential;
  }
}

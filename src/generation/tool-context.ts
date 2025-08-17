/**
 * Tool Context - Extract and format tool descriptions for LLM
 */

import { Schema } from 'effect';
import type { Tool, ToolJoin } from '@/tools/types';
import type {
  FlowConstraints,
  JoinDescription,
  ToolContext,
  ToolDescription,
} from './types';

/**
 * Extract tool description from a tool
 */
export function extractToolDescription(tool: Tool<any, any>): ToolDescription {
  return {
    id: tool.id,
    name: tool.name,
    description: tool.description,
    inputSchema: {} as Record<string, unknown>,
    outputSchema: {} as Record<string, unknown>,
  };
}

/**
 * Format tool schema for LLM understanding
 */
export function formatSchemaForLLM(
  _schema: Schema.Schema<unknown, unknown>
): string {
  return 'schema';
}

/**
 * Create complete tool context for LLM
 */
export function createToolContext(
  tools: ReadonlyArray<Tool<any, any>>,
  joins: ReadonlyArray<ToolJoin<any, any>>,
  constraints?: Partial<FlowConstraints> | undefined,
  errorContext?: import('./types').ValidationError[] | undefined
): ToolContext {
  const toolDescriptions = tools.map(extractToolDescription);
  const joinDescriptions = joins.map(formatJoinDescription);

  const defaultConstraints: FlowConstraints = {
    maxNodes: 50,
    maxDepth: 10,
    allowedOperations: [
      'tool',
      'if-then',
      'map',
      'filter',
      'reduce',
      'parallel',
      'sequence',
    ],
    ...constraints,
  };

  return {
    tools: toolDescriptions,
    joins: joinDescriptions,
    constraints: defaultConstraints,
    errorContext: errorContext || [],
  };
}

/**
 * Format tool capabilities for LLM prompt
 */
export function formatToolCapabilities(tools: ToolDescription[]): string {
  return tools
    .map((tool) => {
      const inputSchema = formatSchemaForLLM(Schema.Unknown);
      const outputSchema = formatSchemaForLLM(Schema.Unknown);

      return `
Tool: ${tool.name} (id: ${tool.id})
Description: ${tool.description}
Input: ${inputSchema}
Output: ${outputSchema}
    `.trim();
    })
    .join('\n\n');
}

/**
 * Format join description for LLM
 */
export function formatJoinDescription(
  join: ToolJoin<any, any>
): JoinDescription {
  return {
    fromTool: join.fromTool,
    toTool: join.toTool,
  };
}

/**
 * Format tool joins for LLM prompt
 */
export function formatToolJoins(joins: JoinDescription[]): string {
  if (joins.length === 0) {
    return 'No specific tool joins defined - tools can be connected if types are compatible';
  }

  return (
    'Tool Connections:\n' +
    joins
      .map(
        (join) =>
          `- ${join.fromTool} → ${join.toTool}${join.mapping ? `: ${join.mapping}` : ''}`
      )
      .join('\n')
  );
}

/**
 * Create a summary of available operations
 */
export function summariseOperations(constraints: FlowConstraints): string {
  const ops = constraints.allowedOperations || [];

  const descriptions: Record<string, string> = {
    tool: 'Execute a tool with inputs',
    'if-then': 'Conditional branching based on LLM/expression/tool evaluation',
    map: 'Apply operation to each item in a collection',
    filter: 'Filter items based on condition',
    reduce: 'Aggregate collection to single value',
    parallel: 'Execute multiple operations concurrently',
    sequence: 'Execute operations in order',
  };

  return (
    'Available Operations:\n' +
    ops.map((op) => `- ${op}: ${descriptions[op] || op}`).join('\n')
  );
}

// Private helper functions

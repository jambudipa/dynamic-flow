/**
 * Flow Builder - Convert JSON to executable flows
 */

import { Effect } from 'effect';
import {
  BuilderError,
  type FlowEdge,
  type FlowJSON,
  type FlowNode,
  type FunctionalNode,
  type ParallelNode,
  type SequenceNode,
  type ValidatedFlow
} from './types';
import type { Tool, ToolJoin } from '@/tools/types';

/**
 * Fluent API for building flows programmatically
 */
export class FlowBuilder {
  private nodes: FlowNode[] = [];
  private edges: FlowEdge[] = [];
  private metadata: Record<string, unknown> = {};
  private nodeCounter = 0;

  /**
   * Create builder from existing JSON
   */
  static fromJSON(json: FlowJSON): FlowBuilder {
    const builder = new FlowBuilder();
    builder.nodes = [...json.nodes];
    builder.edges = [...json.edges];
    builder.metadata = json.metadata || {};
    return builder;
  }

  /**
   * Create an example flow
   */
  static example(): FlowBuilder {
    return new FlowBuilder()
      .withMetadata({
        name: 'Example Flow',
        description: 'A sample flow demonstrating various features',
      })
      .addTool('data-fetcher', { source: 'api' }, 'fetch')
      .addMap(
        '$fetch',
        {
          type: 'llm',
          prompt: 'Extract key information from each item',
        },
        5,
        'extract'
      )
      .addFilter(
        '$extract',
        {
          type: 'expression',
          expression: 'item.importance > 0.7',
        },
        'filter'
      )
      .addTool('summarizer', { format: 'brief' }, 'summarize')
      .chain('fetch', 'extract', 'filter', 'summarize');
  }

  /**
   * Set flow metadata
   */
  withMetadata(metadata: Record<string, unknown>): FlowBuilder {
    this.metadata = { ...this.metadata, ...metadata };
    return this;
  }

  /**
   * Add a tool node
   */
  addTool(
    toolId: string,
    inputs?: Record<string, any>,
    nodeId?: string | undefined
  ): FlowBuilder {
    const id = nodeId || this.generateNodeId('tool');

    const node: any = { id, type: 'tool', toolId };
    if (inputs !== undefined) node.inputs = inputs;
    this.nodes.push(node);

    return this;
  }

  /**
   * Add a conditional (if-then) node
   */
  addConditional(
    condition: {
      type: 'llm' | 'expression' | 'tool';
      prompt?: string;
      expression?: string;
      toolId?: string;
    },
    thenBranch: string[],
    elseBranch?: string[] | undefined,
    nodeId?: string | undefined
  ): FlowBuilder {
    const id = nodeId || this.generateNodeId('condition');

    const node: any = { id, type: 'if-then', condition, then: thenBranch };
    if (elseBranch !== undefined) node.else = elseBranch;

    this.nodes.push(node);
    return this;
  }

  /**
   * Add a map operation
   */
  addMap(
    over: string,
    operation: {
      type: 'llm' | 'tool' | 'expression';
      prompt?: string;
      tool?: string;
      expression?: string;
    },
    concurrency?: number | undefined,
    nodeId?: string | undefined
  ): FlowBuilder {
    const id = nodeId || this.generateNodeId('map');

    const op: any = { over, operation };
    if (concurrency !== undefined) op.concurrency = concurrency;
    const node: FunctionalNode = { id, type: 'map', operation: op };

    this.nodes.push(node);
    return this;
  }

  /**
   * Add a filter operation
   */
  addFilter(
    over: string,
    predicate: {
      type: 'llm' | 'expression';
      prompt?: string;
      expression?: string;
    },
    nodeId?: string | undefined
  ): FlowBuilder {
    const id = nodeId || this.generateNodeId('filter');

    const node: FunctionalNode = {
      id,
      type: 'filter',
      operation: {
        over,
        operation: predicate,
      },
    };

    this.nodes.push(node);
    return this;
  }

  /**
   * Add a reduce operation
   */
  addReduce(
    over: string,
    reducer: {
      type: 'llm' | 'expression';
      prompt?: string;
      expression?: string;
      initialValue?: unknown;
    },
    nodeId?: string | undefined
  ): FlowBuilder {
    const id = nodeId || this.generateNodeId('reduce');

    const node: FunctionalNode = {
      id,
      type: 'reduce',
      operation: {
        over,
        operation: reducer,
      },
    };

    this.nodes.push(node);
    return this;
  }

  /**
   * Add parallel execution branches
   */
  addParallel(branches: string[][], nodeId?: string | undefined): FlowBuilder {
    const id = nodeId || this.generateNodeId('parallel');

    const node: ParallelNode = {
      id,
      type: 'parallel',
      branches,
    };

    this.nodes.push(node);
    return this;
  }

  /**
   * Add sequential execution
   */
  addSequence(sequence: string[], nodeId?: string | undefined): FlowBuilder {
    const id = nodeId || this.generateNodeId('sequence');

    const node: SequenceNode = {
      id,
      type: 'sequence',
      sequence,
    };

    this.nodes.push(node);
    return this;
  }

  /**
   * Connect two nodes
   */
  connect(from: string, to: string, condition?: string): FlowBuilder {
    const edge: any = { from, to };
    if (condition !== undefined) edge.condition = condition;
    this.edges.push(edge);
    return this;
  }

  /**
   * Chain nodes sequentially
   */
  chain(...nodeIds: string[]): FlowBuilder {
    for (let i = 0; i < nodeIds.length - 1; i++) {
      this.connect(nodeIds[i]!, nodeIds[i + 1]!);
    }
    return this;
  }

  /**
   * Create parallel branches that merge
   */
  parallel(from: string, branches: string[][], to: string): FlowBuilder {
    const parallelId = this.generateNodeId('parallel');

    // Add parallel node
    this.addParallel(branches, parallelId);

    // Connect from source to parallel
    this.connect(from, parallelId);

    // Connect parallel to destination
    this.connect(parallelId, to);

    return this;
  }

  /**
   * Build the flow JSON
   */
  build(): FlowJSON {
    return {
      version: '1.0',
      metadata: {
        ...this.metadata,
        name: String(this.metadata.name ?? 'Generated Flow'),
        description: String(this.metadata.description ?? ''),
        generated: true,
        timestamp: new Date().toISOString(),
      },
      nodes: this.nodes,
      edges: this.edges,
    };
  }

  /**
   * Build and validate the flow
   */
  buildValidated(
    tools: Tool[],
    joins: ToolJoin<unknown, unknown>[]
  ): Effect.Effect<ValidatedFlow, BuilderError> {
    const json = this.build();

    // Basic validation
    const errors: string[] = [];

    // Check all edge references exist
    this.edges.forEach((edge) => {
      if (!this.nodes.find((n) => n.id === edge.from)) {
        errors.push(`Edge references non-existent source node: ${edge.from}`);
      }
      if (!this.nodes.find((n) => n.id === edge.to)) {
        errors.push(`Edge references non-existent target node: ${edge.to}`);
      }
    });

    // Check tool references exist
    const toolMap = new Map(tools.map((t) => [t.id, t]));
    this.nodes
      .filter((n) => n.type === 'tool')
      .forEach((n) => {
        if (n.toolId && !toolMap.has(n.toolId)) {
          errors.push(`Tool node references non-existent tool: ${n.toolId}`);
        }
      });

    if (errors.length > 0) {
      return Effect.fail(
        new BuilderError(`Flow validation failed: ${errors.join(', ')}`)
      );
    }

    // Create validated flow
    const joinMap = new Map(joins.map((j) => [`${j.fromTool}-${j.toTool}`, j]));

    return Effect.succeed({
      ir: null, // TODO: Compile JSON to IR here
      json,
      tools: toolMap,
      joins: joinMap,
      warnings: [],
    });
  }

  // Helper methods

  private generateNodeId(prefix: string): string {
    return `${prefix}-${++this.nodeCounter}`;
  }
}

/**
 * Simplified flow DSL for common patterns
 */
export class FlowDSL {
  /**
   * Create a simple linear flow
   */
  static linear(tools: string[]): FlowBuilder {
    const builder = new FlowBuilder();
    const nodeIds = tools.map((toolId, i) => {
      const nodeId = `node-${i + 1}`;
      builder.addTool(toolId, {}, nodeId);
      return nodeId;
    });

    if (nodeIds.length > 1) {
      builder.chain(...nodeIds);
    }

    return builder;
  }

  /**
   * Create a map-reduce flow
   */
  static mapReduce(
    source: string,
    mapper: { prompt: string },
    reducer: { prompt: string }
  ): FlowBuilder {
    return new FlowBuilder()
      .addTool(source, {}, 'source')
      .addMap('$source', { type: 'llm', ...mapper }, undefined, 'map')
      .addReduce('$map', { type: 'llm', ...reducer }, 'reduce')
      .chain('source', 'map', 'reduce');
  }

  /**
   * Create a conditional branching flow
   */
  static conditional(
    source: string,
    condition: { prompt: string },
    thenTools: string[],
    elseTools: string[]
  ): FlowBuilder {
    const builder = new FlowBuilder();

    // Add source
    builder.addTool(source, {}, 'source');

    // Add then branch tools
    const thenIds = thenTools.map((toolId, i) => {
      const nodeId = `then-${i + 1}`;
      builder.addTool(toolId, {}, nodeId);
      return nodeId;
    });

    // Add else branch tools
    const elseIds = elseTools.map((toolId, i) => {
      const nodeId = `else-${i + 1}`;
      builder.addTool(toolId, {}, nodeId);
      return nodeId;
    });

    // Add conditional
    builder.addConditional(
      { type: 'llm', ...condition },
      thenIds,
      elseIds,
      'condition'
    );

    // Connect
    builder.connect('source', 'condition');

    return builder;
  }

  /**
   * Create a parallel processing flow
   */
  static parallel(
    source: string,
    branches: string[][],
    merger: string
  ): FlowBuilder {
    const builder = new FlowBuilder();

    // Add source
    builder.addTool(source, {}, 'source');

    // Add branch tools
    const branchIds: string[][] = [];
    branches.forEach((branch, branchIndex) => {
      const ids = branch.map((toolId, toolIndex) => {
        const nodeId = `branch-${branchIndex + 1}-tool-${toolIndex + 1}`;
        builder.addTool(toolId, {}, nodeId);
        return nodeId;
      });
      branchIds.push(ids);
    });

    // Add parallel node
    builder.addParallel(branchIds, 'parallel');

    // Add merger
    builder.addTool(merger, {}, 'merger');

    // Connect
    builder.chain('source', 'parallel', 'merger');

    return builder;
  }
}

/**
 * Convert natural language to flow
 */
export class NaturalFlowBuilder {
  /**
   * Parse natural language description to flow
   */
  static parse(description: string, tools: Tool[]): FlowBuilder {
    const builder = new FlowBuilder();

    // Simple keyword-based parsing (would use LLM in production)
    const lower = description.toLowerCase();

    // Extract tool references
    // const toolMap = new Map(tools.map(t => [t.name.toLowerCase(), t]))
    const mentionedTools: string[] = [];

    tools.forEach((tool) => {
      if (lower.includes(tool.name.toLowerCase())) {
        mentionedTools.push(tool.id);
      }
    });

    // Detect patterns
    if (lower.includes('then') || lower.includes('after')) {
      // Sequential flow
      mentionedTools.forEach((toolId, i) => {
        builder.addTool(toolId, {}, `step-${i + 1}`);
      });
      if (mentionedTools.length > 1) {
        const nodeIds = mentionedTools.map((_, i) => `step-${i + 1}`);
        builder.chain(...nodeIds);
      }
    } else if (lower.includes('parallel') || lower.includes('simultaneously')) {
      // Parallel flow
      const branches = mentionedTools.map((toolId) => {
        const nodeId = `parallel-${toolId}`;
        builder.addTool(toolId, {}, nodeId);
        return [nodeId];
      });
      builder.addParallel(branches, 'parallel-exec');
    } else if (lower.includes('if') || lower.includes('when')) {
      // Conditional flow
      if (mentionedTools.length >= 2) {
        builder.addTool(mentionedTools[0]!, {}, 'check');
        builder.addConditional(
          { type: 'llm', prompt: 'Evaluate condition from input' },
          mentionedTools.slice(1).map((_, i) => `then-${i}`),
          undefined,
          'condition'
        );
        builder.connect('check', 'condition');
      }
    } else if (lower.includes('for each') || lower.includes('map')) {
      // Map operation
      if (mentionedTools.length > 0) {
        builder.addTool(mentionedTools[0]!, {}, 'source');
        builder.addMap(
          '$source',
          { type: 'llm', prompt: 'Process each item' },
          undefined,
          'map'
        );
        builder.connect('source', 'map');
      }
    }

    // Set metadata
    builder.withMetadata({
      name: 'Natural Language Flow',
      description: description,
      parsedFrom: 'natural language',
    });

    return builder;
  }
}

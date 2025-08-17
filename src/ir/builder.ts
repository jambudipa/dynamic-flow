/**
 * DynamicFlow - IR Builder
 *
 * Utilities for constructing and validating IR structures
 */

import type { Tool, ToolJoin } from '@/tools/types';
import type {
  ConditionalNode,
  IR,
  IRCondition,
  IREdge,
  IRGraph,
  IRMetadata,
  IRNode,
  IRRegistry,
  IRValue,
  LoopNode,
  NodeConfig,
  ParallelNode,
  SequenceNode,
  ToolNode,
} from './core-types';
import { IRValidationError } from './core-types';

/**
 * Builder for constructing IR structures
 */
export class IRBuilder {
  private nodes: Map<string, IRNode> = new Map();
  private edges: IREdge[] = [];
  private tools: Map<string, Tool<any, any>> = new Map();
  private joins: Map<string, ToolJoin<any, any>> = new Map();
  private entryPoint?: string;
  private nodeIdCounter = 0;

  constructor(private metadata: Partial<IRMetadata> = {}) {}

  /**
   * Create an IRValue from a literal
   */
  static literal(value: unknown): IRValue {
    return { type: 'literal', value };
  }

  // ============= Node Creation =============

  /**
   * Create an IRValue from a variable reference
   */
  static variable(name: string, path?: string[]): IRValue {
    const irValue: IRValue = { type: 'variable', name };

    if (path !== undefined) {
      irValue.path = path;
    }

    return irValue;
  }

  /**
   * Create an IRValue from an expression
   */
  static expression(expr: string): IRValue {
    return { type: 'expression', expr };
  }

  /**
   * Create an IRValue from a node reference
   */
  static reference(nodeId: string, output?: string): IRValue {
    const irValue: IRValue = { type: 'reference', nodeId };

    if (output !== undefined) {
      irValue.output = output;
    }

    return irValue;
  }

  /**
   * Create a simple condition
   */
  static condition(
    type: 'expression' | 'variable' | 'literal',
    value: string | boolean
  ): IRCondition {
    return { type, value };
  }

  /**
   * Add a node directly
   */
  addNode(node: IRNode): void {
    this.nodes.set(node.id, node);
    if (!this.entryPoint) {
      this.entryPoint = node.id;
    }
  }

  // ============= Edge Creation =============

  /**
   * Add a tool node
   */
  addToolNode(
    toolId: string,
    inputs: Record<string, IRValue>,
    config?: NodeConfig & { outputVar?: string }
  ): string {
    const nodeId = this.generateNodeId('tool');
    const node: ToolNode = {
      id: nodeId,
      type: 'tool',
      tool: toolId, // Changed from toolId to tool
      inputs,
    };

    if (config?.outputVar !== undefined) {
      node.outputVar = config.outputVar;
    }

    if (config !== undefined) {
      const extractedConfig = this.extractConfig(config);
      if (Object.keys(extractedConfig).length > 0) {
        node.config = extractedConfig;
      }
    }

    this.nodes.set(nodeId, node);

    if (!this.entryPoint) {
      this.entryPoint = nodeId;
    }

    return nodeId;
  }

  /**
   * Add a conditional node
   */
  addConditionalNode(
    condition: IRCondition,
    thenBranch: string[],
    elseBranch?: string[],
    config?: NodeConfig
  ): string {
    const nodeId = this.generateNodeId('conditional');
    const node: ConditionalNode = {
      id: nodeId,
      type: 'conditional',
      condition,
      thenBranch,
    };

    if (elseBranch !== undefined) {
      node.elseBranch = elseBranch;
    }

    if (config !== undefined) {
      node.config = config;
    }

    this.nodes.set(nodeId, node);

    if (!this.entryPoint) {
      this.entryPoint = nodeId;
    }

    return nodeId;
  }

  // ============= Registry Management =============

  /**
   * Add a parallel node
   */
  addParallelNode(
    branches: string[][],
    joinStrategy?: 'all' | 'race' | 'settled',
    config?: NodeConfig & { outputVar?: string }
  ): string {
    const nodeId = this.generateNodeId('parallel');
    const node: ParallelNode = {
      id: nodeId,
      type: 'parallel',
      branches,
    };

    if (joinStrategy !== undefined) {
      node.joinStrategy = joinStrategy;
    }

    if (config?.outputVar !== undefined) {
      node.outputVar = config.outputVar;
    }

    if (config !== undefined) {
      const extractedConfig = this.extractConfig(config);
      if (Object.keys(extractedConfig).length > 0) {
        node.config = extractedConfig;
      }
    }

    this.nodes.set(nodeId, node);

    if (!this.entryPoint) {
      this.entryPoint = nodeId;
    }

    return nodeId;
  }

  /**
   * Add a sequence node
   */
  addSequenceNode(steps: string[], config?: NodeConfig): string {
    const nodeId = this.generateNodeId('sequence');
    const node: SequenceNode = {
      id: nodeId,
      type: 'sequence',
      steps,
    };

    if (config !== undefined) {
      node.config = config;
    }

    this.nodes.set(nodeId, node);

    if (!this.entryPoint) {
      this.entryPoint = nodeId;
    }

    return nodeId;
  }

  /**
   * Add a loop node
   */
  addLoopNode(
    loopType: LoopNode['loopType'],
    body: string[],
    options: {
      collection?: IRValue;
      condition?: IRCondition;
      iteratorVar?: string;
      accumulator?: IRValue;
      outputVar?: string;
      config?: NodeConfig;
    } = {}
  ): string {
    const nodeId = this.generateNodeId('loop');
    const node: LoopNode = {
      id: nodeId,
      type: 'loop',
      loopType,
      body,
    };

    if (options.collection !== undefined) {
      node.collection = options.collection;
    }

    if (options.condition !== undefined) {
      node.condition = options.condition;
    }

    if (options.iteratorVar !== undefined) {
      node.iteratorVar = options.iteratorVar;
    }

    if (options.accumulator !== undefined) {
      node.accumulator = options.accumulator;
    }

    if (options.outputVar !== undefined) {
      node.outputVar = options.outputVar;
    }

    if (options.config !== undefined) {
      node.config = options.config;
    }

    this.nodes.set(nodeId, node);

    if (!this.entryPoint) {
      this.entryPoint = nodeId;
    }

    return nodeId;
  }

  /**
   * Add an edge between two nodes
   */
  addEdge(
    from: string,
    to: string,
    condition?: IRCondition,
    label?: string
  ): void {
    const edge: IREdge = { from, to };

    if (condition !== undefined) {
      edge.condition = condition;
    }

    if (label !== undefined) {
      edge.label = label;
    }

    this.edges.push(edge);
  }

  // ============= IR Construction =============

  /**
   * Connect nodes in sequence
   */
  connectSequence(nodeIds: string[]): void {
    for (let i = 0; i < nodeIds.length - 1; i++) {
      this.addEdge(nodeIds[i]!, nodeIds[i + 1]!);
    }
  }

  /**
   * Register a tool
   */
  registerTool(tool: Tool<any, any>): void {
    this.tools.set(tool.id, tool);
  }

  /**
   * Register multiple tools
   */
  registerTools(tools: Tool<any, any>[]): void {
    for (const tool of tools) {
      this.registerTool(tool);
    }
  }

  // ============= Validation =============

  /**
   * Register a join
   */
  registerJoin(id: string, join: ToolJoin<any, any>): void {
    this.joins.set(id, join);
  }

  // ============= Helper Methods =============

  /**
   * Register multiple joins
   */
  registerJoins(joins: Array<{ id: string; join: ToolJoin<any, any> }>): void {
    for (const { id, join } of joins) {
      this.registerJoin(id, join);
    }
  }

  /**
   * Set the entry point
   */
  setEntryPoint(nodeId: string): void {
    if (!this.nodes.has(nodeId)) {
      throw new Error(`Node ${nodeId} not found`);
    }
    this.entryPoint = nodeId;
  }

  /**
   * Build the final IR structure
   */
  build(): IR {
    // Validate before building
    this.validate();

    const metadata: IRMetadata = {
      source: (this.metadata.source || 'static') as 'static' | 'dynamic',
      created: this.metadata.created || new Date().toISOString(),
    };

    if (this.metadata.name !== undefined) {
      metadata.name = this.metadata.name;
    }

    if (this.metadata.description !== undefined) {
      metadata.description = this.metadata.description;
    }

    if (this.metadata.hash !== undefined) {
      metadata.hash = this.metadata.hash;
    }

    const graph: IRGraph = {
      nodes: new Map(this.nodes),
      edges: [...this.edges],
      entryPoint: this.entryPoint!,
    };

    const registry: IRRegistry = {
      tools: new Map(this.tools),
      joins: new Map(this.joins),
    };

    return {
      version: '1.0',
      metadata,
      graph,
      registry,
    };
  }

  // ============= Static Factory Methods =============

  /**
   * Build from captured steps (for static flow compilation)
   */
  buildFromSteps(
    steps: Array<{ nodeId: string; tool: Tool<any, any>; input?: unknown }>,
    tools?: Tool<any, any>[],
    joins?: ToolJoin<any, any>[]
  ): IR {
    // Clear existing state
    this.nodes.clear();
    this.edges = []; // edges is an array, not a Map

    // Register tools
    if (tools) {
      this.registerTools(tools);
    }

    // Register tools from steps
    for (const step of steps) {
      this.registerTool(step.tool);
    }

    // Register joins
    if (joins) {
      joins.forEach((join, idx) => {
        this.registerJoin(`join_${idx}`, join);
      });
    }

    // Create nodes and edges from steps
    let prevNodeId: string | undefined;

    for (const step of steps) {
      // Convert input to IR values
      const inputs: Record<string, IRValue> = {};
      if (step.input && typeof step.input === 'object') {
        for (const [key, value] of Object.entries(step.input)) {
          inputs[key] = this.convertToIRValue(value);
        }
      } else if (prevNodeId) {
        // If no input specified, reference previous node's output
        inputs.input = {
          type: 'reference',
          nodeId: prevNodeId,
        };
      }

      // Add tool node
      const nodeId = step.nodeId;
      const node: ToolNode = {
        id: nodeId,
        type: 'tool',
        tool: step.tool.id, // Changed from toolId to tool
        inputs,
      };
      this.nodes.set(nodeId, node);

      // Set entry point
      if (!this.entryPoint) {
        this.entryPoint = nodeId;
      }

      // Add edge from previous node
      if (prevNodeId) {
        this.addEdge(prevNodeId, nodeId);
      }

      prevNodeId = nodeId;
    }

    return this.build();
  }

  /**
   * Validate the IR structure
   */
  validate(): void {
    const errors: string[] = [];

    // Check entry point
    if (!this.entryPoint) {
      errors.push('No entry point defined');
    } else if (!this.nodes.has(this.entryPoint)) {
      errors.push(`Entry point ${this.entryPoint} not found in nodes`);
    }

    // Check nodes
    if (this.nodes.size === 0) {
      errors.push('No nodes defined');
    }

    // Validate edges
    for (const edge of this.edges) {
      if (!this.nodes.has(edge.from)) {
        errors.push(`Edge source ${edge.from} not found`);
      }
      if (!this.nodes.has(edge.to)) {
        errors.push(`Edge target ${edge.to} not found`);
      }
    }

    // Validate node references
    for (const [nodeId, node] of this.nodes) {
      if (node.type === 'conditional') {
        for (const branch of [...node.thenBranch, ...(node.elseBranch || [])]) {
          if (!this.nodes.has(branch)) {
            errors.push(
              `Conditional node ${nodeId} references unknown node ${branch}`
            );
          }
        }
      } else if (node.type === 'parallel') {
        for (const branch of node.branches) {
          for (const stepId of branch) {
            if (!this.nodes.has(stepId)) {
              errors.push(
                `Parallel node ${nodeId} references unknown node ${stepId}`
              );
            }
          }
        }
      } else if (node.type === 'sequence') {
        for (const stepId of node.steps) {
          if (!this.nodes.has(stepId)) {
            errors.push(
              `Sequence node ${nodeId} references unknown node ${stepId}`
            );
          }
        }
      } else if (node.type === 'loop') {
        for (const stepId of node.body) {
          if (!this.nodes.has(stepId)) {
            errors.push(
              `Loop node ${nodeId} references unknown node ${stepId}`
            );
          }
        }
      } else if (node.type === 'tool') {
        if (!this.tools.has(node.tool)) {
          errors.push(
            `Tool node ${nodeId} references unknown tool ${node.tool}`
          );
        }
      }
    }

    if (errors.length > 0) {
      throw new IRValidationError({
        message: 'IR validation failed',
        errors: errors as ReadonlyArray<string>,
      });
    }
  }

  private generateNodeId(prefix: string): string {
    return `${prefix}_${++this.nodeIdCounter}`;
  }

  private extractConfig(
    config: NodeConfig & { outputVar?: string }
  ): NodeConfig {
    const { outputVar, ...nodeConfig } = config;
    return nodeConfig;
  }

  private convertToIRValue(value: unknown): IRValue {
    if (typeof value === 'string' && value.startsWith('$')) {
      // Variable reference
      const name = value.substring(1);
      const parts = name.split('.');
      const irValue: IRValue = {
        type: 'variable',
        name: parts[0]!,
      };

      if (parts.length > 1) {
        irValue.path = parts.slice(1);
      }

      return irValue;
    } else if (
      typeof value === 'string' &&
      value.includes(' ') &&
      /[<>=!+\-*/&|]/.test(value)
    ) {
      // Expression
      return {
        type: 'expression',
        expr: value,
      };
    } else {
      // Literal value
      return {
        type: 'literal',
        value,
      };
    }
  }
}

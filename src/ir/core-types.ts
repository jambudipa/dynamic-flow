/**
 * DynamicFlow - Core IR Types
 *
 * @module ir/core-types
 *
 * @description
 * The Intermediate Representation (IR) is the unified execution format
 * for all flows, regardless of their authoring method (static Flow API
 * or dynamic JSON generation).
 *
 * IR provides:
 * - A common execution target for all flow types
 * - Graph-based flow representation with nodes and edges
 * - Tool and join registry for connectivity validation
 * - Metadata for debugging and optimization
 *
 * @example
 * ```typescript
 * const ir: IR = {
 *   version: '1.0.0',
 *   metadata: { source: 'dynamic', created: new Date().toISOString() },
 *   graph: { nodes: nodeMap, edges: [], entryPoint: 'node_1' },
 *   registry: { tools: toolMap, joins: joinMap }
 * };
 * ```
 */

import { Data } from 'effect';
import type { Tool, ToolJoin } from '@/tools/types';

// ============= Core IR Structure =============

/**
 * The complete IR structure that represents an executable flow
 *
 * @interface IR
 *
 * @description
 * Top-level structure containing all information needed to execute a flow.
 * This includes the flow graph, metadata, and available tools/joins.
 */
export interface IR {
  version: string;
  metadata: IRMetadata;
  graph: IRGraph;
  registry: IRRegistry;
}

/**
 * Metadata about the IR's origin and creation
 *
 * @interface IRMetadata
 *
 * @description
 * Provides context about how and when the IR was created, useful for
 * debugging, caching, and optimization decisions.
 */
export interface IRMetadata {
  source: 'static' | 'dynamic';
  created: string;
  name?: string | undefined;
  description?: string | undefined;
  hash?: string | undefined;
}

/**
 * The flow graph structure with nodes and edges
 *
 * @interface IRGraph
 *
 * @description
 * Represents the flow as a directed graph where nodes are operations
 * and edges define the execution flow between them.
 */
export interface IRGraph {
  nodes: Map<string, IRNode>;
  edges: IREdge[];
  entryPoint: string;
}

/**
 * Registry of tools and joins available to the flow
 *
 * @interface IRRegistry
 *
 * @description
 * Contains all tools and joins that can be referenced by nodes in the graph.
 * Used for validation and runtime tool resolution.
 */
export interface IRRegistry {
  tools: Map<string, Tool<any, any>>;
  joins: Map<string, ToolJoin<any, any>>;
}

// ============= Graph Components =============

/**
 * Edge connecting two nodes in the flow graph
 *
 * @interface IREdge
 *
 * @description
 * Defines a directed connection from one node to another, optionally
 * with a condition that must be met for the edge to be traversed.
 */
export interface IREdge {
  from: string;
  to: string;
  condition?: IRCondition | undefined;
  label?: string | undefined;
}

/**
 * Condition for conditional edges or nodes
 *
 * @interface IRCondition
 *
 * @description
 * Represents a boolean condition that can be evaluated at runtime
 * to determine control flow.
 */
export interface IRCondition {
  type: 'expression' | 'variable' | 'literal';
  value: string | boolean;
  operator?:
    | 'eq'
    | 'neq'
    | 'gt'
    | 'lt'
    | 'gte'
    | 'lte'
    | 'in'
    | 'not-in'
    | undefined;
  operands?: IRValue[] | undefined;
}

// ============= Node Types =============

/**
 * Base interface for all IR nodes
 *
 * @interface BaseIRNode
 *
 * @description
 * Common properties shared by all node types in the IR graph.
 */
export interface BaseIRNode {
  id: string;
  type: 'tool' | 'conditional' | 'parallel' | 'sequence' | 'loop';
  config?: NodeConfig | undefined;
}

/**
 * Tool invocation node
 *
 * @interface ToolNode
 *
 * @description
 * Represents a call to a tool with specific inputs. The tool must be
 * registered in the IR registry.
 *
 * @example
 * ```typescript
 * const toolNode: ToolNode = {
 *   id: 'node_1',
 *   type: 'tool',
 *   tool: 'fetch-data',
 *   inputs: { url: { type: 'literal', value: 'https://api.example.com' } },
 *   outputVar: 'apiResponse'
 * };
 * ```
 */
export interface ToolNode extends BaseIRNode {
  type: 'tool';
  tool: string;
  inputs: Record<string, IRValue>;
  outputVar?: string | undefined;
}

/**
 * Conditional branching node
 *
 * @interface ConditionalNode
 *
 * @description
 * Executes different branches based on a condition evaluation.
 * Similar to if/else statements in programming.
 *
 * @example
 * ```typescript
 * const conditionalNode: ConditionalNode = {
 *   id: 'node_2',
 *   type: 'conditional',
 *   condition: { type: 'expression', value: '$score > 80' },
 *   thenBranch: ['node_3', 'node_4'],
 *   elseBranch: ['node_5']
 * };
 * ```
 */
export interface ConditionalNode extends BaseIRNode {
  type: 'conditional';
  condition: IRCondition;
  thenBranch: string[]; // Node IDs
  elseBranch?: string[] | undefined; // Node IDs
}

/**
 * Parallel execution node
 *
 * @interface ParallelNode
 *
 * @description
 * Executes multiple branches concurrently. The join strategy determines
 * how results are combined and when execution continues.
 *
 * @example
 * ```typescript
 * const parallelNode: ParallelNode = {
 *   id: 'node_6',
 *   type: 'parallel',
 *   branches: [['node_7', 'node_8'], ['node_9']],
 *   joinStrategy: 'all',
 *   outputVar: 'results'
 * };
 * ```
 */
export interface ParallelNode extends BaseIRNode {
  type: 'parallel';
  branches: string[][]; // Arrays of node IDs
  joinStrategy?: 'all' | 'race' | 'settled' | undefined;
  outputVar?: string | undefined;
}

/**
 * Sequential execution node
 *
 * @interface SequenceNode
 *
 * @description
 * Groups nodes for sequential execution. Used to create logical blocks
 * within the flow graph.
 */
export interface SequenceNode extends BaseIRNode {
  type: 'sequence';
  steps: string[]; // Node IDs in order
}

/**
 * Loop node (for/while/map/filter/reduce)
 *
 * @interface LoopNode
 *
 * @description
 * Implements various iteration patterns including for loops, while loops,
 * and functional operations like map, filter, and reduce.
 *
 * @example
 * ```typescript
 * const mapNode: LoopNode = {
 *   id: 'node_10',
 *   type: 'loop',
 *   loopType: 'map',
 *   collection: { type: 'variable', name: 'items' },
 *   iteratorVar: 'item',
 *   body: ['node_11', 'node_12'],
 *   outputVar: 'mappedItems'
 * };
 * ```
 */
export interface LoopNode extends BaseIRNode {
  type: 'loop';
  loopType: 'for' | 'while' | 'map' | 'filter' | 'reduce';
  collection?: IRValue | undefined; // For for/map/filter/reduce
  condition?: IRCondition | undefined; // For while
  iteratorVar?: string | undefined; // Variable name for current item
  body: string[]; // Node IDs for loop body
  accumulator?: IRValue | undefined; // For reduce
  outputVar?: string | undefined;
}

/**
 * Union of all IR node types
 *
 * @type IRNode
 *
 * @description
 * Discriminated union of all possible node types in the IR graph.
 * Use the 'type' field for type narrowing.
 */
export type IRNode =
  | ToolNode
  | ConditionalNode
  | ParallelNode
  | SequenceNode
  | LoopNode;

// ============= Value Types =============

/**
 * IR value representation
 *
 * @type IRValue
 *
 * @description
 * Represents different ways values can be expressed in the IR:
 * - literal: A constant value
 * - variable: Reference to a variable in the execution context
 * - expression: A string expression to be evaluated
 * - reference: Output from another node
 *
 * @example
 * ```typescript
 * const literal: IRValue = { type: 'literal', value: 42 };
 * const variable: IRValue = { type: 'variable', name: 'userId' };
 * const expression: IRValue = { type: 'expression', expr: '$count * 2' };
 * const reference: IRValue = { type: 'reference', nodeId: 'node_1' };
 * ```
 */
export type IRValue =
  | { type: 'literal'; value: unknown }
  | { type: 'variable'; name: string; path?: string[] | undefined }
  | { type: 'expression'; expr: string }
  | { type: 'reference'; nodeId: string; output?: string | undefined };

// ============= Node Configuration =============

/**
 * Optional configuration for any node
 *
 * @interface NodeConfig
 *
 * @description
 * Common configuration options that can be applied to any node type
 * for controlling execution behavior.
 */
export interface NodeConfig {
  timeout?: number | undefined; // milliseconds
  retries?: number | undefined;
  retryDelay?: number | undefined; // milliseconds
  cache?: boolean | undefined;
  parallel?: boolean | undefined; // For loop nodes
  concurrency?: number | undefined; // For parallel execution
}

// ============= Error Types =============

/**
 * IR compilation error
 *
 * @class IRCompilationError
 * @extends Data.TaggedError
 *
 * @description
 * Thrown when there's an error during the compilation of flows to IR.
 * Includes context about which node and source type caused the error.
 */
export class IRCompilationError extends Data.TaggedError('IRCompilationError')<{
  readonly message: string;
  readonly nodeId?: string;
  readonly source?: 'static' | 'dynamic';
  readonly context?: Record<string, unknown>;
}> {
  get displayMessage(): string {
    const nodeInfo = this.nodeId ? ` in node '${this.nodeId}'` : '';
    const sourceInfo = this.source ? ` (${this.source} flow)` : '';
    return `IR compilation failed${nodeInfo}${sourceInfo}: ${this.message}`;
  }
}

/**
 * IR validation error
 *
 * @class IRValidationError
 * @extends Data.TaggedError
 *
 * @description
 * Thrown when IR validation fails. Contains a list of validation errors
 * found in the IR structure.
 */
export class IRValidationError extends Data.TaggedError('IRValidationError')<{
  readonly message: string;
  readonly errors: ReadonlyArray<string>;
  readonly nodeId?: string;
}> {
  get displayMessage(): string {
    const nodeInfo = this.nodeId ? ` in node '${this.nodeId}'` : '';
    const errorList =
      this.errors.length > 0 ? `\n  - ${this.errors.join('\n  - ')}` : '';
    return `IR validation failed${nodeInfo}: ${this.message}${errorList}`;
  }
}

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

import { Data, Option, Either, Chunk, HashMap, Brand } from 'effect';
import type { Tool, ToolJoin } from '@/lib/tools/types';

// ============= Branded Types =============

/**
 * Branded type for Node IDs to prevent mixing with other string types
 */
export type NodeId = string & Brand.Brand<'NodeId'>;
export const NodeId = Brand.nominal<NodeId>();

/**
 * Branded type for Tool IDs to prevent mixing with other string types
 */
export type ToolId = string & Brand.Brand<'ToolId'>;
export const ToolId = Brand.nominal<ToolId>();

// ============= Core IR Structure =============

/**
 * The complete IR structure
 */
export interface IR {
  readonly version: string;
  readonly metadata: IRMetadata;
  readonly graph: IRGraph;
  readonly registry: IRRegistry;
}

export const IR = (params: {
  version: string;
  metadata: IRMetadata;
  graph: IRGraph;
  registry: IRRegistry;
}): IR => Data.struct(params);

/**
 * Metadata about the IR's origin using Options for optional fields
 */
export interface IRMetadata {
  readonly source: 'static' | 'dynamic';
  readonly created: string;
  readonly name: Option.Option<string>;
  readonly description: Option.Option<string>;
  readonly hash: Option.Option<string>;
}

export const IRMetadata = (params: {
  source: 'static' | 'dynamic';
  created: string;
  name?: string;
  description?: string;
  hash?: string;
}): IRMetadata =>
  Data.struct({
    source: params.source,
    created: params.created,
    name: params.name ? Option.some(params.name) : Option.none(),
    description: params.description
      ? Option.some(params.description)
      : Option.none(),
    hash: params.hash ? Option.some(params.hash) : Option.none(),
  });

/**
 * Flow graph using HashMap for efficient node lookups and Chunk for edges
 */
export interface IRGraph {
  readonly nodes: HashMap.HashMap<NodeId, IRNode>;
  readonly edges: Chunk.Chunk<IREdge>;
  readonly entryPoint: NodeId;
}

export const IRGraph = (params: {
  nodes: HashMap.HashMap<NodeId, IRNode>;
  edges: Chunk.Chunk<IREdge>;
  entryPoint: NodeId;
}): IRGraph => Data.struct(params);

/**
 * Registry using HashMap for efficient tool/join lookups
 */
export interface IRRegistry {
  readonly tools: HashMap.HashMap<ToolId, Tool<any, any>>;
  readonly joins: HashMap.HashMap<ToolId, ToolJoin<any, any>>;
}

export const IRRegistry = (params: {
  tools: HashMap.HashMap<ToolId, Tool<any, any>>;
  joins: HashMap.HashMap<ToolId, ToolJoin<any, any>>;
}): IRRegistry => Data.struct(params);

// ============= Graph Components =============

/**
 * Edge connecting two nodes with Options for optional fields
 */
export interface IREdge {
  readonly from: NodeId;
  readonly to: NodeId;
  readonly condition: Option.Option<IRCondition>;
  readonly label: Option.Option<string>;
}

export const IREdge = (params: {
  from: NodeId;
  to: NodeId;
  condition?: IRCondition;
  label?: string;
}): IREdge =>
  Data.struct({
    from: params.from,
    to: params.to,
    condition: params.condition ? Option.some(params.condition) : Option.none(),
    label: params.label ? Option.some(params.label) : Option.none(),
  });

/**
 * Condition with proper discriminated union types
 */
export interface IRCondition {
  readonly type: 'expression' | 'variable' | 'literal';
  readonly value: string | boolean;
  readonly operator: Option.Option<
    'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'in' | 'not-in'
  >;
  readonly operands: Chunk.Chunk<IRValue>;
}

export const IRCondition = (params: {
  type: 'expression' | 'variable' | 'literal';
  value: string | boolean;
  operator?: 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte' | 'in' | 'not-in';
  operands?: readonly IRValue[];
}): IRCondition =>
  Data.struct({
    type: params.type,
    value: params.value,
    operator: params.operator ? Option.some(params.operator) : Option.none(),
    operands: Chunk.fromIterable(params.operands ?? []),
  });

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
  type: 'tool' | 'conditional' | 'parallel' | 'sequence' | 'loop' | 'switch';
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
 * Switch/case branching node
 *
 * @interface SwitchNode
 *
 * @description
 * Executes different branches based on a discriminator value.
 * Similar to switch/case statements in programming.
 *
 * @example
 * ```typescript
 * const switchNode: SwitchNode = {
 *   id: 'node_10',
 *   type: 'switch',
 *   discriminator: { type: 'variable', name: 'status' },
 *   cases: {
 *     'pending': ['node_11'],
 *     'active': ['node_12', 'node_13'],
 *     'completed': ['node_14']
 *   },
 *   defaultCase: ['node_15']
 * };
 * ```
 */
export interface SwitchNode extends BaseIRNode {
  type: 'switch';
  discriminator: IRValue;
  cases: Record<string, string[]>; // Map of case values to node IDs
  defaultCase?: string[] | undefined; // Node IDs for default case
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
  | LoopNode
  | SwitchNode;

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

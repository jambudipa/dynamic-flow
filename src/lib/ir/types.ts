/**
 * Intermediate Representation (IR) Types
 * Unified execution format for all flow types
 */

import type { Effect } from 'effect';

// ============= Metadata =============

export interface SourceLocation {
  line?: number | undefined;
  column?: number | undefined;
  file?: string | undefined;
}

export interface IRMetadata {
  sourceLocation?: SourceLocation | undefined;
  sourceType: 'json' | 'typescript';
  optimized?: boolean | undefined;
  stepId?: string | undefined;
  description?: string | undefined;
}

// ============= Value Types =============

export type TypedValue =
  | { type: 'string'; value: string }
  | { type: 'number'; value: number }
  | { type: 'boolean'; value: boolean }
  | { type: 'null'; value: null }
  | { type: 'array'; value: TypedValue[] }
  | { type: 'object'; value: Record<string, TypedValue> }
  | { type: 'variable'; name: string; path?: string[] | undefined }
  | { type: 'expression'; expr: string };

// ============= IR Node Types =============

export interface BaseIRNode {
  id: string;
  type: 'tool' | 'control' | 'parallel' | 'sequence';
  metadata: IRMetadata;
  timeout?: number | undefined;
  retry?: number | undefined;
}

/**
 * Tool invocation node
 */
export interface ToolNode extends BaseIRNode {
  type: 'tool';
  toolId: string;
  inputs: Record<string, TypedValue>;
  outputVar?: string | undefined;
}

/**
 * Control flow node for conditionals, loops, etc.
 */
export interface ControlNode extends BaseIRNode {
  type: 'control';
  construct: 'if' | 'for' | 'while' | 'map' | 'filter' | 'reduce' | 'switch';
  condition?: TypedValue | undefined;
  body: IRNode[];
  elseBranch?: IRNode[] | undefined;
  cases?:
    | Array<{
        condition: TypedValue;
        body: IRNode[];
      }>
    | undefined;
  // For loops
  iterator?: string | undefined;
  iterable?: TypedValue | undefined;
  // For map/filter/reduce
  collection?: TypedValue | undefined;
  operation?: IRNode | undefined;
  accumulator?: TypedValue | undefined;
  outputVar?: string | undefined;
}

/**
 * Parallel execution node
 */
export interface ParallelNode extends BaseIRNode {
  type: 'parallel';
  branches: IRNode[][];
  joinStrategy?: 'all' | 'any' | 'race';
}

/**
 * Sequential execution node (for grouping)
 */
export interface SequenceNode extends BaseIRNode {
  type: 'sequence';
  steps: IRNode[];
}

/**
 * Union of all IR node types
 */
export type IRNode = ToolNode | ControlNode | ParallelNode | SequenceNode;

/**
 * Complete IR structure
 */
export interface IR {
  version: '1.0';
  metadata: {
    source: 'json' | 'typescript';
    created: string;
    hash?: string | undefined;
  };
  nodes: IRNode[];
  entryPoint: string;
}

// ============= Execution Context =============

/**
 * Execution state passed between nodes
 */
export interface ExecutionContext {
  variables: Map<string, unknown>;
  currentScope: string[];
  parentContext?: ExecutionContext | undefined;
}

/**
 * Result of executing an IR node
 */
export interface ExecutionResult {
  value?: unknown | undefined;
  context: ExecutionContext;
  logs: ExecutionLog[];
  metrics: ExecutionMetrics;
}

/**
 * Execution log entry
 */
export interface ExecutionLog {
  timestamp: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  nodeId: string;
  message: string;
  data?: unknown | undefined;
}

/**
 * Execution metrics
 */
export interface ExecutionMetrics {
  startTime: number;
  endTime?: number | undefined;
  duration?: number | undefined;
  toolInvocations: number;
  errors: number;
}

// ============= Tool Definitions =============

/**
 * Tool definition for the registry
 */
export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  id: string;
  name: string;
  description: string;
  inputSchema: unknown; // Effect Schema
  outputSchema: unknown; // Effect Schema
  execute: (
    input: TInput,
    context: ExecutionContext
  ) => Effect.Effect<TOutput, ToolError>;
  config?: ToolConfig | undefined;
}

/**
 * Tool configuration
 */
export interface ToolConfig {
  timeout?: number | undefined;
  retry?: RetryConfig | undefined;
  rateLimit?: RateLimitConfig | undefined;
  requiresApproval?: boolean | undefined;
}

/**
 * Retry configuration
 */
export interface RetryConfig {
  maxAttempts: number;
  backoff: 'exponential' | 'linear' | 'fixed';
  initialDelay: number;
  maxDelay?: number | undefined;
}

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  maxCalls: number;
  windowMs: number;
}

// ============= Error Types =============

export class DynamicFlowError extends Error {
  readonly _tag = 'DynamicFlowError' as const;

  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: unknown | undefined
  ) {
    super(message);
    this.name = 'DynamicFlowError';
  }
}

export class ToolError extends DynamicFlowError {
  readonly _tag = 'DynamicFlowError' as const;

  constructor(
    message: string,
    public readonly toolId: string,
    public readonly cause?: Error | undefined
  ) {
    super(message, 'TOOL_ERROR', { toolId, cause });
    this.name = 'ToolError';
  }
}

export class CompilationError extends DynamicFlowError {
  readonly _tag = 'DynamicFlowError' as const;

  constructor(
    message: string,
    public readonly path: string,
    public readonly source: 'json' | 'typescript'
  ) {
    super(message, 'COMPILATION_ERROR', { path, source });
    this.name = 'CompilationError';
  }
}

export class ExecutionError extends DynamicFlowError {
  readonly _tag = 'DynamicFlowError' as const;

  constructor(
    message: string,
    public readonly nodeId: string,
    public readonly context?: ExecutionContext | undefined | Error
  ) {
    super(message, 'EXECUTION_ERROR', { nodeId });
    this.name = 'ExecutionError';
  }
}

// ============= Helper Functions =============

/**
 * Create a tool node
 */
export const createToolNode = (
  id: string,
  toolId: string,
  inputs: Record<string, TypedValue>,
  outputVar?: string | undefined
): ToolNode => ({
  id,
  type: 'tool',
  toolId,
  inputs,
  outputVar,
  metadata: {
    sourceType: 'json',
  },
});

/**
 * Create a control node
 */
export const createControlNode = (
  id: string,
  construct: ControlNode['construct'],
  body: IRNode[],
  condition?: TypedValue | undefined
): ControlNode => ({
  id,
  type: 'control',
  construct,
  body,
  condition,
  metadata: {
    sourceType: 'json',
  },
});

/**
 * Create a parallel node
 */
export const createParallelNode = (
  id: string,
  branches: IRNode[][]
): ParallelNode => ({
  id,
  type: 'parallel',
  branches,
  metadata: {
    sourceType: 'json',
  },
});

/**
 * Create a sequence node
 */
export const createSequenceNode = (
  id: string,
  steps: IRNode[]
): SequenceNode => ({
  id,
  type: 'sequence',
  steps,
  metadata: {
    sourceType: 'json',
  },
});

/**
 * Check if a value is a variable reference
 */
export const isVariable = (
  value: TypedValue
): value is { type: 'variable'; name: string } => {
  return value.type === 'variable';
};

/**
 * Check if a value is an expression
 */
export const isExpression = (
  value: TypedValue
): value is { type: 'expression'; expr: string } => {
  return value.type === 'expression';
};

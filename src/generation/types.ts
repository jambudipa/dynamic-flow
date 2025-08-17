/**
 * Dynamic Flow Generation - Core Types
 */
// Consolidated types from types-fixed.ts
import type { Duration, Effect, Stream } from 'effect';
import type { Tool, ToolJoin } from '@/tools/types';
// Import error types from the main errors module
import { DynamicFlowError, FlowError, FlowExecutionError, LLMError } from '@/types/errors';
// no Schema imports needed here

// Re-export some tool types and import Tool/ToolJoin for local usage
export type { ToolError, ToolRequirements } from '../tools/types';

// Define ExecutionContext since it's not exported from tools/types
export interface ExecutionContext {
  signal?: AbortSignal | undefined;
  logger?:
    | {
        log: (message: string) => void;
        error: (message: string) => void;
        warn: (message: string) => void;
      }
    | undefined;
  metadata?: Record<string, unknown> | undefined;
}

// Define ExecutionOptions and ExecutionResult
export interface ExecutionOptions {
  input?: unknown | undefined;
  context?: Record<string, unknown> | undefined;
  signal?: AbortSignal | undefined;
}

export interface ExecutionResult {
  output: unknown;
  metadata: {
    duration: Duration.Duration;
    tokensUsed?: number | undefined;
    toolsExecuted: string[];
  };
}

// Define ToolJoin using Schema.transform for type-safe transformations

// Define AI Model interface since @effect/ai might not export it properly
export interface AiModel {
  completion(
    prompt: unknown,
    options?: unknown
  ): Effect.Effect<{ content: string }, never>;

  stream(prompt: unknown, options?: unknown): Stream.Stream<any, never>;
}

// Re-export for use in other modules
export { FlowError } from '../types/errors';

// ============= Flow Generation Types =============

export interface DynamicFlowOptions {
  model?: AiModel;
  retryStrategy?: RetryStrategy;
  escalationPath?: AiModel[];
  timeout?: Duration.Duration;
  cache?: boolean;
  modelPool?: ModelPoolConfig;
  constraints?: FlowConstraints;
  options?: {
    retryStrategy?: RetryStrategy;
    constraints?: FlowConstraints;
    escalationPath?: AiModel[];
  };
}

export interface RetryStrategy {
  maxAttempts: number;
  maxEscalations: number;
  backoffStrategy: 'exponential' | 'linear';
}

export interface ModelPoolConfig {
  models: AiModel[];
  strategy: 'round-robin' | 'least-loaded' | 'random';
  maxConcurrency: number;
  timeout?: Duration.Duration;
  fallback?: AiModel;
}

// ============= Flow Event Types =============

export type FlowEvent =
  // Flow lifecycle events
  | { type: 'flow-start'; timestamp: number; metadata?: unknown }
  | { type: 'flow-complete'; timestamp: number; result?: unknown }
  | {
      type: 'flow-error';
      timestamp: number;
      error?: { message: string; code?: string };
    }
  // Node events
  | { type: 'node-start'; timestamp: number; nodeId: string; nodeType?: string }
  | {
      type: 'node-complete';
      timestamp: number;
      nodeId: string;
      result?: unknown;
    }
  | {
      type: 'node-error';
      timestamp: number;
      nodeId: string;
      error?: { message: string; code?: string };
    }
  // Tool events
  | {
      type: 'tool-start';
      timestamp?: number;
      nodeId?: string;
      toolId: string;
      input: unknown;
    }
  | {
      type: 'tool-output';
      timestamp?: number;
      nodeId?: string;
      toolId: string;
      output: unknown;
    }
  | {
      type: 'tool-error';
      timestamp?: number;
      nodeId?: string;
      toolId: string;
      error: Error;
    }
  // LLM events
  | {
      type: 'llm-token';
      timestamp?: number;
      nodeId?: string;
      token: string;
      toolId?: string;
    }
  | {
      type: 'llm-completion';
      timestamp?: number;
      nodeId?: string;
      completion: string;
      toolId?: string;
    }
  // Progress events
  | { type: 'flow-progress'; step: number; total: number }
  | { type: 'state-change'; state: FlowState }
  | { type: 'final-result'; result: unknown };

export interface FlowSnapshot {
  timestamp: number;
  state: FlowState;
  completedSteps?: string[];
  pendingSteps?: string[];
  intermediateResults?: Map<string, unknown>;
  metadata?: Record<string, unknown>;
}

export interface FlowState {
  status: 'idle' | 'running' | 'paused' | 'completed' | 'error';
  currentNode?: string | null;
  nodes?: Map<string, unknown>;
  values?: Map<string, unknown>;
  variables?: Map<string, unknown>;
  errors?: Error[];
  startTime?: number;
}

// ============= Flow Grammar Types =============

export interface FlowNode {
  id: string;
  type:
    | 'tool'
    | 'if-then'
    | 'map'
    | 'filter'
    | 'reduce'
    | 'parallel'
    | 'sequence'
    | 'flatMap'
    | 'forEach';
  operation?: FunctionalOperation;
  toolId?: string;
  inputs?: Record<string, unknown>;
  config?: NodeConfig;
}

export interface FunctionalOperation {
  over: string; // Reference to array/collection
  operation: {
    type: 'llm' | 'tool' | 'expression';
    prompt?: string; // For LLM-based operations
    tool?: string; // For tool-based operations
    expression?: string; // For expressions
    initialValue?: unknown; // For reduce
  };
  concurrency?: number;
  usePool?: boolean; // Use model pool for parallel execution
}

export interface FunctionalNode extends FlowNode {
  type: 'map' | 'filter' | 'reduce' | 'flatMap' | 'forEach';
  operation: FunctionalOperation;
}

export interface ConditionalNode extends FlowNode {
  type: 'if-then';
  condition: {
    type: 'llm' | 'expression' | 'tool';
    prompt?: string; // For LLM evaluation
    expression?: string; // For JS expression
    toolId?: string; // Tool that returns boolean
  };
  then: string[]; // Node IDs
  else?: string[]; // Node IDs
}

export interface ParallelNode extends FlowNode {
  type: 'parallel';
  branches: string[][];
}

export interface SequenceNode extends FlowNode {
  type: 'sequence';
  sequence: string[];
}

export interface NodeConfig {
  timeout?: Duration.Duration;
  retries?: number;
  cache?: boolean;
  /** Whether to emit tool-output events for this node (default: true) */
  emitIntermediate?: boolean;
  /** Whether to emit llm-token events for this node if applicable (default: true) */
  emitTokens?: boolean;
}

export interface NodeResult {
  nodeId: string;
  output: unknown;
  timestamp: number;
  metadata?: unknown;
}

// ============= Additional Type Exports =============

export interface GenerateFlowOptions {
  model?: AiModel;
  prompt?: string;
  temperature?: number;
  maxRetries?: number;
  timeout?: Duration.Duration;
}

export interface ToolDescription {
  id: string;
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
}

export interface JoinDescription {
  fromTool: string;
  toTool: string;
  mapping?: Record<string, string>;
}

export interface Example {
  input: unknown;
  output: unknown;
  description?: string;
}

// ============= Flow JSON Structure =============

export interface FlowJSON {
  version: '1.0';
  metadata?: {
    name?: string;
    description?: string;
    generated?: boolean;
    model?: string;
    timestamp?: string;
  };
  modelPool?: {
    models: string[];
    strategy: string;
    maxConcurrency: number;
  };
  nodes: FlowNode[];
  edges: FlowEdge[];
  variables?: Record<string, unknown>;
}

export interface FlowEdge {
  from: string;
  to: string;
  condition?: string;
  transform?: string;
}

// ============= Generation Types =============

export interface GenerateFlowRequest {
  prompt: string;
  tools: ReadonlyArray<Tool<any, any>>;
  joins: ReadonlyArray<ToolJoin<any, any>>;
  model: AiModel;
  options?: DynamicFlowOptions;
}

export interface GenerationContext {
  prompt: string;
  tools: ReadonlyArray<Tool<any, any>>;
  joins: ReadonlyArray<ToolJoin<any, any>>;
  currentModel: AiModel;
  attemptCount: number;
  errors: ValidationError[];
  options?: DynamicFlowOptions;
}

export interface ToolContext {
  tools: ToolDescription[];
  joins: JoinDescription[];
  constraints?: FlowConstraints;
  errorContext?: ValidationError[];
}

export interface FlowConstraints {
  maxNodes?: number;
  maxDepth?: number;
  allowedOperations?: string[];
}

// ============= Validation Types =============

export interface ValidationError {
  code: string;
  type: 'schema' | 'tool' | 'connection' | 'join' | 'operation';
  message: string;
  path?: string[];
  suggestion?: string;
  context?: {
    expected: unknown;
    actual: unknown;
    availableOptions?: string[];
  };
}

export interface ValidatedFlow {
  ir: any; // IR type from ../ir/core-types
  json?: FlowJSON; // Optional, for debugging
  tools: Map<string, Tool<any, any>>;
  joins: Map<string, ToolJoin<any, any>>;
  warnings: ValidationWarning[];
}

export interface ValidationWarning {
  code: string;
  message: string;
}

export interface ConnectionError {
  from: string;
  to: string;
  reason: string;
}

// ============= Error Types =============
// Re-export for backward compatibility
export { FlowValidationError } from '../types/errors';

// Create specialized error classes that extend the base TaggedError types
export class GenerationError extends DynamicFlowError {
  readonly retryable: boolean;

  constructor(message: string, cause?: unknown, retryable = true) {
    super({
      module: 'generation',
      operation: 'generate',
      cause: cause || message,
    });
    this.retryable = retryable;
  }
}

export class ExecutionError extends FlowExecutionError {
  readonly code?: string;

  constructor(message: string, code?: string, nodeId?: string) {
    const params: {
      nodeId?: string;
      executionContext?: Record<string, unknown>;
      cause?: unknown;
    } = {
      cause: message,
    };

    if (nodeId) {
      params.nodeId = nodeId;
    }

    if (code) {
      params.executionContext = { code };
    }

    super(params);
    if (code !== undefined) {
      this.code = code;
    }
  }
}

export class BuilderError extends DynamicFlowError {
  constructor(message: string) {
    super({
      module: 'builder',
      operation: 'build',
      cause: message,
    });
  }
}

export class PoolError extends DynamicFlowError {
  constructor(message: string) {
    super({
      module: 'pool',
      operation: 'pool-operation',
      cause: message,
    });
  }
}

export class LLMGenerationError extends LLMError {
  constructor(message: string, cause?: Error) {
    const params: {
      toolId: string;
      provider?: string;
      model?: string;
      details?: Record<string, unknown>;
      cause?: unknown;
    } = {
      toolId: 'llm-generator',
      cause: cause || message,
    };

    super(params);
  }
}

export class RestoreError extends DynamicFlowError {
  constructor(message: string) {
    super({
      module: 'restore',
      operation: 'restore-flow',
      cause: message,
    });
  }
}

// ============= Model Pool Types =============

export interface ModelPool {
  acquire(): Effect.Effect<AiModel, PoolError>;

  release(model: AiModel): Effect.Effect<void, never>;

  executeWithPool<T>(
    items: T[],
    operation: (item: T, model: AiModel) => Effect.Effect<unknown, unknown>
  ): Stream.Stream<any, PoolError>;
}

export interface PoolMetrics {
  totalRequests: number;
  modelUsage: Map<string, number>;
  averageLatency: number;
  errorRate: number;
}

// ============= Cache Types =============

export interface CacheEntry {
  key: string;
  flow: ValidatedFlow;
  request: GenerateFlowRequest;
  timestamp: number;
  lastAccessed: number;
  accessCount: number;
}

export interface CacheStats {
  hits: number;
  misses: number;
  evictions: number;
  size: number;
}

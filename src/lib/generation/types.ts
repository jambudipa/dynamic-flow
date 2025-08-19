/**
 * DynamicFlow Generation - Core Types
 */
// Consolidated types from types-fixed.ts
import type { Duration, Effect, Stream } from 'effect';
import type { Tool, ToolJoin } from '@/lib/tools/types';
// Import error types from the main errors module
import {
  DynamicFlowError,
  FlowError,
  FlowExecutionError,
  LLMError,
} from '@/lib/types/errors';
// no Schema imports needed here

// Re-export some tool types and import Tool/ToolJoin for local usage
export type { ToolError, ToolRequirements } from '../tools/types';

// Define ExecutionContext since it's not exported from tools/types
export interface ExecutionContext {
  signal?: AbortSignal | undefined;
  logger?: {
    log: (message: string) => void;
    error: (message: string) => void;
    warn: (message: string) => void;
  };
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
    options?: unknown | undefined
  ): Effect.Effect<{ content: string }, never>;

  stream(
    prompt: unknown,
    options?: unknown | undefined
  ): Stream.Stream<any, never>;
}

// Re-export for use in other modules
export { FlowError } from '../types/errors';

// ============= Flow Generation Types =============

export interface DynamicFlowOptions {
  model?: AiModel | undefined;
  retryStrategy?: RetryStrategy | undefined;
  escalationPath?: AiModel[] | undefined;
  timeout?: Duration.Duration;
  cache?: boolean | undefined;
  modelPool?: ModelPoolConfig | undefined;
  constraints?: FlowConstraints | undefined;
  options?: {
    retryStrategy?: RetryStrategy | undefined;
    constraints?: FlowConstraints | undefined;
    escalationPath?: AiModel[] | undefined;
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
  fallback?: AiModel | undefined;
}

// ============= Flow Event Types =============

export type FlowEvent =
  // Flow lifecycle events
  | { type: 'flow-start'; timestamp: number; metadata?: unknown | undefined }
  | { type: 'flow-complete'; timestamp: number; result?: unknown | undefined }
  | {
      type: 'flow-error';
      timestamp: number;
      error?: { message: string; code?: string | undefined };
    }
  // Node events
  | {
      type: 'node-start';
      timestamp: number;
      nodeId: string;
      nodeType?: string | undefined;
    }
  | {
      type: 'node-complete';
      timestamp: number;
      nodeId: string;
      result?: unknown | undefined;
    }
  | {
      type: 'node-error';
      timestamp: number;
      nodeId: string;
      error?: { message: string; code?: string | undefined };
    }
  // Tool events
  | {
      type: 'tool-start';
      timestamp?: number | undefined;
      nodeId?: string | undefined;
      toolId: string;
      input: unknown;
    }
  | {
      type: 'tool-output';
      timestamp?: number | undefined;
      nodeId?: string | undefined;
      toolId: string;
      output: unknown;
    }
  | {
      type: 'tool-error';
      timestamp?: number | undefined;
      nodeId?: string | undefined;
      toolId: string;
      error: Error;
    }
  // LLM events
  | {
      type: 'llm-token';
      timestamp?: number | undefined;
      nodeId?: string | undefined;
      token: string;
      toolId?: string | undefined;
    }
  | {
      type: 'llm-completion';
      timestamp?: number | undefined;
      nodeId?: string | undefined;
      completion: string;
      toolId?: string | undefined;
    }
  // Progress events
  | { type: 'flow-progress'; step: number; total: number }
  | { type: 'state-change'; state: FlowState }
  | { type: 'final-result'; result: unknown };

export interface FlowSnapshot {
  timestamp: number;
  state: FlowState;
  completedSteps?: string[] | undefined;
  pendingSteps?: string[] | undefined;
  intermediateResults?: Map<string | undefined, unknown>;
  metadata?: Record<string, unknown>;
}

export interface FlowState {
  status: 'idle' | 'running' | 'paused' | 'completed' | 'error';
  currentNode?: string | null;
  nodes?: Map<string | undefined, unknown>;
  values?: Map<string | undefined, unknown>;
  variables?: Map<string | undefined, unknown>;
  errors?: Error[] | undefined;
  startTime?: number | undefined;
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
  operation?: FunctionalOperation | undefined;
  toolId?: string | undefined;
  inputs?: Record<string, unknown>;
  config?: NodeConfig | undefined;
}

export interface FunctionalOperation {
  over: string; // Reference to array/collection
  operation: {
    type: 'llm' | 'tool' | 'expression';
    prompt?: string | undefined; // For LLM-based operations
    tool?: string | undefined; // For tool-based operations
    expression?: string | undefined; // For expressions
    initialValue?: unknown | undefined; // For reduce
  };
  concurrency?: number | undefined;
  usePool?: boolean | undefined; // Use model pool for parallel execution
}

export interface FunctionalNode extends FlowNode {
  type: 'map' | 'filter' | 'reduce' | 'flatMap' | 'forEach';
  operation: FunctionalOperation;
}

export interface ConditionalNode extends FlowNode {
  type: 'if-then';
  condition: {
    type: 'llm' | 'expression' | 'tool';
    prompt?: string | undefined; // For LLM evaluation
    expression?: string | undefined; // For JS expression
    toolId?: string | undefined; // Tool that returns boolean
  };
  then: string[]; // Node IDs
  else?: string[] | undefined; // Node IDs
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
  retries?: number | undefined;
  cache?: boolean | undefined;
  /** Whether to emit tool-output events for this node (default: true) */
  emitIntermediate?: boolean | undefined;
  /** Whether to emit llm-token events for this node if applicable (default: true) */
  emitTokens?: boolean | undefined;
}

export interface NodeResult {
  nodeId: string;
  output: unknown;
  timestamp: number;
  metadata?: unknown | undefined;
}

// ============= Additional Type Exports =============

export interface GenerateFlowOptions {
  model?: AiModel | undefined;
  prompt?: string | undefined;
  temperature?: number | undefined;
  maxRetries?: number | undefined;
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
  description?: string | undefined;
}

// ============= Flow JSON Structure =============

export interface FlowJSON {
  version: '1.0';
  metadata?: {
    name?: string | undefined;
    description?: string | undefined;
    generated?: boolean | undefined;
    model?: string | undefined;
    timestamp?: string | undefined;
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
  condition?: string | undefined;
  transform?: string | undefined;
}

// ============= Generation Types =============

export interface GenerateFlowRequest {
  prompt: string;
  tools: ReadonlyArray<Tool<any, any>>;
  joins: ReadonlyArray<ToolJoin<any, any>>;
  model: AiModel;
  options?: DynamicFlowOptions | undefined;
}

export interface GenerationContext {
  prompt: string;
  tools: ReadonlyArray<Tool<any, any>>;
  joins: ReadonlyArray<ToolJoin<any, any>>;
  currentModel: AiModel;
  attemptCount: number;
  errors: ValidationError[];
  options?: DynamicFlowOptions | undefined;
}

export interface ToolContext {
  tools: ToolDescription[];
  joins: JoinDescription[];
  constraints?: FlowConstraints | undefined;
  errorContext?: ValidationError[] | undefined;
}

export interface FlowConstraints {
  maxNodes?: number | undefined;
  maxDepth?: number | undefined;
  allowedOperations?: string[] | undefined;
}

// ============= Validation Types =============

export interface ValidationError {
  code: string;
  type: 'schema' | 'tool' | 'connection' | 'join' | 'operation';
  message: string;
  path?: string[] | undefined;
  suggestion?: string | undefined;
  context?: {
    expected: unknown;
    actual: unknown;
    availableOptions?: string[] | undefined;
  };
}

export interface ValidatedFlow {
  ir: any; // IR type from ../ir/core-types
  json?: FlowJSON | undefined; // Optional, for debugging
  tools: Map<string, Tool<any, any>>; // Each tool has its own specific input/output types
  joins: Map<string, ToolJoin<any, any>>; // Each join has its own specific transformation types
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

  constructor(message: string, cause?: unknown | undefined, retryable = true) {
    super({
      module: 'generation',
      operation: 'generate',
      cause: cause || message,
    });
    this.retryable = retryable;
  }
}

export class ExecutionError extends FlowExecutionError {
  readonly code?: string | undefined;

  constructor(
    message: string,
    code?: string | undefined,
    nodeId?: string | undefined
  ) {
    const params: {
      nodeId?: string | undefined;
      executionContext?: Record<string, unknown>;
      cause?: unknown | undefined;
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
  constructor(message: string, cause?: Error | undefined) {
    const params: {
      toolId: string;
      provider?: string | undefined;
      model?: string | undefined;
      details?: Record<string, unknown>;
      cause?: unknown | undefined;
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

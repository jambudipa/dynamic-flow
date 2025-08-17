/**
 * Error Types - Unified Error Hierarchy using TaggedError
 *
 * This module provides the single source of truth for error types used
 * throughout the Dynamic Flow system, using Effect's TaggedError pattern
 * for type-safe, composable error handling.
 *
 * @see https://effect.website/docs/data-types/data/#taggederror
 */

import { Data, Effect } from 'effect';
import type { SourceLocation } from './core';

// ============= Base Error Classes =============

/**
 * Base error class for all Dynamic Flow errors
 */
export class DynamicFlowError extends Data.TaggedError('DynamicFlowError')<{
  module: string;
  operation: string;
  cause?: unknown;
}> {
  get message(): string {
    return `[${this.module}] ${this.operation} failed${this.cause ? `: ${String(this.cause)}` : ''}`;
  }
}

// ============= Execution Errors =============

/**
 * Error that occurs during flow execution
 */
export class FlowExecutionError extends Data.TaggedError('FlowExecutionError')<{
  nodeId?: string;
  executionContext?: Record<string, unknown>;
  cause?: unknown;
}> {
  get message(): string {
    const location = this.nodeId ? ` at node '${this.nodeId}'` : '';
    return `Flow execution failed${location}${this.cause ? `: ${String(this.cause)}` : ''}`;
  }
}

/**
 * Error that occurs due to type mismatches
 */
export class FlowTypeError extends Data.TaggedError('FlowTypeError')<{
  expected: string;
  actual: string;
  location?: {
    line?: number;
    column?: number;
    file?: string;
  };
  cause?: unknown;
}> {
  get message(): string {
    const loc = this.location
      ? ` at ${this.location.file}:${this.location.line}:${this.location.column}`
      : '';
    return `Type mismatch${loc}: expected ${this.expected}, got ${this.actual}`;
  }
}

/**
 * Error that occurs during data mapping between steps
 */
export class FlowMappingError extends Data.TaggedError('FlowMappingError')<{
  sourceType: string;
  targetType: string;
  availableMappings: string[];
  cause?: unknown;
}> {
  get message(): string {
    return `Cannot map from ${this.sourceType} to ${this.targetType}. Available mappings: ${this.availableMappings.join(', ') || 'none'}`;
  }
}

/**
 * Error that occurs during validation
 */
export class FlowValidationError extends Data.TaggedError(
  'FlowValidationError'
)<{
  validationDetails?: Record<string, unknown>;
  fieldPath?: string;
  cause?: unknown;
}> {
  get message(): string {
    const path = this.fieldPath ? ` at field '${this.fieldPath}'` : '';
    return `Validation failed${path}${this.cause ? `: ${String(this.cause)}` : ''}`;
  }
}

// ============= Tool Errors =============

/**
 * Error that occurs during tool execution
 */
export class ToolError extends Data.TaggedError('ToolError')<{
  toolId: string;
  phase: 'validation' | 'execution' | 'cleanup';
  details?: Record<string, unknown>;
  cause?: unknown;
}> {
  get message(): string {
    return `Tool '${this.toolId}' failed during ${this.phase}${this.cause ? `: ${String(this.cause)}` : ''}`;
  }
}

/**
 * Error specific to LLM tool execution
 */
export class LLMError extends Data.TaggedError('LLMError')<{
  toolId: string;
  provider?: string;
  model?: string;
  details?: Record<string, unknown>;
  cause?: unknown;
}> {
  get message(): string {
    const providerInfo = this.provider
      ? ` (${this.provider}${this.model ? `/${this.model}` : ''})`
      : '';
    return `LLM tool '${this.toolId}'${providerInfo} failed${this.cause ? `: ${String(this.cause)}` : ''}`;
  }
}

// ============= Compilation Errors =============

/**
 * Error that occurs during flow compilation
 */
export class FlowCompilationError extends Data.TaggedError(
  'FlowCompilationError'
)<{
  path: string;
  source: 'json' | 'typescript';
  location?: {
    line?: number;
    column?: number;
    file?: string;
  };
  cause?: unknown;
}> {
  get message(): string {
    const loc = this.location
      ? ` at ${this.location.file}:${this.location.line}:${this.location.column}`
      : '';
    return `${this.source} compilation failed for '${this.path}'${loc}${this.cause ? `: ${String(this.cause)}` : ''}`;
  }
}

// ============= Schema Errors =============

/**
 * Error that occurs during schema validation or transformation
 */
export class FlowSchemaError extends Data.TaggedError('FlowSchemaError')<{
  schemaName?: string;
  fieldPath?: string;
  cause?: unknown;
}> {
  get message(): string {
    const schema = this.schemaName ? ` for schema '${this.schemaName}'` : '';
    const field = this.fieldPath ? ` at field '${this.fieldPath}'` : '';
    return `Schema error${schema}${field}${this.cause ? `: ${String(this.cause)}` : ''}`;
  }
}

/**
 * Error that occurs when operations timeout
 */
export class TimeoutError extends Data.TaggedError('TimeoutError')<{
  operation: string;
  timeoutMs: number;
  nodeId?: string;
}> {
  get message(): string {
    const location = this.nodeId ? ` at node '${this.nodeId}'` : '';
    return `Operation '${this.operation}' timed out after ${this.timeoutMs}ms${location}`;
  }
}

/**
 * Error that occurs during parsing
 */
export class ParseError extends Data.TaggedError('ParseError')<{
  input: unknown;
  schema: string;
  details?: string;
}> {
  get message(): string {
    return `Failed to parse as ${this.schema}${this.details ? `: ${this.details}` : ''}`;
  }
}

// ============= Simplified FlowError for backward compatibility =============

/**
 * Simplified FlowError class for backward compatibility
 * This is a simple error that maintains the FlowError interface
 */
export class FlowError extends Data.TaggedError('FlowError')<{
  _customMessage: string;
  cause?: unknown;
}> {
  constructor(message: string, cause?: unknown) {
    super({
      _customMessage: message,
      cause,
    });
  }

  get message(): string {
    return this._customMessage;
  }
}

// ============= Union Types =============

/**
 * Union type of all Flow error types
 */
export type AnyFlowError =
  | DynamicFlowError
  | FlowExecutionError
  | FlowTypeError
  | FlowMappingError
  | FlowValidationError
  | ToolError
  | LLMError
  | FlowCompilationError
  | FlowSchemaError
  | TimeoutError
  | ParseError
  | FlowError;

// ============= Type Guards =============

/**
 * Type guard to check if an error is a FlowError
 */
export const isFlowError = (error: unknown): error is FlowError => {
  return (
    error instanceof FlowError ||
    (typeof error === 'object' &&
      error !== null &&
      '_tag' in error &&
      (error as any)._tag === 'FlowError')
  );
};

/**
 * Type guard for FlowExecutionError
 */
export const isFlowExecutionError = (
  error: unknown
): error is FlowExecutionError => {
  return (
    typeof error === 'object' &&
    error !== null &&
    '_tag' in error &&
    (error as any)._tag === 'FlowExecutionError'
  );
};

/**
 * Type guard for FlowTypeError
 */
export const isFlowTypeError = (error: unknown): error is FlowTypeError => {
  return (
    typeof error === 'object' &&
    error !== null &&
    '_tag' in error &&
    (error as any)._tag === 'FlowTypeError'
  );
};

/**
 * Type guard for FlowMappingError
 */
export const isFlowMappingError = (
  error: unknown
): error is FlowMappingError => {
  return (
    typeof error === 'object' &&
    error !== null &&
    '_tag' in error &&
    (error as any)._tag === 'FlowMappingError'
  );
};

/**
 * Type guard for FlowValidationError
 */
export const isFlowValidationError = (
  error: unknown
): error is FlowValidationError => {
  return (
    typeof error === 'object' &&
    error !== null &&
    '_tag' in error &&
    (error as any)._tag === 'FlowValidationError'
  );
};

/**
 * Type guard for ToolError
 */
export const isToolError = (error: unknown): error is ToolError => {
  return (
    typeof error === 'object' &&
    error !== null &&
    '_tag' in error &&
    (error as any)._tag === 'ToolError'
  );
};

/**
 * Type guard for LLMError
 */
export const isLLMError = (error: unknown): error is LLMError => {
  return (
    typeof error === 'object' &&
    error !== null &&
    '_tag' in error &&
    (error as any)._tag === 'LLMError'
  );
};

/**
 * Type guard for FlowCompilationError
 */
export const isFlowCompilationError = (
  error: unknown
): error is FlowCompilationError => {
  return (
    typeof error === 'object' &&
    error !== null &&
    '_tag' in error &&
    (error as any)._tag === 'FlowCompilationError'
  );
};

/**
 * Type guard for FlowSchemaError
 */
export const isFlowSchemaError = (error: unknown): error is FlowSchemaError => {
  return (
    typeof error === 'object' &&
    error !== null &&
    '_tag' in error &&
    (error as any)._tag === 'FlowSchemaError'
  );
};

// ============= Error Factory Functions =============

/**
 * Create a FlowExecutionError with consistent formatting
 */
export const createFlowExecutionError = (
  message: string,
  nodeId?: string,
  context?: Record<string, unknown>,
  cause?: unknown
): FlowExecutionError => {
  const props: {
    nodeId?: string;
    executionContext?: Record<string, unknown>;
    cause?: unknown;
  } = {
    cause: cause ?? message,
  };

  if (nodeId !== undefined) {
    props.nodeId = nodeId;
  }

  if (context !== undefined) {
    props.executionContext = context;
  }

  return new FlowExecutionError(props);
};

/**
 * Create a FlowTypeError with consistent formatting
 */
export const createFlowTypeError = (
  message: string,
  expected: string,
  actual: string,
  location?: SourceLocation,
  cause?: unknown
): FlowTypeError => {
  const props: {
    expected: string;
    actual: string;
    location?: {
      line?: number;
      column?: number;
      file?: string;
    };
    cause?: unknown;
  } = {
    expected,
    actual,
    cause: cause ?? message,
  };

  if (location !== undefined) {
    props.location = location;
  }

  return new FlowTypeError(props);
};

/**
 * Create a ToolError with consistent formatting
 */
export const createToolError = (
  message: string,
  toolId: string,
  details?: Record<string, unknown>,
  cause?: unknown
): ToolError => {
  const props: {
    toolId: string;
    phase: 'validation' | 'execution' | 'cleanup';
    details?: Record<string, unknown>;
    cause?: unknown;
  } = {
    toolId,
    phase: 'execution',
    cause: cause ?? message,
  };

  if (details !== undefined) {
    props.details = details;
  }

  return new ToolError(props);
};

/**
 * Create an LLMError with consistent formatting
 */
export const createLLMError = (
  message: string,
  toolId: string,
  provider?: string,
  model?: string,
  details?: Record<string, unknown>,
  cause?: unknown
): LLMError => {
  const props: {
    toolId: string;
    provider?: string;
    model?: string;
    details?: Record<string, unknown>;
    cause?: unknown;
  } = {
    toolId,
    cause: cause ?? message,
  };

  if (provider !== undefined) {
    props.provider = provider;
  }

  if (model !== undefined) {
    props.model = model;
  }

  if (details !== undefined) {
    props.details = details;
  }

  return new LLMError(props);
};

// ============= Error Conversion Utilities =============

/**
 * Convert FlowExecutionError to FlowError for backward compatibility
 */
export const toFlowError = (error: FlowExecutionError): FlowError => {
  const nodeId = error.nodeId ? ` at node '${error.nodeId}'` : '';
  const message = `Flow execution failed${nodeId}${error.cause ? `: ${String(error.cause)}` : ''}`;
  return new FlowError(message, error.cause);
};

/**
 * Convert any AnyFlowError to FlowError for backward compatibility
 */
export const normalizeToFlowError = (error: AnyFlowError): FlowError => {
  if (error instanceof FlowError) {
    return error;
  }

  return new FlowError(error.message, error);
};

/**
 * Effect utility to map any flow error to FlowError
 */
export const mapToFlowError = <A, E extends AnyFlowError, R>(
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, FlowError, R> => {
  return Effect.mapError(effect, normalizeToFlowError);
};

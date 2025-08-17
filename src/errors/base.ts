/**
 * Base error types using Effect's TaggedError pattern.
 * All errors in the DynamicFlow library extend from these base types.
 */

import { Data } from 'effect';

/**
 * Base error for all DynamicFlow errors.
 * Provides consistent structure with module, operation, and cause tracking.
 */
export class DynamicFlowError extends Data.TaggedError('DynamicFlowError')<{
  readonly module: string;
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}> {
  get displayMessage(): string {
    return `[${this.module}] ${this.operation}: ${this.message}`;
  }
}

/**
 * Error for validation failures.
 * Used when input data doesn't meet expected schema or constraints.
 */
export class ValidationError extends Data.TaggedError('ValidationError')<{
  readonly field: string;
  readonly value: unknown;
  readonly expected: string;
  readonly message: string;
}> {
  get displayMessage(): string {
    return `Validation failed for ${this.field}: ${this.message}`;
  }
}

/**
 * Error for execution failures.
 * Used when flow execution encounters an error at a specific step.
 */
export class ExecutionError extends Data.TaggedError('ExecutionError')<{
  readonly step: string;
  readonly input: unknown;
  readonly message: string;
  readonly cause?: unknown;
}> {
  get displayMessage(): string {
    return `Execution failed at step ${this.step}: ${this.message}`;
  }
}

/**
 * Error for tool-related failures.
 * Used when tool registration, execution, or validation fails.
 */
export class ToolError extends Data.TaggedError('ToolError')<{
  readonly toolName: string;
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}> {
  get displayMessage(): string {
    return `Tool ${this.toolName} failed during ${this.operation}: ${this.message}`;
  }
}

/**
 * Error for LLM-related failures.
 * Used when LLM generation or parsing fails.
 */
export class LLMError extends Data.TaggedError('LLMError')<{
  readonly model?: string;
  readonly prompt?: string;
  readonly message: string;
  readonly cause?: unknown;
}> {
  get displayMessage(): string {
    const modelInfo = this.model ? ` (model: ${this.model})` : '';
    return `LLM operation failed${modelInfo}: ${this.message}`;
  }
}

/**
 * Error for network-related failures.
 * Used when HTTP requests or network operations fail.
 */
export class NetworkError extends Data.TaggedError('NetworkError')<{
  readonly url?: string;
  readonly statusCode?: number;
  readonly message: string;
  readonly cause?: unknown;
}> {
  get displayMessage(): string {
    const urlInfo = this.url ? ` for ${this.url}` : '';
    const statusInfo = this.statusCode ? ` (status: ${this.statusCode})` : '';
    return `Network request failed${urlInfo}${statusInfo}: ${this.message}`;
  }
}

/**
 * Error for timeout failures.
 * Used when operations exceed their time limit.
 */
export class TimeoutError extends Data.TaggedError('TimeoutError')<{
  readonly operation: string;
  readonly duration: number;
  readonly message?: string;
}> {
  get displayMessage(): string {
    return `Operation ${this.operation} timed out after ${this.duration}ms`;
  }
}

/**
 * Error for parsing failures.
 * Used when JSON or other data parsing fails.
 */
export class ParseError extends Data.TaggedError('ParseError')<{
  readonly input: string;
  readonly expected: string;
  readonly message: string;
  readonly cause?: unknown;
}> {
  get displayMessage(): string {
    return `Failed to parse input as ${this.expected}: ${this.message}`;
  }
}

/**
 * Error for configuration failures.
 * Used when configuration is invalid or missing.
 */
export class ConfigError extends Data.TaggedError('ConfigError')<{
  readonly key: string;
  readonly message: string;
  readonly cause?: unknown;
}> {
  get displayMessage(): string {
    return `Configuration error for ${this.key}: ${this.message}`;
  }
}

/**
 * Error for resource failures.
 * Used when resource acquisition or release fails.
 */
export class ResourceError extends Data.TaggedError('ResourceError')<{
  readonly resource: string;
  readonly operation: 'acquire' | 'release' | 'use';
  readonly message: string;
  readonly cause?: unknown;
}> {
  get displayMessage(): string {
    return `Resource ${this.resource} failed to ${this.operation}: ${this.message}`;
  }
}

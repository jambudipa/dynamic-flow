/**
 * Core Types - Unified Type Definitions
 *
 * This module provides the single source of truth for core types used
 * throughout the DynamicFlow system, eliminating conflicts and ensuring
 * consistency across all modules.
 */

import type { Schema } from 'effect';

// ============= Execution Context =============

/**
 * Unified ExecutionContext interface that serves as the single definition
 * used across all modules. This consolidates the various ExecutionContext
 * definitions from ir/types.ts, datatypes/types.ts, and core/interfaces/executable.ts
 */
export interface ExecutionContext {
  /** Unique identifier for the current flow */
  readonly flowId: string;
  /** Unique identifier for the current step */
  readonly stepId: string;
  /** Session identifier for tracking execution sessions */
  readonly sessionId: string;
  /** Variables available in the current execution context */
  readonly variables: Record<string, unknown>;
  /** Metadata for the current execution */
  readonly metadata: Record<string, unknown>;

  // Optional enhanced fields from various contexts
  /** Parent execution context for nested flows */
  readonly parentContext?: ExecutionContext;
  /** Current scope information for variable resolution */
  readonly currentScope?: string[];
  /** Worker pool for parallel execution (avoid circular deps with any) */
  readonly workerPool?: unknown;
  /** Flow control manager for advanced control flow */
  readonly flowControl?: unknown;
  /** Pause/resume manager for long-running flows */
  readonly pauseResume?: unknown;
}

// ============= Source Location =============

/**
 * Source location information for error reporting and debugging
 */
export interface SourceLocation {
  readonly line?: number;
  readonly column?: number;
  readonly file?: string;
}

// ============= Metadata Types =============

/**
 * General metadata interface for flow components
 */
export interface ComponentMetadata {
  readonly sourceLocation?: SourceLocation;
  readonly sourceType?: 'json' | 'typescript';
  readonly description?: string;
  readonly version?: string;
  readonly author?: string;
  readonly tags?: readonly string[];
}

// ============= Resource Requirements =============

/**
 * Resource requirements for executable entities
 */
export interface ResourceRequirements {
  /** Memory requirements in bytes */
  readonly memory?: number;
  /** CPU requirements (0-1 scale) */
  readonly cpu?: number;
  /** Network requirements */
  readonly network?: boolean;
  /** File system access requirements */
  readonly filesystem?: boolean;
  /** Custom resource requirements */
  readonly custom?: Record<string, unknown>;
}

// ============= Schema Types =============

/**
 * Schema definition for executable entities with input/output validation
 */
export interface ExecutableSchema<TInput, TOutput> {
  /** Input schema for validation */
  readonly input: Schema.Schema<TInput>;
  /** Output schema for validation */
  readonly output: Schema.Schema<TOutput>;
  /** Human-readable description of what this executable does */
  readonly description: string;
  /** Optional examples for documentation and testing */
  readonly examples?: ReadonlyArray<{ input: TInput; output: TOutput }>;
}

// ============= Validation Types =============

/**
 * Validation result type
 */
export type ValidationResult<T = unknown> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: string };

/**
 * Create a successful validation result
 */
export const validationSuccess = <T>(data: T): ValidationResult<T> => ({
  success: true,
  data,
});

/**
 * Create a failed validation result
 */
export const validationFailure = <T = unknown>(
  error: string
): ValidationResult<T> => ({
  success: false,
  error,
});

// ============= Type Guards =============

/**
 * Type guard to check if a value has the basic structure of ExecutionContext
 */
export const isExecutionContext = (
  value: unknown
): value is ExecutionContext => {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj['flowId'] === 'string' &&
    typeof obj['stepId'] === 'string' &&
    typeof obj['sessionId'] === 'string' &&
    typeof obj['variables'] === 'object' &&
    typeof obj['metadata'] === 'object'
  );
};

/**
 * Type guard to check if a validation result is successful
 */
export const isValidationSuccess = <T>(
  result: ValidationResult<T>
): result is { success: true; data: T } => {
  return result.success;
};

/**
 * Type guard to check if a validation result is a failure
 */
export const isValidationFailure = <T>(
  result: ValidationResult<T>
): result is { success: false; error: string } => {
  return !result.success;
};

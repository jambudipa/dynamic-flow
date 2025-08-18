/**
 * Type Guards and Predicates
 *
 * This module provides comprehensive type guards and predicate functions
 * for runtime type checking and validation throughout the DynamicFlow system.
 */

import { Effect, type Schema } from 'effect';
import { safeOp } from '../utils/effect-patterns';
import type {
  ComponentMetadata,
  ExecutionContext,
  ValidationResult,
} from './core';
import type { AnyFlowError, FlowError } from './errors';
import type { FlowContext, FlowEffect, ToolRequirements } from './effects';
import { isArray, isDefined, isRecord, isString } from './type-utils';

// ============= Core Type Guards =============

/**
 * Enhanced ExecutionContext type guard with optional field checking
 */
export const isExecutionContext = (
  value: unknown
): value is ExecutionContext => {
  if (!isRecord(value)) {
    return false;
  }

  // Check required fields using type-safe guards
  const hasRequired =
    isString(value.flowId) &&
    isString(value.stepId) &&
    isString(value.sessionId) &&
    isRecord(value.variables) &&
    isRecord(value.metadata);

  if (!hasRequired) {
    return false;
  }

  // Check optional fields if present
  if (
    isDefined(value.parentContext) &&
    !isExecutionContext(value.parentContext)
  ) {
    return false;
  }

  if (isDefined(value.currentScope) && !isArray(value.currentScope)) {
    return false;
  }

  return true;
};

/**
 * Strict ExecutionContext type guard that requires all fields
 */
export const isCompleteExecutionContext = (
  value: unknown
): value is Required<ExecutionContext> => {
  if (!isExecutionContext(value)) {
    return false;
  }

  return (
    isDefined(value.parentContext) &&
    isDefined(value.currentScope) &&
    isDefined((value as any).workerPool) &&
    isDefined((value as any).flowControl) &&
    isDefined((value as any).pauseResume)
  );
};

/**
 * ValidationResult type guard
 */
export const isValidationResult = <T>(
  value: unknown
): value is ValidationResult<T> => {
  if (!isRecord(value)) {
    return false;
  }

  if (typeof value.success !== 'boolean') {
    return false;
  }

  if (value.success === true) {
    return 'data' in value;
  } else {
    return isString(value.error);
  }
};

/**
 * ComponentMetadata type guard
 */
export const isComponentMetadata = (
  value: unknown
): value is ComponentMetadata => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const obj = value as any;

  // All fields are optional, so check types if present
  if (obj.sourceLocation !== undefined) {
    if (typeof obj.sourceLocation !== 'object' || obj.sourceLocation === null) {
      return false;
    }
  }

  if (obj.sourceType !== undefined) {
    if (obj.sourceType !== 'json' && obj.sourceType !== 'typescript') {
      return false;
    }
  }

  if (obj.description !== undefined && typeof obj.description !== 'string') {
    return false;
  }

  if (obj.version !== undefined && typeof obj.version !== 'string') {
    return false;
  }

  if (obj.author !== undefined && typeof obj.author !== 'string') {
    return false;
  }

  return !(obj.tags !== undefined && !Array.isArray(obj.tags));
};

// ============= Error Type Guards =============

/**
 * FlowError type guard with tag checking
 */
export const isFlowError = (value: unknown): value is FlowError => {
  if (!(value instanceof Error)) {
    return false;
  }

  const errorWithTag = value as Error & { _tag?: unknown; name?: unknown };
  return isString(errorWithTag._tag) && isString(errorWithTag.name);
};

/**
 * Specific error type guards using tag discrimination
 */
export const isFlowExecutionError = (
  value: unknown
): value is import('./errors').FlowExecutionError => {
  return isFlowError(value) && (value as any)._tag === 'FlowExecutionError';
};

export const isFlowTypeError = (
  value: unknown
): value is import('./errors').FlowTypeError => {
  return isFlowError(value) && (value as any)._tag === 'FlowTypeError';
};

export const isFlowMappingError = (
  value: unknown
): value is import('./errors').FlowMappingError => {
  return isFlowError(value) && (value as any)._tag === 'FlowMappingError';
};

export const isFlowValidationError = (
  value: unknown
): value is import('./errors').FlowValidationError => {
  return isFlowError(value) && (value as any)._tag === 'FlowValidationError';
};

export const isToolError = (
  value: unknown
): value is import('./errors').ToolError => {
  return isFlowError(value) && (value as any)._tag === 'ToolError';
};

export const isLLMError = (
  value: unknown
): value is import('./errors').LLMError => {
  return isFlowError(value) && (value as any)._tag === 'LLMError';
};

export const isFlowCompilationError = (
  value: unknown
): value is import('./errors').FlowCompilationError => {
  return isFlowError(value) && (value as any)._tag === 'FlowCompilationError';
};

export const isFlowSchemaError = (
  value: unknown
): value is import('./errors').FlowSchemaError => {
  return isFlowError(value) && (value as any)._tag === 'FlowSchemaError';
};

/**
 * Union type guard for any Flow error
 */
export const isAnyFlowError = (value: unknown): value is AnyFlowError => {
  return (
    isFlowExecutionError(value) ||
    isFlowTypeError(value) ||
    isFlowMappingError(value) ||
    isFlowValidationError(value) ||
    isToolError(value) ||
    isLLMError(value) ||
    isFlowCompilationError(value) ||
    isFlowSchemaError(value)
  );
};

// ============= Effect Type Guards =============

/**
 * Effect type guard
 */
export const isEffect = (
  value: unknown
): value is Effect.Effect<unknown, unknown, never> => {
  return (
    typeof value === 'object' &&
    value !== null &&
    '_tag' in value &&
    (value as any)._tag === 'Effect'
  );
};

/**
 * FlowEffect type guard
 */
export const isFlowEffect = (value: unknown): value is FlowEffect<unknown> => {
  return isEffect(value);
};

/**
 * FlowContext type guard
 */
export const isFlowContext = (value: unknown): value is FlowContext => {
  return (
    typeof value === 'object' &&
    value !== null &&
    'executionContext' in value &&
    isExecutionContext((value as any).executionContext) &&
    (!(value as any).services || typeof (value as any).services === 'object')
  );
};

/**
 * ToolRequirements type guard
 */
export const isToolRequirements = (
  value: unknown
): value is ToolRequirements => {
  return (
    typeof value === 'object' &&
    value !== null &&
    'executionContext' in value &&
    isExecutionContext((value as any).executionContext) &&
    (!(value as any).toolServices ||
      typeof (value as any).toolServices === 'object')
  );
};

// ============= Tool Type Guards =============

/**
 * Tool interface type guard
 */
export const isTool = <TInput, TOutput>(value: unknown): value is any => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const obj = value as any;

  return (
    typeof obj.id === 'string' &&
    typeof obj.type === 'string' &&
    typeof obj.schema === 'object' &&
    obj.schema !== null &&
    typeof obj.execute === 'function'
  );
};

/**
 * Executable interface type guard
 */
export const isExecutable = <TInput, TOutput>(value: unknown): value is any => {
  return (
    isTool<TInput, TOutput>(value) &&
    typeof value.validate === 'function' &&
    typeof value.getMetadata === 'function' &&
    typeof value.asFlowEffect === 'function'
  );
};

/**
 * LLMAdapter type guard
 */
export const isLLMAdapter = (value: unknown): value is any => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const obj = value as any;

  return (
    typeof obj.provider === 'string' &&
    Array.isArray(obj.models) &&
    obj.models.every((model: unknown) => typeof model === 'string') &&
    typeof obj.execute === 'function'
  );
};

/**
 * ToolDefinition type guard
 */
export const isToolDefinition = (value: unknown): value is any => {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const obj = value as any;

  return (
    typeof obj.id === 'string' &&
    typeof obj.name === 'string' &&
    typeof obj.description === 'string' &&
    isSchema(obj.inputSchema) &&
    isSchema(obj.outputSchema) &&
    typeof obj.implementation === 'function'
  );
};

/* TODO: Fix missing './tools' module - commenting out legacy tool guard
export const isLegacyTool = (value: unknown): value is import('./tools').LegacyTool => {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const obj = value as any

  return (
    typeof obj.id === 'string' &&
    typeof obj.execute === 'function' &&
    // Must NOT have modern interface methods
    !('validate' in obj) &&
    !('getMetadata' in obj) &&
    !('asFlowEffect' in obj)
  )
}
*/

// ============= Schema Type Guards =============

/**
 * Schema type guard
 */
export const isSchema = (value: unknown): value is Schema.Schema<unknown> => {
  return (
    typeof value === 'object' &&
    value !== null &&
    '_tag' in value &&
    (value as any)._tag === 'Schema'
  );
};

/**
 * Check if schema has specific properties
 */
export const isSchemaWithDescription = (
  value: unknown
): value is Schema.Schema<unknown> & { description: string } => {
  return (
    isSchema(value) &&
    'description' in value &&
    typeof (value as any).description === 'string'
  );
};

// ============= Utility Type Guards =============

/**
 * Check if value is a non-empty string
 */
export const isNonEmptyString = (value: unknown): value is string => {
  return typeof value === 'string' && value.length > 0;
};

/**
 * Check if value is a valid identifier
 */
export const isValidId = (value: unknown): value is string => {
  return (
    isNonEmptyString(value) &&
    /^[a-zA-Z0-9_-]+$/.test(value) &&
    value.length <= 100
  );
};

/**
 * Check if value is a valid version string
 */
export const isValidVersion = (value: unknown): value is string => {
  return (
    isNonEmptyString(value) && /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9-]+)?$/.test(value)
  );
};

/**
 * Check if value is a valid URL
 */
export const isValidUrl = (value: unknown): value is string => {
  if (!isNonEmptyString(value)) {
    return false;
  }

  return Effect.runSync(
    safeOp(
      () => {
        new URL(value);
        return true;
      },
      () => ({ _tag: 'ValidationError' as const, result: false })
    ).pipe(Effect.catchAll(() => Effect.succeed(false)))
  );
};

/**
 * Check if value is a valid email
 */
export const isValidEmail = (value: unknown): value is string => {
  return isNonEmptyString(value) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
};

/**
 * Check if value is a plain object
 */
export const isPlainObject = (
  value: unknown
): value is Record<string, unknown> => {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
};

/**
 * Check if value is a non-empty array
 */
export const isNonEmptyArray = <T>(value: unknown): value is [T, ...T[]] => {
  return Array.isArray(value) && value.length > 0;
};

// ============= Predicate Utilities =============

/**
 * Create a type guard that checks multiple conditions
 */
export const allOf =
  <T>(...guards: Array<(value: unknown) => value is T>) =>
  (value: unknown): value is T => {
    return guards.every((guard) => guard(value));
  };

/**
 * Create a type guard that checks any condition
 */
export const anyOf =
  <T>(...guards: Array<(value: unknown) => value is T>) =>
  (value: unknown): value is T => {
    return guards.some((guard) => guard(value));
  };

/**
 * Negate a type guard
 */
export const not =
  <T>(guard: (value: unknown) => value is T) =>
  (value: unknown): value is Exclude<unknown, T> => {
    return !guard(value);
  };

/**
 * Optional type guard - passes if value is undefined or passes the guard
 */
export const optional =
  <T>(guard: (value: unknown) => value is T) =>
  (value: unknown): value is T | undefined => {
    return value === undefined || guard(value);
  };

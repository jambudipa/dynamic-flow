/**
 * Comprehensive Error Types - Centralized error definitions
 * 
 * Re-exports all error types from types/errors.ts and adds service-specific errors
 */

// Re-export all existing error types
export * from './types/errors';

// Re-export error types from errors/index.ts
export { 
  OperatorError, 
  PoolError, 
  ExecutionError,
  ValidationError,
  ConfigError,
  StorageError,
  SerializationError,
  EncryptionError,
  PersistenceError,
  FlowError,
  ToolError,
  KeyError,
  CompilationError,
  RegistrationError,
  DiscoveryError,
  GenerationError,
  CacheError,
  DynamicFlowError,
  RecoveryError,
  StreamError
} from './errors/index';

// Import for use in type definitions
import type {
  ConfigError,
  ExecutionError,
  RegistrationError,
  ValidationError,
  SerializationError,
  PersistenceError,
  EncryptionError,
  RecoveryError,
  StreamError
} from './errors/index';

import { Data } from 'effect';

// ============= Service-Specific Errors =============

// ConfigError is re-exported from errors/index.ts

/**
 * Error that occurs during state management
 */
export class StateError extends Data.TaggedError('StateError')<{
  readonly message: string;
  readonly operation?: string;
  readonly variable?: string;
  readonly cause?: unknown;
}> {}

/**
 * Error that occurs when variable is not found
 */
export class VariableNotFoundError extends Data.TaggedError('VariableNotFoundError')<{
  readonly name: string;
  readonly scope?: number;
}> {
  get displayMessage(): string {
    const scope = this.scope !== undefined ? ` in scope ${this.scope}` : '';
    return `Variable '${this.name}' not found${scope}`;
  }
}

// ExecutionError is already exported from errors/index.ts with proper phase property
// Don't redefine it here

// RegistrationError is re-exported from errors/index.ts

/**
 * Error that occurs when tool is not found
 */
export class ToolNotFoundError extends Data.TaggedError('ToolNotFoundError')<{
  readonly toolId: string;
  readonly operation?: string;
}> {}

// ValidationError is re-exported from errors/index.ts

// SerializationError is re-exported from errors/index.ts

/**
 * Error that occurs during compression/decompression
 */
export class CompressionError extends Data.TaggedError('CompressionError')<{
  readonly message: string;
  readonly operation?: string;
  readonly format?: string;
  readonly cause?: unknown;
}> {}

/**
 * Error that occurs during key validation
 */
export class KeyValidationError extends Data.TaggedError('KeyValidationError')<{
  readonly message: string;
  readonly key?: string;
  readonly format?: string;
  readonly cause?: unknown;
}> {}

// PersistenceError is re-exported from errors/index.ts

// EncryptionError is re-exported from errors/index.ts

/**
 * Error that occurs during IR compilation
 */
export class IRCompilationError extends Data.TaggedError('IRCompilationError')<{
  readonly message: string;
  readonly node?: string;
  readonly phase?: string;
  readonly cause?: unknown;
}> {}

/**
 * Error that occurs during IR execution
 */
export class IRExecutionError extends Data.TaggedError('IRExecutionError')<{
  readonly message: string;
  readonly nodeId?: string;
  readonly nodeType?: string;
  readonly cause?: unknown;
}> {}

/**
 * Error that occurs during flow suspension
 */
export class SuspensionError extends Data.TaggedError('SuspensionError')<{
  readonly message: string;
  readonly flowId?: string;
  readonly key?: string;
  readonly cause?: unknown;
}> {}

/**
 * Error that occurs in storage backend
 */
export class BackendError extends Data.TaggedError('BackendError')<{
  readonly message: string;
  readonly backend?: string;
  readonly operation?: string;
  readonly cause?: unknown;
}> {}

/**
 * Error that occurs during connection
 */
export class ConnectionError extends Data.TaggedError('ConnectionError')<{
  readonly message: string;
  readonly endpoint?: string;
  readonly retryable?: boolean;
  readonly cause?: unknown;
}> {}

/**
 * Error that occurs during JSON operations
 */
export class JSONError extends Data.TaggedError('JSONError')<{
  readonly message: string;
  readonly operation?: 'parse' | 'stringify';
  readonly data?: unknown;
  readonly cause?: unknown;
}> {}

// ============= Type Exports =============

/**
 * Union type of all service-specific errors
 */
export type ServiceError =
  | ConfigError
  | StateError
  | VariableNotFoundError
  | ExecutionError
  | RegistrationError
  | ToolNotFoundError
  | ValidationError
  | SerializationError
  | CompressionError
  | KeyValidationError
  | PersistenceError
  | EncryptionError
  | IRCompilationError
  | IRExecutionError
  | SuspensionError
  | BackendError
  | ConnectionError
  | JSONError;

// ============= Type Guards =============

/**
 * Type guard for ConfigError
 */
export const isConfigError = (error: unknown): error is ConfigError => {
  return (
    typeof error === 'object' &&
    error !== null &&
    '_tag' in error &&
    (error as any)._tag === 'ConfigError'
  );
};

/**
 * Type guard for StateError
 */
export const isStateError = (error: unknown): error is StateError => {
  return (
    typeof error === 'object' &&
    error !== null &&
    '_tag' in error &&
    (error as any)._tag === 'StateError'
  );
};

/**
 * Type guard for VariableNotFoundError
 */
export const isVariableNotFoundError = (error: unknown): error is VariableNotFoundError => {
  return (
    typeof error === 'object' &&
    error !== null &&
    '_tag' in error &&
    (error as any)._tag === 'VariableNotFoundError'
  );
};

/**
 * Type guard for ExecutionError
 */
export const isExecutionError = (error: unknown): error is ExecutionError => {
  return (
    typeof error === 'object' &&
    error !== null &&
    '_tag' in error &&
    (error as any)._tag === 'ExecutionError'
  );
};

/**
 * Type guard for RegistrationError
 */
export const isRegistrationError = (error: unknown): error is RegistrationError => {
  return (
    typeof error === 'object' &&
    error !== null &&
    '_tag' in error &&
    (error as any)._tag === 'RegistrationError'
  );
};

/**
 * Type guard for ToolNotFoundError
 */
export const isToolNotFoundError = (error: unknown): error is ToolNotFoundError => {
  return (
    typeof error === 'object' &&
    error !== null &&
    '_tag' in error &&
    (error as any)._tag === 'ToolNotFoundError'
  );
};

/**
 * Type guard for ValidationError
 */
export const isValidationError = (error: unknown): error is ValidationError => {
  return (
    typeof error === 'object' &&
    error !== null &&
    '_tag' in error &&
    (error as any)._tag === 'ValidationError'
  );
};

/**
 * Type guard for SerializationError
 */
export const isSerializationError = (error: unknown): error is SerializationError => {
  return (
    typeof error === 'object' &&
    error !== null &&
    '_tag' in error &&
    (error as any)._tag === 'SerializationError'
  );
};

/**
 * Type guard for PersistenceError
 */
export const isPersistenceError = (error: unknown): error is PersistenceError => {
  return (
    typeof error === 'object' &&
    error !== null &&
    '_tag' in error &&
    (error as any)._tag === 'PersistenceError'
  );
};

/**
 * Type guard for EncryptionError
 */
export const isEncryptionError = (error: unknown): error is EncryptionError => {
  return (
    typeof error === 'object' &&
    error !== null &&
    '_tag' in error &&
    (error as any)._tag === 'EncryptionError'
  );
};

/**
 * Type guard for any service error
 */
export const isServiceError = (error: unknown): error is ServiceError => {
  return (
    isConfigError(error) ||
    isStateError(error) ||
    isVariableNotFoundError(error) ||
    isExecutionError(error) ||
    isRegistrationError(error) ||
    isToolNotFoundError(error) ||
    isValidationError(error) ||
    isSerializationError(error) ||
    isPersistenceError(error) ||
    isEncryptionError(error)
  );
};

// ============= Error Factory Functions =============

/**
 * Create a StateError
 */
export const createStateError = (
  message: string,
  operation?: string,
  variable?: string,
  cause?: unknown
) => new StateError({ message, operation, variable, cause });

/**
 * Create a VariableNotFoundError
 */
export const createVariableNotFoundError = (
  name: string,
  scope?: number
) => new VariableNotFoundError({ name, scope });

/**
 * Create a ToolNotFoundError
 */
export const createToolNotFoundError = (
  toolId: string,
  operation?: string
) => new ToolNotFoundError({ toolId, operation });

/**
 * Create a CompressionError
 */
export const createCompressionError = (
  message: string,
  operation?: string,
  format?: string,
  cause?: unknown
) => new CompressionError({ message, operation, format, cause });

/**
 * Create a KeyValidationError
 */
export const createKeyValidationError = (
  message: string,
  key?: string,
  format?: string,
  cause?: unknown
) => new KeyValidationError({ message, key, format, cause });

/**
 * Create an IRCompilationError
 */
export const createIRCompilationError = (
  message: string,
  node?: string,
  phase?: string,
  cause?: unknown
) => new IRCompilationError({ message, node, phase, cause });

/**
 * Create an IRExecutionError
 */
export const createIRExecutionError = (
  message: string,
  nodeId?: string,
  nodeType?: string,
  cause?: unknown
) => new IRExecutionError({ message, nodeId, nodeType, cause });

/**
 * Create a SuspensionError
 */
export const createSuspensionError = (
  message: string,
  flowId?: string,
  key?: string,
  cause?: unknown
) => new SuspensionError({ message, flowId, key, cause });

/**
 * Create a BackendError
 */
export const createBackendError = (
  message: string,
  backend?: string,
  operation?: string,
  cause?: unknown
) => new BackendError({ message, backend, operation, cause });

/**
 * Create a ConnectionError
 */
export const createConnectionError = (
  message: string,
  endpoint?: string,
  retryable?: boolean,
  cause?: unknown
) => new ConnectionError({ message, endpoint, retryable, cause });

/**
 * Create a JSONError
 */
export const createJSONError = (
  message: string,
  operation?: 'parse' | 'stringify',
  data?: unknown,
  cause?: unknown
) => new JSONError({ message, operation, data, cause });
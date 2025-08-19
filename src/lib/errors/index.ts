/**
 * Error hierarchy for DynamicFlow using Effect's Data.TaggedError
 * This replaces all try/catch blocks with structured Effect errors
 */

import { Data } from 'effect';

// Base error class
export class DynamicFlowError extends Data.TaggedError('DynamicFlowError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

// Configuration errors
export class ConfigError extends Data.TaggedError('ConfigError')<{
  readonly message: string;
  readonly key?: string;
  readonly cause?: unknown;
}> {}

// Persistence errors
export class PersistenceError extends Data.TaggedError('PersistenceError')<{
  readonly message: string;
  readonly operation: 'suspend' | 'resume' | 'delete' | 'list';
  readonly key?: string;
  readonly cause?: unknown;
}> {}

// Storage backend errors
export class StorageError extends Data.TaggedError('StorageError')<{
  readonly message: string;
  readonly backend: string;
  readonly operation: string;
  readonly cause?: unknown;
}> {}

// Execution errors
export class ExecutionError extends Data.TaggedError('ExecutionError')<{
  readonly message: string;
  readonly node?: string;
  readonly phase?: 'compilation' | 'validation' | 'execution';
  readonly cause?: unknown;
}> {}

// Flow errors
export class FlowError extends Data.TaggedError('FlowError')<{
  readonly message: string;
  readonly flowId?: string;
  readonly operation?: string;
  readonly cause?: unknown;
}> {}

// Encryption errors
export class EncryptionError extends Data.TaggedError('EncryptionError')<{
  readonly message: string;
  readonly operation: 'encrypt' | 'decrypt' | 'rotate';
  readonly cause?: unknown;
}> {}

// Serialization errors
export class SerializationError extends Data.TaggedError('SerializationError')<{
  readonly message: string;
  readonly operation: 'serialize' | 'deserialize';
  readonly format?: string;
  readonly cause?: unknown;
}> {}

// Key generation errors
export class KeyError extends Data.TaggedError('KeyError')<{
  readonly message: string;
  readonly operation?: 'generate' | 'parse';
  readonly cause?: unknown;
}> {}

// Compilation errors
export class CompilationError extends Data.TaggedError('CompilationError')<{
  readonly message: string;
  readonly source?: string;
  readonly line?: number;
  readonly cause?: unknown;
}> {}

// Validation errors
export class ValidationError extends Data.TaggedError('ValidationError')<{
  readonly message: string;
  readonly field?: string;
  readonly value?: unknown;
  readonly cause?: unknown;
}> {}

// Tool errors
export class ToolError extends Data.TaggedError('ToolError')<{
  readonly message: string;
  readonly tool?: string;
  readonly operation?: string;
  readonly cause?: unknown;
}> {}

// Operator errors
export class OperatorError extends Data.TaggedError('OperatorError')<{
  readonly message: string;
  readonly operator?: string;
  readonly operation?: string;
  readonly cause?: unknown;
}> {}

// Pool errors
export class PoolError extends Data.TaggedError('PoolError')<{
  readonly message: string;
  readonly pool?: string;
  readonly operation?: string;
  readonly cause?: unknown;
}> {}

// Cache errors
export class CacheError extends Data.TaggedError('CacheError')<{
  readonly message: string;
  readonly key?: string;
  readonly operation?: string;
  readonly cause?: unknown;
}> {}

// Registration errors
export class RegistrationError extends Data.TaggedError('RegistrationError')<{
  readonly message: string;
  readonly item?: string;
  readonly cause?: unknown;
}> {}

// Discovery errors
export class DiscoveryError extends Data.TaggedError('DiscoveryError')<{
  readonly message: string;
  readonly server?: string;
  readonly cause?: unknown;
}> {}

// Generation errors
export class GenerationError extends Data.TaggedError('GenerationError')<{
  readonly message: string;
  readonly target?: string;
  readonly cause?: unknown;
}> {}

// Recovery errors
export class RecoveryError extends Data.TaggedError('RecoveryError')<{
  readonly message: string;
  readonly strategy?: string;
  readonly attempts?: number;
  readonly cause?: unknown;
}> {}

// Stream errors
export class StreamError extends Data.TaggedError('StreamError')<{
  readonly message: string;
  readonly operation?: string;
  readonly cause?: unknown;
}> {}

// State errors
export class StateError extends Data.TaggedError('StateError')<{
  readonly message: string;
  readonly operation?: string;
  readonly cause?: unknown;
}> {}

// IR Execution errors
export class IRExecutionError extends Data.TaggedError('IRExecutionError')<{
  readonly message: string;
  readonly nodeId?: string;
  readonly nodeType?: string;
  readonly cause?: unknown;
}> {}

// IR Compilation errors
export class IRCompilationError extends Data.TaggedError('IRCompilationError')<{
  readonly message: string;
  readonly source?: string;
  readonly location?: string;
  readonly cause?: unknown;
}> {}

// Flow Execution errors
export class FlowExecutionError extends Data.TaggedError('FlowExecutionError')<{
  readonly message: string;
  readonly flowId?: string;
  readonly nodeId?: string;
  readonly cause?: unknown;
}> {}

// Flow Compilation errors
export class FlowCompilationError extends Data.TaggedError(
  'FlowCompilationError'
)<{
  readonly message: string;
  readonly flowId?: string;
  readonly source?: string;
  readonly cause?: unknown;
}> {}

// Tool Not Found error
export class ToolNotFoundError extends Data.TaggedError('ToolNotFoundError')<{
  readonly message: string;
  readonly toolId?: string;
  readonly cause?: unknown;
}> {}

// Error factory functions for common cases
export const configError = (message: string, key?: string, cause?: unknown) =>
  new ConfigError({ message, key, cause });

export const persistenceError = (
  message: string,
  operation: 'suspend' | 'resume' | 'delete' | 'list',
  key?: string,
  cause?: unknown
) => new PersistenceError({ message, operation, key, cause });

export const storageError = (
  message: string,
  backend: string,
  operation: string,
  cause?: unknown
) => new StorageError({ message, backend, operation, cause });

export const executionError = (
  message: string,
  node?: string,
  phase?: 'compilation' | 'validation' | 'execution',
  cause?: unknown
) => new ExecutionError({ message, node, phase, cause });

export const encryptionError = (
  message: string,
  operation: 'encrypt' | 'decrypt' | 'rotate',
  cause?: unknown
) => new EncryptionError({ message, operation, cause });

export const serializationError = (
  message: string,
  operation: 'serialize' | 'deserialize',
  format?: string,
  cause?: unknown
) => new SerializationError({ message, operation, format, cause });

export const validationError = (
  message: string,
  field?: string,
  value?: unknown,
  cause?: unknown
) => new ValidationError({ message, field, value, cause });

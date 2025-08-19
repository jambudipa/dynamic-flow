/**
 * Core Types - Unified Type Definitions
 *
 * This module provides the single source of truth for core types used
 * throughout the DynamicFlow system, eliminating conflicts and ensuring
 * consistency across all modules.
 */

import { Data, Schema, Either, Option, Brand } from 'effect';

// ============= Branded Types =============

/**
 * Branded type for Flow IDs to prevent mixing with other string types
 */
export type FlowId = string & Brand.Brand<'FlowId'>;
export const FlowId = Brand.nominal<FlowId>();

/**
 * Branded type for Step IDs to prevent mixing with other string types
 */
export type StepId = string & Brand.Brand<'StepId'>;
export const StepId = Brand.nominal<StepId>();

/**
 * Branded type for Session IDs to prevent mixing with other string types
 */
export type SessionId = string & Brand.Brand<'SessionId'>;
export const SessionId = Brand.nominal<SessionId>();

// ============= Execution Context =============

/**
 * Unified ExecutionContext using proper Effect data types
 */
export interface ExecutionContext {
  /** Unique identifier for the current flow */
  readonly flowId: FlowId;
  /** Unique identifier for the current step */
  readonly stepId: StepId;
  /** Session identifier for tracking execution sessions */
  readonly sessionId: SessionId;
  /** Variables available in the current execution context */
  readonly variables: ReadonlyMap<string, unknown>;
  /** Metadata for the current execution */
  readonly metadata: ReadonlyMap<string, unknown>;
  /** Parent execution context for nested flows */
  readonly parentContext: Option.Option<ExecutionContext>;
  /** Current scope information for variable resolution */
  readonly currentScope: readonly string[];
}

/**
 * Create a new ExecutionContext with proper Data structure
 */
export const ExecutionContext = Data.struct({
  flowId: FlowId(''),
  stepId: StepId(''),
  sessionId: SessionId(''),
  variables: new Map<string, unknown>(),
  metadata: new Map<string, unknown>(),
  parentContext: Option.none<ExecutionContext>(),
  currentScope: [] as readonly string[],
});

/**
 * Schema for ExecutionContext validation
 */
export const ExecutionContextSchema = Schema.Struct({
  flowId: Schema.String,
  stepId: Schema.String,
  sessionId: Schema.String,
  variables: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  metadata: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  currentScope: Schema.Array(Schema.String),
});

// ============= Source Location =============

/**
 * Source location information for debugging
 */
export interface SourceLocation {
  readonly line: Option.Option<number>;
  readonly column: Option.Option<number>;
  readonly file: Option.Option<string>;
}

export const SourceLocation = Data.struct({
  line: Option.none<number>(),
  column: Option.none<number>(),
  file: Option.none<string>(),
});

// ============= Metadata Types =============

/**
 * Component metadata with optional fields as Options
 */
export interface ComponentMetadata {
  readonly sourceLocation: Option.Option<SourceLocation>;
  readonly sourceType: Option.Option<'json' | 'typescript'>;
  readonly description: Option.Option<string>;
  readonly version: Option.Option<string>;
  readonly author: Option.Option<string>;
  readonly tags: readonly string[];
}

export const ComponentMetadata = Data.struct({
  sourceLocation: Option.none<SourceLocation>(),
  sourceType: Option.none<'json' | 'typescript'>(),
  description: Option.none<string>(),
  version: Option.none<string>(),
  author: Option.none<string>(),
  tags: [] as readonly string[],
});

// ============= Resource Requirements =============

/**
 * Resource requirements with Options for optional values
 */
export interface ResourceRequirements {
  /** Memory requirements in bytes */
  readonly memory: Option.Option<number>;
  /** CPU requirements (0-1 scale) */
  readonly cpu: Option.Option<number>;
  /** Network requirements */
  readonly network: boolean;
  /** File system access requirements */
  readonly filesystem: boolean;
  /** Custom resource requirements */
  readonly custom: ReadonlyMap<string, unknown>;
}

export const ResourceRequirements = Data.struct({
  memory: Option.none<number>(),
  cpu: Option.none<number>(),
  network: false,
  filesystem: false,
  custom: new Map<string, unknown>(),
});

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
  readonly examples: readonly {
    readonly input: TInput;
    readonly output: TOutput;
  }[];
}

export const ExecutableSchema = <TInput, TOutput>(params: {
  input: Schema.Schema<TInput>;
  output: Schema.Schema<TOutput>;
  description: string;
  examples?: readonly { readonly input: TInput; readonly output: TOutput }[];
}) =>
  Data.struct({
    input: params.input,
    output: params.output,
    description: params.description,
    examples: params.examples ?? [],
  });

// ============= Validation Types =============

/**
 * Replace custom ValidationResult with proper Effect Either types
 * Either.Right for success, Either.Left for errors
 */
export type ValidationResult<E, A> = Either.Either<E, A>;

/**
 * Create a successful validation result using Either.right
 */
export const validationSuccess = <A>(data: A): Either.Either<A, never> =>
  Either.right(data);

/**
 * Create a failed validation result using Either.left
 */
export const validationFailure = <E>(error: E): Either.Either<never, E> =>
  Either.left(error);

/**
 * Validation error type using Data.TaggedError
 */
export class ValidationError extends Data.TaggedError('ValidationError')<{
  readonly message: string;
  readonly field?: string;
  readonly details?: ReadonlyMap<string, unknown>;
}> {
  get displayMessage(): string {
    const fieldInfo = this.field ? ` in field '${this.field}'` : '';
    return `Validation failed${fieldInfo}: ${this.message}`;
  }
}

// ============= Type Guards and Utilities =============

/**
 * Type guard using Schema for runtime validation of ExecutionContext
 */
export const isExecutionContext = Schema.is(ExecutionContextSchema);

/**
 * Parse and validate ExecutionContext from unknown input
 */
export const parseExecutionContext = Schema.decodeUnknown(
  ExecutionContextSchema
);

/**
 * Type predicates for Either validation results
 */
export const isValidationSuccess = Either.isRight;
export const isValidationFailure = Either.isLeft;

/**
 * Helper to create ExecutionContext with proper branded types
 */
export const createExecutionContext = (params: {
  flowId: string;
  stepId: string;
  sessionId: string;
  variables?: ReadonlyMap<string, unknown>;
  metadata?: ReadonlyMap<string, unknown>;
  parentContext?: ExecutionContext;
  currentScope?: readonly string[];
}): ExecutionContext =>
  Data.struct({
    flowId: FlowId(params.flowId),
    stepId: StepId(params.stepId),
    sessionId: SessionId(params.sessionId),
    variables: params.variables ?? new Map(),
    metadata: params.metadata ?? new Map(),
    parentContext: params.parentContext
      ? Option.some(params.parentContext)
      : Option.none(),
    currentScope: params.currentScope ?? [],
  });

/**
 * Helper to update ExecutionContext variables immutably
 */
export const updateContextVariables = (
  ctx: ExecutionContext,
  variables: ReadonlyMap<string, unknown>
): ExecutionContext => ({
  ...ctx,
  variables: new Map([...ctx.variables, ...variables]),
});

/**
 * Helper to add metadata to ExecutionContext immutably
 */
export const addContextMetadata = (
  ctx: ExecutionContext,
  metadata: ReadonlyMap<string, unknown>
): ExecutionContext => ({
  ...ctx,
  metadata: new Map([...ctx.metadata, ...metadata]),
});

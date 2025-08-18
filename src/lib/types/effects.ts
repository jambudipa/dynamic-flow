/**
 * Effect Types - Effect-specific types and utilities
 *
 * This module provides types and utilities for working with Effect
 * in the context of Dynamic Flow operations.
 */

import { Effect, Context, Layer, pipe } from 'effect';
import type { ExecutionContext } from './core';
import type { FlowError } from './errors';

// ============= Flow Effect Types =============

/**
 * Standard Flow Effect type that represents operations in the DynamicFlow system.
 * This type maintains consistency across all flow operations.
 */
export type FlowEffect<A, E = FlowError, R = FlowContext> = Effect.Effect<
  A,
  E,
  R
>;

/**
 * Flow Context type that provides the execution environment for flow operations.
 * This is used as the requirements (R) parameter in Flow Effects.
 */
export interface FlowContext {
  /** Current execution context */
  readonly executionContext: ExecutionContext;
  /** Additional services that may be required */
  readonly services?: Record<string, unknown>;
}

/**
 * Context Tag for FlowContext - enables proper context access in Effect
 */
export const FlowContext = Context.GenericTag<FlowContext>('@effect/FlowContext');

// ============= Tool Effect Types =============

/**
 * Requirements for tool execution
 */
export interface ToolRequirements {
  /** Access to execution context */
  readonly executionContext: ExecutionContext;
  /** Optional tool-specific services */
  readonly toolServices?: Record<string, unknown>;
}

/**
 * Context Tag for ToolRequirements
 */
export const ToolRequirements = Context.GenericTag<ToolRequirements>('@effect/ToolRequirements');

/**
 * Effect type specifically for tool operations
 */
export type ToolEffect<A, E = FlowError> = Effect.Effect<
  A,
  E,
  ToolRequirements
>;

// ============= Utility Types =============

/**
 * Extract the success type from a Flow Effect
 */
export type ExtractSuccess<T> =
  T extends FlowEffect<infer A, unknown, unknown> ? A : never;

/**
 * Extract the error type from a Flow Effect
 */
export type ExtractError<T> =
  T extends FlowEffect<unknown, infer E, unknown> ? E : never;

/**
 * Extract the requirements type from a Flow Effect
 */
export type ExtractRequirements<T> =
  T extends FlowEffect<unknown, unknown, infer R> ? R : never;

// ============= Effect Constructors =============

/**
 * Create a successful Flow Effect
 */
export const flowSuccess = <A>(value: A): FlowEffect<A, never, never> => {
  return Effect.succeed(value);
};

/**
 * Create a failed Flow Effect
 */
export const flowFailure = <E extends FlowError>(
  error: E
): FlowEffect<never, E, never> => {
  return Effect.fail(error);
};

/**
 * Create a Flow Effect from a promise
 */
export const flowFromPromise = <A, E extends FlowError>(
  promise: Promise<A>,
  mapError: (error: unknown) => E
): FlowEffect<A, E, never> => {
  return Effect.tryPromise({
    try: () => promise,
    catch: mapError,
  });
};

// ============= Effect Combinators =============

/**
 * Map over the success value of a Flow Effect
 */
export const flowMap =
  <A, B>(f: (a: A) => B) =>
  <E, R>(effect: FlowEffect<A, E, R>): FlowEffect<B, E, R> => {
    return Effect.map(effect, f);
  };

/**
 * FlatMap over a Flow Effect (chain operations)
 * Fixed: Proper type composition for Effect requirements
 */
export const flowFlatMap =
  <A, B, E2, R2>(f: (a: A) => Effect.Effect<B, E2, R2>) =>
  <E1, R1>(effect: Effect.Effect<A, E1, R1>): Effect.Effect<B, E1 | E2, R1 | R2> => {
    return Effect.flatMap(effect, f) as Effect.Effect<B, E1 | E2, R1 | R2>;
  };

/**
 * Map over the error of a Flow Effect
 */
export const flowMapError =
  <E1, E2>(f: (e: E1) => E2) =>
  <A, R>(effect: FlowEffect<A, E1, R>): FlowEffect<A, E2, R> => {
    return Effect.mapError(effect, f);
  };

/**
 * Catch and recover from errors in a Flow Effect
 * Fixed: Proper type composition for Effect requirements
 */
export const flowCatchAll =
  <E1, A2, E2, R2>(f: (e: E1) => Effect.Effect<A2, E2, R2>) =>
  <A1, R1>(
    effect: Effect.Effect<A1, E1, R1>
  ): Effect.Effect<A1 | A2, E2, R1 | R2> => {
    return Effect.catchAll(effect, f) as Effect.Effect<A1 | A2, E2, R1 | R2>;
  };

// ============= Context Utilities =============

/**
 * Create a Flow Context from an ExecutionContext
 */
export const createFlowContext = (
  executionContext: ExecutionContext,
  services?: Record<string, unknown>
): FlowContext =>
  services === undefined
    ? { executionContext }
    : { executionContext, services };

/**
 * Create Tool Requirements from an ExecutionContext
 */
export const createToolRequirements = (
  executionContext: ExecutionContext,
  toolServices?: Record<string, unknown>
): ToolRequirements =>
  toolServices === undefined
    ? { executionContext }
    : { executionContext, toolServices };

/**
 * Access the ExecutionContext from within a Flow Effect
 * Fixed: Using proper Context.Tag access pattern
 */
export const accessExecutionContext = FlowContext.pipe(
  Effect.map((ctx) => ctx.executionContext)
);

/**
 * Access services from within a Flow Effect
 * Fixed: Using proper Context.Tag access pattern
 */
export const accessServices = FlowContext.pipe(
  Effect.map((ctx) => ctx.services || {})
);

/**
 * Provide FlowContext to an Effect
 */
export const provideFlowContext = <A, E>(
  effect: Effect.Effect<A, E, FlowContext>,
  context: FlowContext
): Effect.Effect<A, E> =>
  Effect.provideService(effect, FlowContext, context);

/**
 * Create a Layer that provides FlowContext
 */
export const FlowContextLive = (context: FlowContext) =>
  Layer.succeed(FlowContext, context);

// ============= Type Guards =============

/**
 * Type guard to check if an Effect is a Flow Effect
 */
export const isFlowEffect = (value: unknown): value is FlowEffect<unknown> => {
  return (
    typeof value === 'object' &&
    value !== null &&
    '_tag' in value &&
    (value as { _tag?: unknown })._tag === 'Effect'
  );
};

// ============= Legacy Compatibility =============

/**
 * @deprecated Use FlowEffect instead
 * Legacy type for backward compatibility
 */
export type DynamicFlowEffect<A, E = FlowError, R = FlowContext> = FlowEffect<
  A,
  E,
  R
>;

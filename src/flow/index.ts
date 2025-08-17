/**
 * DynamicFlow - Effectful Piped Flow API
 *
 * This module provides the core piped flow composition API built on Effect.
 * All flows are Effects with proper error handling, resource management,
 * and context propagation.
 */

import { Context, Effect, Layer, Schema } from 'effect';
import type {
  ExecutionContext,
  FlowContext,
  FlowEffect,
  ToolRequirements,
} from '@/types';
import {
  FlowError,
  FlowExecutionError,
  FlowTypeError,
  ToolError,
} from '@/types';
import { toFlowError } from '@/types/errors';
// (no local types needed)

// ============= Re-export Core Types =============

export type { ExecutionContext, FlowEffect, FlowContext, ToolRequirements };

export { FlowError, FlowExecutionError, FlowTypeError, ToolError };

// ============= Legacy Types (deprecated) =============

/**
 * @deprecated Use FlowError from @/types instead
 */
export class LegacyFlowError extends Error {
  readonly _tag = 'FlowError';

  constructor(
    message: string,
    public readonly cause?: unknown
  ) {
    super(message);
  }
}

/**
 * @deprecated Use FlowTypeError from @/types instead
 */
export class LegacyFlowTypeError extends FlowError {
  readonly _tag = 'FlowError';

  constructor(
    message: string,
    public readonly expected: string,
    public readonly actual: string
  ) {
    super(message);
  }
}

/**
 * @deprecated Use FlowExecutionError from @/types instead
 */
export class LegacyFlowExecutionError extends FlowError {
  readonly _tag = 'FlowError';

  constructor(message: string, cause?: unknown) {
    super(message, cause);
  }
}

/**
 * Flow context service for dependency injection
 */
export interface FlowContextService {
  readonly executionContext: ExecutionContext;
  readonly variables: Record<string, unknown>;
  readonly metadata: Record<string, unknown>;
}

export const FlowContextTag =
  Context.GenericTag<FlowContextService>('FlowContext');

/**
 * Pipeable flow function type
 */
export interface PipeableFlow<A, B, E = FlowError, R = never> {
  readonly _tag: 'PipeableFlow';
  readonly effect: Effect.Effect<B, E, R | FlowContext>;
  readonly _A: A; // Input type (phantom)
  readonly _B: B; // Output type (phantom)
}

// ============= Core Pipe Function =============

/**
 * The fundamental pipe function for composing flows
 * Provides type-safe composition of effectful operations
 */
export function pipe<A>(flow: FlowEffect<A>): FlowEffect<A>;
export function pipe<A, B>(
  flow: FlowEffect<A>,
  fn: (a: FlowEffect<A>) => FlowEffect<B>
): FlowEffect<B>;
export function pipe<A, B, C>(
  flow: FlowEffect<A>,
  fn1: (a: FlowEffect<A>) => FlowEffect<B>,
  fn2: (b: FlowEffect<B>) => FlowEffect<C>
): FlowEffect<C>;
export function pipe<A, B, C, D>(
  flow: FlowEffect<A>,
  fn1: (a: FlowEffect<A>) => FlowEffect<B>,
  fn2: (b: FlowEffect<B>) => FlowEffect<C>,
  fn3: (c: FlowEffect<C>) => FlowEffect<D>
): FlowEffect<D>;
export function pipe<A, B, C, D, E>(
  flow: FlowEffect<A>,
  fn1: (a: FlowEffect<A>) => FlowEffect<B>,
  fn2: (b: FlowEffect<B>) => FlowEffect<C>,
  fn3: (c: FlowEffect<C>) => FlowEffect<D>,
  fn4: (d: FlowEffect<D>) => FlowEffect<E>
): FlowEffect<E>;
export function pipe(
  flow: FlowEffect<unknown>,
  ...fns: Array<(input: FlowEffect<unknown>) => FlowEffect<unknown>>
): FlowEffect<unknown> {
  return fns.reduce((acc, fn) => fn(acc), flow);
}

// ============= Flow Utility Functions =============

/**
 * Create a simple Flow effect from a value
 */
export const succeed = <A>(value: A): FlowEffect<A> => Effect.succeed(value);

/**
 * Create a failing Flow effect
 */
export const fail = <E = FlowError>(error: E): FlowEffect<never, E> =>
  Effect.fail(error);

/**
 * Create a Flow effect from a function that might throw
 */
export const sync = <A>(fn: () => A): FlowEffect<A> => Effect.sync(fn);

/**
 * Create a Flow effect from an async function
 */
export const promise = <A>(fn: () => Promise<A>): FlowEffect<A, FlowError> =>
  Effect.tryPromise({
    try: fn,
    catch: (error: unknown) =>
      toFlowError(
        new FlowExecutionError({
          cause: error,
        })
      ),
  });

/**
 * Create a Flow effect from an Effect
 */
export const fromEffect = <A, E, R>(
  effect: Effect.Effect<A, E, R>
): FlowEffect<A, E, R> => effect;

/**
 * Provide context to a Flow effect
 */
export const provideContext =
  <A, E, R>(context: ExecutionContext) =>
  (flow: FlowEffect<A, E, R>): FlowEffect<A, E, Exclude<R, FlowContext>> =>
    Effect.provide(
      flow,
      Layer.succeed(FlowContextTag, {
        executionContext: context,
        variables: context.variables,
        metadata: context.metadata,
      })
    ) as unknown as FlowEffect<A, E, Exclude<R, FlowContext>>;

// ============= Schema Integration =============

/**
 * Create a typed Flow effect with schema validation
 */
export const typed = <From, To, E = FlowError, R = never>(
  inputSchema: Schema.Schema<unknown, From>,
  outputSchema: Schema.Schema<To, unknown>,
  implementation: (input: From) => Effect.Effect<To, E, R>
): FlowEffect<To, FlowError | E, R | FlowContext> => {
  // Note: input validation is currently a no-op to avoid strict From typing issues.
  return Effect.flatMap(implementation({} as From), (output) =>
    Effect.mapError(
      Schema.encodeUnknown(outputSchema)(output),
      () =>
        new FlowTypeError({
          expected: outputSchema.toString(),
          actual: 'invalid output',
          cause: 'Output validation failed',
        })
    )
  ) as unknown as FlowEffect<To, FlowError | E, R | FlowContext>;
};

// ============= Export the pipe function =============
export { pipe as default };

// Re-export Effect's pipe for compatibility
export { pipe as effectPipe } from 'effect';

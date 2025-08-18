/**
 * DynamicFlow - Effectful Piped Flow API
 *
 * This module provides the core piped flow composition API built on Effect.
 * All flows are Effects with proper error handling, resource management,
 * and context propagation.
 */

import { Context, Data, Effect, Layer, Schema } from 'effect';
import type {
  ExecutionContext,
  FlowContext,
  FlowEffect,
  ToolRequirements,
} from '@/lib/types';
import {
  FlowError,
  FlowExecutionError,
  FlowTypeError,
  ToolError,
} from '@/lib/types';
import { toFlowError } from '@/lib/types/errors';

// ============= Re-export Core Types =============

export type { ExecutionContext, FlowEffect, FlowContext, ToolRequirements };

export { FlowError, FlowExecutionError, FlowTypeError, ToolError };

// ============= Legacy Types (deprecated) =============

/**
 * @deprecated Use FlowError from @/types instead
 */
export class LegacyFlowError extends Data.TaggedError('LegacyFlowError')<{
  readonly message: string;
  readonly cause?: unknown;
}> {
  get displayMessage(): string {
    const cause = this.cause ? ` (caused by: ${this.cause})` : '';
    return `Legacy flow error${cause}: ${this.message}`;
  }
}

/**
 * @deprecated Use FlowTypeError from @/types instead
 */
export class LegacyFlowTypeError extends Data.TaggedError(
  'LegacyFlowTypeError'
)<{
  readonly message: string;
  readonly expected: string;
  readonly actual: string;
}> {
  get displayMessage(): string {
    return `Legacy flow type error: ${this.message} (expected: ${this.expected}, actual: ${this.actual})`;
  }
}

/**
 * @deprecated Use FlowExecutionError from @/types instead
 */
export class LegacyFlowExecutionError extends Data.TaggedError(
  'LegacyFlowExecutionError'
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {
  get displayMessage(): string {
    const cause = this.cause ? ` (caused by: ${this.cause})` : '';
    return `Legacy flow execution error${cause}: ${this.message}`;
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

// Note: Use `pipe` from `effect` in consumers for composition.

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

// No pipe exports to avoid confusion with Effect's pipe.

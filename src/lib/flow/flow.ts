/**
 * Flow – Pipeable Flow Operations Namespace
 *
 * Purpose: Functional, pipeable combinators for composing effectful flows
 * with strong typing. These are the building blocks for authoring flows in
 * TypeScript, complementary to the JSON authoring route.
 *
 * How it fits in:
 * - Authoring: Developers `pipe()` Effects with `Flow.*` combinators.
 * - Generation: Piped flows can be compiled to JSON/IR in future workflows.
 * - Execution: Piped flows can be run directly as Effects; or compiled JSON
 *   can be executed by the engine.
 */

import { Duration, Effect, Schema, Stream } from 'effect';
import type { ParseError } from 'effect/ParseResult';
import type { Tool, ToolJoin } from '@/lib/tools/types';
import type { FlowError } from '@/lib/types';
import { FlowExecutionError } from '@/lib/types';
import { toFlowError } from '@/lib/types/errors';
import { getErrorMessage } from '@/lib/types/type-utils';
import type { IR } from '@/lib/ir';
import type { ExecutionResult, FlowEvent } from '@/lib/generation/types';
import type { ValidatedFlowInstance } from '@/lib/generation';
import { structuredChoice } from '@/lib/llm/structured';

// Re-export Tools namespace
export { Tools } from './tools';

// ============= Core Flow Namespace =============

/**
 * The Flow namespace containing all pipeable flow operations for functional workflow composition.
 *
 * This namespace provides a comprehensive set of combinators that enable you to build
 * complex, type-safe workflows using functional composition patterns. All operations
 * are built on Effect and integrate seamlessly with the broader Effect ecosystem.
 *
 * @namespace Flow
 * @since 0.1.0
 */
export namespace Flow {
  /**
   * Sequential composition: run `f` after `self` succeeds.
   *
   * This is the fundamental building block for creating dependent operations
   * where each step needs the result of the previous step.
   *
   * @template A - Type of the input value
   * @template B - Type of the output value
   * @template E2 - Error type that `f` can produce
   * @template R2 - Environment/context that `f` requires
   *
   * @param f - Function that takes the success value and returns a new Effect
   * @returns A function that transforms an Effect<A> into an Effect<B>
   *
   * @example
   * ```typescript
   * const flow = pipe(
   *   Effect.succeed("user123"),
   *   Flow.andThen(userId => fetchUser(userId)),
   *   Flow.andThen(user => validateUser(user)),
   *   Flow.andThen(validUser => createAccount(validUser))
   * )
   * ```
   *
   * @since 0.1.0
   */
  export const andThen =
    <A, B, E2 = never, R2 = never>(
      f: (a: A) => Effect.Effect<B, E2, R2>,
      stepName?: string | undefined
    ) =>
    <E1, R1>(
      self: Effect.Effect<A, E1, R1>
    ): Effect.Effect<B, E1 | E2, R1 | R2> => {
      // Add metadata for streaming if provided
      const effect = Effect.flatMap(self, f);
      if (stepName) {
        // Tag the effect with step metadata for streaming
        return Effect.tap(effect, () =>
          Effect.annotateCurrentSpan('flow.step', stepName)
        );
      }
      return effect;
    };

  /** Parallel execution: run multiple Effects concurrently with optional concurrency. */
  export const parallel = <
    T extends Record<string, Effect.Effect<any, any, any>>,
  >(
    flows: T,
    options?: {
      concurrency?: number | 'inherit' | 'unbounded';
    }
  ): Effect.Effect<
    {
      [K in keyof T]: T[K] extends Effect.Effect<infer A, any, any> ? A : never;
    },
    T[keyof T] extends Effect.Effect<any, infer E, any> ? E : never,
    T[keyof T] extends Effect.Effect<any, any, infer R> ? R : never
  > => {
    return Effect.all(flows, {
      concurrency: options?.concurrency,
    }) as unknown as Effect.Effect<
      {
        [K in keyof T]: T[K] extends Effect.Effect<infer A, any, any>
          ? A
          : never;
      },
      T[keyof T] extends Effect.Effect<any, infer E, any> ? E : never,
      T[keyof T] extends Effect.Effect<any, any, infer R> ? R : never
    >;
  };

  /** Conditional execution: choose `onTrue` or `onFalse` based on predicate. */
  export const doIf =
    <A, B, E1 = never, R1 = never, E2 = never, R2 = never>(
      predicate: (a: A) => boolean,
      options: {
        onTrue: (a: A) => Effect.Effect<B, E1, R1>;
        onFalse: (a: A) => Effect.Effect<B, E2, R2>;
      }
    ) =>
    <E, R>(
      self: Effect.Effect<A, E, R>
    ): Effect.Effect<B, E | E1 | E2, R | R1 | R2> => {
      return Effect.flatMap(self, (a) =>
        predicate(a)
          ? (options.onTrue(a) as Effect.Effect<B, E1 | E2, R1 | R2>)
          : (options.onFalse(a) as Effect.Effect<B, E1 | E2, R1 | R2>)
      );
    };

  /** Timeout a flow operation, mapping provider-specific timeouts to a tag. */
  export const timeout =
    (duration: Duration.Duration) =>
    <A, E, R>(
      self: Effect.Effect<A, E, R>
    ): Effect.Effect<A, E | 'TimeoutError', R> => {
      return Effect.timeout(self, duration).pipe(
        Effect.mapError((error: any) =>
          error?._tag === 'TimeoutException'
            ? ('TimeoutError' as const)
            : (error as E)
        )
      );
    };

  /** Retry a flow with simple backoff strategy. */
  export const retry =
    (options: {
      times: number;
      delay?: Duration.Duration | undefined;
      backoff?: 'exponential' | 'linear' | 'fixed';
    }) =>
    <A, E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> => {
      const run = (remaining: number): Effect.Effect<A, E, R> =>
        Effect.catchAll(self, (err: E) => {
          if (remaining > 0) {
            const next = run(remaining - 1);
            return options.delay
              ? Effect.zipRight(Effect.sleep(options.delay), next)
              : next;
          }
          return Effect.fail(err);
        });
      return run(options.times);
    };

  /** Map over the success value. */
  export const map =
    <A, B>(f: (a: A) => B) =>
    <E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<B, E, R> => {
      return Effect.map(self, f);
    };

  /**
   * Route to one of several flows using an LLM structured choice over provided tool descriptions.
   * - The LLM returns one of the given tool IDs (e.g. 'prep:prompt1').
   * - The selected branch is executed; all branches must return the same output type.
   * - Branches can be pipeable functions or ValidatedFlowInstance (dynamic flows).
   */
  export const switchRoute =
    <A, B>(
      prompt: string | ((a: A) => string),
      options: ReadonlyArray<Tool<any, any>>, // used only for {id,name,description}
      branches: Record<
        string,
        ((a: A) => Effect.Effect<B, any, any>) | ValidatedFlowInstance
      >,
      config?: { retries?: number | undefined }
    ) =>
    <E, R>(
      self: Effect.Effect<A, E, R>
    ): Effect.Effect<B, E | FlowError, R> => {
      return Effect.flatMap(self, (input) =>
        Effect.gen(function* () {
          const userPrompt =
            typeof prompt === 'function' ? prompt(input) : prompt;

          const choice = yield* structuredChoice(
            userPrompt,
            options.map((t) => ({
              id: t.id,
              name: t.name,
              description: t.description,
            })),
            { retries: config?.retries || 2 }
          ).pipe(
            Effect.mapError((e) =>
              toFlowError(
                new FlowExecutionError({
                  cause: `Switch routing failed: ${getErrorMessage(e)}`,
                })
              )
            )
          );

          const branch = branches[choice.choice];
          if (!branch) {
            return yield* Effect.fail(
              toFlowError(
                new FlowExecutionError({
                  executionContext: { selectedBranch: choice.choice },
                  cause: `Switch selected unknown branch '${choice.choice}'.`,
                })
              )
            );
          }

          if (typeof branch === 'function') {
            return yield* branch(input);
          }

          // ValidatedFlowInstance branch (dynamic flow)
          const result = yield* branch.runCollect().pipe(
            Effect.mapError((e) =>
              toFlowError(
                new FlowExecutionError({
                  cause: `Dynamic branch execution failed: ${getErrorMessage(e)}`,
                })
              )
            )
          );
          return result.output as B;
        })
      );
    };

  /**
   * Helper: wrap a ValidatedFlowInstance as a branch function for switchRoute.
   * Passes the prior step output as the dynamic flow input, returning its collected output.
   */
  export const branchFromInstance =
    <A = unknown, B = unknown>(instance: ValidatedFlowInstance) =>
    (input: A): Effect.Effect<B, FlowError> => {
      return instance.runCollect(input).pipe(
        Effect.map((res) => res.output as B),
        Effect.mapError((e) =>
          toFlowError(
            new FlowExecutionError({
              cause: getErrorMessage(e),
            })
          )
        )
      );
    };

  /**
   * Join (transform) the output of the current flow into the input shape expected by the next step.
   * Accepts either a Schema.transform or a ToolJoin definition.
   *
   * Example:
   * pipe(
   *   Effect.succeed({ title: "Item-1" }),
   *   Flow.join(Schema.transform(Schema.Struct({ title: Schema.String }), Schema.Struct({ text: Schema.String }), {
   *     strict: true,
   *     decode: (a) => ({ text: a.title }),
   *     encode: (b) => ({ title: b.text })
   *   })),
   *   Flow.andThen(runTextTool)
   * )
   */
  export const join =
    <From, To, R2 = never>(
      transformOrJoin: Schema.Schema<To, From, R2> | ToolJoin<From, To, R2>
    ) =>
    <E, R1>(
      self: Effect.Effect<From, E, R1>
    ): Effect.Effect<To, E | ParseError, R1 | R2> => {
      const schema = (transformOrJoin as any).transform
        ? (transformOrJoin as ToolJoin<From, To, R2>).transform
        : (transformOrJoin as Schema.Schema<To, From, R2>);
      // Decode From -> To using the transform schema
      return Effect.flatMap(self, (value) =>
        Schema.decodeUnknown(schema)(value)
      ) as unknown as Effect.Effect<To, E | ParseError, R1 | R2>;
    };

  /** Filter values by predicate, failing with `FlowExecutionError` by default. */
  export const filter =
    <A>(
      predicate: (a: A) => boolean,
      options?: { error?: FlowError | undefined }
    ) =>
    <E, R>(
      self: Effect.Effect<A, E, R>
    ): Effect.Effect<A, E | FlowError, R> => {
      return Effect.filterOrFail(
        self,
        predicate,
        () =>
          options?.error ||
          toFlowError(
            new FlowExecutionError({
              cause: 'Filter predicate failed',
            })
          )
      );
    };

  /** Catch and handle all errors with a recovery function. */
  export const catchAll =
    <E, A2, E2 = never, R2 = never>(
      f: (error: E) => Effect.Effect<A2, E2, R2>
    ) =>
    <A, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A | A2, E2, R | R2> => {
      return Effect.catchAll(self, f);
    };

  /** Catch only specific tagged errors. */
  export const catchTag =
    <
      E extends { _tag: string },
      K extends E['_tag'],
      A2,
      E2 = never,
      R2 = never,
    >(
      tag: K,
      f: (error: Extract<E, { _tag: K }>) => Effect.Effect<A2, E2, R2>
    ) =>
    <A, R>(
      self: Effect.Effect<A, E, R>
    ): Effect.Effect<A | A2, Exclude<E, { _tag: K }> | E2, R | R2> => {
      return Effect.catchTag(
        self as Effect.Effect<A, any, R>,
        tag as any,
        f as any
      ) as any;
    };

  /** For-each over an array of items, mapping each via `f`. */
  export const forEach =
    <A, B, E2 = never, R2 = never>(
      f: (a: A, index: number) => Effect.Effect<B, E2, R2>,
      options?: { concurrency?: number | 'inherit' | 'unbounded' }
    ) =>
    <E, R>(
      self: Effect.Effect<ReadonlyArray<A>, E, R>
    ): Effect.Effect<ReadonlyArray<B>, E | E2, R | R2> => {
      return Effect.flatMap(self, (items) =>
        Effect.all(
          items.map((item, index) => f(item, index)),
          { concurrency: options?.concurrency }
        )
      );
    };

  /** Tap side effects without changing the value. */
  export const tap =
    <A, E2 = never, R2 = never>(f: (a: A) => Effect.Effect<unknown, E2, R2>) =>
    <E, R>(self: Effect.Effect<A, E, R>): Effect.Effect<A, E | E2, R | R2> => {
      return Effect.tap(self, f);
    };

  /** Helpers: succeed, fail, sync, promise. */
  export const succeed = <A>(value: A): Effect.Effect<A, never, never> => {
    return Effect.succeed(value);
  };

  /**
   * Create a failing flow
   */
  export const fail = <E>(error: E): Effect.Effect<never, E, never> => {
    return Effect.fail(error);
  };

  /**
   * Create a flow from a function that might throw
   */
  export const sync = <A>(f: () => A): Effect.Effect<A, unknown, never> => {
    return Effect.sync(f);
  };

  /**
   * Create a flow from a Promise
   */
  export const promise = <A>(
    f: () => Promise<A>
  ): Effect.Effect<A, unknown, never> => {
    return Effect.promise(f);
  };

  /** Runners: run (resolve success), runExit (resolve success/failure). */
  export const run = <A, E, R = never>(
    flow: Effect.Effect<A, E, R>
  ): Promise<A> => {
    // Cast away R to avoid requiring callers to provide an environment
    return Effect.runPromise(flow as unknown as Effect.Effect<A, E, never>);
  };

  /**
   * Run a flow and handle both success and error
   */
  export const runExit = <A, E, R = never>(
    flow: Effect.Effect<A, E, R>
  ): Promise<{ _tag: 'Success'; value: A } | { _tag: 'Failure'; error: E }> => {
    return Effect.runPromiseExit(
      flow as unknown as Effect.Effect<A, E, never>
    ) as any;
  };

  // ======== Compilation to IR and unified runners ========

  export interface CompileOptions {
    name?: string | undefined;
    joins?: ToolJoin<unknown | undefined, unknown>[] | undefined;
  }

  export const compile = async <A, E, R = never>(
    program: Effect.Effect<A, E, R>,
    options?: CompileOptions
  ): Promise<IR> => {
    // TODO: Implement using operator-based compilation
    throw new Error(
      'Static flow compilation not yet implemented - use operators instead'
    );
  };

  export const runStream = <A, E, R = never>(
    program: Effect.Effect<A, E, R>,
    options?: CompileOptions
  ): Stream.Stream<FlowEvent, FlowError | E> => {
    // For static flows, we can't easily extract intermediate steps since Effects are opaque
    // So we emit start, the final value, and complete events
    return Stream.make({
      type: 'flow-start',
      timestamp: Date.now(),
    } as FlowEvent).pipe(
      Stream.concat(
        Stream.fromEffect(
          Effect.gen(function* () {
            const result = yield* program as Effect.Effect<A, E, never>;
            return {
              type: 'flow-complete',
              timestamp: Date.now(),
              result,
            } as FlowEvent;
          })
        )
      )
    ) as Stream.Stream<FlowEvent, FlowError | E>;
  };

  export const runCollectCompiled = <A, E, R = never>(
    program: Effect.Effect<A, E, R>,
    options?: CompileOptions
  ): Effect.Effect<ExecutionResult, FlowError | E, R> => {
    // For static flows, run the effect and wrap in ExecutionResult format
    return Effect.gen(function* () {
      const startTime = Date.now();
      const result = yield* program;
      const endTime = Date.now();

      return {
        output: result,
        metadata: {
          duration: Duration.millis(endTime - startTime),
          toolsExecuted: [],
        },
        // Also include state for compatibility
        state: {
          variables: new Map(),
          metadata: {
            startTime,
            endTime,
            duration: endTime - startTime,
          },
        },
        events: [
          { type: 'flow-start', timestamp: startTime } as FlowEvent,
          { type: 'flow-complete', timestamp: endTime, result } as FlowEvent,
        ],
      } as any as ExecutionResult;
    });
  };

  /** Convenience alias for `runCollectCompiled` for naming parity. */
  export const runCollect = runCollectCompiled;
}

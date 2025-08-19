/**
 * Test utilities for Effect-based tests
 */

import { Effect, Exit, Option, Runtime } from 'effect';

/**
 * Run an Effect and return its successful value
 */
export async function runTest<A, E = any, R = any>(
  effect: Effect.Effect<A, E, R>
): Promise<A> {
  const result = await Effect.runPromise(effect as Effect.Effect<A, E, never>);
  return result;
}

/**
 * Run an Effect and return its Exit
 */
export async function runTestExit<A, E, R = any>(
  effect: Effect.Effect<A, E, R>
): Promise<Exit.Exit<A, E>> {
  const result = await Effect.runPromiseExit(
    effect as Effect.Effect<A, E, never>
  );
  return result;
}

/**
 * Test helper for successful Effects
 */
export function testEffect<A>(value: A): Effect.Effect<A, never, never> {
  return Effect.succeed(value);
}

/**
 * Test helper for failed Effects
 */
export function testEffectError<E>(error: E): Effect.Effect<never, E, never> {
  return Effect.fail(error);
}

/**
 * Test helper for Option values
 */
export function testOption<A>(value: A | undefined): Option.Option<A> {
  return value === undefined ? Option.none() : Option.some(value);
}

/**
 * Run an Effect with a test runtime
 */
export async function runWithRuntime<A, E, R>(
  effect: Effect.Effect<A, E, R>,
  layer: any
): Promise<Exit.Exit<A, E>> {
  const providedEffect = Effect.provide(effect, layer);
  return Effect.runPromiseExit(
    providedEffect as Effect.Effect<A, E, never>
  ) as Promise<Exit.Exit<A, E>>;
}

/**
 * Extract error from Exit
 */
export function getExitError<E>(exit: Exit.Exit<any, E>): E | undefined {
  if (Exit.isFailure(exit)) {
    const cause = exit.cause;
    // Handle different types of causes
    if ('_tag' in cause) {
      switch (cause._tag) {
        case 'Fail':
          return (cause as any).error;
        case 'Die':
          return (cause as any).defect;
        default:
          return undefined;
      }
    }
  }
  return undefined;
}

/**
 * Extract value from Exit
 */
export function getExitValue<A>(exit: Exit.Exit<A, any>): A | undefined {
  if (Exit.isSuccess(exit)) {
    return exit.value;
  }
  return undefined;
}

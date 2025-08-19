/**
 * Effect testing utilities
 * 
 * Provides helpers for testing Effect-based code in Dynamic Flow
 */

import { Effect, Exit, Runtime, Layer, pipe } from 'effect'
import type { Cause } from 'effect/Cause'

/**
 * Run an Effect and return the successful value or throw the error
 */
export const runTest = async <A>(effect: Effect.Effect<A, any, any>): Promise<A> => {
  const result = await Effect.runPromiseExit(effect)
  
  if (Exit.isFailure(result)) {
    throw new Error(`Effect failed: ${JSON.stringify(result.cause)}`)
  }
  
  return result.value
}

/**
 * Run an Effect and return the Exit result for inspection
 */
export const runTestExit = async <E, A>(
  effect: Effect.Effect<A, E, any>
): Promise<Exit.Exit<A, E>> => {
  return Effect.runPromiseExit(effect)
}

/**
 * Test an Effect with custom assertions
 */
export const testEffect = async <R, E, A>(
  effect: Effect.Effect<A, E, R>,
  assertions: (result: A) => void | Promise<void>,
  layer?: Layer.Layer<R, any, any>
): Promise<void> => {
  const program = layer 
    ? pipe(effect, Effect.provide(layer))
    : effect
    
  const result = await runTest(program)
  await assertions(result)
}

/**
 * Test that an Effect fails with a specific error
 */
export const testEffectError = async <R, E, A>(
  effect: Effect.Effect<A, E, R>,
  errorAssertion: (error: E) => void | Promise<void>,
  layer?: Layer.Layer<R, any, any>
): Promise<void> => {
  const program = layer 
    ? pipe(effect, Effect.provide(layer))
    : effect
    
  const exit = await runTestExit(program)
  
  if (Exit.isSuccess(exit)) {
    throw new Error('Expected Effect to fail but it succeeded')
  }
  
  const error = pipe(
    exit.cause,
    Cause.failureOption,
    (option) => {
      if (option._tag === 'None') {
        throw new Error('Expected failure cause but got none')
      }
      return option.value
    }
  )
  
  await errorAssertion(error)
}

/**
 * Create a test runtime with mock services
 */
export const createTestRuntime = <R>(layer: Layer.Layer<R, any, any>) => {
  return Runtime.defaultRuntime.pipe(
    Runtime.provideLayer(layer)
  )
}

/**
 * Helper to run multiple Effects in sequence and collect results
 */
export const runSequence = async <A>(
  effects: Array<Effect.Effect<A, any, any>>
): Promise<A[]> => {
  const results: A[] = []
  
  for (const effect of effects) {
    const result = await runTest(effect)
    results.push(result)
  }
  
  return results
}

/**
 * Helper to run Effects in parallel and collect results
 */
export const runParallel = async <A>(
  effects: Array<Effect.Effect<A, any, any>>
): Promise<A[]> => {
  return runTest(Effect.all(effects))
}

/**
 * Test helper for timeout scenarios
 */
export const withTimeout = <R, E, A>(
  effect: Effect.Effect<A, E, R>,
  millis: number
): Effect.Effect<A, E | Error, R> => {
  return pipe(
    effect,
    Effect.timeout(millis),
    Effect.flatMap((option) =>
      option._tag === 'None'
        ? Effect.fail(new Error(`Timeout after ${millis}ms`))
        : Effect.succeed(option.value)
    )
  )
}

/**
 * Mock layer for testing
 */
export const createMockLayer = <T>(service: T, tag: any): Layer.Layer<any, never, never> => {
  return Layer.succeed(tag, service)
}
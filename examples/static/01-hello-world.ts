/**
 * Example: Hello World with Dynamic Flow
 *
 * The simplest possible flow - demonstrates basic pipeable syntax
 * and sequential operations using the current Dynamic Flow API.
 *
 * Run: npx tsx examples/static/01-hello-world.ts
 */

import { Duration, Effect, Flow, pipe } from '../../src/index';
import { Stream } from 'effect';

// Create a simple flow that transforms a greeting
const helloFlow = pipe(
  // Start with a simple value
  Effect.succeed('Hello'),

  // Transform it using Flow.andThen
  Flow.andThen(greeting => Effect.succeed(`${greeting}, World!`)),

  // Apply another transformation
  Flow.map(message => message.toUpperCase()),

  // Add a side effect (logging) without changing the value
  Flow.tap(message => Effect.sync(() => {
    console.log('Intermediate value:', message);
  })),

  // Final transformation
  Flow.map(message => `✨ ${message} ✨`)
);

/**
 * Main example function that can be called programmatically
 */
export const runExample = async () => {
  console.log('🚀 Starting Hello World example...');
  console.log('📝 This demonstrates basic Flow operations: succeed, andThen, map, tap');

  // Non-streaming: collect the final result
  console.log('\n— Non-streaming (collect) —');
  const collected = await Effect.runPromise(
    Flow.runCollect(helloFlow)
  );
  console.log('Final result:', collected.output);
  console.log('Execution time:', Duration.toMillis(collected.metadata.duration), 'ms');

  // Streaming: get events as the flow executes
  console.log('\n— Streaming (events) —');
  await Stream.runForEach(
    Flow.runStream(helloFlow),
    (event) => Effect.sync(() => {
      if (event.type === 'flow-start') {
        console.log('• flow-start');
      } else if (event.type === 'flow-complete') {
        console.log('• flow-complete →', (event as any).result);
      } else {
        console.log(`• ${event.type}`);
      }
    })
  ).pipe(Effect.runPromise);

  console.log('\n✅ Example completed successfully');

  return collected.output;
};

// Run example if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runExample().catch(error => {
    console.error('❌ Hello World example failed:', error);
    process.exit(1);
  });
}

/**
 * Expected Output:
 * ===============
 *
 * 🚀 Starting Hello World example...
 * 📝 This demonstrates basic Flow operations: succeed, andThen, map, tap
 *
 * — Non-streaming (collect) —
 * Intermediate value: HELLO, WORLD!
 * Final result: ✨ HELLO, WORLD! ✨
 * Execution time: 0 ms
 *
 * — Streaming (events) —
 * • flow-start
 * Intermediate value: HELLO, WORLD!
 * • flow-complete → ✨ HELLO, WORLD! ✨
 *
 * ✅ Example completed successfully
 */

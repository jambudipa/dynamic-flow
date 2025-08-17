/**
 * Example: Sequential Operations
 *
 * Demonstrates chaining multiple operations sequentially using
 * Flow.andThen. Each step depends on the result of the previous step.
 *
 * Run: npx tsx examples/static/02-sequential.ts
 */

import { Duration, Effect, Flow, pipe } from '../../src/index';
import { Stream } from 'effect';

// Mock data fetching functions
const fetchUser = (id: number) => Effect.succeed({
  id,
  name: 'Alice Johnson',
  departmentId: 42
});

const fetchDepartment = (id: number) => Effect.succeed({
  id,
  name: 'Engineering',
  managerId: 7
});

const fetchManager = (id: number) => Effect.succeed({
  id,
  name: 'Bob Smith',
  title: 'Engineering Director'
});

// Create a sequential flow that fetches related data
const userInfoFlow = pipe(
  // Start with a user ID
  Effect.succeed(1),

  // Fetch the user
  Flow.andThen(userId => {
    console.log(`📝 Fetching user ${userId}...`);
    return fetchUser(userId);
  }),

  // Use user data to fetch department
  Flow.andThen(user => {
    console.log(`📝 Fetching department ${user.departmentId} for ${user.name}...`);
    return pipe(
      fetchDepartment(user.departmentId),
      Flow.map(dept => ({ user, department: dept }))
    );
  }),

  // Use department data to fetch manager
  Flow.andThen(({ user, department }) => {
    console.log(`📝 Fetching manager ${department.managerId} for ${department.name}...`);
    return pipe(
      fetchManager(department.managerId),
      Flow.map(manager => ({ user, department, manager }))
    );
  }),

  // Format the final result
  Flow.map(({ user, department, manager }) => ({
    summary: `${user.name} works in ${department.name} under ${manager.name} (${manager.title})`
  }))
);

/**
 * Main example function that can be called programmatically
 */
export const runExample = async () => {
  console.log('🚀 Starting Sequential Operations example...');
  console.log('📝 This demonstrates chaining dependent operations with Flow.andThen');

  // Non-streaming: collect the final result
  console.log('\n— Non-streaming (collect) —\n');
  const collected = await Effect.runPromise(
    Flow.runCollect(userInfoFlow)
  );
  console.log('📊 Result:', (collected.output as any).summary);
  console.log('⏱️  Execution time:', Duration.toMillis(collected.metadata.duration), 'ms');

  // Streaming: get events as the flow executes
  console.log('\n— Streaming (events) —');
  await Stream.runForEach(
    Flow.runStream(userInfoFlow),
    (event) => Effect.sync(() => {
      if (event.type === 'flow-start') {
        console.log('• flow-start');
      } else if (event.type === 'flow-complete') {
        const result = (event as any).result;
        console.log('• flow-complete →', result.summary);
      }
    })
  ).pipe(Effect.runPromise);

  console.log('\n✅ Completed both modes successfully');

  return collected.output;
};

// Run example if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runExample().catch(error => {
    console.error('❌ Sequential Operations example failed:', error);
    process.exit(1);
  });
}

/**
 * Expected Output:
 * ===============
 *
 * 🚀 Starting Sequential Operations example...
 * 📝 This demonstrates chaining dependent operations with Flow.andThen
 *
 * — Non-streaming (collect) —
 *
 * 📝 Fetching user 1...
 * 📝 Fetching department 42 for Alice Johnson...
 * 📝 Fetching manager 7 for Engineering...
 * 📊 Result: Alice Johnson works in Engineering under Bob Smith (Engineering Director)
 * ⏱️  Execution time: 0 ms
 *
 * — Streaming (events) —
 * • flow-start
 * 📝 Fetching user 1...
 * 📝 Fetching department 42 for Alice Johnson...
 * 📝 Fetching manager 7 for Engineering...
 * • flow-complete → Alice Johnson works in Engineering under Bob Smith (Engineering Director)
 *
 * ✅ Completed both modes successfully
 */

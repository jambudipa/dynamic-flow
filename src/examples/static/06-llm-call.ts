/**
 * Example: Calling OpenAI from a static flow
 *
 * Demonstrates integrating LLM completions into static Flow pipelines
 * with both collect and streaming execution modes.
 *
 * Features demonstrated:
 * - LLM tool integration with OpenAI
 * - Static flow compilation and execution
 * - Streaming token events for real-time responses
 * - Flow.runCollect vs Flow.runStream execution patterns
 * - Event-based monitoring of LLM calls
 *
 * Performance characteristics:
 * - Async execution: Non-blocking LLM API calls
 * - Token streaming: Real-time response display
 * - Event-driven: Fine-grained execution monitoring
 *
 * Expected console output:
 * ```
 * LLM response (collected): { response: "DynamicFlow is..." }
 * — Streaming events —
 * • flow-start
 * • tool-start — tool=llm:basic-ask
 * • llm-token — token="Dynamic"
 * • llm-token — token=" Flow"
 * • tool-output — response available
 * • flow-complete
 * ```
 *
 * Return value: Promise<{ response: string }>
 * Note: Requires OPENAI_API_KEY environment variable
 *
 * Run: npx tsx examples/static/06-llm-call.ts
 */

import { loadEnv } from '../env';
import { Duration, Effect, pipe, Stream } from 'effect';
import { Flow, LLMServiceLive, Tools } from '../../lib';
import { createOpenAiCompletionTool } from '../../lib/llm/providers/effect-openai-tool';

async function createLlmFlow() {
  const ask = createOpenAiCompletionTool(
    'llm:basic-ask',
    'Ask (Basic)',
    'Generates a succinct answer using OpenAI'
  );

  // Piped static flow
  const run = Tools.createTool<{ prompt: string }, { response: string }>(ask);
  const program = pipe(
    Effect.succeed({ prompt: 'In one short sentence, what is DynamicFlow?' }),
    Flow.andThen(run)
  );

  return program;
}

/**
 * Programmatic example runner for testing and integration
 */
export async function runExample(): Promise<{ response: string }> {
  console.log('=== LLM Call Example ===\n');

  loadEnv();

  try {
    const program = await createLlmFlow();

    // Provide the LLM service layer
    const programWithLLM = pipe(program, Effect.provide(LLMServiceLive));

    // Non-streaming: collect the final result
    console.log('— Non-streaming (collect) —');
    const collected = await Effect.runPromise(
      //TODO fix typing / requirements of runCollect to avoid this "as"
      Flow.runCollect(programWithLLM as Effect.Effect<any, any, never>, {
        name: 'Static LLM Call',
      })
    );
    console.log('Final result:', collected.output);
    console.log(
      'Execution time:',
      Duration.toMillis(collected.metadata.duration),
      'ms'
    );

    // Streaming: get events as they happen
    console.log('\n— Streaming (events) —');
    await Stream.runForEach(
      Flow.runStream(programWithLLM as Effect.Effect<any, any, never>, {
        name: 'Static LLM Call',
      }),
      (event) =>
        Effect.sync(() => {
          console.log(
            `• ${event.type}`,
            event.type === 'flow-complete'
              ? `result: ${JSON.stringify((event as any).result)}`
              : ''
          );
        })
    ).pipe(Effect.runPromise);

    console.log('\n✅ LLM call completed successfully!');
    return collected.output as { response: string };
  } catch (error) {
    console.error('❌ LLM call failed:', error);
    throw error;
  }
}

// Run the example when executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runExample().catch((e) => {
    console.error('Example failed:', e);
    process.exit(1);
  });
}

/**
 * Expected Output:
 * ===============
 *
 * === LLM Call Example ===
 *
 * — Non-streaming (collect) —
 * Final result: {
 *   response: "DynamicFlow is the modeling and management of time-varying flows through a system or network that adapt to changing conditions."
 * }
 * Execution time: 5024 ms
 *
 * — Streaming (events) —
 * • flow-start
 * • flow-complete result: {"response":"Dynamic flow is a time-dependent network flow that models how quantities move through a network and change over time."}
 *
 * ✅ LLM call completed successfully\!
 *
 * Note: Requires OPENAI_API_KEY environment variable
 */

/**
 * Example: Tools + LLM in one flow
 *
 * Demonstrates combining custom tools with LLM calls in a single flow pipeline,
 * showcasing data transformation and AI integration patterns.
 *
 * Features demonstrated:
 * - Custom tool creation with typed input/output schemas
 * - Tool composition in sequential flows
 * - Data transformation before LLM processing
 * - Schema validation for type safety
 * - Pipeline execution in both collect and streaming modes
 *
 * Performance characteristics:
 * - Sequential execution: Tools run in defined order
 * - Schema validation: O(1) input/output validation
 * - Streaming support: Real-time event monitoring
 *
 * Expected console output:
 * ```
 * Preparing prompt for topic: Dynamic Flow
 * Generated prompt: "In one sentence, explain: Dynamic Flow"
 * LLM Response: "Dynamic Flow refers to..."
 * — Streaming events —
 * • tool-start
 * • tool-output
 * • tool-start
 * • llm-token
 * • tool-output
 * • flow-complete
 * ```
 *
 * Return value: Promise<{ response: string }>
 * Note: Requires OPENAI_API_KEY environment variable
 *
 * Run: npx tsx examples/static/07-tools-and-llm.ts
 */

import { loadEnv } from '../env';
import { Effect, pipe, Schema, Stream } from 'effect';
import type { Tool } from '../../src/index';
import { Flow, LLMLive, Tools } from '../../src/index';
import { createOpenAiCompletionTool } from '../../src/llm/providers/effect-openai-tool';

// A small tool that formats a clean prompt for the LLM
const promptPrepTool: Tool<{ topic: string }, { prompt: string }> = {
  id: 'prep:prompt',
  name: 'Prompt Prep',
  description: 'Prepares a concise prompt from a topic',
  inputSchema: Schema.Struct({ topic: Schema.String }),
  outputSchema: Schema.Struct({ prompt: Schema.String }),
  execute: (input) => Effect.sync(() => {
    const prompt = `In one sentence, explain: ${input.topic}`;
    console.log(`Preparing prompt for topic: ${input.topic}`);
    console.log(`Generated prompt: "${prompt}"`);
    return { prompt };
  })
};

async function createToolsLlmFlow(topic: string) {
  // LLM tool
  const ask = createOpenAiCompletionTool(
    'llm:ask',
    'Ask',
    'Generates a succinct answer from a prompt'
  );

  const prep = Tools.createTool<{ topic: string }, { prompt: string }>(promptPrepTool);
  const runAsk = Tools.createTool<{ prompt: string }, { response: string }>(ask);

  const program = pipe(
    Effect.succeed({ topic }),
    Flow.andThen(prep),
    Flow.andThen(runAsk)
  );

  return program;
}

/**
 * Programmatic example runner for testing and integration
 */
export async function runExample(): Promise<{ response: string }> {
  console.log('=== Tools + LLM Example ===\n');

  loadEnv();

  try {
    const program = await createToolsLlmFlow('Dynamic Flow');

    // Provide the LLM service layer
    const programWithLLM = pipe(program, Effect.provide(LLMLive));

    // Non-streaming: collect the final result
    console.log('Executing tools + LLM pipeline...');
    const collected = await Effect.runPromise(
      Flow.runCollect(programWithLLM as Effect.Effect<any, any, never>, { name: 'Tools + LLM' })
    );
    const response = (collected.output as any)?.response ?? collected.output;
    console.log('LLM Response:', response);

    // Streaming: get events
    console.log('\n— Streaming events —');
    await Stream.runForEach(
      Flow.runStream(programWithLLM as Effect.Effect<any, any, never>, { name: 'Tools + LLM' }),
      (event) => Effect.sync(() => {
        console.log(`• ${event.type}`,
          event.type === 'flow-complete' ? `→ ${JSON.stringify((event as any).result?.response || (event as any).result)}` : ''
        );
      })
    ).pipe(Effect.runPromise);

    console.log('\n✅ Tools + LLM pipeline completed successfully!');
    return { response: response || 'Pipeline completed' };
  } catch (error) {
    console.error('❌ Tools + LLM pipeline failed:', error);
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
 * === Tools + LLM Example ===
 *
 * Executing tools + LLM pipeline...
 * Preparing prompt for topic: Dynamic Flow
 * Generated prompt: "In one sentence, explain: Dynamic Flow"
 * LLM Response: Dynamic flow is a model of network flow that accounts for time-varying quantities and travel delays, describing how flow moves through a network over time rather than instantaneously.
 *
 * — Streaming events —
 * • flow-start
 * Preparing prompt for topic: Dynamic Flow
 * Generated prompt: "In one sentence, explain: Dynamic Flow"
 * • flow-complete → "Dynamic flow is a time-varying movement of material, traffic, information, or resources through a system where the flow rates and paths change in response to time, system dynamics, or control actions."
 *
 * ✅ Tools + LLM pipeline completed successfully\!
 *
 * Note: Requires OPENAI_API_KEY environment variable
 */

/**
 * Example: Switch Routing with LLM Decision Making
 *
 * Demonstrates intelligent routing where an LLM chooses between multiple tools
 * based on context, showcasing dynamic flow decision making.
 *
 * Features demonstrated:
 * - Flow.switchRoute for intelligent branching
 * - LLM-driven tool selection
 * - Multiple preparation strategies
 * - Retry logic for robustness
 * - Context-aware routing decisions
 *
 * Performance characteristics:
 * - Adaptive routing: LLM chooses optimal path
 * - Single decision point: One LLM call for routing
 * - Fault tolerance: Retry mechanism for unreliable decisions
 *
 * Expected console output:
 * ```
 * Analysing topic for routing: "Please clarify selflessness of persons"
 * LLM selected tool: prep:prompt1
 * Executing Route1 → Please clarify selflessness of persons
 * Result: { final: 'Route1 → Please clarify selflessness of persons' }
 * ```
 *
 * Return value: Promise<{ final: string }>
 * Note: Requires OPENAI_API_KEY environment variable
 *
 * Run: npx tsx examples/static/12-switch-routing.ts
 */

import { Effect, pipe, Schema } from 'effect';
import { Flow } from '../../lib/flow/flow';
import { LLMServiceLive } from '../../lib/llm/service';
import { loadEnv } from '../env';

const tool1 = {
  id: 'prep:prompt1',
  name: 'Prompt Prep 1',
  description: 'Prepares a concise prompt from a topic',
  inputSchema: Schema.Struct({ topic: Schema.String }),
  outputSchema: Schema.Struct({ prompt: Schema.String }),
  execute: (input: { topic: string }) =>
    Effect.sync(() => {
      console.log(`Tool 1: Creating explanatory prompt for "${input.topic}"`);
      return { prompt: `In one sentence, explain: ${input.topic}` };
    }),
};

const tool2 = {
  id: 'prep:prompt2',
  name: 'Prompt Prep 2',
  description: 'Summarises a paragraph to a single question',
  inputSchema: Schema.Struct({ topic: Schema.String }),
  outputSchema: Schema.Struct({ prompt: Schema.String }),
  execute: (input: { topic: string }) =>
    Effect.sync(() => {
      console.log(`Tool 2: Creating question prompt for "${input.topic}"`);
      return { prompt: `What is the core question about: ${input.topic}?` };
    }),
};

const tool3 = {
  id: 'prep:prompt3',
  name: 'Prompt Prep 3',
  description: 'Turns a topic into a clarifying instruction',
  inputSchema: Schema.Struct({ topic: Schema.String }),
  outputSchema: Schema.Struct({ prompt: Schema.String }),
  execute: (input: { topic: string }) =>
    Effect.sync(() => {
      console.log(`Tool 3: Creating clarification prompt for "${input.topic}"`);
      return { prompt: `Clarify in plain terms: ${input.topic}` };
    }),
};

const branch1 = (topic: string) =>
  Effect.sync(() => {
    console.log(`Executing Route1 → ${topic}`);
    return { final: `Route1 → ${topic}` };
  });

const branch2 = (topic: string) =>
  Effect.sync(() => {
    console.log(`Executing Route2 → ${topic}`);
    return { final: `Route2 → ${topic}` };
  });

const branch3 = (topic: string) =>
  Effect.sync(() => {
    console.log(`Executing Route3 → ${topic}`);
    return { final: `Route3 → ${topic}` };
  });

/**
 * Programmatic example runner for testing and integration
 */
export async function runExample(): Promise<{ final: string }> {
  console.log('=== Switch Routing Example ===\n');

  loadEnv();

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required for LLM routing decisions');
  }

  try {
    const topic = 'Please clarify selflessness of persons';
    console.log(`Analysing topic for routing: "${topic}"`);

    const program = pipe(
      Flow.succeed(topic),
      Flow.switchRoute(
        (topic) => `Please choose a preparation tool for: ${topic}`,
        [tool1, tool2, tool3],
        {
          'prep:prompt1': branch1,
          'prep:prompt2': branch2,
          'prep:prompt3': branch3,
        },
        { retries: 2 }
      )
    );

    const result = await Flow.run(pipe(program, Effect.provide(LLMServiceLive)));
    console.log('Final result:', result);

    console.log('\n✅ Switch routing completed successfully!');
    return result as { final: string };
  } catch (error) {
    console.error('❌ Switch routing failed:', error);
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
 * === Switch Routing Example ===
 *
 * Analysing topic for routing: "Please clarify selflessness of persons"
 * 🤖 Using OpenAI SDK for structured output...
 * 📥 SDK response text: {"choice":"prep:prompt3","reason":"The user requests clarification of the concept 'selflessness of persons'; prep:prompt3 converts the topic into a clear instructive prompt to elicit a focused explanation."}
 * Executing Route3 → Please clarify selflessness of persons
 * Final result: { final: 'Route3 → Please clarify selflessness of persons' }
 *
 * ✅ Switch routing completed successfully!
 *
 * Note: Requires OPENAI_API_KEY environment variable
 * Note: LLM may choose different routes based on reasoning
 */

/**
 * Example: Structured LLM Output
 *
 * Demonstrates using structured output with schema validation to ensure
 * LLM responses conform to expected formats for reliable parsing.
 *
 * Features demonstrated:
 * - Schema-driven LLM response validation
 * - Structured output for decision making
 * - Type-safe response parsing
 * - Optional field handling in schemas
 * - Union types for enumerated choices
 *
 * Performance characteristics:
 * - Validated parsing: O(1) schema validation
 * - Type safety: Compile-time schema checking
 * - Reliable format: Consistent response structure
 *
 * Expected console output:
 * ```
 * Requesting structured choice from LLM...
 * TEXT: I recommend prep:prompt3 because...
 * JSON: { choice: "prep:prompt3", reason: "Best suited for clarification..." }
 * Validated choice: prep:prompt3
 * ```
 *
 * Return value: Promise<{ choice: string; reason?: string }>
 * Note: Requires OPENAI_API_KEY environment variable
 *
 * Run: npx tsx examples/static/13-structured-smoke.ts
 */

import { Effect, Schema } from 'effect';
import { LLMCoreService } from '../../src/llm/service';
import { loadEnv } from '../env';

const Choice = Schema.Struct({
  choice: Schema.Union(Schema.Literal('prep:prompt1'), Schema.Literal('prep:prompt2'), Schema.Literal('prep:prompt3')),
  reason: Schema.optional(Schema.String)
});

type ChoiceResult = typeof Choice.Type;

/**
 * Programmatic example runner for testing and integration
 */
export async function runExample(): Promise<ChoiceResult> {
  console.log('=== Structured LLM Output Example ===\n');

  loadEnv();

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required for structured LLM responses');
  }

  try {
    const prompt = 'Choose the best id for a topic about Buddhist selflessness of persons: prep:prompt1, prep:prompt2, prep:prompt3.';
    console.log('Requesting structured choice from LLM...');
    console.log(`Prompt: "${prompt}"`);

    const res = await Effect.runPromise(LLMCoreService.structured(prompt, Choice));

    console.log('\nTEXT:', res.text);
    console.log('JSON:', res.json);
    console.log(`Validated choice: ${res.json.choice}`);

    if (res.json.reason) {
      console.log(`Reason: ${res.json.reason}`);
    }

    console.log('\n✅ Structured output parsing completed successfully!');
    return res.json;
  } catch (error) {
    console.error('❌ Structured output parsing failed:', error);
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
 * === Structured LLM Output Example ===
 * 
 * Requesting structured choice from LLM...
 * Prompt: "Choose the best id for a topic about Buddhist selflessness of persons: prep:prompt1, prep:prompt2, prep:prompt3."
 * 🤖 Using OpenAI SDK for structured output...
 * 📥 SDK response text: {"choice":"prep:prompt2","reason":"Without the prompts' text, prompt2 is the best single pick as a neutral middle option; typically a second prompt is used to present the core topic (Buddhist anattā/selflessness of persons) with balanced depth between an introductory and an advanced prompt."}
 * 
 * TEXT: {"choice":"prep:prompt2","reason":"Without the prompts' text, prompt2 is the best single pick as a neutral middle option; typically a second prompt is used to present the core topic (Buddhist anattā/selflessness of persons) with balanced depth between an introductory and an advanced prompt."}
 * JSON: {
 *   choice: 'prep:prompt2',
 *   reason: "Without the prompts' text, prompt2 is the best single pick as a neutral middle option; typically a second prompt is used to present the core topic (Buddhist anattā/selflessness of persons) with balanced depth between an introductory and an advanced prompt."
 * }
 * Validated choice: prep:prompt2
 * Reason: Without the prompts' text, prompt2 is the best single pick as a neutral middle option; typically a second prompt is used to present the core topic (Buddhist anattā/selflessness of persons) with balanced depth between an introductory and an advanced prompt.
 * 
 * ✅ Structured output parsing completed successfully!
 * 
 * Note: Requires OPENAI_API_KEY environment variable
 */

/**
 * Dynamic Example 03: generate() then runCollect()
 *
 * Demonstrates the two-stage dynamic flow pattern: first generate a plan
 * from a natural language prompt, then execute it in different modes.
 *
 * Features:
 * - Separate plan generation and execution phases
 * - Plan inspection and validation before execution
 * - Both streaming and collect execution modes
 * - Simple text summarization tool demonstration
 *
 * Performance notes:
 * - Plan generation is a one-time cost (~1-2s) that can be cached
 * - Multiple execution modes from same plan reduce LLM calls
 * - Streaming mode provides real-time progress feedback
 *
 * Run: npx tsx examples/dynamic/03-generate-then-run.ts
 */

import { loadEnv } from '../env';
import { Effect, Schema, Stream } from 'effect';
import type { Tool } from '../../lib/tools/types';
import { DynamicFlow } from '../../lib/generation';
import { OpenAiEffectModel } from '../../lib/llm/service';

type SummarizeIn = { text: string };
type SummarizeOut = { summary: string };
const summarizeTool: Tool<SummarizeIn, SummarizeOut> = {
  id: 'summarize',
  name: 'Summarize',
  description: 'Summarizes input text',
  inputSchema: Schema.Struct({ text: Schema.String }),
  outputSchema: Schema.Struct({ summary: Schema.String }),
  execute: ({ text }) =>
    Effect.succeed({
      summary: text
        ? text.slice(0, 20) + '...'
        : 'No text provided to summarize',
    }),
};
const tools = [summarizeTool];

/**
 * Main example function that can be called programmatically
 */
export const runExample = async () => {
  console.log('🚀 Starting Generate-Then-Run example...');
  console.log(
    '📝 This demonstrates two-stage dynamic flow: generate plan, then execute'
  );

  try {
    loadEnv();
    const model = new OpenAiEffectModel();

    // Stage 1: Generate plan from natural language prompt
    console.log('\n— Stage 1: Plan Generation —');
    const instance = await DynamicFlow.generate({
      prompt: 'Create a simple flow that summarizes text.',
      tools,
      joins: [],
      model,
    }).pipe(Effect.runPromise);

    // Display the generated plan (Flow JSON)
    const plan = instance.getPlanJSON();
    console.log('Generated Plan:');
    console.log(JSON.stringify(plan, null, 2));

    // Stage 2a: Execute with streaming events
    console.log('\n— Stage 2a: Streaming Execution —');
    const streamingEvents: any[] = [];
    await instance.run().pipe(
      Stream.tap((evt) =>
        Effect.sync(() => {
          console.log(`• ${evt.type}`);
          streamingEvents.push(evt);
        })
      ),
      Stream.runDrain,
      Effect.runPromise
    );

    // Stage 2b: Execute with sync collect
    console.log('\n— Stage 2b: Sync Execution (collect) —');
    const result = await instance.runCollect().pipe(Effect.runPromise);
    console.log('Execution result:', result);

    console.log('\n✅ Completed generate-then-run successfully');

    return {
      generatedPlan: plan,
      streamingEvents,
      executionResult: result,
    };
  } catch (error) {
    console.error('❌ Generate-then-run example failed:', error);
    throw error;
  }
};

// Run example if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runExample().catch((error) => {
    console.error('❌ Generate-then-run example failed:', error);
    process.exit(1);
  });
}

/**
 * Expected Output:
 * ===============
 *
 * 🚀 Starting Generate-Then-Run example...
 * 📝 This demonstrates two-stage dynamic flow: generate plan, then execute
 *
 * — Stage 1: Plan Generation —
 * Generated Plan:
 * {
 *   "version": "1.0",
 *   "metadata": {
 *     "name": "Simple Text Summarization Flow",
 *     "description": "A minimal flow that summarizes input text using the Summarize tool.",
 *     "generated": true,
 *     "model": "[object Object]",
 *     "timestamp": "2025-08-17T03:25:53.715Z"
 *   },
 *   "nodes": [
 *     {
 *       "id": "s1",
 *       "type": "tool",
 *       "toolId": "summarize",
 *       "inputs": {}
 *     }
 *   ],
 *   "edges": []
 * }
 *
 * — Stage 2a: Streaming Execution —
 * • flow-start
 * • node-start
 * • tool-start
 * • tool-output
 * • node-complete
 * • flow-complete
 *
 * — Stage 2b: Sync Execution (collect) —
 * Execution result: {
 *   output: { s1: { summary: 'No text provided to summarize' } },
 *   metadata: {
 *     duration: { _id: 'Duration', _tag: 'Millis', millis: 3 },
 *     toolsExecuted: []
 *   }
 * }
 *
 * ✅ Completed generate-then-run successfully
 *
 * Note: This example demonstrates:
 * 1. Generating a flow plan using LLM (Stage 1)
 * 2. Executing the generated plan with streaming (Stage 2a)
 * 3. Executing the same plan synchronously (Stage 2b)
 * The summarize tool currently receives no text input from the LLM-generated plan.
 * Requires OPENAI_API_KEY environment variable.
 */

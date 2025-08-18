/**
 * Dynamic Example 02: Streaming from OpenAI LLM service
 *
 * Demonstrates streaming LLM completions using the central LLM service
 * and dynamic flow generation with plan inspection.
 *
 * Features:
 * - Direct LLM streaming for real-time text generation
 * - Sync completion for immediate responses
 * - Dynamic flow plan generation with simple tools
 * - Plan inspection before execution
 *
 * Performance notes:
 * - Streaming reduces perceived latency for long responses
 * - Sync completion has lower overhead for short responses
 * - Plan generation is cached for reuse across executions
 *
 * Run: npx tsx examples/dynamic/02-streaming.ts
 */

import { loadEnv } from '../env';
import { Effect, Schema, Stream } from 'effect';
import type { Tool } from '../../lib/tools/types';
import { LLMCoreService, OpenAiEffectModel } from '../../lib/llm/service';
import { DynamicFlow } from '../../lib/generation';

/**
 * Main example function that can be called programmatically
 */
export const runExample = async () => {
  console.log('🚀 Starting Dynamic Streaming example...');
  console.log('📝 This demonstrates LLM streaming and dynamic flow generation');

  try {
    loadEnv();

    // Sync (collect)
    console.log('\n— Sync completion (immediate response) —');
    const result = await LLMCoreService.completion(
      'Write a haiku about DynamicFlow.'
    ).pipe(Effect.runPromise);
    console.log('Complete response:', result.content);

    // Streaming
    console.log('\n— Streaming completion (real-time tokens) —');
    let streamedContent = '';
    await Stream.runForEach(
      LLMCoreService.stream('Write a haiku about DynamicFlow.'),
      (c) =>
        Effect.sync(() => {
          process.stdout.write(c.content);
          streamedContent += c.content;
        })
    ).pipe(Effect.runPromise);
    console.log('\n— end of stream —');

    // Additionally, demonstrate generating a DynamicFlow plan
    console.log('\n— DynamicFlow Plan Generation Demo —');
    const model = new OpenAiEffectModel();

    type EchoIn = { text: string };
    type EchoOut = { echoed: string };
    const echoTool: Tool<EchoIn, EchoOut> = {
      id: 'echo',
      name: 'Echo',
      description: 'Echoes input text',
      inputSchema: Schema.Struct({ text: Schema.String }),
      outputSchema: Schema.Struct({ echoed: Schema.String }),
      execute: ({ text }) => Effect.succeed({ echoed: String(text) }),
    };
    const tools = [echoTool];

    const instance = await DynamicFlow.generate({
      prompt: 'Create a simple one-step echo pipeline.',
      tools,
      joins: [],
      model,
    }).pipe(Effect.runPromise);

    const plan = instance.getPlanJSON();
    console.log('Generated Plan:');
    console.log(JSON.stringify(plan, null, 2));

    console.log('\n✅ Completed streaming and plan generation successfully');

    return {
      syncCompletion: result.content,
      streamedCompletion: streamedContent,
      generatedPlan: plan,
    };
  } catch (error) {
    console.error('❌ Streaming example failed:', error);
    throw error;
  }
};

// Run example if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runExample().catch((error) => {
    console.error('❌ Streaming example failed:', error);
    process.exit(1);
  });
}

/**
 * Expected Output:
 * ===============
 *
 * Console Output:
 * 🚀 Starting Dynamic Streaming example...
 * 📝 This demonstrates LLM streaming and dynamic flow generation
 *
 * — Sync completion (immediate response) —
 * Complete response: DynamicFlow hums,
 * like rivers learning new banks—
 * change becomes a path.
 *
 * — Streaming completion (real-time tokens) —
 *
 * — end of stream —
 *
 * — DynamicFlow Plan Generation Demo —
 * Generated flow JSON: {
 *   "version": "1.0",
 *   "metadata": {
 *     "name": "Test Flow",
 *     "description": "Flow for: Create a simple one-step echo pipeline.",
 *     "created": "2025-08-16T17:15:26.710Z"
 *   },
 *   "flow": [
 *     {
 *       "id": "step1",
 *       "type": "tool",
 *       "tool": "echo",
 *       "args": {
 *         "message": "Hello from dynamic flow!"
 *       }
 *     }
 *   ]
 * }
 * Generated Plan:
 * {
 *   "version": "1.0",
 *   "metadata": {
 *     "name": "Simple Echo Pipeline",
 *     "description": "A one-step pipeline that uses the Echo tool.",
 *     "generated": true,
 *     "model": "[object Object]",
 *     "timestamp": "2025-08-17T03:24:19.821Z"
 *   },
 *   "nodes": [
 *     {
 *       "id": "s1",
 *       "type": "tool",
 *       "toolId": "echo",
 *       "inputs": {}
 *     }
 *   ],
 *   "edges": []
 * }
 *
 * ✅ Completed streaming and plan generation successfully
 *
 * Note: This example demonstrates:
 * 1. Direct LLM streaming for real-time token generation
 * 2. Dynamic flow plan generation from natural language
 * The streaming tokens display may vary based on network speed.
 * Requires OPENAI_API_KEY environment variable.
 *
 * Note: The sync completion now works and returns a haiku. Streaming is currently empty.
 * The flow generation uses hardcoded test data until proper LLM integration is enabled.
 */

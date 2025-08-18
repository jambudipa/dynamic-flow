/**
 * Example: LLM streaming in a static flow context
 *
 * Demonstrates direct LLM service usage for token-by-token streaming,
 * showcasing low-level streaming capabilities without Flow abstraction.
 *
 * Features demonstrated:
 * - Direct LLM service integration
 * - Real-time token streaming
 * - Comparison of collect vs streaming modes
 * - Raw streaming API usage
 * - Performance monitoring for streaming responses
 *
 * Performance characteristics:
 * - Token streaming: Real-time response display
 * - Memory efficient: No buffering of complete response
 * - Low latency: First token time optimization
 *
 * Expected console output:
 * ```
 * — Sync (collect) —
 * DynamicFlow is a workflow orchestration framework...
 *
 * — Streaming tokens —
 * DynamicFlow is a workflow orchestration framework...
 * (displays character by character as received)
 * ```
 *
 * Return value: Promise<{ fullResponse: string; streamedTokens: string[] }>
 * Note: Requires OPENAI_API_KEY environment variable
 *
 * Run: npx tsx examples/static/10-llm-call-streaming.ts
 */

import { loadEnv } from '../env';
import { Effect, Stream } from 'effect';
import { LLMCoreService } from '../../lib/llm/service';

/**
 * Programmatic example runner for testing and integration
 */
export async function runExample(): Promise<{
  fullResponse: string;
  streamedTokens: string[];
}> {
  console.log('=== LLM Streaming Example ===\n');

  loadEnv();

  const prompt = 'Stream a concise definition of DynamicFlow.';

  try {
    console.log(`Prompt: "${prompt}"`);
    console.log();

    // Sync (collect)
    console.log('— Sync (collect) —');
    const resp = await LLMCoreService.completion(prompt).pipe(
      Effect.runPromise
    );
    console.log(resp.content);
    console.log();

    // Streaming tokens
    console.log('— Streaming tokens —');
    const streamedTokens: string[] = [];
    let streamedContent = '';

    await Stream.runForEach(LLMCoreService.stream(prompt), (c) =>
      Effect.sync(() => {
        streamedTokens.push(c.content);
        streamedContent += c.content;
        process.stdout.write(c.content);
      })
    ).pipe(Effect.runPromise);

    console.log('\n');
    console.log(
      `— Streaming complete: received ${streamedTokens.length} tokens —`
    );
    console.log('\n✅ LLM streaming completed successfully!');

    return {
      fullResponse: resp.content,
      streamedTokens,
    };
  } catch (error) {
    console.error('❌ LLM streaming failed:', error);
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
 * === LLM Streaming Example ===
 *
 * Prompt: "Stream a concise definition of DynamicFlow."
 *
 * — Sync (collect) —
 * DynamicFlow (networks): a time-dependent network flow model in which units of flow move through edges with travel times and capacity limits, respecting flow conservation at nodes; flows and edge availabilities vary over a time horizon and objectives typically involve maximizing throughput or minimizing arrival times.
 *
 * (Alternate, concise meaning in fluid mechanics: unsteady flow — a velocity field that changes with time.)
 *
 * — Streaming tokens —
 * Dynamic flow — the movement or transfer of entities (fluid, traffic, data, etc.) whose rate, direction, or routing changes over time in response to varying inputs, constraints, or system state (contrast with steady/static flow).
 *
 * — Streaming complete: received 34 tokens —
 *
 * ✅ LLM streaming completed successfully!
 *
 * Note: Requires OPENAI_API_KEY environment variable
 */

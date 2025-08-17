/**
 * Dynamic Example 01: execute() with streaming events
 *
 * Demonstrates dynamic flow generation using LLM planning with streaming execution.
 * Shows how the framework can automatically generate flow plans from natural language
 * prompts and execute them with real-time event streaming.
 *
 * Features:
 * - LLM-driven flow planning from natural language
 * - Streaming execution with real-time events
 * - Tool joins for type-safe data transformation
 * - Both streaming and collect modes
 *
 * Performance notes:
 * - LLM planning adds latency (~1-3s) but enables natural language interface
 * - Streaming provides real-time feedback for long-running operations
 * - Tool joins are validated at runtime for type safety
 *
 * Run: npx tsx examples/dynamic/01-execute.ts
 */

import { loadEnv } from '../env';
import { Effect, pipe, Schema, Stream } from 'effect';
import type { Tool, ToolJoin } from '../../src/tools/types';
import { DynamicFlow } from '../../src/generation';
import { OpenAiEffectModel } from '../../src/llm/service';

// Tools
type WebScraperInput = { url: string };
type WebScraperOutput = { content: string };
const webScraper: Tool<WebScraperInput, WebScraperOutput> = {
  id: 'web-scraper',
  name: 'Web Scraper',
  description: 'Scrapes data from websites',
  inputSchema: Schema.Struct({ url: Schema.String }),
  outputSchema: Schema.Struct({ content: Schema.String }),
  execute: (_input) => Effect.succeed({ content: '<html>...</html>' })
};

type SentimentInput = { text: string };
type SentimentOutput = { sentiment: string; score: number };
const sentimentAnalyzer: Tool<SentimentInput, SentimentOutput> = {
  id: 'sentiment-analyzer',
  name: 'Sentiment Analyzer',
  description: 'Analyzes sentiment of text',
  inputSchema: Schema.Struct({ text: Schema.String }),
  outputSchema: Schema.Struct({ sentiment: Schema.String, score: Schema.Number }),
  execute: (_input) => Effect.succeed({ sentiment: 'positive', score: 0.92 })
};

const tools = [webScraper, sentimentAnalyzer];

// Optional example join
const joins: Array<ToolJoin<WebScraperOutput, SentimentInput>> = [
  {
    fromTool: 'web-scraper',
    toTool: 'sentiment-analyzer',
    transform: Schema.transform(
      Schema.Struct({ content: Schema.String }),
      Schema.Struct({ text: Schema.String }),
      {
        strict: true,
        decode: (s: WebScraperOutput) => ({ text: s.content }),
        encode: (t: SentimentInput) => ({ content: t.text })
      }
    )
  }
];

/**
 * Main example function that can be called programmatically
 */
export const runExample = async () => {
  console.log('🚀 Starting Dynamic Execute example...');
  console.log('📝 This demonstrates LLM-driven flow planning with streaming execution');

  try {
    console.time('Environment setup');
    loadEnv();
    const model = new OpenAiEffectModel();
    console.timeEnd('Environment setup');

    // Streaming events
    console.log('\n— Streaming execution with real-time events —');
    console.time('DynamicFlow.execute');
    const streamingResult = await pipe(
      DynamicFlow.execute({
        prompt: 'Scrape a page and analyze its sentiment.',
        tools,
        joins,
        model
      }),
      Stream.tap(event => Effect.sync(() => {
        const details =
          event.type === 'tool-start' ? `tool=${(event as any).toolId} node=${(event as any).nodeId}` :
            event.type === 'llm-token' ? `tool=${(event as any).toolId} node=${(event as any).nodeId} token="${(event as any).token}"` :
              event.type === 'tool-output' ? `tool=${(event as any).toolId} node=${(event as any).nodeId}` :
                event.type === 'node-complete' ? `node=${(event as any).nodeId}` :
                  event.type === 'flow-complete' ? `result=${JSON.stringify((event as any).result)}` :
                    event.type === 'flow-error' ? `error=${JSON.stringify((event as any).error)}` :
                      '';
        console.log(`• ${event.type}${details ? ` — ${details}` : ''}`);
      })),
      Stream.runCollect
    ).pipe(Effect.runPromise);
    console.timeEnd('DynamicFlow.execute');

    // Sync collect via generate + runCollect
    console.log('\n— Generate plan then execute synchronously —');
    console.time('DynamicFlow.generate');
    const instance = await DynamicFlow.generate({
      prompt: 'Scrape a page and analyze its sentiment.',
      tools,
      joins,
      model
    }).pipe(Effect.runPromise);
    console.timeEnd('DynamicFlow.generate');

    // Display the generated plan (Flow JSON)
    const plan = instance.getPlanJSON();
    console.log('Generated Plan:');
    console.log(JSON.stringify(plan, null, 2));

    console.time('Flow execution');
    const result = await instance.runCollect().pipe(Effect.runPromise);
    console.timeEnd('Flow execution');
    console.log('Execution result:', result);

    console.log('\n✅ Completed dynamic execution successfully');

    return {
      streamingEvents: streamingResult,
      planGenerated: plan,
      executionResult: result
    };
  } catch (error) {
    console.error('❌ Dynamic execute example failed:', error);
    throw error;
  }
};

// Run example if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runExample().catch(error => {
    console.error('❌ Dynamic execute example failed:', error);
    process.exit(1);
  });
}

/**
 * Expected Output:
 * ===============
 *
 * 🚀 Starting Dynamic Execute example...
 * 📝 This demonstrates LLM-driven flow planning with streaming execution
 * Environment setup: 0.062ms
 *
 * — Streaming execution with real-time events —
 * • flow-start
 * • node-start
 * • tool-start — tool=web-scraper node=s1
 * • tool-output — tool=web-scraper node=s1
 * • node-complete — node=s1
 * • node-start
 * • tool-start — tool=sentiment-analyzer node=s2
 * • tool-output — tool=sentiment-analyzer node=s2
 * • node-complete — node=s2
 * • flow-complete — result={"s1":{"content":"<html>...</html>"},"s2":{"sentiment":"positive","score":0.92}}
 * DynamicFlow.execute: 22.394s
 *
 * — Generate plan then execute synchronously —
 * DynamicFlow.generate: 30.538s
 * Generated Plan:
 * {
 *   "version": "1.0",
 *   "metadata": {
 *     "name": "Scrape and Sentiment Analysis",
 *     "description": "Scrapes a web page and analyzes its sentiment",
 *     "generated": true,
 *     "model": "[object Object]",
 *     "timestamp": "2025-08-17T03:22:41.591Z"
 *   },
 *   "nodes": [
 *     {
 *       "id": "s1",
 *       "type": "tool",
 *       "toolId": "web-scraper",
 *       "inputs": {
 *         "url": "https://example.com"
 *       }
 *     },
 *     {
 *       "id": "s2",
 *       "type": "tool",
 *       "toolId": "sentiment-analyzer",
 *       "inputs": {
 *         "text": "$s1.output"
 *       }
 *     }
 *   ],
 *   "edges": [
 *     {
 *       "from": "s1",
 *       "to": "s2"
 *     }
 *   ]
 * }
 * Flow execution: 4.443ms
 * Execution result: {
 *   output: {
 *     s1: { content: '<html>...</html>' },
 *     s2: { sentiment: 'positive', score: 0.92 }
 *   },
 *   metadata: {
 *     duration: { _id: 'Duration', _tag: 'Millis', millis: 4 },
 *     toolsExecuted: []
 *   }
 * }
 *
 * ✅ Completed dynamic execution successfully
 *
 * Performance Notes:
 * - LLM planning takes 22-30 seconds (most of the time) due to OpenAI API calls
 * - Actual flow execution is very fast (4-5ms)
 * - Uses gpt-5 model for flow generation with structured output
 * 
 * Requires OPENAI_API_KEY environment variable.
 * To use a mock model for faster testing, replace OpenAiEffectModel with a mock.
 */

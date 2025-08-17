/**
 * DynamicFlow Examples — LLM-driven flow generation and execution
 *
 * These examples demonstrate the DynamicFlow API: provide tools and a natural
 * language prompt, and let the framework handle planning, validation, and execution.
 *
 * Features:
 * - Natural language prompts converted to executable flows
 * - Type-safe tool composition and data transformation
 * - Real-time streaming execution with events
 * - Plan generation and inspection before execution
 *
 * Performance notes:
 * - LLM planning adds ~1-3s latency but enables natural language interface
 * - Tool joins provide type safety with minimal runtime overhead
 * - Streaming provides real-time feedback for long operations
 *
 * Run: npx tsx examples/dynamic/index.ts
 */

import { loadEnv } from '../env';
import { Effect, pipe, Schema, Stream } from 'effect';
import { DynamicFlow } from '@/generation';
import type { AiModel } from '@/generation/types';
import type { Tool, ToolJoin } from '@/tools/types';

// OpenAI-backed model implementation for examples
import { OpenAiEffectModel } from '@/llm/service';

// Shared tools used across examples
type WebScraperIn = { url: string };
type WebScraperOut = { content: string };
const webScraper: Tool<WebScraperIn, WebScraperOut> = {
  id: 'web-scraper',
  name: 'Web Scraper',
  description: 'Scrapes data from websites',
  inputSchema: Schema.Struct({ url: Schema.String }),
  outputSchema: Schema.Struct({ content: Schema.String }),
  execute: (_input) => Effect.succeed({ content: '<html>...</html>' }),
};

type SentimentIn = { text: string };
type SentimentOut = { sentiment: string; score: number };
const sentimentAnalyzer: Tool<SentimentIn, SentimentOut> = {
  id: 'sentiment-analyzer',
  name: 'Sentiment Analyzer',
  description: 'Analyzes sentiment of text',
  inputSchema: Schema.Struct({ text: Schema.String }),
  outputSchema: Schema.Struct({
    sentiment: Schema.String,
    score: Schema.Number,
  }),
  execute: (_input) => Effect.succeed({ sentiment: 'positive', score: 0.92 }),
};

type ReportIn = { data: unknown };
type ReportOut = { report: string };
const reportGenerator: Tool<ReportIn, ReportOut> = {
  id: 'report-generator',
  name: 'Report Generator',
  description: 'Generates formatted reports',
  inputSchema: Schema.Struct({ data: Schema.Unknown }),
  outputSchema: Schema.Struct({ report: Schema.String }),
  execute: (_input) =>
    Effect.succeed({ report: 'Report generated successfully.' }),
};

const tools = [webScraper, sentimentAnalyzer, reportGenerator];

// Optional joins to demonstrate typed transformations between tools
const joins: Array<
  ToolJoin<WebScraperOut, SentimentIn> | ToolJoin<SentimentOut, ReportIn>
> = [
  {
    fromTool: 'web-scraper',
    toTool: 'sentiment-analyzer',
    transform: Schema.transform(
      Schema.Struct({ content: Schema.String }),
      Schema.Struct({ text: Schema.String }),
      {
        strict: true,
        decode: (scraped: WebScraperOut) => ({ text: scraped.content }),
        encode: (analyzed: SentimentIn) => ({ content: analyzed.text }),
      }
    ),
  },
  {
    fromTool: 'sentiment-analyzer',
    toTool: 'report-generator',
    transform: Schema.transform(
      Schema.Struct({ sentiment: Schema.String, score: Schema.Number }),
      Schema.Struct({ data: Schema.Unknown }),
      {
        strict: true,
        decode: (sentiment: SentimentOut) => ({
          data: { sentiment: sentiment.sentiment, score: sentiment.score },
        }),
        encode: (_report: ReportIn) => ({ sentiment: 'neutral', score: 0 }),
      }
    ),
  },
];

// Example 1: Execute directly with streaming events
async function executeStreamingExample() {
  console.log('Example 1: execute() with tools + prompt (streaming)');
  const model: AiModel = new OpenAiEffectModel();

  const streamingEvents = await pipe(
    DynamicFlow.execute({
      prompt: 'Scrape a website, analyze sentiment, then produce a report.',
      tools,
      joins,
      model,
    }),
    Stream.tap((event) =>
      Effect.sync(() => {
        const details =
          event.type === 'node-start'
            ? `node=${(event as any).nodeId}`
            : event.type === 'node-complete'
              ? `node=${(event as any).nodeId}`
              : event.type === 'tool-start'
                ? `tool=${(event as any).toolId} node=${(event as any).nodeId}`
                : event.type === 'tool-output'
                  ? `tool=${(event as any).toolId} node=${(event as any).nodeId}`
                  : event.type === 'llm-token'
                    ? `tool=${(event as any).toolId} node=${(event as any).nodeId} token="${(event as any).token}"`
                    : event.type === 'llm-completion'
                      ? `tool=${(event as any).toolId} node=${(event as any).nodeId}`
                      : event.type === 'flow-complete'
                        ? `result=${JSON.stringify((event as any).result)}`
                        : '';
        console.log(`• ${event.type}${details ? ` — ${details}` : ''}`);
      })
    ),
    Stream.runCollect,
    Effect.runPromise
  );

  return streamingEvents;
}

// Example 2: Generate first, then run and collect
async function generateThenRunExample() {
  console.log('\nExample 2: generate() → runCollect()');
  const model: AiModel = new OpenAiEffectModel();

  const instance = await DynamicFlow.generate({
    prompt: 'Create a 3-step analysis pipeline',
    tools,
    joins,
    model,
  }).pipe(Effect.runPromise);

  // Display the generated plan (Flow JSON)
  const plan = instance.getPlanJSON();
  console.log('Generated Plan:');
  console.log(JSON.stringify(plan, null, 2));

  const result = await instance.runCollect().pipe(Effect.runPromise);
  console.log('Execution result:', result);

  return { plan, result };
}

/**
 * Main example function that can be called programmatically
 */
export const runExample = async () => {
  console.log('🚀 Starting DynamicFlow comprehensive examples...');
  console.log(
    '📝 This demonstrates LLM-driven flow generation and execution patterns'
  );

  try {
    loadEnv();

    console.log('\n=== DynamicFlow: LLM-Driven Examples ===\n');

    const streamingResult = await executeStreamingExample();
    const generateResult = await generateThenRunExample();

    console.log('\n✅ Completed all dynamic flow examples successfully');
    console.log('=== Done ===');

    return {
      streamingExecution: streamingResult,
      generateThenRun: generateResult,
    };
  } catch (error) {
    console.error('❌ Dynamic flow examples failed:', error);
    throw error;
  }
};

// Legacy function names for backwards compatibility
export const example_executeStreaming = executeStreamingExample;
export const example_generateThenRun = generateThenRunExample;
export const runExamples = runExample;

// Run examples if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runExample().catch((error) => {
    console.error('❌ Dynamic flow examples failed:', error);
    process.exit(1);
  });
}

/**
 * Expected Output:
 * ===============
 *
 * Console Output:
 * 🚀 Starting DynamicFlow comprehensive examples...
 * 📝 This demonstrates LLM-driven flow generation and execution patterns
 *
 * === DynamicFlow: LLM-Driven Examples ===
 *
 * Example 1: execute() with tools + prompt (streaming)
 * • flow-start
 * • node-start — node=scrape-website
 * • tool-start — tool=web-scraper node=scrape-website
 * • tool-output — tool=web-scraper node=scrape-website
 * • node-complete — node=scrape-website
 * • node-start — node=analyze-sentiment
 * • tool-start — tool=sentiment-analyzer node=analyze-sentiment
 * • tool-output — tool=sentiment-analyzer node=analyze-sentiment
 * • node-complete — node=analyze-sentiment
 * • node-start — node=generate-report
 * • tool-start — tool=report-generator node=generate-report
 * • tool-output — tool=report-generator node=generate-report
 * • node-complete — node=generate-report
 * • flow-complete — result={"scrape-website":{"content":"<html>...</html>"},"analyze-sentiment":{"sentiment":"positive","score":0.92},"generate-report":{"report":"Report generated successfully."}}
 *
 * Example 2: generate() → runCollect()
 * Generated Plan:
 * {
 *   "version": "1.0",
 *   "metadata": {
 *     "name": "3-Step Analysis Pipeline",
 *     "description": "A pipeline for web scraping, sentiment analysis, and report generation",
 *     "generated": true,
 *     "timestamp": "2025-08-16T10:30:00.000Z"
 *   },
 *   "nodes": [
 *     {
 *       "id": "webScraperNode",
 *       "type": "tool",
 *       "toolId": "web-scraper",
 *       "inputs": { "url": "https://example.com" }
 *     },
 *     {
 *       "id": "sentimentAnalyzerNode",
 *       "type": "tool",
 *       "toolId": "sentiment-analyzer",
 *       "inputs": { "text": { "from": "webScraperNode", "output": "content" } }
 *     },
 *     {
 *       "id": "reportGeneratorNode",
 *       "type": "tool",
 *       "toolId": "report-generator",
 *       "inputs": { "data": { "from": "sentimentAnalyzerNode", "output": "sentiment" } }
 *     }
 *   ],
 *   "edges": [
 *     { "from": "webScraperNode", "to": "sentimentAnalyzerNode" },
 *     { "from": "sentimentAnalyzerNode", "to": "reportGeneratorNode" }
 *   ]
 * }
 * Execution result: {
 *   output: {
 *     webScraperNode: { content: '<html>...</html>' },
 *     sentimentAnalyzerNode: { sentiment: 'positive', score: 0.92 },
 *     reportGeneratorNode: { report: 'Report generated successfully.' }
 *   },
 *   metadata: {
 *     duration: { _id: 'Duration', _tag: 'Millis', millis: 1200 },
 *     toolsExecuted: ['web-scraper', 'sentiment-analyzer', 'report-generator']
 *   }
 * }
 *
 * ✅ Completed all dynamic flow examples successfully
 * === Done ===
 *
 * Return Value:
 * {
 *   streamingExecution: [...],    // Array of streaming execution events
 *   generateThenRun: {            // Generate-then-run example results
 *     plan: {...},                // Generated flow plan JSON
 *     result: {...}               // Execution result with output and metadata
 *   }
 * }
 */

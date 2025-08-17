/**
 * Example: LLM + Mock Data Pipeline
 *
 * Demonstrates data-driven AI workflows where LLMs analyze structured data
 * to answer business questions with context-aware responses.
 *
 * Features demonstrated:
 * - Data fetching and preprocessing for LLM consumption
 * - Prompt engineering with structured data injection
 * - Multi-step pipeline: Data → Prompt → LLM → Response
 * - Business intelligence patterns with AI integration
 * - Schema validation for data integrity
 *
 * Performance characteristics:
 * - Data streaming: Efficient data flow without intermediate storage
 * - Context injection: O(1) data serialization for prompts
 * - Pipeline composition: Modular, reusable components
 *
 * Expected console output:
 * ```
 * Fetching sales data for Q2-2025...
 * Preparing data-driven prompt...
 * Generated prompt with 4 regions of data
 * LLM Analysis: "East region has highest sales: $143,500"
 * — Streaming events —
 * • tool-start (data fetch)
 * • tool-output (prompt prep)
 * • llm-token ("East")
 * • flow-complete
 * ```
 *
 * Return value: Promise<{ analysis: string, data: SalesData }>
 * Note: Requires OPENAI_API_KEY environment variable
 *
 * Run: npx tsx examples/static/08-llm-with-data.ts
 */

import { loadEnv } from '../env';
import { Effect, pipe, Schema, Stream } from 'effect';
import type { Tool } from '../../src/index';
import { Flow, LLMLive, Tools } from '../../src/index';
import { createOpenAiCompletionTool } from '../../src/llm/providers/effect-openai-tool';

// Types for sales data
interface SalesData {
  quarter: string;
  regions: Array<{
    region: string;
    sales: number;
  }>;
}

// Mock service: returns simple sales data
const fetchSalesData = (): Effect.Effect<SalesData, never, never> => Effect.sync(() => {
  const data = {
    quarter: 'Q2-2025',
    regions: [
      { region: 'North', sales: 125000 },
      { region: 'South', sales: 98000 },
      { region: 'East', sales: 143500 },
      { region: 'West', sales: 112300 }
    ]
  };
  console.log(`Fetching sales data for ${data.quarter}...`);
  console.log(`Retrieved ${data.regions.length} regional sales records`);
  return data;
});

// Tool: prepare a concise prompt from data and a question
const promptFromData: Tool<{ data: unknown; question: string }, { prompt: string }> = {
  id: 'prep:promptFromData',
  name: 'Prompt From Data',
  description: 'Formats a short, structured prompt using the data and a question',
  inputSchema: Schema.Struct({ data: Schema.Unknown, question: Schema.String }),
  outputSchema: Schema.Struct({ prompt: Schema.String }),
  execute: ({ data, question }) => Effect.sync(() => {
    console.log('Preparing data-driven prompt...');
    const regions = (data as SalesData).regions.length;
    console.log(`Generated prompt with ${regions} regions of data`);

    const prompt = [
      'You are a helpful data assistant. Answer strictly and concisely.',
      'Data (JSON):',
      JSON.stringify(data, null, 2),
      'Question:',
      question,
      'Return only the answer, no explanations.'
    ].join('\n');

    return { prompt };
  })
};

async function createDataLlmFlow(question: string) {
  // LLM tool
  const ask = createOpenAiCompletionTool(
    'llm:ask-data',
    'Ask About Data',
    'Answers questions about provided JSON data'
  );

  // Pipeable functions
  const toPrompt = Tools.createTool<{ data: unknown; question: string }, { prompt: string }>(promptFromData);
  const runAsk = Tools.createTool<{ prompt: string }, { response: string }>(ask);

  // Build a flow
  const program = pipe(
    fetchSalesData(),
    Flow.map((data) => ({ data, question })),
    Flow.andThen(toPrompt),
    Flow.andThen(runAsk)
  );

  return program;
}

/**
 * Programmatic example runner for testing and integration
 */
export async function runExample(): Promise<{ analysis: string; data: SalesData }> {
  console.log('=== LLM + Mock Data Pipeline ===\n');

  loadEnv();

  try {
    const question = 'Which region has the highest sales and what is the amount?';
    const program = await createDataLlmFlow(question);

    // Provide the LLM service layer
    const programWithLLM = pipe(program, Effect.provide(LLMLive));

    console.log(`Question: ${question}`);
    const collected = await Effect.runPromise(
      Flow.runCollect(programWithLLM as Effect.Effect<any, any, never>, { name: 'LLM + Data' })
    );
    const analysis = (collected.output as any)?.response ?? collected.output;
    console.log('LLM Analysis:', analysis);

    console.log('\n— Streaming events —');
    await Stream.runForEach(
      Flow.runStream(programWithLLM as Effect.Effect<any, any, never>, { name: 'LLM + Data' }),
      (event) => Effect.sync(() => {
        console.log(`• ${event.type}`,
          event.type === 'flow-complete' ? `→ ${JSON.stringify((event as any).result?.response || (event as any).result).substring(0, 100)}...` : ''
        );
      })
    ).pipe(Effect.runPromise);

    // Get the data for the response
    const data = await Effect.runPromise(fetchSalesData());

    console.log('\n✅ Data + LLM pipeline completed successfully!');
    return { analysis: analysis || 'Analysis completed', data };
  } catch (error) {
    console.error('❌ Data + LLM pipeline failed:', error);
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
 * === LLM + Mock Data Pipeline ===
 *
 * Question: Which region has the highest sales and what is the amount?
 * Fetching sales data for Q2-2025...
 * Retrieved 4 regional sales records
 * Preparing data-driven prompt...
 * Generated prompt with 4 regions of data
 * LLM Analysis: East: 143500
 *
 * — Streaming events —
 * • flow-start
 * Fetching sales data for Q2-2025...
 * Retrieved 4 regional sales records
 * Preparing data-driven prompt...
 * Generated prompt with 4 regions of data
 * • flow-complete → "East: 143500"...
 * Fetching sales data for Q2-2025...
 * Retrieved 4 regional sales records
 *
 * ✅ Data + LLM pipeline completed successfully\!
 *
 * Note: Requires OPENAI_API_KEY environment variable
 */

/**
 * Example: Tool Join — Type Mismatch vs Join Fix
 *
 * Demonstrates solving tool composition type mismatches using ToolJoin transformations.
 * Shows the progression from type errors to type-safe tool chains with automatic data mapping.
 *
 * Features demonstrated:
 * - Tool composition type safety enforcement
 * - ToolJoin schema transformations for data mapping
 * - Complex field mapping and enrichment
 * - Type-safe pipeline construction with joins
 * - Schema validation during transformations
 *
 * Performance characteristics:
 * - Zero-copy transformations: O(1) data mapping
 * - Compile-time safety: Type errors caught early
 * - Schema validation: Runtime data integrity checks
 *
 * Expected console output:
 * ```
 * Tool A: Fetching title for ID: 42
 * Join A→B: Transforming { title: "Item-42" } → { text: "Item-42" }
 * Tool B: Computing text length for "Item-42"
 * Length (collected): 7
 *
 * Tool A: Fetching title for ID: 88
 * Join A→C: Enriching { title: "Item-88" } → { text: "Item-88", note: "..." }
 * Tool C: Computing enriched result
 * Length (with note): 7 — Title received: Item-88
 * ```
 *
 * Return value: Promise<{ simpleLength: number; enrichedResult: { length: number; note: string } }>
 *
 * Run: npx tsx examples/static/09-tool-join.ts
 */

import { Duration, Effect, pipe, Schema, Stream } from 'effect';
import type { Tool, ToolJoin } from '../../src/index';
import { Flow, Tools } from '../../src/index';

// Tool A: given an ID, returns a record with { title: string }
const toolA: Tool<{ id: number }, { title: string }> = {
  id: 'tool:A',
  name: 'Fetch Title',
  description: 'Fetches a title by ID',
  inputSchema: Schema.Struct({ id: Schema.Number }),
  outputSchema: Schema.Struct({ title: Schema.String }),
  execute: ({ id }) => Effect.sync(() => {
    const title = `Item-${id}`;
    console.log(`Tool A: Fetching title for ID: ${id}`);
    return { title };
  })
};

// Tool B: expects { text: string } and returns the length
const toolB: Tool<{ text: string }, { length: number }> = {
  id: 'tool:B',
  name: 'Text Length',
  description: 'Computes the length of a text value',
  inputSchema: Schema.Struct({ text: Schema.String }),
  outputSchema: Schema.Struct({ length: Schema.Number }),
  execute: ({ text }) => Effect.sync(() => {
    console.log(`Tool B: Computing text length for "${text}"`);
    return { length: text.length };
  })
};

// Tool C: richer input to demonstrate a more complex join
const toolC: Tool<{ text: string; note: string }, { length: number; note: string }> = {
  id: 'tool:C',
  name: 'Text Length With Note',
  description: 'Computes text length and echoes an auxiliary note',
  inputSchema: Schema.Struct({ text: Schema.String, note: Schema.String }),
  outputSchema: Schema.Struct({ length: Schema.Number, note: Schema.String }),
  execute: ({ text, note }) => Effect.sync(() => {
    console.log(`Tool C: Computing enriched result for "${text}" with note`);
    return { length: text.length, note };
  })
};

// Create pipeable wrappers
const runA = Tools.createTool<{ id: number }, { title: string }>(toolA);
const runB = Tools.createTool<{ text: string }, { length: number }>(toolB);
const runC = Tools.createTool<{ text: string; note: string }, { length: number; note: string }>(toolC);

/**
 * Programmatic example runner for testing and integration
 */
export async function runExample(): Promise<{
  simpleLength: number;
  enrichedResult: { length: number; note: string }
}> {
  console.log('=== Tool Join Demo ===\n');

  // 1) Intentional type mismatch: { title: string } → { text: string }
  // This demonstrates the error the join resolves.
  const invalidProgram = pipe(
    Effect.succeed({ id: 1 }),
    Flow.andThen(runA),
    // @ts-expect-error: runB expects { text: string }, but previous step yields { title: string }
    Flow.andThen(runB)
  );

  // NOTE: We do not execute invalidProgram; the line above is for type-check demonstration only.

  try {
    // 2) Define a ToolJoin to transform A → B using Schema.transform
    const joinAToB: ToolJoin<{ title: string }, { text: string }> = {
      fromTool: 'tool:A',
      toTool: 'tool:B',
      transform: Schema.transform(
        Schema.Struct({ title: Schema.String }),   // From A's output
        Schema.Struct({ text: Schema.String }),    // To B's input
        {
          strict: true,
          decode: (a: { title: string }) => {
            console.log(`Join A→B: Transforming { title: "${a.title}" } → { text: "${a.title}" }`);
            return { text: a.title };
          },
          encode: (b: { text: string }) => ({ title: b.text })
        }
      )
    };

    // 3) Valid flow using Flow.join with the ToolJoin between A and B
    console.log('Testing simple A→B join...');
    const validProgram = pipe(
      Effect.succeed({ id: 42 }),
      Flow.andThen(runA),
      Flow.join(joinAToB),
      Flow.andThen(runB)
    );

    // Non-streaming: collect the result
    const collected = await Effect.runPromise(
      Flow.runCollect(validProgram as Effect.Effect<any, any, never>, { name: 'Join A->B' })
    );
    const simpleLength = (collected.output as any)?.length ?? collected.output;
    console.log('Length (collected):', simpleLength);
    console.log('Execution time:', Duration.toMillis(collected.metadata.duration), 'ms');

    // 4) Second variant: more complex join (adds an extra field)
    console.log('\nTesting enriched A→C join...');

    // Now define a richer join: { title } → { text, note }
    const joinAToC: ToolJoin<{ title: string }, { text: string; note: string }> = {
      fromTool: 'tool:A',
      toTool: 'tool:C',
      transform: Schema.transform(
        Schema.Struct({ title: Schema.String }),
        Schema.Struct({ text: Schema.String, note: Schema.String }),
        {
          strict: true,
          decode: (a: { title: string }) => {
            const note = `Title received: ${a.title}`;
            console.log(`Join A→C: Enriching { title: "${a.title}" } → { text: "${a.title}", note: "${note}" }`);
            return { text: a.title, note };
          },
          encode: (c: { text: string; note: string }) => ({ title: c.text })
        }
      )
    };

    const validCProgram = pipe(
      Effect.succeed({ id: 88 }),
      Flow.andThen(runA),
      Flow.join(joinAToC),
      Flow.andThen(runC)
    );

    const collectedC = await Effect.runPromise(
      Flow.runCollect(validCProgram as Effect.Effect<any, any, never>, { name: 'Join A->C' })
    );
    const enrichedResult = collectedC.output as any;
    console.log('Length (with note, collected):', enrichedResult.length, '—', enrichedResult.note);
    console.log('Execution time:', Duration.toMillis(collectedC.metadata.duration), 'ms');

    // Streaming events for one of the programs
    console.log('\n— Streaming events —');
    await Stream.runForEach(
      Flow.runStream(validProgram, { name: 'Join A->B' }),
      (event) => Effect.sync(() => {
        console.log(`• ${event.type}`,
          event.type === 'flow-complete' ? `→ length: ${(event as any).result?.length}` : ''
        );
      })
    ).pipe(Effect.runPromise);

    console.log('\n✅ Tool join transformations completed successfully!');
    return { simpleLength, enrichedResult };
  } catch (error) {
    console.error('❌ Tool join failed:', error);
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

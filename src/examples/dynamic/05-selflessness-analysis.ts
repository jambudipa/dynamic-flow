/**
 * Dynamic Example 05: Complex multi-tool orchestration with conditional logic
 *
 * Demonstrates advanced dynamic flow generation with:
 * - Multiple tool orchestration (search, retrieval, analysis, summarization)
 * - Conditional branching (clarification only if needed)
 * - Parallel execution attempts (book + audio retrieval)
 * - Real LLM calls for analysis and summarization
 * - Defensive error handling for missing data
 *
 * This example showcases how DynamicFlow can generate complex, multi-step
 * workflows from natural language prompts, orchestrating both mocked retrieval
 * tools and real LLM-powered analysis tools.
 *
 * Prompt:
 *   "Can you find where the books discuss the gross and subtle selflessness
 *    of persons? Compare how these two are described. If the descriptions are
 *    unclear or overlapping, try to clarify using related sections or audio
 *    teachings. Then summarise the distinction in plain language, and let me
 *    know if any parts contradict each other."
 *
 * Requirements:
 * - Set `OPENAI_API_KEY` (root .env is supported by examples/env.ts)
 * - Node 18+
 *
 * Run:
 *   npx tsx examples/dynamic/05-selflessness-analysis.ts
 *
 * Expected Output:
 * ===============
 *
 * The example will:
 * 1. Generate a flow plan with 7-9 nodes including search, retrieval, comparison,
 *    optional clarification, summarization, and contradiction checking
 * 2. Execute the flow using streaming events
 * 3. Produce a philosophical summary distinguishing gross vs subtle selflessness
 *
 * Note: Due to current limitations with parallel node execution in streaming mode,
 * the book/audio retrieval may not pass data correctly, but the LLM tools will
 * still demonstrate the analysis pipeline with defensive handling.
 *
 * Performance: Flow generation takes ~30 seconds due to OpenAI structured output
 * generation. Execution is fast (<1 second) as retrieval tools are mocked.
 */

import { loadEnv } from '../env';
import { Effect, Schema, Stream } from 'effect';
import type { Tool, ToolJoin } from '../../lib/tools/types';
import { DynamicFlow } from '../../lib/generation';
import type { AiModel } from '../../lib/generation/types';
import { OpenAiEffectModel } from '../../lib/llm/service';

// ---------- Mocked retrieval tools (OK to mock per request) ----------

// Search across a (mocked) corpus returning book and audio hits
type SearchIn = { query: string; limit?: number };
type SearchHit = {
  id: string;
  kind: 'book' | 'audio';
  title: string;
  score: number;
  tags: string[];
};
type SearchOut = { results: SearchHit[] };

const SearchHitSchema = Schema.Struct({
  id: Schema.String,
  kind: Schema.Union(Schema.Literal('book'), Schema.Literal('audio')),
  title: Schema.String,
  score: Schema.Number,
  tags: Schema.Array(Schema.String).pipe(Schema.mutable),
});
const SearchOutSchema = Schema.Struct({
  results: Schema.Array(SearchHitSchema).pipe(Schema.mutable),
});

const corpusSearch: Tool<SearchIn, SearchOut> = {
  id: 'corpus:search',
  name: 'Corpus Search',
  description:
    'Searches the library and returns ranked results from books and audio',
  inputSchema: Schema.Struct({
    query: Schema.String,
    limit: Schema.optional(Schema.Number),
  }),
  outputSchema: SearchOutSchema,
  execute: ({ query, limit = 10 }: SearchIn) => {
    const items: SearchHit[] = [
      {
        id: 'bk-chandrakirti-12',
        kind: 'book' as const,
        title: 'Introduction to Madhyamaka – Selflessness of Persons',
        score: 0.94,
        tags: ['selflessness', 'persons', 'gross', 'analysis'],
      },
      {
        id: 'bk-shantideva-9',
        kind: 'book' as const,
        title: 'Bodhicaryavatara – View Chapter notes',
        score: 0.86,
        tags: ['selflessness', 'persons', 'subtle', 'aggregate'],
      },
      {
        id: 'aud-2021-03-14',
        kind: 'audio' as const,
        title: 'Weekend Teaching – Twofold Selflessness',
        score: 0.78,
        tags: ['teaching', 'selflessness', 'clarification'],
      },
    ].slice(0, limit);
    return Effect.succeed({ results: items });
  },
};

// Fetch a (mock) book section by ID
type BookSectionIn = { id: string; section?: string };
type BookSectionOut = {
  source: 'book';
  id: string;
  title: string;
  text: string;
  mentions: string[];
};

const BookSectionInSchema = Schema.Struct({
  id: Schema.String,
  section: Schema.optional(Schema.String),
});
const BookSectionOutSchema = Schema.Struct({
  source: Schema.Literal('book'),
  id: Schema.String,
  title: Schema.String,
  text: Schema.String,
  mentions: Schema.Array(Schema.String).pipe(Schema.mutable),
});

const getBookSection: Tool<BookSectionIn, BookSectionOut> = {
  id: 'book:get-section',
  name: 'Get Book Section',
  description: 'Retrieves a section of a book by ID (mocked content).',
  inputSchema: Schema.Struct({
    id: Schema.String,
    section: Schema.optional(Schema.String),
  }),
  outputSchema: BookSectionOutSchema,
  execute: ({ id }: BookSectionIn) =>
    Effect.succeed({
      source: 'book',
      id,
      title:
        id === 'bk-chandrakirti-12'
          ? 'Chandrakirti – On the Persons’ Selflessness'
          : 'Shantideva – Clarifying Persons’ Selflessness',
      text:
        id === 'bk-chandrakirti-12'
          ? 'Gross selflessness of persons is refuted by analyzing the self independent of aggregates; subtle selflessness negates even the imputation upon aggregates.'
          : 'Subtle selflessness of persons is the lack of a self even as a mere imputation; gross selflessness rejects a permanent unitary self separate from aggregates.',
      mentions:
        id === 'bk-chandrakirti-12'
          ? ['gross selflessness', 'subtle selflessness', 'aggregates']
          : ['subtle selflessness', 'gross selflessness', 'designation'],
    }),
};

// Fetch a (mock) audio transcript
type AudioIn = { id: string };
type AudioOut = {
  source: 'audio';
  id: string;
  title: string;
  transcript: string;
};

const AudioInSchema = Schema.Struct({ id: Schema.String });
const AudioOutSchema = Schema.Struct({
  source: Schema.Literal('audio'),
  id: Schema.String,
  title: Schema.String,
  transcript: Schema.String,
});

const getAudioTranscript: Tool<AudioIn, AudioOut> = {
  id: 'audio:get-transcript',
  name: 'Get Audio Transcript',
  description: 'Retrieves an audio teaching transcript by ID (mocked).',
  inputSchema: Schema.Struct({ id: Schema.String }),
  outputSchema: AudioOutSchema,
  execute: ({ id }: AudioIn) =>
    Effect.succeed({
      source: 'audio',
      id,
      title: 'Twofold Selflessness – Weekend Teaching',
      transcript:
        'In teaching, gross selflessness denies a self as an independent controller; subtle selflessness refines this by denying even a mere imputed controller over aggregates.',
    }),
};

// ---------- LLM-backed analysis/summarization tools (real calls) ----------

type CompareText = {
  source: string;
  type: 'book' | 'audio' | 'note';
  text: string;
};
type CompareIn = { texts: CompareText[]; focus?: string };
type CompareOut = {
  analysis: string;
  keyPoints: string[];
  clarityIssues?: string[];
};

const CompareTextSchema = Schema.Struct({
  source: Schema.String,
  type: Schema.Union(
    Schema.Literal('book'),
    Schema.Literal('audio'),
    Schema.Literal('note')
  ),
  text: Schema.String,
});
const CompareInSchema = Schema.Struct({
  texts: Schema.Array(CompareTextSchema).pipe(Schema.mutable),
  focus: Schema.optional(Schema.String),
});
const CompareOutSchema = Schema.Struct({
  analysis: Schema.String,
  keyPoints: Schema.Array(Schema.String).pipe(Schema.mutable),
  clarityIssues: Schema.optional(
    Schema.Array(Schema.String).pipe(Schema.mutable)
  ),
});

const llmCompare: Tool<CompareIn, CompareOut> = {
  id: 'llm:compare',
  name: 'LLM Compare',
  description: 'Uses LLM to compare descriptions and extract key points.',
  inputSchema: CompareInSchema,
  outputSchema: CompareOutSchema,
  execute: (input: CompareIn) =>
    Effect.gen(function* () {
      const model: AiModel = new OpenAiEffectModel();
      // Handle missing or empty texts
      const texts = input?.texts || [];
      if (texts.length === 0) {
        return {
          analysis: 'No texts provided for comparison',
          keyPoints: ['No texts available'],
          clarityIssues: [],
        };
      }
      const content = `Compare the following texts with respect to the focus.
Focus: ${input.focus ?? 'gross vs subtle selflessness of persons'}
Texts:
${texts
  .map((t, i) => `(${i + 1}) [${t.type}/${t.source}] ${t.text}`)
  .join('\n')}

Return clear contrasting points and note any areas that seem unclear or overlapping.`;
      const result = yield* model.completion({ content });
      // Crude post-process into shape
      const lines = result.content
        .split(/\n+/)
        .map((l) => l.trim())
        .filter(Boolean);
      const keyPoints = lines.slice(0, 6);
      const clarity = lines.filter((l) => /unclear|overlap|ambig/i.test(l));
      return { analysis: result.content, keyPoints, clarityIssues: clarity };
    }),
};

type ClarifyIn = {
  issues: string[];
  related: Array<{ source: string; text: string }>;
};
type ClarifyOut = { clarifications: string[] };

const ClarifyInSchema = Schema.Struct({
  issues: Schema.Array(Schema.String).pipe(Schema.mutable),
  related: Schema.Array(
    Schema.Struct({ source: Schema.String, text: Schema.String })
  ).pipe(Schema.mutable),
});
const ClarifyOutSchema = Schema.Struct({
  clarifications: Schema.Array(Schema.String).pipe(Schema.mutable),
});

const llmClarify: Tool<ClarifyIn, ClarifyOut> = {
  id: 'llm:clarify',
  name: 'LLM Clarify',
  description:
    'Uses LLM to clarify overlapping or unclear points using related texts.',
  inputSchema: ClarifyInSchema,
  outputSchema: ClarifyOutSchema,
  execute: (input: ClarifyIn) =>
    Effect.gen(function* () {
      const model: AiModel = new OpenAiEffectModel();
      const issues = input?.issues || [];
      const related = input?.related || [];
      if (issues.length === 0) {
        return { clarifications: [] };
      }
      const content = `Clarify the following issues using the provided related excerpts.
Issues:
${issues.map((i) => `- ${i}`).join('\n')}

Related excerpts:
${related.map((r) => `- [${r.source}] ${r.text}`).join('\n')}

Provide clear, concise clarifications for each issue.`;
      const result = yield* model.completion({ content });
      const clarifications = result.content
        .split(/\n+/)
        .map((l) => l.replace(/^[-•]\s*/, '').trim())
        .filter(Boolean)
        .slice(0, 8);
      return { clarifications };
    }),
};

type SummariseIn = {
  analysis: string;
  clarifications?: string[];
  audience?: 'plain' | 'scholarly';
};
type SummariseOut = { summary: string };

const SummariseInSchema = Schema.Struct({
  analysis: Schema.String,
  clarifications: Schema.optional(
    Schema.Array(Schema.String).pipe(Schema.mutable)
  ),
  audience: Schema.optional(
    Schema.Union(Schema.Literal('plain'), Schema.Literal('scholarly'))
  ),
});
const SummariseOutSchema = Schema.Struct({ summary: Schema.String });

const llmSummarise: Tool<SummariseIn, SummariseOut> = {
  id: 'llm:summarise',
  name: 'LLM Summarise',
  description: 'Produces a plain-language summary of the distinction.',
  inputSchema: SummariseInSchema,
  outputSchema: SummariseOutSchema,
  execute: (input: SummariseIn) =>
    Effect.gen(function* () {
      const model: AiModel = new OpenAiEffectModel();
      const analysis = input?.analysis || 'No analysis provided';
      const content = `Summarise the distinction between gross and subtle selflessness of persons in plain language (max 6 sentences).
Base analysis:
${analysis}

Clarifications (if any):
${(input?.clarifications ?? []).map((c) => `- ${c}`).join('\n')}`;
      const result = yield* model.completion({ content });
      return { summary: result.content };
    }),
};

type CheckContradictionsIn = { texts: string[] };
type CheckContradictionsOut = { contradictions: string[] };

const CheckContradictionsInSchema = Schema.Struct({
  texts: Schema.Array(Schema.String).pipe(Schema.mutable),
});
const CheckContradictionsOutSchema = Schema.Struct({
  contradictions: Schema.Array(Schema.String).pipe(Schema.mutable),
});

const llmCheckContradictions: Tool<
  CheckContradictionsIn,
  CheckContradictionsOut
> = {
  id: 'llm:check-contradictions',
  name: 'LLM Check Contradictions',
  description: 'Detects if parts contradict each other.',
  inputSchema: CheckContradictionsInSchema,
  outputSchema: CheckContradictionsOutSchema,
  execute: (input: CheckContradictionsIn) =>
    Effect.gen(function* () {
      const model: AiModel = new OpenAiEffectModel();
      const texts = input?.texts || [];
      if (texts.length === 0) {
        return { contradictions: ['No texts to check'] };
      }
      const content = `Review for contradictions across these notes/outputs. List contradictions succinctly or write "None".
${texts.map((t, i) => `(${i + 1}) ${t}`).join('\n\n')}`;
      const result = yield* model.completion({ content });
      const items = result.content
        .split(/\n+/)
        .map((l) => l.replace(/^[-•]\s*/, '').trim())
        .filter(Boolean)
        .slice(0, 8);
      return { contradictions: items.length ? items : ['None'] };
    }),
};

// ---------- Suggested joins to guide planning ----------

const joinSearchToBook: ToolJoin<SearchOut, BookSectionIn> = {
  fromTool: 'corpus:search',
  toTool: 'book:get-section',
  transform: Schema.transform(SearchOutSchema, BookSectionInSchema, {
    strict: true,
    decode: (out: SearchOut) => {
      const firstBook =
        out.results.find((r) => r.kind === 'book') ?? out.results[0];
      return { id: firstBook?.id ?? 'unknown-id' };
    },
    encode: (inp: BookSectionIn): SearchOut => ({
      results: [
        { id: inp.id, kind: 'book', title: 'Encoded', score: 0, tags: [] },
      ],
    }),
  }),
};

const joinSearchToAudio: ToolJoin<SearchOut, AudioIn> = {
  fromTool: 'corpus:search',
  toTool: 'audio:get-transcript',
  transform: Schema.transform(SearchOutSchema, AudioInSchema, {
    strict: true,
    decode: (out: SearchOut) => {
      const audio =
        out.results.find((r) => r.kind === 'audio') ?? out.results[0];
      return { id: audio?.id ?? 'unknown-id' };
    },
    encode: (inp: AudioIn): SearchOut => ({
      results: [
        { id: inp.id, kind: 'audio', title: 'Encoded', score: 0, tags: [] },
      ],
    }),
  }),
};

const joinBookToCompare: ToolJoin<BookSectionOut, CompareIn> = {
  fromTool: 'book:get-section',
  toTool: 'llm:compare',
  transform: Schema.transform(BookSectionOutSchema, CompareInSchema, {
    strict: true,
    decode: (b: BookSectionOut) => ({
      texts: [{ source: b.title, type: 'book' as const, text: b.text }],
      focus: 'gross vs subtle selflessness of persons',
    }),
    encode: (c: CompareIn): BookSectionOut => ({
      source: 'book',
      id: 'n/a',
      title: c.texts[0]?.source ?? 'Unknown',
      text: c.texts[0]?.text ?? '',
      mentions: [],
    }),
  }),
};

const joinAudioToCompare: ToolJoin<AudioOut, CompareIn> = {
  fromTool: 'audio:get-transcript',
  toTool: 'llm:compare',
  transform: Schema.transform(AudioOutSchema, CompareInSchema, {
    strict: true,
    decode: (a: AudioOut) => ({
      texts: [{ source: a.title, type: 'audio' as const, text: a.transcript }],
      focus: 'gross vs subtle selflessness of persons',
    }),
    encode: (c: CompareIn): AudioOut => ({
      source: 'audio',
      id: 'n/a',
      title: c.texts[0]?.source ?? 'Unknown',
      transcript: c.texts[0]?.text ?? '',
    }),
  }),
};

const joinCompareToClarify: ToolJoin<CompareOut, ClarifyIn> = {
  fromTool: 'llm:compare',
  toTool: 'llm:clarify',
  transform: Schema.transform(CompareOutSchema, ClarifyInSchema, {
    strict: true,
    decode: (c: CompareOut) => ({ issues: c.clarityIssues ?? [], related: [] }),
    encode: (_i: ClarifyIn): CompareOut => ({ analysis: '', keyPoints: [] }),
  }),
};

const joinCompareToSummarise: ToolJoin<CompareOut, SummariseIn> = {
  fromTool: 'llm:compare',
  toTool: 'llm:summarise',
  transform: Schema.transform(CompareOutSchema, SummariseInSchema, {
    strict: true,
    decode: (c: CompareOut) => ({
      analysis: c.analysis,
      clarifications: c.clarityIssues ?? [],
      audience: 'plain' as const,
    }),
    encode: (s: SummariseIn): CompareOut => ({
      analysis: s.analysis,
      keyPoints: s.clarifications ?? [],
    }),
  }),
};

const joinSummariseToContradictions: ToolJoin<
  SummariseOut,
  CheckContradictionsIn
> = {
  fromTool: 'llm:summarise',
  toTool: 'llm:check-contradictions',
  transform: Schema.transform(SummariseOutSchema, CheckContradictionsInSchema, {
    strict: true,
    decode: (s: SummariseOut) => ({ texts: [s.summary] }),
    encode: (c: CheckContradictionsIn): SummariseOut => ({
      summary: c.texts.join('\n') || '',
    }),
  }),
};

const joins: ReadonlyArray<
  | ToolJoin<SearchOut, BookSectionIn>
  | ToolJoin<SearchOut, AudioIn>
  | ToolJoin<BookSectionOut, CompareIn>
  | ToolJoin<AudioOut, CompareIn>
  | ToolJoin<CompareOut, ClarifyIn>
  | ToolJoin<CompareOut, SummariseIn>
  | ToolJoin<SummariseOut, CheckContradictionsIn>
> = [
  joinSearchToBook,
  joinSearchToAudio,
  joinBookToCompare,
  joinAudioToCompare,
  joinCompareToClarify,
  joinCompareToSummarise,
  joinSummariseToContradictions,
];

const tools = [
  corpusSearch,
  getBookSection,
  getAudioTranscript,
  llmCompare,
  llmClarify,
  llmSummarise,
  llmCheckContradictions,
] as const;

export async function runExample() {
  console.log(
    '🚀 DynamicFlow – Complex operators example (selflessness of persons)'
  );
  console.log('ℹ️  Retrieval tools are mocked; LLM calls are real.');

  loadEnv();
  const model: AiModel = new OpenAiEffectModel();

  // Use generate() → inspect plan (Flow JSON) → run
  const prompt =
    'Can you find where the books discuss the gross and subtle selflessness of persons? ' +
    'Compare how these two are described. If the descriptions are unclear or overlapping, ' +
    'try to clarify using related sections or audio teachings. Then summarise the distinction ' +
    'in plain language, and let me know if any parts contradict each other.';

  const instance = await DynamicFlow.generate({
    prompt,
    tools,
    joins,
    model,
  }).pipe(Effect.runPromise);

  const plan = instance.getPlanJSON();
  console.log('\n— Generated Flow Plan (JSON) —');
  console.log(JSON.stringify(plan, null, 2));

  // Execute and collect results using streaming
  console.log('\n— Streaming Execution —');
  const events: any[] = [];
  let finalResult: any = null;

  await instance.run().pipe(
    Stream.tap((event) =>
      Effect.sync(() => {
        console.log(
          `• ${event.type}${event.type === 'node-complete' ? ` — ${(event as any).nodeId}` : ''}`
        );
        events.push(event);
        if (event.type === 'flow-complete') {
          finalResult = (event as any).result;
        }
      })
    ),
    Stream.runDrain,
    Effect.runPromise
  );

  console.log('\n— Execution Result —');
  console.log(
    JSON.stringify(finalResult || 'No final result captured', null, 2)
  );

  return { plan, result: finalResult, events };
}

// Run if invoked directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runExample().catch((err) => {
    console.error('❌ Example failed:', err);
    process.exit(1);
  });
}

/**
 * Sample Output:
 * =============
 *
 * 🚀 DynamicFlow – Complex operators example (selflessness of persons)
 * ℹ️  Retrieval tools are mocked; LLM calls are real.
 *
 * — Generated Flow Plan (JSON) —
 * {
 *   "version": "1.0",
 *   "metadata": {
 *     "name": "Gross vs Subtle Selflessness of Persons - Discovery, Comparison, Clarification, Summary",
 *     "description": "Search corpus, retrieve relevant book sections and audio, compare gross vs subtle selflessness of persons, clarify if unclear, summarise plainly, and check contradictions.",
 *     "generated": true,
 *     "timestamp": "2025-08-19T21:19:09.422Z"
 *   },
 *   "nodes": [
 *     {
 *       "id": "s1",
 *       "type": "tool",
 *       "toolId": "corpus:search",
 *       "inputs": {},
 *       "description": "Search corpus for discussions of gross and subtle selflessness of persons in books and audio."
 *     },
 *     {
 *       "id": "s2",
 *       "type": "parallel",
 *       "parallel": [{"id": "s3", "tool": "book:get-section"}, {"id": "s4", "tool": "audio:get-transcript"}],
 *       "description": "In parallel, fetch top relevant book sections and audio transcripts from $s1.output."
 *     },
 *     {
 *       "id": "s5",
 *       "type": "tool",
 *       "toolId": "llm:compare",
 *       "description": "Compare how 'gross' vs 'subtle' selflessness of persons are described..."
 *     },
 *     {
 *       "id": "s6",
 *       "type": "if-then",
 *       "condition": "contains($s5.output, 'unclear') || contains($s5.output, 'overlap')",
 *       "if_true": [{"id": "s7", "tool": "llm:clarify"}],
 *       "description": "If descriptions appear unclear or overlapping, run clarification using related texts."
 *     },
 *     {
 *       "id": "s8",
 *       "type": "tool",
 *       "toolId": "llm:summarise",
 *       "description": "Produce a plain-language summary of the distinction..."
 *     },
 *     {
 *       "id": "s9",
 *       "type": "tool",
 *       "toolId": "llm:check-contradictions",
 *       "description": "Check the plain-language summary for internal contradictions..."
 *     }
 *   ],
 *   "edges": [
 *     { "from": "s1", "to": "s2" },
 *     { "from": "s2", "to": "s5" },
 *     { "from": "s5", "to": "s6" },
 *     { "from": "s6", "to": "s8" },
 *     { "from": "s8", "to": "s9" }
 *   ]
 * }
 *
 * — Streaming Execution —
 * • flow-start
 * • node-start
 * • tool-start
 * • tool-output
 * • node-complete — s1
 * • node-start
 * • node-error       // Parallel node limitation
 * • node-start
 * • tool-start
 * • tool-output
 * • node-complete — s5
 * • node-start
 * • node-complete — s6
 * • node-start
 * • tool-start
 * • tool-output
 * • node-complete — s8
 * • node-start
 * • tool-start
 * • tool-output
 * • node-complete — s9
 * • flow-complete
 *
 * — Execution Result —
 * {
 *   "s1": {
 *     "results": [
 *       {
 *         "id": "bk-chandrakirti-12",
 *         "kind": "book",
 *         "title": "Introduction to Madhyamaka – Selflessness of Persons",
 *         "score": 0.94,
 *         "tags": ["selflessness", "persons", "gross", "analysis"]
 *       },
 *       {
 *         "id": "bk-shantideva-9",
 *         "kind": "book",
 *         "title": "Bodhicaryavatara – View Chapter notes",
 *         "score": 0.86,
 *         "tags": ["selflessness", "persons", "subtle", "aggregate"]
 *       },
 *       {
 *         "id": "aud-2021-03-14",
 *         "kind": "audio",
 *         "title": "Weekend Teaching – Twofold Selflessness",
 *         "score": 0.78,
 *         "tags": ["teaching", "selflessness", "clarification"]
 *       }
 *     ]
 *   },
 *   "s8": {
 *     "summary": "Gross selflessness of persons says there is no permanent, unitary, independent 'me' that stands apart from or controls the body and mind. It denies a fixed, soul-like self and targets the coarse belief in an inner boss. Subtle selflessness of persons goes further: even the changing, everyday 'I' lacks any inherent core; it exists only as a label dependent on the aggregates, causes, and concepts. So, while persons work perfectly well in everyday life, no self can be found under ultimate analysis. Realizing the gross level weakens crude self-grasping; realizing the subtle level uproots the deeper belief in inherent existence."
 *   },
 *   "s9": {
 *     "contradictions": ["No texts to check"]
 *   }
 * }
 *
 * Notes:
 * - The parallel node encounters an error, limiting data flow to downstream tools
 * - LLM tools handle missing inputs gracefully with defensive checks
 * - Despite data flow issues, the pipeline demonstrates complex orchestration
 * - The final summary is generated by the LLM based on general knowledge
 * - Flow generation time: ~30 seconds (OpenAI structured output)
 * - Execution time: <1 second (mocked retrieval tools)
 */

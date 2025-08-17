# Dynamic Examples (OpenAI)

Real dynamic-flow examples that call OpenAI directly (no mocks).

Setup:

- Set `OPENAI_API_KEY` in your environment.
- Node 18+ is required.

Run the index (streams and collects):

```
npx tsx examples/dynamic/index.ts
```

Or run individual files, e.g.:

```
npx tsx examples/dynamic/01-execute.ts
npx tsx examples/dynamic/02-streaming.ts
```

Notes:

- `OpenAiEffectModel` uses the central LLM service.
- Use `DynamicFlow.execute(...)` for streaming and `DynamicFlow.generate(...).runCollect()` for sync collection.

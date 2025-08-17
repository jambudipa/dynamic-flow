# DynamicFlow Examples

This directory contains comprehensive examples demonstrating the DynamicFlow library's capabilities using the current
API patterns.

## Quick Start

First, make sure you have the required dependencies installed:

```bash
npm install effect @effect/schema @effect/ai tsx dotenv glob
```

## Validation and Testing

Run all examples and validate they work correctly:

```bash
# Run all examples with validation
npx tsx examples/test-runner.ts

# Check TypeScript compilation
npx tsc --noEmit --project examples/tsconfig.json
```

## Available Examples

### ⚡ Dynamic Flows — Tools + Prompt API (Streaming supported)

Use the high-level DynamicFlow API by providing tools and a prompt; planning, validation, and execution happen
internally.

Run the examples aggregator:

```bash
npx tsx examples/dynamic/index.ts
```

What it shows:

- Provide a list of typed tools and optional joins
- Call `DynamicFlow.execute({ prompt, tools, joins, model })` to stream events
- Or `DynamicFlow.generate(...)` to create an instance and `runCollect()` (non-streaming)
- Uses a simple mock model; swap in a real model when ready

Switching streaming/non-streaming:

- Dynamic: use `execute()` for streaming; use `generate().runCollect()` for non-streaming
- Static: use `Flow` + tools for non-streaming; or call `LLMCoreService.stream()` for token streaming (see
  `static/10-llm-call-streaming.ts`)

### 📁 `/static/` - Pre-defined Examples

Basic examples showing core concepts and simple flows.

- `01-hello-world.ts` - Simplest possible flow
- `02-sequential.ts` - Sequential tool execution
- `03-parallel.ts` - Parallel execution
- `04-conditional.ts` - Conditional logic
- `05-error-handling.ts` - Error handling patterns
- `06-llm-call.ts` - Call an LLM tool directly
- `07-tools-and-llm.ts` - Compose tools and LLM in a single flow
- `08-llm-with-data.ts` - Build a flow that queries an LLM about mock data
- `09-tool-join.ts` - Tool joins: type mismatch and Schema.transform fix (with advanced mapping)
- `10-llm-call-streaming.ts` - Static: stream tokens directly via LLM service
- `11-llm-openai-tool.ts` - Static: OpenAI tool via LLMLive
- `12-switch-routing.ts` - Static: LLM-guided routing with switchRoute (Responses JSON Schema)
- `13-structured-smoke.ts` - Static: minimal structured outputs smoke test
- `14-responses-raw.ts` - Static: raw Responses API JSON Schema request (debug helper)
- `15-mcp-curl.ts` - Static: call an MCP server (`server-curl`) and summarise via LLM

### 🔌 MCP (Model Context Protocol) Examples

Run a simple MCP server over stdio and consume its tools from DynamicFlow examples.

Prerequisites:

- Install MCP SDK and the curl server: `npm i -D @modelcontextprotocol/sdk @modelcontextprotocol/server-curl`
- Set `OPENAI_API_KEY` in `.env` for LLM summarisation/plan generation.

Run example:

- Static: `npx tsx examples/static/15-mcp-curl.ts`

## Running Examples with Real AI Models

To use real AI models instead of mocks, install the appropriate Effect AI packages:

```bash
# For OpenAI
npm install @effect/ai-openai

# For Claude (via Anthropic)
npm install @effect/ai-anthropic

# For local models
npm install @effect/ai-ollama
```

Then set environment variables:

```bash
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."
```

Update the model creation in examples:

```typescript
import { OpenAi } from '@effect/ai-openai';

const model = OpenAi.completion('gpt-4');
```

## Example Output Structure

Most examples follow this pattern:

1. **Setup Phase**: Define tools, joins, and models
2. **Construction Phase**: Build flows using Builder API or generate with LLM
3. **Execution Phase**: Run flows with streaming events
4. **Results Phase**: Display outcomes and metrics

## Key Concepts Demonstrated

### 🔧 **Tools**

Reusable functions with typed inputs/outputs using Effect.Schema:

```typescript
const searchTool: Tool = {
  id: 'search',
  name: 'Web Search',
  inputSchema: S.struct({ query: S.string }),
  outputSchema: S.struct({ results: S.array(S.unknown) }),
  execute: async (input) => ({ results: [] }),
};
```

### 🔗 **Tool Joins**

Type-safe data transformations between tools using Schema.transform:

```typescript
const join: ToolJoin = {
  fromTool: 'search',
  toTool: 'analyze',
  transform: S.transform(
    S.Struct({ results: S.Array(S.Unknown) }), // From schema
    S.Struct({ data: S.Unknown }), // To schema
    {
      strict: true,
      decode: (search) => ({ data: search.results }),
      encode: (analyze) => ({ results: [analyze.data] }),
    }
  ),
};
```

### 🌊 **Streaming Execution**

Real-time event processing:

```typescript
await pipe(
  DynamicFlow.execute(prompt, tools, joins, { model }),
  Stream.tap((event) =>
    Effect.sync(() => {
      console.log(`Event: ${event.type} - ${event.nodeId}`);
    })
  ),
  Stream.runCollect,
  Effect.runPromise
);
```

### 🧭 **DynamicFlow API**

- `DynamicFlow.execute(...)`: Streams `FlowEvent`s during execution
- `DynamicFlow.generate(...)`: Returns a `DynamicFlowInstance` for later execution

### 📊 **Functional Operations**

- **Map**: Transform each item in a collection
- **Filter**: Keep items matching conditions
- **Reduce**: Aggregate collection into single value
- **Conditional**: Branch execution based on conditions

### 🎯 **Using Real Models**

Replace the mock model with a real one from `@effect/ai-*` and pass it as `model`.

## Supporting Files

### Core Utilities

- `env.ts` - Environment configuration and validation
- `tools-registry.ts` - Common tools used across examples
- `test-runner.ts` - Comprehensive example validation suite
- `tsconfig.json` - TypeScript configuration for examples

### Environment Setup

Create a `.env` file in the project root:

```bash
OPENAI_API_KEY=sk-your-key-here
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

The examples will use mock implementations when API keys are not provided.

## Troubleshooting

### Common Issues

1. **Import Errors**: Make sure all Effect packages are installed
2. **Model Errors**: Check API keys and model availability
3. **Type Errors**: Ensure proper Effect.Schema definitions
4. **Memory Issues**: Adjust concurrency limits for large datasets
5. **Compilation Errors**: Run `npx tsc --noEmit --project examples/tsconfig.json` to check

### Debug Mode

Enable debug output by setting:

```bash
export DEBUG=dynamic-flow:*
```

### Performance Tips

- Use model pools for parallel LLM operations
- Implement proper error handling with retries
- Monitor memory usage with large datasets
- Cache generated flows for repeated patterns
- Run validation regularly with `test-runner.ts`

## Next Steps

After trying these examples:

1. **Build Your Own Tools**: Create domain-specific tools for your use case
2. **Integrate Real Models**: Connect to OpenAI, Claude, or local models
3. **Production Setup**: Add proper error handling, monitoring, and logging
4. **Custom Operations**: Extend functional operations for your needs

For more information, see the main project documentation.

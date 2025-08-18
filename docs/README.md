# DynamicFlow Documentation

Welcome to the comprehensive documentation for DynamicFlow - the only AI orchestration framework that generates complete execution graphs at runtime.

## What is DynamicFlow?

DynamicFlow breaks the constraints of traditional workflow frameworks by enabling AI models to create entire workflow topologies from natural language prompts. This isn't dynamic routing through pre-defined graphs - it's dynamic generation of the graph structure itself.

### Core Innovation: Two-Phase Architecture

1. **Planning Phase**: AI analyses your prompt and generates a complete execution graph
2. **Execution Phase**: Deterministic execution without additional LLM calls

This approach provides the flexibility of AI planning with the reliability of deterministic execution.

## Core Execution Scenarios

Understanding the different execution modes helps you choose the right approach for your use case:

### 1. Static Sync (Programmatic Flows)
Direct execution of pre-defined flows using the pipeable API.

```typescript
import { Flow } from '@jambudipa/dynamic-flow'
import { Effect, pipe } from 'effect'

const weatherFlow = pipe(
  Effect.succeed({ city: 'London' }),
  Flow.andThen(fetchWeather),
  Flow.map(weather => `Temperature: ${weather.temp}°C`)
)

const result = await Effect.runPromise(
  Flow.run(weatherFlow)
)
```

**Use Cases:**
- Well-defined business processes
- Performance-critical operations
- Situations requiring compile-time guarantees

### 2. Static Streaming (Programmatic with Events)
Static flows with real-time event monitoring.

```typescript
await pipe(
  Flow.runStream(weatherFlow),
  Stream.tap(event => Effect.sync(() => {
    console.log(`Event: ${event.type}`)
  })),
  Stream.runDrain,
  Effect.runPromise
)
```

**Use Cases:**
- Long-running operations requiring monitoring
- Real-time dashboards and progress tracking
- Debugging and observability

### 3. Dynamic Sync (AI-Generated, Collected Results)
AI generates the workflow, executes without streaming.

```typescript
const result = await pipe(
  DynamicFlow.execute({
    prompt: "Check London weather and email summary to user",
    tools: [weatherTool, emailTool],
    joins: [],
    model: OpenAi.completion('gpt-4')
  }),
  Stream.runCollect,
  Effect.runPromise
)
```

**Use Cases:**
- Batch processing
- Simple automation tasks
- When you only need final results

### 4. Dynamic Streaming (AI-Generated with Real-time Events)
AI generates the workflow with real-time execution monitoring.

```typescript
await pipe(
  DynamicFlow.execute({
    prompt: "Process customer support ticket with full workflow tracking",
    tools: supportTools,
    joins: [],
    model
  }),
  Stream.tap(event => Effect.sync(() => {
    console.log(`${event.type}: ${event.nodeId || 'flow'}`)
  })),
  Stream.runDrain,
  Effect.runPromise
)
```

**Use Cases:**
- Interactive applications
- Complex business processes
- Customer-facing automation
- Operations requiring auditability

## Quick Start

### Installation

```bash
npm install @jambudipa/dynamic-flow effect
```

### Your First Flow

```typescript
import { Flow } from '@jambudipa/dynamic-flow'
import { Effect, pipe } from 'effect'

// Simple static flow
const helloFlow = pipe(
  Effect.succeed("Hello"),
  Flow.andThen(greeting => Effect.succeed(`${greeting}, World!`)),
  Flow.map(message => message.toUpperCase())
)

const result = await Effect.runPromise(
  Flow.run(helloFlow)
)
console.log(result) // "HELLO, WORLD!"
```

### Your First Dynamic Flow

```typescript
import { DynamicFlow, Tools } from '@jambudipa/dynamic-flow'
import { OpenAi } from '@effect/ai-openai'

const weatherTool = Tools.createTool({
  id: 'fetchWeather',
  name: 'Weather Fetcher',
  description: 'Get current weather for any city',
  inputSchema: Schema.Struct({ city: Schema.String }),
  outputSchema: Schema.Struct({ temp: Schema.Number, conditions: Schema.String }),
  execute: (input, context) =>
    Effect.succeed({ temp: 22, conditions: 'sunny' })
})

await pipe(
  DynamicFlow.execute({
    prompt: "Check the weather in Paris and tell me if it's nice for a walk",
    tools: [weatherTool],
    joins: [],
    model: OpenAi.completion('gpt-4')
  }),
  Stream.tap(event => Effect.sync(() => {
    if (event.type === 'flow-complete') {
      console.log('Result:', event.result)
    }
  })),
  Stream.runDrain,
  Effect.runPromise
)
```

## Documentation Structure

### 📖 API Reference
Comprehensive API documentation for all components:

- **[Flow API](./api/flow.md)** - Pipeable operations for functional workflow composition
- **[Tools API](./api/tools.md)** - Creating and managing typed tools
- **[DynamicFlow API](./api/dynamic-flow.md)** - AI-powered workflow generation
- **[Persistence API](./api/persistence.md)** - Flow suspension and resumption

### 📚 Guides
Step-by-step guides for common scenarios:

- **[Getting Started](./guides/getting-started.md)** - Quick start guide and core concepts
- **[Pipeable Patterns](./guides/pipeable-patterns.md)** - Advanced functional composition patterns
- **[Dynamic Flows](./guides/dynamic-flows.md)** - AI-generated workflow best practices

### ⭐ Features
Deep dives into key capabilities:

- **[Runtime Graph Generation](./features/runtime-graph-generation.md)** - How AI creates workflows
- **[Effect Integration](./features/effect-integration.md)** - Functional programming benefits
- **[Persistence](./api/persistence.md)** - Flow suspension and resumption
- **[LLM Conversation Routing](../src/examples/static/16-conversation-final.ts)** - See working conversation example
- **[MCP Integration](../src/examples/static/15-mcp-curl.ts)** - Model Context Protocol tools

### 🎯 Examples
Working code examples organised by use case:

- **[Static Examples](../src/examples/static/)** - Programmatic flows demonstrating core concepts
- **[Dynamic Examples](../src/examples/dynamic/)** - AI-generated workflow examples
- **[Conversation Example](../src/examples/static/16-conversation-final.ts)** - Interactive LLM conversation with persistence
- **[MCP Integration Example](../src/examples/static/15-mcp-curl.ts)** - Real MCP server integration with type-safe tools

## Key Concepts

### Tools: Building Blocks for AI

Tools are typed, reusable components that AI can orchestrate:

```typescript
const emailTool = Tools.createTool({
  id: 'sendEmail',
  name: 'Email Sender',
  description: 'Send emails with template support',
  inputSchema: Schema.Struct({
    to: Schema.String,
    subject: Schema.String,
    body: Schema.String
  }),
  outputSchema: Schema.Struct({
    sent: Schema.Boolean,
    messageId: Schema.String
  }),
  execute: (input, context) =>
    Effect.succeed({
      sent: true,
      messageId: `msg_${Date.now()}`
    })
})
```

### Flows: Functional Composition

Flows use pipeable operations for type-safe composition:

```typescript
const userOnboardingFlow = pipe(
  Effect.succeed(userData),
  Flow.andThen(validateUser),
  Flow.andThen(createAccount),
  Flow.parallel({
    email: sendWelcomeEmail,
    profile: createProfile,
    preferences: setDefaults
  }),
  Flow.catchAll(handleError)
)
```

### Dynamic Generation: AI-Powered Workflows

AI creates complete workflows from natural language:

```typescript
const dynamicWorkflow = await DynamicFlow.execute({
  prompt: `
    Process a customer refund request:
    1. Validate the request details
    2. Check refund eligibility  
    3. Calculate refund amount
    4. Process the refund
    5. Send confirmation to customer
    6. Update order status
  `,
  tools: [validateTool, checkEligibilityTool, calculateTool, processTool, emailTool, updateTool],
  joins: [],
  model: OpenAi.completion('gpt-4')
})
```

## Architecture Overview

### Component Stack

```
┌─────────────────────────────────────┐
│ Natural Language Prompts           │
├─────────────────────────────────────┤
│ AI Planning Layer (LLM)             │
├─────────────────────────────────────┤
│ Graph Generation & Validation       │
├─────────────────────────────────────┤
│ Intermediate Representation (IR)    │
├─────────────────────────────────────┤
│ Flow Execution Engine               │
├─────────────────────────────────────┤
│ Tool Registry & Management          │
├─────────────────────────────────────┤
│ Effect Foundation               │
└─────────────────────────────────────┘
```

### Data Flow

```
Prompt → LLM → JSON Graph → IR → Execution → Events/Results
```

1. **Prompt Analysis**: LLM understands requirements
2. **Graph Generation**: Complete workflow structure created
3. **IR Compilation**: JSON converted to executable representation
4. **Deterministic Execution**: No additional LLM calls
5. **Real-time Events**: Streaming monitoring and results

## Framework Comparison

| Feature | DynamicFlow | LangGraph | TaskWeaver | CrewAI |
|---------|-------------|-----------|------------|---------|
| **Graph Generation** | ✅ Complete | ❌ Static | ❌ Code only | ❌ Static |
| **Runtime Topology** | ✅ Per-prompt | ❌ Pre-defined | ❌ Linear | ❌ Fixed |
| **Deterministic Execution** | ✅ Always | ⚠️ Optional | ✅ Yes | ✅ Flows |
| **Type Safety** | ✅ Full Effect | ✅ TypeScript | ⚠️ Python | ⚠️ Python |
| **Functional Paradigm** | ✅ Effect-based | ❌ OOP | ❌ Imperative | ❌ OOP |
| **Real-time Events** | ✅ Built-in | ⚠️ Limited | ❌ No | ⚠️ Limited |

## Community and Support

### Getting Help

- **[GitHub Issues](https://github.com/jambudipa/dynamic-flow/issues)** - Bug reports and feature requests
- **[GitHub Discussions](https://github.com/jambudipa/dynamic-flow/discussions)** - Questions and community chat
- **[Examples Repository](../src/examples/)** - Working code examples
- **[API Documentation](./api/)** - Complete API reference

### Contributing

We welcome contributions! Please:

1. Check existing [Issues](https://github.com/jambudipa/dynamic-flow/issues)
2. Join [Discussions](https://github.com/jambudipa/dynamic-flow/discussions)
3. Submit PRs with tests and documentation
4. Follow the code style and conventions in the codebase

### Roadmap

- **Enhanced AI Models**: Support for more LLM providers
- **Visual Flow Editor**: GUI for workflow visualization
- **Enterprise Features**: Advanced security and compliance
- **Performance Optimizations**: Faster graph generation and execution
- **More Integrations**: Additional tool libraries and connectors

## Next Steps

1. **Start with [Getting Started](./guides/getting-started.md)** - Learn the basics
2. **Try the [Examples](../src/examples/)** - See working code
3. **Read [Pipeable Patterns](./guides/pipeable-patterns.md)** - Master functional composition
4. **Explore [Dynamic Flows](./guides/dynamic-flows.md)** - Leverage AI generation
5. **Build Production Systems** - See examples and best practices

Ready to build AI workflows that generate their own execution graphs? Start with the [Getting Started Guide](./guides/getting-started.md)!

# DynamicFlow - Runtime AI Planning

## The Only Framework That Generates Complete Execution Graphs at Runtime

Unlike static workflow frameworks or dynamic routing systems, DynamicFlow **generates entire execution graphs from scratch** for each user prompt. Your AI doesn't just choose paths through a predefined graph - it creates the graph itself, then DynamicFlow executes it deterministically.

**Every prompt gets its own custom-generated graph topology. Every graph executes exactly as planned.**

## The Problem Nobody Talks About

Most AI frameworks fall into two traps:
1. **Static workflows** that can't adapt to varied user requests
2. **Free-form agents** that wander off-task during execution

You've seen it: An LLM starts with a good plan, but halfway through execution it "reconsiders", loops indefinitely, or simply forgets what it was doing.

## Why DynamicFlow Is Different

### The Critical Innovation: Complete Graph Generation

**What others do:**
- **LangGraph**: Define nodes and edges at compile time, route dynamically
- **TaskWeaver**: Generate Python code to execute tasks
- **Plan-and-Execute Agents**: Create sequences of predefined actions
- **AutoGen**: Generate and execute code with multiple LLM calls

**What DynamicFlow does:**
- Generates the **entire graph topology** from the prompt
- Creates **nodes, edges, conditions, and parallel branches** dynamically
- Outputs a **JSON graph definition** that's safe and debuggable
- Executes **deterministically without any LLM calls**

### The Two-Phase Architecture That Makes It Possible

#### Phase 1: AI Planning (Graph Generation)
Your LLM analyzes the user's request and generates a complete execution graph as JSON:
- **Dynamic node creation** based on the specific task
- **Custom edge definitions** connecting operations
- **Conditional branches** determined by the prompt
- **Parallel execution paths** when appropriate
- **All topology decisions made upfront**

**Example: "Analyze weather data and send notifications"**

The AI generates this complete workflow graph:
```json
{
  "version": "1.0",
  "metadata": {
    "name": "Weather Analysis Workflow",
    "description": "Check weather in multiple cities and send appropriate notifications",
    "generated": true,
    "timestamp": "2024-01-15T10:30:00Z"
  },
  "nodes": [
    {
      "id": "weather_london",
      "type": "tool",
      "toolId": "weather-api",
      "inputs": {
        "city": "London",
        "units": "celsius"
      }
    },
    {
      "id": "weather_paris",
      "type": "tool",
      "toolId": "weather-api",
      "inputs": {
        "city": "Paris",
        "units": "celsius"
      }
    },
    {
      "id": "weather_tokyo",
      "type": "tool",
      "toolId": "weather-api",
      "inputs": {
        "city": "Tokyo",
        "units": "celsius"
      }
    },
    {
      "id": "analyze_temps",
      "type": "tool",
      "toolId": "llm-analyzer",
      "inputs": {
        "prompt": "Compare these temperatures and identify any extreme weather: London: ${weather_london}, Paris: ${weather_paris}, Tokyo: ${weather_tokyo}",
        "max_tokens": 200
      }
    },
    {
      "id": "format_report",
      "type": "tool",
      "toolId": "template-formatter",
      "inputs": {
        "template": "Weather Report:\n- London: ${weather_london.temp}°C, ${weather_london.condition}\n- Paris: ${weather_paris.temp}°C, ${weather_paris.condition}\n- Tokyo: ${weather_tokyo.temp}°C, ${weather_tokyo.condition}\n\nAnalysis: ${analyze_temps.summary}"
      }
    },
    {
      "id": "send_email",
      "type": "tool",
      "toolId": "email-service",
      "inputs": {
        "to": "team@company.com",
        "subject": "Daily Weather Report",
        "body": "${format_report.output}"
      }
    }
  ],
  "edges": [
    {
      "from": "START",
      "to": ["weather_london", "weather_paris", "weather_tokyo"]
    },
    {
      "from": ["weather_london", "weather_paris", "weather_tokyo"],
      "to": "analyze_temps"
    },
    {
      "from": "analyze_temps",
      "to": "format_report"
    },
    {
      "from": "format_report",
      "to": "send_email"
    },
    {
      "from": "send_email",
      "to": "END"
    }
  ]
}
```

#### Phase 2: Deterministic Execution
DynamicFlow's execution engine interprets the JSON graph:
- **No more LLM calls** during execution
- **No graph structure changes** mid-execution
- **Predictable, debuggable behavior**
- **Full type safety** through Effect
- **Guaranteed completion** without infinite loops

## Core Features

### 🎯 True Runtime Graph Generation
The only framework that generates complete execution graphs per-prompt - not routing, not code, but actual graph structures.

### ⚡ Effect-Based Architecture
First AI framework built on Effect for robust error handling, dependency injection, and composability.

### 🔄 Production-Ready Persistence
Complete state management with multiple backends and human-in-the-loop workflows:
- Multiple storage backends (Filesystem, PostgreSQL, Redis, MongoDB, Neo4j)
- Automatic state serialization with encryption
- Suspension/resumption with branded `SuspensionKey` types
- Human approval and input workflows

### 🤖 LLM Conversation Routing
Advanced LLM integration with intelligent routing:
- `Flow.switchRoute` for LLM-powered decision making
- Conversation memory and context preservation
- Real-time terminal interfaces
- Structured conversation flows with persistence

### 🔌 MCP Server Integration (NEW)
Production-ready Model Context Protocol server discovery and integration:
- **Real MCP server discovery** with automatic tool generation
- **Type-safe MCP tools** with proper TypeScript inference
- **Per-server tool generation** from discovered capabilities
- **Production MCP connections** (no mocks) with cleanup

## Featured Examples - Try Them Now!

### 🗣️ Interactive LLM Conversation with Persistence
Experience DynamicFlow's conversation capabilities:

```bash
export OPENAI_API_KEY=your_key_here
npx tsx src/examples/static/16-conversation-final.ts
```

**Features demonstrated:**
- LLM-powered conversation routing using `Flow.switchRoute`
- Filesystem persistence with automatic state saving
- Natural terminal conversation interface
- Real OpenAI integration with memory
- Proper suspension/resumption handling

### 🔧 MCP Server Integration
See real MCP server discovery and tool generation:

```bash
npx tsx src/examples/static/15-mcp-curl.ts
```

**Features demonstrated:**
- Real MCP filesystem server connections
- Type-safe tool generation (`string` returns, not `unknown`)
- Production MCP protocol integration
- Automatic cleanup and connection management

**Generate your own MCP tools:**
```bash
# Discover MCP servers
npx tsx src/lib/cli/mcp-discovery.ts discover --source network > servers.json

# Generate typed tools
npx tsx src/lib/cli/mcp-discovery.ts generate -i servers.json -o src/generated/mcp-tools

# Use in your flows with full type safety!
```

## Human-in-the-Loop Workflows

DynamicFlow provides powerful persistence capabilities for workflows requiring human interaction:

```typescript
import { Effect, Schema, Duration } from 'effect'
import { createPersistenceHub, AwaitInputPresets, BackendFactory } from '@jambudipa/dynamic-flow'

// Setup filesystem storage backend
const backend = await Effect.runPromise(
  BackendFactory.create({
    type: 'filesystem',
    config: { basePath: './suspended-flows' }
  })
)

// Create persistence hub
const hub = await Effect.runPromise(
  createPersistenceHub(backend, {
    enableEncryption: false,
    enableCompression: true,
    defaultTimeout: Duration.hours(24)
  })
)

// Create approval tool that suspends flow
const approvalTool = AwaitInputPresets.approval(
  'manager-approval',
  'Manager Approval',
  'Requires manager approval'
).withTimeout(Duration.hours(4)).build(hub)

// Execute tool directly - this will suspend
try {
  const result = await Effect.runPromise(
    approvalTool.execute(undefined, executionContext)
  )
} catch (suspensionSignal) {
  if (suspensionSignal instanceof FlowSuspensionSignal) {
    console.log('Flow suspended:', suspensionSignal.suspensionKey)
    
    // Later, resume with approval
    const approval = { approved: true, approvedBy: "manager@company.com" }
    const resumed = await Effect.runPromise(
      hub.resume(suspensionSignal.suspensionKey, approval)
    )
  }
}
```

## LLM Conversation Routing

DynamicFlow treats LLMs as powerful tools with intelligent routing capabilities:

```typescript
import { Flow } from '@jambudipa/dynamic-flow'
import { LLMServiceLive } from '@jambudipa/dynamic-flow'
import { Effect, pipe } from 'effect'

// Available tools for conversation
const availableTools = [
  weatherTool,
  calculatorTool, 
  emailTool,
  fileSearchTool
]

// Create conversation flow with LLM routing
const conversationFlow = pipe(
  Flow.succeed(conversationInput),
  
  // LLM decides which tool to use based on user input
  Flow.switchRoute(
    'Analyze the user request and select the most appropriate tool',
    availableTools,
    {
      weather: (input) => handleWeatherRequest(input),
      calculator: (input) => handleCalculation(input),
      email: (input) => handleEmail(input),
      fileSearch: (input) => handleFileSearch(input)
    }
  )
)

// Execute with OpenAI integration
const result = await Effect.runPromise(
  pipe(
    Flow.run(conversationFlow),
    Effect.provide(LLMServiceLive)
  )
)
```

**Real Working Example:**
```bash
npx tsx src/examples/static/16-conversation-final.ts
```

## MCP Server Integration

DynamicFlow includes production-ready MCP (Model Context Protocol) integration:

### Discover & Generate Tools
```bash
# Discover available MCP servers
npx tsx src/lib/cli/mcp-discovery.ts discover --source network --output json

# Generate tools from specific server
npx tsx src/lib/cli/mcp-discovery.ts discover \
  --source url \
  --filter "stdio://npx @modelcontextprotocol/server-filesystem /tmp" \
  > filesystem-server.json

# Generate TypeScript tools with proper typing
npx tsx src/lib/cli/mcp-discovery.ts generate \
  -i filesystem-server.json \
  -o src/generated/filesystem-tools
```

### Use Generated Tools with Full Type Safety
```typescript
// Generated tools have proper TypeScript types
import { read_text_fileTool, list_directoryTool } from '../generated/filesystem-tools'

// read_text_fileTool returns string (not unknown!)
const fileContent: string = await read_text_fileTool.execute({ 
  path: '/path/to/file.txt' 
})

// list_directoryTool returns Array<{name: string, type: 'file' | 'directory', size?: number}>
const files = await list_directoryTool.execute({ path: '/path/to/dir' })
```

**MCP Integration Features:**
- **Per-server discovery**: Each MCP server gets its own tool file
- **Smart type inference**: Tool return types inferred from names and capabilities  
- **Real connections**: Production MCP protocol, not mocks
- **Automatic cleanup**: Proper connection management and disconnection

## Quick Start

```bash
npm install @jambudipa/dynamic-flow effect
```

### Basic Flow Composition
```typescript
import { Flow } from '@jambudipa/dynamic-flow'
import { Effect, pipe } from 'effect'

// Create a simple flow
const myFlow = pipe(
  Effect.succeed("Hello"),
  Flow.andThen(greeting => Effect.succeed(`${greeting}, World!`)),
  Flow.map(message => message.toUpperCase())
)

// Run the flow
const result = await Effect.runPromise(
  Flow.run(myFlow)
)
console.log(result) // "HELLO, WORLD!"
```

### Create Tools with Schema Validation
```typescript
import { Tools } from '@jambudipa/dynamic-flow'
import { Schema } from 'effect'

const weatherTool = Tools.createTool({
  id: 'weather',
  name: 'Weather Fetcher',
  description: 'Get current weather for a city',
  inputSchema: Schema.Struct({
    city: Schema.String
  }),
  outputSchema: Schema.Struct({
    temperature: Schema.Number,
    conditions: Schema.String,
    humidity: Schema.Number
  }),
  execute: (input, context) => Effect.succeed({
    temperature: 72,
    conditions: 'sunny',
    humidity: 45
  })
})

// Use in flows with full type safety
const weatherFlow = Flow.pipe(
  Flow.input(CitySchema),
  Flow.tool(weatherTool),
  Flow.map(weather => `It's ${weather.temperature}°F and ${weather.conditions}`)
)
```

## Learn More

### 📚 Documentation
Comprehensive guides and API references are available in the [`/docs`](./docs) directory:

#### 🚀 Getting Started
- **[Complete Documentation Index](./docs/README.md)** - Overview of all documentation
- **[Getting Started Guide](./docs/guides/getting-started.md)** - Quick start and core concepts

#### 📖 API Reference  
- **[Flow API](./docs/api/flow.md)** - Pipeable operations for functional composition
- **[Tools API](./docs/api/tools.md)** - Creating and managing typed tools
- **[Persistence API](./docs/api/persistence.md)** - Flow suspension and resumption

#### 📚 Guides
- **[Pipeable Patterns](./docs/guides/pipeable-patterns.md)** - Advanced functional composition
- **[DynamicFlows](./docs/guides/dynamic-flows.md)** - AI-generated workflows

### 🚀 More Examples
- **[All Static Examples](src/examples/static/)** - Complete working examples
- **[LLM Integration Examples](src/examples/static/06-llm-call.ts)** - OpenAI integration
- **[Persistence Examples](src/examples/static/)** - Human-in-the-loop workflows

### 💬 Community
Join the discussion: [GitHub Issues](https://github.com/jambudipa/dynamic-flow/issues) | [GitHub Discussions](https://github.com/jambudipa/dynamic-flow/discussions)

## Why Choose DynamicFlow?

| Feature | DynamicFlow | LangGraph | TaskWeaver | CrewAI | AutoGen |
|---------|------------|-----------|------------|---------|----------|
| **Runtime Graph Generation** | ✅ Complete | ❌ Static | ❌ Code only | ❌ Static | ❌ Code only |
| **Graph Topology Per-Prompt** | ✅ Yes | ❌ No | ❌ No | ❌ No | ❌ No |
| **Deterministic Execution** | ✅ Always | ⚠️ Optional | ✅ Yes | ✅ Flows | ⚠️ Varies |
| **Type Safety** | ✅ Full Effect | ✅ TypeScript | ⚠️ Python | ⚠️ Python | ⚠️ Python |
| **Persistence** | ✅ Multi-backend | ✅ Yes | ⚠️ Stateful | ✅ Yes | ❌ No |
| **LLM Conversation** | ✅ Advanced routing | ⚠️ Basic | ❌ No | ⚠️ Basic | ✅ Multi-agent |
| **MCP Integration** | ✅ Production ready | ❌ No | ❌ No | ❌ No | ❌ No |
| **Effect Based** | ✅ Yes | ❌ No | ❌ No | ❌ No | ❌ No |

## The Bottom Line

DynamicFlow is the only framework that:
1. **Generates complete execution graphs** (not just plans or code) at runtime
2. **Creates unique graph topologies** for each prompt (not routing through static graphs)  
3. **Executes deterministically** without LLM involvement after planning
4. **Uses Effect** for functional, type-safe workflow composition
5. **Provides production-ready persistence** with multiple backends and human workflows
6. **Includes intelligent LLM conversation routing** with memory and context
7. **Integrates with MCP servers** for real tool discovery and type-safe generation

This isn't an incremental improvement - it's a fundamentally different approach to AI orchestration.

## Status

- **Production-ready core**: Flow composition, persistence, and MCP integration are stable
- **Active development**: Performance optimizations and additional features in progress  
- **Feedback welcome**: Please share ideas via GitHub Issues or Discussions

## Next Steps

- Performance optimizations for dynamic flow generation
- Additional MCP server integrations
- Enhanced conversation routing capabilities
- More comprehensive testing suite

## License

MIT © DynamicFlow Contributors

---

Built with ❤️ by [JAMBUDIPA](https://jambudipa.io)

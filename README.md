# DynamicFlow - Runtime AI Planning

## The Only Framework That Generates Complete Execution Graphs at Runtime

Unlike static workflow frameworks or dynamic routing systems, DynamicFlow **generates entire execution graphs from scratch** for each user prompt. Your AI doesn't just choose paths through a predefined graph - it creates the graph itself, then DynamicFlow executes it deterministically.

**Every prompt gets its own custom-generated graph topology. Every graph executes exactly as planned.**

## The Problem Nobody Talks About

Most AI frameworks fall into two traps:
1. **Static workflows** that can't adapt to varied user requests
2. **Free-form agents** that wander off-task during execution

You've seen it: An LLM starts with a good plan, but halfway through execution it "reconsiders", loops indefinitely, or simply forgets what it was doing.

## Why Runtime Graph Generation Matters

Other frameworks force you to:
- **Define all possible nodes at compile time** (LangGraph requires predefined StateGraphs)
- **Specify graph topology beforehand** (CrewAI, n8n need pre-built workflows)
- **Generate code snippets rather than workflows** (TaskWeaver produces Python code, not graphs)
- **Use predefined action sequences** (Plan-and-Execute agents work with fixed action sets)

DynamicFlow breaks these constraints by treating the **graph structure itself as data**, generated fresh for each unique request. This isn't dynamic routing through a static graph - it's dynamic generation of the graph itself.

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

#### Phase 2: Deterministic Execution
DynamicFlow's execution engine interprets the JSON graph:
- **No more LLM calls** during execution
- **No graph structure changes** mid-execution
- **Predictable, debuggable behavior**
- **Full type safety** through Effect.js
- **Guaranteed completion** without infinite loops

### Why This Is Hard (And Why Others Haven't Done It)

1. **Type Safety Challenge**: Dynamic graphs break compile-time type checking
    - **Our Solution**: Effect.js provides runtime type safety with functional composition

2. **Security Concerns**: Executing dynamic structures is risky
    - **Our Solution**: JSON intermediate representation prevents code injection

3. **Debugging Complexity**: Dynamic graphs are hard to trace
    - **Our Solution**: Deterministic execution with full execution traces

4. **Performance Overhead**: Graph generation could be slow
    - **Our Solution**: Single planning phase, then pure execution

### The Result: True Adaptive AI Workflows

```typescript
// ❌ LangGraph - Predefined graph, dynamic routing
const langGraphApproach = new StateGraph({
  // Must define all nodes upfront
  nodes: { analyze, decide, execute },
  // Must specify possible edges
  edges: [['analyze', 'decide'], ['decide', 'execute']]
})
// Can only route through existing structure

// ❌ TaskWeaver - Code generation, not graphs
const taskWeaverApproach = async (prompt) => {
  const code = await generatePythonCode(prompt)
  return eval(code) // Generates code, not workflow structure
}

// ✅ DynamicFlow - Complete graph generation
const dynamicFlowApproach = async (prompt) => {
  // Generate entire graph structure from prompt
  const instance = await DynamicFlow.generate({
    prompt,
    tools: availableTools,
    joins: [],
    model: aiModel
  }).pipe(Effect.runPromise)
  // Execute the newly created graph deterministically
  return await instance.runCollect().pipe(Effect.runPromise)
}
```

## Powered by Effect.js - A First in AI Orchestration

DynamicFlow is the **first AI orchestration framework built on Effect's functional foundations**:

- **🔄 Compositional**: Build complex flows from simple, typed pieces
- **🛡️ Type-safe**: Full TypeScript guarantees even with dynamic generation
- **💪 Resilient**: Built-in error handling, retries, and timeout management
- **🔍 Observable**: Complete execution traces for debugging
- **⚡ Performant**: Efficient execution with automatic optimization
- **🎯 Deterministic**: Same input always produces same output

This isn't just using Effect as a utility - it's architected from the ground up on Effect's principles.

## New: LLM-Guided Switch Routing

You can now route between branches using an LLM to select the best tool id based on descriptions. See docs/guides/flow-switch.md and examples/static/switch-static.ts for usage. Set `OPENAI_API_KEY` to enable real routing.

## See It In Action

Imagine you prompt your AI assistant:

```
"Fetch the latest sales data, analyze trends, and if revenue dropped more than 10%, 
email the team with a summary and create a Slack alert"
```

Your AI planner generates this **complete execution graph as JSON**:

```json
{
  "version": "1.0",
  "metadata": {
    "name": "Sales Alert Flow",
    "description": "Monitor sales and alert on revenue drops"
  },
  "steps": [
    {
      "id": "s1",
      "type": "tool",
      "tool": "fetchSalesData",
      "args": { "period": "last_30_days" }
    },
    {
      "id": "s2",
      "type": "tool",
      "tool": "analyzeTrends",
      "args": { "data": "$s1.output" }
    },
    {
      "id": "s3",
      "type": "conditional",
      "condition": "$s2.output.revenueChange < -10",
      "then": [
        {
          "id": "s4",
          "type": "parallel",
          "steps": [
            {
              "id": "s5",
              "type": "tool",
              "tool": "sendEmail",
              "args": {
                "to": "team@company.com",
                "subject": "Revenue Alert",
                "body": "$s2.output.summary"
              }
            },
            {
              "id": "s6",
              "type": "tool",
              "tool": "postSlack",
              "args": {
                "channel": "#alerts",
                "message": "⚠️ Revenue dropped"
              }
            }
          ]
        }
      ]
    }
  ],
  "rootIds": ["s1", "s2", "s3"]
}
```

**The magic**: This JSON represents a complete graph structure - not a sequence of actions, not code to execute, but a full directed acyclic graph with conditional branches and parallel execution paths, generated specifically for this prompt.

## DynamicFlow vs. The Competition

### vs. LangGraph
- **LangGraph**: You define nodes at compile time, LLM chooses paths at runtime
- **DynamicFlow**: LLM creates the entire graph structure at runtime

```typescript
// LangGraph: Static structure, dynamic routing
const graph = new StateGraph({ /* predefined nodes */ })

// DynamicFlow: Dynamic structure generation
const instance = await DynamicFlow.generate({
  prompt: userRequest,
  tools: availableTools,
  joins: [],
  model: aiModel
}).pipe(Effect.runPromise)
```

### vs. Microsoft TaskWeaver
- **TaskWeaver**: Generates Python code snippets for data analysis
- **DynamicFlow**: Generates complete workflow graphs with typed operations

```typescript
// TaskWeaver: Code generation
"df = pd.read_csv('data.csv'); df.groupby('category').mean()"

// DynamicFlow: Graph generation
{ steps: [...], rootIds: [...] }
```

### vs. Plan-and-Execute Agents (LangChain)
- **P&E Agents**: Create linear sequences of predefined actions
- **DynamicFlow**: Create full DAGs with conditionals and parallelism

```typescript
// Plan-and-Execute: Sequential steps
["fetch_data", "analyze", "report"]

// DynamicFlow: Complete graph topology
{ parallel: [...], conditional: [...], sequential: [...] }
```

### vs. CrewAI
- **CrewAI**: Autonomous agents with predefined roles and workflows
- **DynamicFlow**: Dynamic graph generation with deterministic execution

### vs. AutoGen
- **AutoGen**: Multiple agents generating and executing code iteratively
- **DynamicFlow**: Single planning phase, then pure deterministic execution

## Core Features

### 🎯 True Runtime Graph Generation
The only framework that generates complete execution graphs per-prompt - not routing, not code, but actual graph structures.

### ⚡ Effect-Based Architecture
First AI framework built on Effect for robust error handling, dependency injection, and composability.

### 🔄 Pausable & Resumable
Flows can pause for human input, wait for events, or resume after system restarts.

### 🔀 Parallel Execution
Smart worker pool management with graph-aware parallelization.

### 📝 Type-Safe Throughout
Full TypeScript support with Effect.js guarantees, even for dynamically generated graphs.

### 🔌 Extensible
Integrate with LangChain, MCP servers, or any tool ecosystem.

## The TypeScript + Effect Advantage

You can also define flows programmatically using Effect's powerful composition:

```typescript
import { Flow } from '@jambudipa/dynamic-flow'
import { Effect, pipe, Duration, Layer } from 'effect'

const salesAlertFlow = pipe(
  // Fetch sales data with Effect
  Effect.succeed({ period: "last_30_days" }),
  Flow.andThen(fetchSalesData),
  
  // Analyze trends with timeout
  Flow.andThen(salesData =>
    pipe(
      analyzeTrends(salesData),
      Effect.timeout(Duration.seconds(30))
    )
  ),
  
  // Conditional alerting
  Flow.andThen(trends =>
    Flow.doIf(
      () => trends.revenueChange < -10,
      {
        onTrue: () => Flow.parallel({
          email: pipe(
            sendEmail({
              to: "team@company.com",
              subject: "Revenue Alert",
              body: trends.summary
            }),
            Effect.provide(EmailContext)
          ),
          slack: postSlack({
            channel: "#alerts",
            message: `⚠️ Revenue dropped ${trends.revenueChange}%`
          })
        }),
        onFalse: () => Effect.succeed({ status: "ok" })
      }
    )
  ),
  
  // Error handling with Effect
  Flow.catchAll(error =>
    pipe(
      Effect.logError("Sales alert flow failed", error),
      Effect.zipRight(notifyOps(error))
    )
  ),
  
  // Provide required contexts
  Effect.provide(
    Layer.merge(DatabaseLayer, NotificationLayer)
  )
)
```

## Quick Start

```bash
npm install @jambudipa/dynamic-flow effect @effect/schema
```

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
const result = await Flow.run(myFlow)
console.log(result) // "HELLO, WORLD!"
```

### 1. Create Pipeable Tools

```typescript
import { Tools, Flow } from '@jambudipa/dynamic-flow'
import { Effect, pipe } from 'effect'
import * as S from 'effect/Schema'

// Define a weather tool that returns an Effect
const fetchWeather = Tools.createTool({
  id: 'fetchWeather',
  name: 'Weather Fetcher',
  description: 'Fetch current weather for a city',
  inputSchema: S.Struct({ city: S.String }),
  outputSchema: S.Struct({
    temp: S.Number,
    conditions: S.String,
    humidity: S.Number
  }),
  execute: (input, context) =>
    Effect.succeed({
      temp: 72,
      conditions: 'sunny',
      humidity: 45
    })
})

// Use the tool in a pipeable flow
const weatherFlow = pipe(
  Effect.succeed({ city: 'San Francisco' }),
  Flow.andThen(fetchWeather)
)
```

### 2. AI-Generated Flow Execution

```typescript
import { Flow } from '@jambudipa/dynamic-flow'
import { Effect, pipe } from 'effect'

// Your AI generates a complete execution plan as JSON
const userRequest = "Check weather in multiple cities and alert if any have storms"

// Use DynamicFlow to generate and execute a workflow from the prompt
const weatherAnalysisFlow = pipe(
  Effect.succeed(['San Francisco', 'New York', 'London']),
  Flow.andThen(cities =>
    Flow.parallel({
      weather_data: Effect.all(cities.map(city => fetchWeather({ city }))),
      storm_alerts: Effect.all(cities.map(city => checkStormAlerts({ city })))
    })
  ),
  Flow.andThen(({ weather_data, storm_alerts }) =>
    Flow.doIf(
      () => storm_alerts.some(alert => alert.severity > 7),
      {
        onTrue: () => Effect.succeed({ alert: 'Storm detected!', data: weather_data }),
        onFalse: () => Effect.succeed({ alert: 'All clear', data: weather_data })
      }
    )
  )
)

const result = await Flow.run(weatherAnalysisFlow)
```

### 3. Advanced Flow Composition

```typescript
import { Flow, Tools } from '@jambudipa/dynamic-flow'
import { Effect, pipe } from 'effect'

// Compose complex flows with conditional logic and parallel processing
const weatherAnalysisFlow = pipe(
  Effect.succeed({ cities: ['San Francisco', 'New York', 'London'] }),
  Flow.andThen(({ cities }) =>
    Flow.parallel({
      weather: Effect.all(cities.map(city => fetchWeather({ city }))),
      populations: Effect.all(cities.map(city => getCityPopulation({ city })))
    })
  ),
  Flow.andThen(({ weather, populations }) =>
    pipe(
      Effect.succeed({ weather, populations }),
      Flow.map(data => ({
        averageTemp: data.weather.reduce((sum, w) => sum + w.temp, 0) / data.weather.length,
        totalPopulation: data.populations.reduce((sum, p) => sum + p.count, 0),
        report: `Analyzed ${data.weather.length} cities`
      })),
      Flow.doIf(
        (analysis) => analysis.averageTemp > 80,
        {
          onTrue: (analysis) => 
            sendHeatwaveAlert(analysis),
          onFalse: (analysis) => 
            Effect.succeed({ ...analysis, alert: 'Normal temperatures' })
        }
      )
    )
  )
)
```

## Learn More

### 📚 Documentation
Comprehensive guides and API references are available in the [`/docs`](./docs) directory:

#### 🚀 Getting Started
- **[Complete Documentation Index](./docs/README.md)** - Overview of all documentation
- **[Getting Started Guide](./docs/guides/getting-started.md)** - Quick start and core concepts
- **[Core Execution Scenarios](./docs/README.md#core-execution-scenarios)** - Static vs Dynamic, Sync vs Streaming

#### 📖 API Reference
- **[Flow API](./docs/api/flow.md)** - Pipeable operations for functional composition
- **[Tools API](./docs/api/tools.md)** - Creating and managing typed tools
- **[DynamicFlow API](./docs/api/dynamic-flow.md)** - AI-powered workflow generation

#### 📚 Comprehensive Guides
- **[Pipeable Patterns](./docs/guides/pipeable-patterns.md)** - Advanced functional composition patterns
- **[Dynamic Flows](./docs/guides/dynamic-flows.md)** - AI-generated workflow best practices

#### ⭐ Key Features
- **[Runtime Graph Generation](./docs/features/runtime-graph-generation.md)** - How AI creates complete workflows
- **[Effect.js Integration](./docs/features/effect-integration.md)** - Functional programming benefits

### 🚀 Examples
Our examples are being refreshed. For now:
- See [Core Execution Scenarios](./docs/README.md#core-execution-scenarios)
- Browse guides like [Pipeable Patterns](./docs/guides/pipeable-patterns.md) and [Dynamic Flows](./docs/guides/dynamic-flows.md)
- The [`/examples`](./examples) directory will be updated shortly

### 💬 Community
Join the discussion: [GitHub Issues](https://github.com/jambudipa/dynamic-flow/issues) | [GitHub Discussions](https://github.com/jambudipa/dynamic-flow/discussions)

### 🤝 Contributing
We welcome contributions! Please open an issue or start a discussion on GitHub. A CONTRIBUTING guide will be added soon.

## Why Choose DynamicFlow?

| Feature | DynamicFlow | LangGraph | TaskWeaver | CrewAI | AutoGen |
|---------|------------|-----------|------------|---------|----------|
| **Runtime Graph Generation** | ✅ Complete | ❌ Static | ❌ Code only | ❌ Static | ❌ Code only |
| **Graph Topology Per-Prompt** | ✅ Yes | ❌ No | ❌ No | ❌ No | ❌ No |
| **Deterministic Execution** | ✅ Always | ⚠️ Optional | ✅ Yes | ✅ Flows | ⚠️ Varies |
| **No LLM During Execution** | ✅ Yes | ❌ Often | ⚠️ Sometimes | ⚠️ Mode-dependent | ❌ Multiple calls |
| **Type Safety** | ✅ Full Effect.js | ✅ TypeScript | ⚠️ Python | ⚠️ Python | ⚠️ Python |
| **JSON Graph Definition** | ✅ Yes | ❌ No | ❌ No | ❌ No | ❌ No |
| **Pausable Flows** | ✅ Built-in | ✅ Yes | ⚠️ Stateful | ✅ Yes | ❌ No |
| **Effect.js Based** | ✅ Yes | ❌ No | ❌ No | ❌ No | ❌ No |

## The Bottom Line

DynamicFlow is the only framework that:
1. **Generates complete execution graphs** (not just plans or code) at runtime
2. **Creates unique graph topologies** for each prompt (not routing through static graphs)
3. **Executes deterministically** without LLM involvement after planning
4. **Uses Effect.js** for functional, type-safe workflow composition
5. **Represents graphs as JSON** for safety, debugging, and portability

This isn't an incremental improvement - it's a fundamentally different approach to AI orchestration.

## Status – Early Look

- Early alpha: many features are still in development.
- Orchestration-first: focuses on workflow orchestration, not a general AI/NLP toolkit.
- Feedback welcome: please share ideas and feature requests via GitHub Issues or Discussions.

## Next Steps

- Performance is an issue (30s to create and execute a dynamic flow).
- Many type problems (usage of `any`).
- Add testing (very TDD madam).
- Effect usage needs tightening!

## License

MIT © DynamicFlow Contributors

---

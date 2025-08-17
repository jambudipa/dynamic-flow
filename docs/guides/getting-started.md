# Getting Started with DynamicFlow

Welcome to DynamicFlow, the only AI orchestration framework that generates complete execution graphs at runtime. This guide will get you up and running in under 5 minutes.

## What Makes DynamicFlow Different

Unlike other frameworks that route through pre-defined graphs or generate code snippets, DynamicFlow enables LLMs to create entire workflow topologies from scratch for each prompt. This provides unprecedented flexibility while maintaining deterministic execution.

### The Two-Phase Architecture

1. **Planning Phase**: Your LLM analyses the prompt and generates a complete execution graph as JSON
2. **Execution Phase**: DynamicFlow executes the graph deterministically without any additional LLM calls

## Quick Start

### 1. Installation

```bash
npm install @jambudipa/dynamic-flow effect
```

For AI models, install the appropriate Effect AI package:

```bash
# For OpenAI
npm install @effect/ai-openai

# For Claude (Anthropic)  
npm install @effect/ai-anthropic

# For local models
npm install @effect/ai-ollama
```

### 2. Environment Setup

Create a `.env` file in your project root:

```bash
OPENAI_API_KEY=sk-your-key-here
# or
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

### 3. Your First Flow

Create a simple hello world flow using the pipeable API:

```typescript
// hello-flow.ts
import { Flow } from '@jambudipa/dynamic-flow'
import { Effect, pipe } from 'effect'

const helloFlow = pipe(
  Effect.succeed("Hello"),
  Flow.andThen(greeting => Effect.succeed(`${greeting}, World!`)),
  Flow.map(message => message.toUpperCase())
)

// Run the flow
const result = await Flow.run(helloFlow)
console.log(result) // "HELLO, WORLD!"
```

You should see: `HELLO, WORLD!`

### 4. Create Your First Tool

Tools are the building blocks that LLMs can use in generated workflows:

```typescript
// weather-tool.ts
import { Tools } from '@jambudipa/dynamic-flow'
import { Effect, Schema} from 'effect'

const weatherTool = Tools.createTool({
  id: 'fetchWeather',
  name: 'Weather Fetcher',
  description: 'Get current weather conditions for any city',
  inputSchema: Schema.Struct({
    city: Schema.String,
    units: Schema.optional(Schema.Union(Schema.Literal('celsius'), Schema.Literal('fahrenheit')))
  }),
  outputSchema: Schema.Struct({
    temperature: Schema.Number,
    conditions: Schema.String,
    humidity: Schema.Number
  }),
  execute: (input, context) =>
    Effect.succeed({
      temperature: 22,
      conditions: 'sunny',
      humidity: 65
    })
})

export { weatherTool }
```

### 5. AI-Generated Workflow

Now let's create a workflow that's planned by AI:

```typescript
// ai-workflow.ts
import { DynamicFlow } from '@jambudipa/dynamic-flow'
import { OpenAi } from '@effect/ai-openai'
import { Stream, Effect } from 'effect'
import { weatherTool } from './weather-tool'

// Create AI model
const model = OpenAi.completion('gpt-4')

// Execute AI-planned workflow
await DynamicFlow.execute({
  prompt: "Check the weather in London and tell me if it's good for outdoor activities",
  tools: [weatherTool],
  joins: [],
  model
}).pipe(
  Stream.tap(event => Effect.sync(() => {
    console.log(`Event: ${event.type}`)
    if (event.type === 'flow-complete') {
      console.log('Result:', event.result)
    }
  })),
  Stream.runDrain,
  Effect.runPromise
)
```

You should see events like:
```
Event: flow-start
Event: tool-start
Event: tool-output
Event: flow-complete
Result: { analysis: "With sunny conditions and 22°C, it's perfect for outdoor activities!" }
```

## Core Concepts

### Effects and Pipeable Operations

DynamicFlow is built on Effect.js, providing functional composition through piping:

```typescript
const dataFlow = pipe(
  Effect.succeed(rawData),           // Start with data
  Flow.andThen(validateData),        // Validate it
  Flow.map(transformData),           // Transform it
  Flow.tap(logData),                 // Log it (side effect)
  Flow.catchAll(handleError)         // Handle any errors
)
```

### Tools: Typed Building Blocks

Tools define what your AI can do. Each tool has:
- **ID**: Unique identifier
- **Name**: Human-readable name  
- **Description**: Helps LLM understand when to use it
- **Schemas**: Type-safe input/output validation
- **Execute**: Pure Effect implementation

```typescript
const emailTool = Tools.createTool({
  id: 'sendEmail',
  name: 'Email Sender',
  description: 'Send emails to users with subject and body',
  inputSchema: S.Struct({
    to: S.String,
    subject: S.String,
    body: S.String
  }),
  outputSchema: S.Struct({
    sent: S.Boolean,
    messageId: S.String
  }),
  execute: (input, context) =>
    Effect.succeed({
      sent: true,
      messageId: `msg_${Date.now()}`
    })
})
```

### Two Execution Modes

#### Static Flows (Programmatic)
Define workflows explicitly using the Flow API:

```typescript
const staticFlow = pipe(
  Effect.succeed({ city: 'Paris' }),
  Flow.andThen(weatherTool.execute),
  Flow.map(weather => `Temperature in Paris: ${weather.temperature}°C`)
)

const result = await Flow.run(staticFlow)
```

#### Dynamic Flows (AI-Generated)
Let AI generate workflows from natural language:

```typescript
await DynamicFlow.execute({
  prompt: "Check Paris weather and email me a summary",
  tools: [weatherTool, emailTool],
  joins: [],
  model
})
```

## Common Patterns

### Sequential Operations

```typescript
const sequentialFlow = pipe(
  fetchUserData(userId),
  Flow.andThen(userData => validateUser(userData)),
  Flow.andThen(validUser => createAccount(validUser)),
  Flow.andThen(account => sendWelcomeEmail(account))
)
```

### Parallel Operations

```typescript
const parallelFlow = pipe(
  Effect.succeed(userId),
  Flow.andThen(id => 
    Flow.parallel({
      profile: fetchProfile(id),
      preferences: fetchPreferences(id),
      permissions: fetchPermissions(id)
    })
  )
)
```

### Conditional Logic

```typescript
const conditionalFlow = pipe(
  analyseData(inputData),
  Flow.doIf(
    analysis => analysis.confidence > 0.8,
    {
      onTrue: analysis => processWithHighConfidence(analysis),
      onFalse: analysis => requestHumanReview(analysis)
    }
  )
)
```

### Error Handling

```typescript
const resilientFlow = pipe(
  riskyApiCall(),
  Flow.timeout(Duration.seconds(30)),
  Flow.retry({ times: 3, backoff: 'exponential' }),
  Flow.catchAll(error => 
    Effect.succeed({ error: true, fallback: 'default-value' })
  )
)
```

## Development Workflow

### 1. Define Your Tools

Start by creating tools for your domain:

```typescript
// tools/index.ts
export const userTools = [
  Tools.createTool({
    id: 'getUser',
    name: 'Get User',
    description: 'Retrieve user by ID',
    // ... implementation
  }),
  Tools.createTool({
    id: 'updateUser', 
    name: 'Update User',
    description: 'Update user information',
    // ... implementation
  })
]
```

### 2. Set Up Tool Registry

```typescript
// registry.ts
import { createRegistry } from '@jambudipa/dynamic-flow'
import { userTools } from './tools'

export const toolRegistry = createRegistry([
  ...userTools,
  ...otherTools
])
```

### 3. Create Reusable Flows

```typescript
// flows/user-management.ts
export const createUserFlow = (userData: UserData) => pipe(
  Effect.succeed(userData),
  Flow.andThen(validateUserData),
  Flow.andThen(createUserAccount),
  Flow.andThen(sendWelcomeEmail),
  Flow.catchAll(handleUserCreationError)
)
```

### 4. Test Your Flows

```typescript
// __tests__/flows.test.ts
import { describe, it, expect } from 'vitest'
import { Flow } from '@jambudipa/dynamic-flow'

describe('User Management Flows', () => {
  it('should create user successfully', async () => {
    const result = await Flow.run(
      createUserFlow({ email: 'test@example.com', name: 'Test User' })
    )
    
    expect(result.created).toBe(true)
    expect(result.email).toBe('test@example.com')
  })
})
```

## Best Practices

### Tool Design

1. **Single Responsibility**: Each tool should do one thing well
2. **Clear Descriptions**: Help the LLM understand when to use the tool
3. **Robust Schemas**: Use specific types, not `unknown`
4. **Error Handling**: Always use Effect's error channel

```typescript
// ✅ Good
const specificTool = Tools.createTool({
  id: 'calculateShipping',
  name: 'Shipping Calculator',
  description: 'Calculate shipping cost based on weight, distance, and service level',
  inputSchema: S.Struct({
    weightKg: S.Number.pipe(S.positive()),
    distanceKm: S.Number.pipe(S.positive()),
    serviceLevel: S.Union(S.Literal('standard'), S.Literal('express'), S.Literal('overnight'))
  }),
  // ... rest
})

// ❌ Avoid
const vagueTool = Tools.createTool({
  id: 'doStuff',
  name: 'Do Stuff',
  description: 'Does things',
  inputSchema: S.Unknown,
  // ... rest  
})
```

### Flow Composition

1. **Keep flows focused**: Each flow should represent a clear business process
2. **Use meaningful names**: `processCustomerOrder` not `doThing`  
3. **Handle errors gracefully**: Always provide fallbacks
4. **Add timeouts**: Protect against hung operations

```typescript
// ✅ Good
const processOrderFlow = pipe(
  validateOrder(orderData),
  Flow.timeout(Duration.seconds(30)),
  Flow.andThen(calculatePricing),
  Flow.andThen(processPayment),
  Flow.andThen(createShipment),
  Flow.catchAll(handleOrderError),
  Flow.tap(logOrderProcessed)
)
```

### Prompt Engineering

1. **Be specific**: Detailed prompts produce better workflows
2. **Include context**: Provide relevant data and constraints
3. **Set expectations**: Describe the desired outcome clearly

```typescript
// ✅ Good
const prompt = `
Create a customer support workflow that:
1. Validates customer identity using their email and account number
2. Retrieves their recent order history (last 30 days)
3. Logs the support request with priority level
4. If it's a refund request over $100, require manager approval
5. Send confirmation email to customer

Customer: ${customerEmail}
Issue type: ${issueType}
Priority: ${priority}
`

// ❌ Avoid  
const prompt = "Help customer"
```

## Troubleshooting

### Common Issues

**Tool Not Found Error**
```typescript
// Ensure tool is registered
const registry = createRegistry([myTool])
// Or check tool ID matches
console.log('Available tools:', registry.getAllIds())
```

**Schema Validation Error**
```typescript
// Debug schema issues
const result = S.decodeUnknownEither(schema)(data)
if (result._tag === 'Left') {
  console.log('Validation error:', result.left)
}
```

**Timeout Errors**
```typescript
// Increase timeout for slow operations
Flow.timeout(Duration.minutes(5))
```

**Memory Issues with Large Flows**
```typescript
// Use streaming for large datasets
DynamicFlow.execute({
  // ... config
  options: {
    memoryOptimisation: {
      streamingExecution: true,
      batchSize: 100
    }
  }
})
```

### Debug Mode

Enable debug logging to understand what's happening:

```typescript
const options = {
  debugMode: true,
  customPrompts: {
    systemPrompt: "You are a helpful assistant. Explain your reasoning."
  }
}
```

## Next Steps

Now that you've got the basics:

1. **Explore Examples**: Check out the [`/examples`](../examples/) directory for more patterns
2. **Read API Docs**: Deep dive into the [Flow API](../api/flow.md) and [Tools API](../api/tools.md)
3. **Build Real Tools**: Create tools for your specific domain (databases, APIs, etc.)
4. **Deploy to Production**: Set up proper error handling, monitoring, and logging

### Recommended Learning Path

1. **Start with Static Flows**: Get comfortable with the Flow API
2. **Create Domain Tools**: Build tools specific to your use case  
3. **Try Dynamic Flows**: Let AI generate workflows from prompts
4. **Advanced Patterns**: Explore parallel execution, error recovery, and streaming
5. **Production Setup**: Add monitoring, caching, and optimisation

### Production Checklist

- [ ] Error handling with appropriate fallbacks
- [ ] Timeout configuration for all external calls
- [ ] Retry policies for unreliable operations  
- [ ] Monitoring and logging setup
- [ ] API rate limiting and quotas
- [ ] Security review of tool implementations
- [ ] Performance testing with expected load
- [ ] Caching strategy for generated workflows

## Resources

- **API Reference**: [Flow](../api/flow.md) | [Tools](../api/tools.md) | [DynamicFlow](../api/dynamic-flow.md)
- **Guides**: [Advanced Patterns](./advanced-patterns.md) | [Error Handling](./error-handling.md)
- **Examples**: [Basic Examples](../../examples/static/) | [Dynamic Examples](../../examples/dynamic/)
- **Community**: [GitHub Issues](https://github.com/jambudipa/dynamic-flow/issues) | [Discussions](https://github.com/jambudipa/dynamic-flow/discussions)

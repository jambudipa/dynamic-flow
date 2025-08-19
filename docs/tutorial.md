# Tutorial: Building Your First Dynamic Flow

*A hands-on lesson to get you started with DynamicFlow's core concepts*

## What You'll Learn

In this tutorial, you'll build a complete weather notification system that demonstrates DynamicFlow's core capabilities:
- Creating static flows with functional composition
- Building tools with schema validation
- Generating dynamic flows with AI planning
- Managing persistence for human-in-the-loop workflows

By the end, you'll have a working system that can check weather in multiple cities and send notifications based on conditions.

## Prerequisites

- Node.js 18 or higher
- Basic TypeScript knowledge
- OpenAI API key (for dynamic examples)

## Step 1: Setup and Installation

First, let's create a new project and install DynamicFlow:

```bash
mkdir weather-flow-tutorial
cd weather-flow-tutorial
npm init -y
npm install @jambudipa/dynamic-flow effect
npm install --save-dev tsx typescript @types/node
```

Create a basic TypeScript configuration:

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

## Step 2: Your First Static Flow

Let's start with a simple "Hello World" flow to understand the basics:

```typescript
// hello-world.ts
import { Flow } from '@jambudipa/dynamic-flow'
import { Effect, pipe } from 'effect'

// Create your first flow
const helloFlow = pipe(
  Effect.succeed('Hello'),
  Flow.andThen(greeting => Effect.succeed(`${greeting}, DynamicFlow!`)),
  Flow.map(message => message.toUpperCase())
)

// Run the flow
const result = await Effect.runPromise(Flow.runCollect(helloFlow))
console.log(result.output) // "HELLO, DYNAMICFLOW!"
```

Run it to see the magic:

```bash
npx tsx hello-world.ts
```

**What happened here?**
- `Effect.succeed()` creates an Effect with a successful value
- `Flow.andThen()` chains Effects together sequentially
- `Flow.map()` transforms the result
- `Flow.runCollect()` executes the flow and returns the final result

## Step 3: Creating Your First Tool

Tools are reusable functions with schema validation. Let's create a weather tool:

```typescript
// weather-tool.ts
import { Tool } from '@jambudipa/dynamic-flow'
import { Schema } from 'effect'
import { Effect } from 'effect'

// Define the tool with input/output schemas
const weatherTool: Tool<
  { city: string; units?: 'celsius' | 'fahrenheit' },
  { temperature: number; condition: string; humidity: number; city: string }
> = {
  id: 'weather-api',
  name: 'Weather Fetcher',
  description: 'Get current weather for a city',
  inputSchema: Schema.Struct({
    city: Schema.String,
    units: Schema.optional(Schema.Literal('celsius', 'fahrenheit'))
  }),
  outputSchema: Schema.Struct({
    temperature: Schema.Number,
    condition: Schema.String,
    humidity: Schema.Number,
    city: Schema.String
  }),
  execute: (input, context) => {
    // Simulate API call
    const mockWeather = {
      temperature: Math.round(Math.random() * 30 + 10),
      condition: ['sunny', 'cloudy', 'rainy'][Math.floor(Math.random() * 3)],
      humidity: Math.round(Math.random() * 40 + 40),
      city: input.city
    }
    return Effect.succeed(mockWeather)
  }
}

export { weatherTool }
```

## Step 4: Building a Multi-City Weather Flow

Now let's combine multiple tools in a flow:

```typescript
// weather-flow.ts
import { Flow } from '@jambudipa/dynamic-flow'
import { Effect, pipe } from 'effect'
import { weatherTool } from './weather-tool'

// Create a flow that checks weather in multiple cities
const multiCityWeatherFlow = pipe(
  // Start with an array of cities
  Effect.succeed(['London', 'Tokyo', 'New York']),
  
  // Get weather for each city in parallel
  Flow.andThen(cities => 
    Effect.all(
      cities.map(city => 
        weatherTool.execute({ city }, { requestId: 'weather-check' })
      ),
      { concurrency: 'unbounded' }
    )
  ),
  
  // Format the results
  Flow.map(weatherData => ({
    summary: `Weather checked for ${weatherData.length} cities`,
    cities: weatherData,
    timestamp: new Date().toISOString()
  })),
  
  // Log the results
  Flow.tap(result => 
    Effect.sync(() => {
      console.log('Weather Summary:')
      result.cities.forEach(weather => {
        console.log(`${weather.city}: ${weather.temperature}°C, ${weather.condition}`)
      })
    })
  )
)

// Run the flow
const result = await Effect.runPromise(Flow.runCollect(multiCityWeatherFlow))
console.log('Final result:', result.output)
```

**Key concepts learned:**
- Tools have type-safe input/output schemas
- `Effect.all()` runs Effects in parallel
- `Flow.tap()` adds side effects without changing the data
- Flows compose naturally with functional programming patterns

## Step 5: Dynamic Flow Generation with AI

Now for the exciting part - let DynamicFlow generate workflows from natural language! 

First, set up your OpenAI API key:

```bash
export OPENAI_API_KEY=your_api_key_here
```

Create a dynamic flow:

```typescript
// dynamic-weather.ts
import { DynamicFlow, Tools } from '@jambudipa/dynamic-flow'
import { OpenAi } from '@effect/ai-openai'
import { Effect } from 'effect'
import { weatherTool } from './weather-tool'

// Create additional tools for a complete system
const emailTool: Tool<
  { to: string; subject: string; body: string },
  { sent: boolean; messageId: string }
> = {
  id: 'email-sender',
  name: 'Email Sender',
  description: 'Send email notifications',
  inputSchema: Schema.Struct({
    to: Schema.String,
    subject: Schema.String,
    body: Schema.String
  }),
  outputSchema: Schema.Struct({
    sent: Schema.Boolean,
    messageId: Schema.String
  }),
  execute: (input, context) => Effect.succeed({
    sent: true,
    messageId: `msg-${Date.now()}`
  })
}

const alertTool: Tool<
  { condition: string; temperature: number; city: string },
  { alert: boolean; severity: string; message: string }
> = {
  id: 'weather-alert',
  name: 'Weather Alert',
  description: 'Create weather alerts based on conditions',
  inputSchema: Schema.Struct({
    condition: Schema.String,
    temperature: Schema.Number,
    city: Schema.String
  }),
  outputSchema: Schema.Struct({
    alert: Schema.Boolean,
    severity: Schema.String,
    message: Schema.String
  }),
  execute: (input, context) => {
    const isExtreme = input.temperature > 30 || input.temperature < 0
    return Effect.succeed({
      alert: isExtreme,
      severity: isExtreme ? 'high' : 'low',
      message: isExtreme 
        ? `Extreme weather alert for ${input.city}: ${input.temperature}°C, ${input.condition}`
        : `Normal weather in ${input.city}`
    })
  }
}

// Generate and execute a dynamic flow
const runDynamicWeather = async () => {
  const result = await DynamicFlow.execute({
    prompt: `
      Check the weather in London, Tokyo, and Sydney. 
      For each city, if the temperature is extreme (below 0°C or above 30°C), 
      create an alert and send an email notification to admin@company.com.
      Return a summary of all weather data and any alerts generated.
    `,
    tools: [weatherTool, emailTool, alertTool],
    joins: [],
    model: OpenAi.completion({ model: 'gpt-5' })
  })
  
  console.log('Dynamic flow completed:', result)
}

runDynamicWeather().catch(console.error)
```

**What's happening here?**
- DynamicFlow analyzes your prompt and available tools
- It generates a complete execution graph (nodes, edges, parallel paths)
- The graph is executed deterministically without further LLM calls
- You get the full power of AI planning with predictable execution

## Step 6: Human-in-the-Loop with Persistence

For workflows requiring human approval, DynamicFlow provides persistence:

```typescript
// approval-flow.ts
import { 
  Flow, 
  createPersistenceHub, 
  AwaitInputPresets,
  BackendFactory,
  FlowSuspensionSignal 
} from '@jambudipa/dynamic-flow'
import { Effect, Duration, Schema } from 'effect'
import { weatherTool } from './weather-tool'

// Setup persistence with filesystem backend
const setupPersistence = async () => {
  const backend = await Effect.runPromise(
    BackendFactory.create({
      type: 'filesystem',
      config: { basePath: './suspended-flows' }
    })
  )
  
  return await Effect.runPromise(
    createPersistenceHub(backend, {
      enableEncryption: false,
      enableCompression: true,
      defaultTimeout: Duration.hours(24)
    })
  )
}

// Create approval tool that suspends execution
const createApprovalFlow = async () => {
  const hub = await setupPersistence()
  
  const approvalTool = AwaitInputPresets.approval(
    'weather-approval',
    'Weather Report Approval',
    'Requires manager approval before sending weather alerts'
  ).withTimeout(Duration.hours(4)).build(hub)
  
  // Flow that requires approval
  const approvalFlow = pipe(
    weatherTool.execute({ city: 'London' }, { requestId: 'approval-demo' }),
    
    Flow.andThen(weather => {
      // Check if approval is needed
      if (weather.temperature > 25) {
        return approvalTool.execute(undefined, { requestId: 'approval-demo' })
          .pipe(Effect.map(() => weather))
      }
      return Effect.succeed(weather)
    }),
    
    Flow.map(weather => `Approved weather report: ${weather.city} - ${weather.temperature}°C`)
  )
  
  try {
    const result = await Effect.runPromise(Flow.runCollect(approvalFlow))
    console.log('Flow completed:', result.output)
  } catch (error) {
    if (error instanceof FlowSuspensionSignal) {
      console.log('Flow suspended for approval:', error.suspensionKey)
      console.log('Resume with: await hub.resume(key, { approved: true, approvedBy: "manager" })')
    }
  }
}

createApprovalFlow().catch(console.error)
```

## Step 7: Putting It All Together

Create a comprehensive weather notification system:

```typescript
// complete-system.ts
import { Flow, DynamicFlow, createPersistenceHub } from '@jambudipa/dynamic-flow'
import { Effect, pipe, Stream } from 'effect'
import { weatherTool, emailTool, alertTool } from './tools'

const completeWeatherSystem = pipe(
  // Start with configuration
  Effect.succeed({
    cities: ['London', 'Tokyo', 'Sydney', 'New York'],
    alertThreshold: { min: 0, max: 30 },
    recipients: ['admin@company.com', 'alerts@company.com']
  }),
  
  // Check weather for all cities
  Flow.andThen(config => 
    Effect.all(
      config.cities.map(city => 
        weatherTool.execute({ city }, { requestId: 'batch-weather' })
      ),
      { concurrency: 'unbounded' }
    ).pipe(Effect.map(weather => ({ config, weather })))
  ),
  
  // Filter for extreme weather
  Flow.map(({ config, weather }) => ({
    config,
    weather,
    alerts: weather.filter(w => 
      w.temperature < config.alertThreshold.min || 
      w.temperature > config.alertThreshold.max
    )
  })),
  
  // Send alerts if needed
  Flow.andThen(({ config, weather, alerts }) => {
    if (alerts.length > 0) {
      const emailBody = `Weather Alert Summary:
${alerts.map(w => `- ${w.city}: ${w.temperature}°C, ${w.condition}`).join('\n')}

Total cities checked: ${weather.length}
Alerts generated: ${alerts.length}
`
      
      return emailTool.execute({
        to: config.recipients.join(','),
        subject: `Weather Alert - ${alerts.length} extreme conditions detected`,
        body: emailBody
      }, { requestId: 'alert-email' })
        .pipe(Effect.map(emailResult => ({ weather, alerts, emailResult })))
    }
    
    return Effect.succeed({ weather, alerts, emailResult: null })
  }),
  
  // Final summary
  Flow.map(result => ({
    summary: `Weather system completed`,
    citiesChecked: result.weather.length,
    alertsGenerated: result.alerts.length,
    emailSent: result.emailResult?.sent || false,
    timestamp: new Date().toISOString()
  }))
)

// Run with streaming to see progress
Stream.runForEach(
  Flow.runStream(completeWeatherSystem),
  event => Effect.sync(() => console.log(`Event: ${event.type}`))
).pipe(Effect.runPromise)
```

## What You've Accomplished

Congratulations! You've built a complete weather notification system that demonstrates:

1. **Static Flow Composition**: Using functional programming patterns with Effect
2. **Tool Creation**: Building reusable, schema-validated tools
3. **Dynamic Generation**: Letting AI create execution graphs from natural language
4. **Human-in-the-Loop**: Adding approval workflows with persistence
5. **Streaming Execution**: Monitoring flow progress in real-time

## Next Steps

Now that you understand the basics, explore these advanced features:

- **MCP Integration**: Connect to Model Context Protocol servers for real tool discovery
- **LLM Conversation Routing**: Build intelligent chatbots with memory
- **Advanced Persistence**: Use PostgreSQL or Redis backends for production
- **Error Recovery**: Handle failures gracefully with Effect's error handling
- **Performance Optimization**: Scale flows with concurrency and resource management

Check the [How-to Guides](./how-to-guide.md) for specific implementation patterns, or dive into the [Reference](./reference.md) for complete API documentation.

Welcome to the future of AI orchestration with DynamicFlow! 🚀

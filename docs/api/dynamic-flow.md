# DynamicFlow API Reference

The DynamicFlow API enables AI-powered workflow generation where Large Language Models create complete execution graphs from natural language prompts. Unlike static workflow frameworks, DynamicFlow generates the entire graph topology at runtime, then executes it deterministically.

## Core Concept

DynamicFlow follows a two-phase architecture:
1. **Planning Phase**: LLM analyses the prompt and generates a complete execution graph
2. **Execution Phase**: Deterministic execution of the generated graph without additional LLM calls

This approach provides the flexibility of AI planning with the reliability of deterministic execution.

## Main API

### `DynamicFlow.execute(config)`

Execute the complete pipeline: prompt → LLM → graph generation → execution with streaming events.

**Type Signature:**
```typescript
execute(config: {
  prompt: string;
  tools: ReadonlyArray<Tool<any, any>>;
  joins: ReadonlyArray<ToolJoin<any, any>>;
  model: AiModel;
  options?: DynamicFlowOptions;
  input?: unknown;
}): Stream.Stream<FlowEvent, ExecutionError>
```

**Parameters:**
- `prompt` - Natural language description of the desired workflow
- `tools` - Array of available tools the LLM can use
- `joins` - Type transformations between incompatible tool inputs/outputs
- `model` - AI model for workflow generation (OpenAI, Claude, etc.)
- `options` - Configuration for generation and execution
- `input` - Initial input data for the workflow

**Returns:** `Stream.Stream<FlowEvent, ExecutionError>` - Real-time execution events

**Example:**
```typescript
import { DynamicFlow, Tools } from '@jambudipa/dynamic-flow'
import { OpenAi } from '@effect/ai-openai'
import { Stream, Effect } from 'effect'

// Define available tools
const tools = [
  Tools.createTool({
    id: 'fetchWeather',
    name: 'Weather Fetcher', 
    description: 'Get current weather for a city',
    inputSchema: Schema.Struct({ city: Schema.String }),
    outputSchema: Schema.Struct({ temp: Schema.Number, conditions: Schema.String }),
    execute: (input, context) => 
      Effect.succeed({ temp: 22, conditions: 'sunny' })
  }),
  Tools.createTool({
    id: 'sendEmail',
    name: 'Email Sender',
    description: 'Send an email notification',
    inputSchema: Schema.Struct({ to: Schema.String, subject: Schema.String, body: Schema.String }),
    outputSchema: Schema.Struct({ sent: Schema.Boolean }),
    execute: (input, context) => 
      Effect.succeed({ sent: true })
  })
]

// Create AI model
const model = OpenAi.completion('gpt-5')

// Execute dynamic workflow
await pipe(
  DynamicFlow.execute({
    prompt: "Check the weather in London and email me a summary",
    tools,
    joins: [],
    model,
    options: {
      maxSteps: 10,
      timeout: Duration.minutes(5),
      enableCaching: true
    }
  }),
  Stream.tap(event => Effect.sync(() => {
    console.log(`Event: ${event.type}`, event)
  })),
  Stream.runDrain,
  Effect.runPromise
)
```

### `DynamicFlow.generate(config)`

Generate a workflow plan without executing it, returning a `ValidatedFlowInstance` for later execution.

**Type Signature:**
```typescript
generate(config: {
  prompt: string;
  tools: ReadonlyArray<Tool<any, any>>;
  joins: ReadonlyArray<ToolJoin<any, any>>;
  model: AiModel;
  options?: DynamicFlowOptions;
}): Promise<ValidatedFlowInstance>
```

**Example:**
```typescript
// Generate workflow plan
const flowInstance = await DynamicFlow.generate({
  prompt: "Process user registration and send welcome email",
  tools: [registrationTool, emailTool, auditTool],
  joins: [userToEmailJoin],
  model: OpenAi.completion('gpt-5')
})

// Inspect the generated plan
console.log('Generated steps:', flowInstance.ir.nodes.length)
console.log('Plan description:', flowInstance.ir.metadata.description)

// Execute later with specific input
const result = await Effect.runPromise(
  flowInstance.runCollect({ email: 'user@example.com', name: 'John Doe' })
)
```

### `DynamicFlow.importPlan(planDefinition)`

Import and validate a pre-defined workflow plan (JSON schema) for execution.

**Type Signature:**
```typescript
importPlan(plan: {
  json: DynamicFlowType;
  tools: ReadonlyArray<Tool<any, any>>;
  joins: ReadonlyArray<ToolJoin<any, any>>;
}): Promise<ValidatedFlowInstance>
```

**Example:**
```typescript
// Pre-defined workflow plan
const workflowPlan = {
  version: '1.0',
  metadata: {
    name: 'User Onboarding',
    description: 'Complete user onboarding workflow'
  },
  nodes: [
    {
      id: 'validate',
      type: 'tool',
      toolId: 'validateUser',
      inputs: { userData: '$input' }
    },
    {
      id: 'create',
      type: 'tool', 
      toolId: 'createAccount',
      inputs: { validatedData: '$validate.output' }
    },
    {
      id: 'notify',
      type: 'tool',
      toolId: 'sendWelcomeEmail',
      inputs: { account: '$create.output' }
    }
  ],
  edges: [
    { from: 'validate', to: 'create' },
    { from: 'create', to: 'notify' }
  ]
}

// Import and execute
const instance = await DynamicFlow.importPlan({
  json: workflowPlan,
  tools: [validateTool, createAccountTool, emailTool],
  joins: []
})

const result = await Effect.runPromise(
  instance.runCollect({ 
    userData: { email: 'user@example.com', name: 'Alice' }
  })
)
```

## Configuration Options

### `DynamicFlowOptions`

Configuration for workflow generation and execution behaviour.

```typescript
interface DynamicFlowOptions {
  maxSteps?: number;
  timeout?: Duration.Duration;
  enableCaching?: boolean;
  cacheTTL?: Duration.Duration;
  retryStrategy?: RetryStrategy;
  modelPoolConfig?: ModelPoolConfig;
  enableApprovalWorkflow?: boolean;
  debugMode?: boolean;
  customPrompts?: {
    systemPrompt?: string;
    planningPrompt?: string;
    validationPrompt?: string;
  };
}
```

**Properties:**
- `maxSteps` - Maximum number of workflow steps (default: 20)
- `timeout` - Overall execution timeout (default: 5 minutes)
- `enableCaching` - Cache generated workflows for reuse (default: true)
- `cacheTTL` - Cache expiration time (default: 1 hour)
- `retryStrategy` - Error recovery configuration
- `modelPoolConfig` - Model pool settings for parallel operations
- `enableApprovalWorkflow` - Require human approval for sensitive operations
- `debugMode` - Enhanced logging and intermediate state capture
- `customPrompts` - Override default LLM prompts for specialised domains

**Example:**
```typescript
const options: DynamicFlowOptions = {
  maxSteps: 15,
  timeout: Duration.minutes(10),
  enableCaching: true,
  cacheTTL: Duration.hours(2),
  retryStrategy: {
    maxAttempts: 3,
    backoffStrategy: 'exponential',
    retryableErrors: ['NetworkError', 'RateLimitError']
  },
  modelPoolConfig: {
    maxConcurrent: 5,
    queueTimeout: Duration.seconds(30)
  },
  debugMode: process.env.NODE_ENV === 'development',
  customPrompts: {
    systemPrompt: `You are an expert workflow planner for financial services...`,
    planningPrompt: `Create a workflow that follows SOX compliance requirements...`
  }
}
```

## Execution Events

### `FlowEvent` Types

Real-time events emitted during workflow execution.

#### `flow-start`
```typescript
{
  type: 'flow-start';
  flowId: string;
  timestamp: number;
  metadata: {
    name?: string;
    description?: string;
    totalSteps: number;
  };
}
```

#### `node-start`
```typescript
{
  type: 'node-start';
  flowId: string;
  nodeId: string;
  toolId?: string;
  timestamp: number;
  inputs: unknown;
}
```

#### `tool-start`
```typescript
{
  type: 'tool-start';
  flowId: string;
  nodeId: string;
  toolId: string;
  timestamp: number;
  inputs: unknown;
}
```

#### `tool-output`
```typescript
{
  type: 'tool-output';
  flowId: string;
  nodeId: string;
  toolId: string;
  timestamp: number;
  output: unknown;
  executionTime: number;
}
```

#### `llm-token` (for streaming LLM tools)
```typescript
{
  type: 'llm-token';
  flowId: string;
  nodeId: string;
  toolId: string;
  timestamp: number;
  token: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
  };
}
```

#### `node-complete`
```typescript
{
  type: 'node-complete';
  flowId: string;
  nodeId: string;
  timestamp: number;
  output: unknown;
  executionTime: number;
}
```

#### `flow-complete`
```typescript
{
  type: 'flow-complete';
  flowId: string;
  timestamp: number;
  result: unknown;
  totalExecutionTime: number;
  stepResults: Record<string, unknown>;
}
```

#### `error`
```typescript
{
  type: 'error';
  flowId: string;
  nodeId?: string;
  timestamp: number;
  error: ExecutionError;
  retryable: boolean;
}
```

## Advanced Features

### Model Pools

For workflows requiring multiple LLM calls, DynamicFlow supports model pools for efficient resource utilisation.

```typescript
const modelPool = createModelPool({
  models: [
    OpenAi.completion('gpt-5'),
    OpenAi.completion('gpt-5'),
    OpenAi.completion('gpt-5')
  ],
  maxConcurrent: 3,
  queueTimeout: Duration.seconds(30),
  loadBalancing: 'round-robin'
})

await DynamicFlow.execute({
  prompt: "Analyse multiple documents in parallel",
  tools: analysisTools,
  joins: [],
  model: modelPool,
  options: {
    modelPoolConfig: {
      maxConcurrent: 5,
      queueTimeout: Duration.seconds(30)
    }
  }
})
```

### Approval Workflows

For sensitive operations, DynamicFlow supports human-in-the-loop approval workflows.

```typescript
await DynamicFlow.execute({
  prompt: "Transfer funds between accounts",
  tools: [balanceCheckTool, transferTool, auditTool],
  joins: [],
  model,
  options: {
    enableApprovalWorkflow: true,
    approvalConfig: {
      requiredApprovers: 2,
      timeoutDuration: Duration.minutes(30),
      approvalChannels: ['email', 'slack']
    }
  }
})
```

### Caching and Optimisation

DynamicFlow includes intelligent caching to optimise repeated workflow patterns.

```typescript
// Enable aggressive caching for development
const devOptions: DynamicFlowOptions = {
  enableCaching: true,
  cacheTTL: Duration.hours(24),
  cacheStrategy: 'aggressive' // Cache by prompt + tool signature
}

// Production caching with cache warming
const prodOptions: DynamicFlowOptions = {
  enableCaching: true,
  cacheTTL: Duration.hours(4),
  cacheStrategy: 'conservative', // Cache only successful executions
  cacheWarmup: {
    enabled: true,
    commonPrompts: [
      "Process customer order",
      "Generate monthly report",
      "Handle support ticket"
    ]
  }
}
```

## Error Handling

### `ExecutionError`

Errors that occur during workflow execution.

```typescript
class ExecutionError extends Error {
  constructor(config: {
    phase: 'generation' | 'compilation' | 'execution';
    nodeId?: string;
    toolId?: string;
    cause: string;
    retryable: boolean;
    context?: Record<string, unknown>;
  })
}
```

### Error Recovery

```typescript
await DynamicFlow.execute({
  prompt: "Process data with error handling",
  tools,
  joins: [],
  model,
  options: {
    retryStrategy: {
      maxAttempts: 3,
      backoffStrategy: 'exponential',
      retryableErrors: ['NetworkError', 'RateLimitError', 'TemporaryError'],
      customRetryLogic: (error, attempt) => {
        // Custom logic for determining if error should be retried
        return error.retryable && attempt < 5
      }
    },
    fallbackBehavior: {
      onPlanningFailure: 'use-cached-plan',
      onExecutionFailure: 'partial-results',
      onTimeoutFailure: 'graceful-degradation'
    }
  }
}).pipe(
  Stream.catchAll(error => {
    if (error instanceof ExecutionError && error.retryable) {
      // Implement custom recovery logic
      return Stream.succeed({
        type: 'recovery-attempt',
        originalError: error,
        timestamp: Date.now()
      })
    }
    return Stream.fail(error)
  }),
  Stream.runCollect,
  Effect.runPromise
)
```

## Integration Patterns

### With Existing Systems

```typescript
// Integration with existing Express.js API
app.post('/api/workflows/execute', async (req, res) => {
  const { prompt, toolIds, input } = req.body
  
  // Get tools from registry
  const tools = toolRegistry.getMany(toolIds)
  
  try {
    const events: FlowEvent[] = []
    
    await DynamicFlow.execute({
      prompt,
      tools,
      joins: [], 
      model: getModelForUser(req.user),
      input
    }).pipe(
      Stream.tap(event => Effect.sync(() => {
        events.push(event)
        // Send real-time updates via WebSocket
        io.to(req.user.id).emit('workflow-event', event)
      })),
      Stream.runDrain,
      Effect.runPromise
    )
    
    res.json({ success: true, events })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})
```

### Database Integration

```typescript
// Persist workflow executions
const persistedExecution = await DynamicFlow.execute({
  prompt: "Process customer order",
  tools: orderProcessingTools,
  joins: [],
  model,
  options: {
    persistExecution: true,
    database: {
      connection: dbConnection,
      logLevel: 'detailed'
    }
  }
}).pipe(
  Stream.tap(event => Effect.sync(() => {
    // Save each event to database
    auditLog.save({
      workflowId: event.flowId,
      eventType: event.type,
      timestamp: event.timestamp,
      data: event
    })
  })),
  Stream.runCollect,
  Effect.runPromise
)
```

## Performance Optimisation

### Concurrent Execution

```typescript
// Process multiple workflows concurrently
const workflows = [
  { prompt: "Process order A", input: orderA },
  { prompt: "Process order B", input: orderB },
  { prompt: "Process order C", input: orderC }
]

const results = await Effect.all(
  workflows.map(workflow =>
    DynamicFlow.execute({
      prompt: workflow.prompt,
      tools: orderTools,
      joins: [],
      model,
      input: workflow.input
    }).pipe(Stream.runCollect)
  ),
  { concurrency: 3 }
).pipe(Effect.runPromise)
```

### Memory Management

```typescript
// Configure memory-efficient execution for large workflows
await DynamicFlow.execute({
  prompt: "Process large dataset",
  tools: dataProcessingTools,
  joins: [],
  model,
  options: {
    memoryOptimisation: {
      streamingExecution: true,
      batchSize: 100,
      clearIntermediateResults: true
    },
    resourceLimits: {
      maxMemoryMB: 1024,
      maxExecutionTime: Duration.minutes(30)
    }
  }
})
```

## Best Practices

### Prompt Engineering

```typescript
// ✅ Good: Specific, structured prompts
const prompt = `
Create a customer support workflow that:
1. Validates the customer's identity
2. Retrieves their account information 
3. Logs the support request
4. Routes to appropriate specialist if needed
5. Sends confirmation email

Customer data: ${JSON.stringify(customerData)}
Priority level: ${priority}
`

// ❌ Avoid: Vague prompts
const prompt = "Help the customer"
```

### Tool Selection

```typescript
// ✅ Good: Focused, well-described tools
const tools = [
  customerValidationTool,    // Clear, single purpose
  accountLookupTool,        // Well-defined inputs/outputs  
  ticketLoggingTool,        // Comprehensive metadata
  routingDecisionTool,      // Clear decision criteria
  emailNotificationTool     // Reliable delivery
]

// ❌ Avoid: Too many generic tools
const tools = getAllTools() // Overwhelming for LLM planning
```

### Error Handling

```typescript
// ✅ Good: Comprehensive error handling
await DynamicFlow.execute({
  prompt,
  tools,
  joins: [],
  model,
  options: {
    retryStrategy: {
      maxAttempts: 3,
      backoffStrategy: 'exponential'
    },
    timeouts: {
      planning: Duration.seconds(30),
      execution: Duration.minutes(5),
      toolExecution: Duration.seconds(60)
    },
    fallbacks: {
      planningFailure: 'use-template',
      executionFailure: 'partial-completion'
    }
  }
}).pipe(
  Stream.catchAll(error => {
    // Log error with context
    logger.error('Workflow failed', { error, context })
    // Return graceful fallback
    return Stream.succeed(fallbackResult)
  })
)
```

## Testing

### Unit Testing

```typescript
import { describe, it, expect, vi } from 'vitest'

describe('DynamicFlow', () => {
  it('should generate and execute simple workflow', async () => {
    const mockModel = vi.fn().mockResolvedValue(mockPlan)
    
    const events: FlowEvent[] = []
    
    await DynamicFlow.execute({
      prompt: "Test workflow",
      tools: [mockTool],
      joins: [],
      model: mockModel
    }).pipe(
      Stream.tap(event => Effect.sync(() => events.push(event))),
      Stream.runDrain,
      Effect.runPromise
    )
    
    expect(events).toHaveLength(4) // start, tool-start, tool-output, complete
    expect(events[0].type).toBe('flow-start')
    expect(events[events.length - 1].type).toBe('flow-complete')
  })
})
```

### Integration Testing

```typescript
describe('DynamicFlow Integration', () => {
  it('should handle real API calls', async () => {
    const realModel = OpenAi.completion('gpt-5')
    
    const result = await DynamicFlow.execute({
      prompt: "Get weather for London and format as JSON",
      tools: [weatherApiTool, formatTool],
      joins: [],
      model: realModel
    }).pipe(
      Stream.runCollect,
      Effect.runPromise
    )
    
    expect(result).toBeDefined()
    expect(result.length).toBeGreaterThan(0)
  })
})
```

## Related APIs

- [Flow API](./flow.md) - Static workflow composition
- [Tools API](./tools.md) - Creating and managing tools
- [Streaming API](./streaming.md) - Real-time event processing
- [IR API](./ir.md) - Intermediate representation details

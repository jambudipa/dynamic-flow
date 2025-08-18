# Persistence API

The persistence module provides comprehensive support for suspending flows at any point during execution and resuming them later. This is essential for human-in-the-loop workflows, approval processes, and long-running operations that need to wait for external events.

## Core Concepts

### Flow Suspension

When a flow encounters an `AwaitInput` tool, it:
1. **Completely stops execution** - The flow doesn't wait in memory
2. **Generates a unique suspension key** - This cryptographically secure key is used to resume later
3. **Persists the entire state** - All variables, execution position, and context are saved
4. **Returns the suspension key** - The calling application receives this key for later resumption

### Flow Resumption

Using the suspension key, a flow can be resumed:
1. **Retrieve the stored state** - Using the suspension key
2. **Validate the input** - Against the schema expected by the AwaitInput tool
3. **Restore the flow** - With all variables and position intact
4. **Continue execution** - From the exact point after the AwaitInput tool

## Quick Start

```typescript
import { Effect, Duration } from 'effect'
import { Flow, BackendFactory, createDefaultPersistenceHub, createAwaitInputTool } from '@jambudipa/dynamic-flow'

// 1. Create a storage backend
const backend = await Effect.runPromise(
  BackendFactory.create({
    type: 'filesystem',
    config: { basePath: './suspended-flows' }
  })
)

// 2. Create a persistence hub
const persistenceHub = await Effect.runPromise(
  createDefaultPersistenceHub(backend, {
    enableEncryption: false,
    enableCompression: true,
    defaultTimeout: Duration.hours(24)
  })
)

// 3. Create an AwaitInput tool
const awaitApproval = createAwaitInputTool({
  id: 'manager-approval',
  name: 'Manager Approval',
  description: 'Awaiting manager approval for purchase order',
  schema: Schema.Struct({
    approved: Schema.Boolean,
    approvedBy: Schema.String,
    comments: Schema.optional(Schema.String)
  }),
  timeout: Duration.hours(4),
  defaultValue: { approved: false, approvedBy: 'system', comments: 'timeout' }
}, persistenceHub)

// 4. Use in a flow
const approvalFlow = Flow.pipe(
  Flow.input(OrderSchema),
  Flow.tool(validateOrder),
  Flow.tool(awaitApproval), // This triggers suspension
  Flow.tool(processOrder)
)

// 5. Execute - will suspend at awaitApproval
const result = await Flow.run(
  pipe(approvalFlow, Effect.provide(/* dependencies */))
)
// If suspended, check the persistence hub for the suspension key

// 6. Later, resume with input
const approval = { approved: true, approvedBy: "John Manager", comments: "Approved" }
const resumed = await Effect.runPromise(
  persistenceHub.resume(suspensionKey, approval)
)
```

## Persistence Hub

The `PersistenceHub` is the main orchestrator for flow suspension and resumption.

### Creating a Persistence Hub

#### Using the Factory Pattern (Recommended)

```typescript
import { Effect, Duration } from 'effect'
import { BackendFactory, createDefaultPersistenceHub } from '@jambudipa/dynamic-flow'

// 1. Create a storage backend
const backend = await Effect.runPromise(
  BackendFactory.create({
    type: 'filesystem',  // or 'postgres', 'redis', 'mongodb', 'neo4j'
    config: {
      // For filesystem
      basePath: './suspended-flows',
      
      // For PostgreSQL
      connectionString: 'postgresql://user:pass@localhost/db',
      
      // For Redis
      connectionString: 'redis://localhost:6379',
      
      // For MongoDB
      connectionString: 'mongodb://localhost:27017/flows',
      
      // For Neo4j
      connectionString: 'neo4j://localhost:7687',
      username: 'neo4j',
      password: 'password'
    }
  })
)

// 2. Create persistence hub with default components
const hub = await Effect.runPromise(
  createDefaultPersistenceHub(backend, {
    enableEncryption: true,      // Enable AES-256-GCM encryption
    enableCompression: true,     // Enable gzip compression
    defaultTimeout: Duration.hours(24),  // 24 hours timeout
    cleanupInterval: Duration.hours(1)   // 1 hour cleanup interval
  })
)
```

#### Using Manual Assembly (Advanced)

```typescript
import { 
  createPersistenceHub,
  createStateSerializer,
  createAESStateEncryptor,
  createCryptographicKeyGenerator 
} from '@jambudipa/dynamic-flow'

const serializer = createStateSerializer()
const encryptor = createAESStateEncryptor({ key: process.env.ENCRYPTION_KEY })
const keyGenerator = createCryptographicKeyGenerator()

const hub = createPersistenceHub(backend, serializer, encryptor, keyGenerator, {
  defaultTimeout: Duration.hours(24),
  maxRetries: 3,
  retryDelay: Duration.seconds(1)
})
```

### Hub Methods

#### `suspend(flow, context)`
Suspends a flow with the given context.

```typescript
const result = await hub.suspend(flowInstance, {
  toolId: 'await-approval',
  awaitingInputSchema: ApprovalSchema,
  timeout: Duration.hours(24),
  metadata: { requestId: '12345' }
})
// Returns: { key: "abc123...", suspendedAt: Date, expiresAt?: Date }
```

#### `resume(key, input)`
Resumes a suspended flow with provided input.

```typescript
const result = await hub.resume("abc123...", { approved: true })
// Returns: { key: "abc123...", resumedAt: Date, flowInstance: ... }
```

#### `query(criteria)`
Queries suspended flows.

```typescript
const suspended = await hub.query({
  limit: 10,
  createdAfter: new Date('2024-01-01'),
  toolId: 'await-approval'
})
// Returns array of SuspendedFlowInfo
```

#### `cleanup(criteria)`
Cleans up expired or old suspended flows.

```typescript
const result = await hub.cleanup({
  expiredOnly: true,
  olderThan: new Date('2024-01-01')
})
// Returns: { deletedCount: 5, errors: [] }
```

## AwaitInput Tool

The `AwaitInput` tool is a special tool that triggers flow suspension when executed.

### Creating AwaitInput Tools

#### Using Factory Function

```typescript
import { createAwaitInputTool, Schema, Duration } from '@jambudipa/dynamic-flow'

const awaitApproval = createAwaitInputTool({
  id: 'expense-approval',
  name: 'Expense Approval',
  description: 'Manager approval required for expense',
  schema: Schema.Struct({
    approved: Schema.Boolean,
    approvedBy: Schema.String,
    comments: Schema.optional(Schema.String),
    amount: Schema.optional(Schema.Number)
  }),
  timeout: Duration.hours(4),
  defaultValue: {
    approved: false,
    approvedBy: 'system',
    comments: 'Request timed out'
  },
  metadata: {
    priority: 'high',
    department: 'finance'
  }
}, persistenceHub)
```

#### Using Presets (Convenient Factory Functions)

```typescript
import { AwaitInputPresets, HumanInTheLoopTools } from '@jambudipa/dynamic-flow'

// Create tools factory
const hitlTools = new HumanInTheLoopTools(persistenceHub)

// Simple approval
const awaitApproval = hitlTools.approval({
  id: 'expense-approval',
  name: 'Expense Approval',
  description: 'Manager approval required for expense',
  timeoutHours: 4,
  requireComments: true,
  allowDelegation: false
})

// Confirmation dialog
const awaitConfirmation = hitlTools.confirmation({
  id: 'delete-confirm',
  name: 'Delete Confirmation', 
  description: 'Confirm deletion of resource',
  timeoutHours: 1,
  requireReason: true
})

// Document review
const awaitReview = hitlTools.documentReview({
  id: 'document-review',
  name: 'Document Review',
  description: 'Human review of uploaded document',
  timeoutHours: 24,
  allowAnnotations: true
})
```

#### Using Builder Pattern (Advanced)

```typescript
import { awaitInput, Schema, Duration } from '@jambudipa/dynamic-flow'

const customAwaitInput = awaitInput()
  .withId('custom-input')
  .withName('Custom Input')
  .withDescription('Awaiting custom structured input')
  .withSchema(Schema.Struct({
    decision: Schema.String,
    reason: Schema.String,
    metadata: Schema.Record({ key: Schema.String, value: Schema.Unknown })
  }))
  .withTimeout(Duration.hours(48))
  .withDefaultValue({
    decision: 'pending',
    reason: 'timeout',
    metadata: {}
  })
  .withMetadata({
    priority: 'high',
    department: 'finance'
  })
  .build(persistenceHub)
```

### How AwaitInput Works

1. **Tool Execution**: When the flow executes an AwaitInput tool
2. **Signal Thrown**: The tool throws a `FlowSuspensionSignal` error
3. **Signal Caught**: The flow engine catches this special error
4. **State Persisted**: The entire flow state is serialized and stored
5. **Key Returned**: A unique suspension key is returned to the caller

```typescript
// Inside AwaitInput tool (simplified)
execute(input, context) {
  return Effect.fail(new FlowSuspensionSignal({
    suspensionKey: generateKey(),
    awaitingSchema: this.schema,
    message: `Flow suspended: ${this.description}`
  }))
}
```

## Storage Backends

### Filesystem Backend

Stores suspended flows as JSON files on disk.

```typescript
const hub = createPersistenceHub({
  backend: 'filesystem',
  backendConfig: {
    directory: './suspended-flows',  // Default: './.suspended-flows'
    permissions: 0o600               // File permissions (owner read/write only)
  }
})
```

**Auto-provisioning**: Creates directory if it doesn't exist.

### PostgreSQL Backend

Stores suspended flows in a PostgreSQL database.

```typescript
const hub = createPersistenceHub({
  backend: 'postgres',
  backendConfig: {
    connectionString: 'postgresql://user:pass@localhost:5432/mydb',
    tableName: 'suspended_flows',    // Default table name
    schemaName: 'public'             // Database schema
  }
})
```

**Auto-provisioning**: 
- Creates database if it doesn't exist (requires appropriate permissions)
- Creates table with indexes:
  ```sql
  CREATE TABLE IF NOT EXISTS suspended_flows (
    key VARCHAR(255) PRIMARY KEY,
    state TEXT NOT NULL,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP,
    tool_id VARCHAR(255)
  );
  CREATE INDEX idx_created_at ON suspended_flows(created_at);
  CREATE INDEX idx_expires_at ON suspended_flows(expires_at);
  CREATE INDEX idx_tool_id ON suspended_flows(tool_id);
  ```

### Redis Backend

Stores suspended flows in Redis with optional expiration.

```typescript
const hub = createPersistenceHub({
  backend: 'redis',
  backendConfig: {
    connectionString: 'redis://localhost:6379',
    keyPrefix: 'flow:suspended:',    // Prefix for all keys
    db: 0                            // Redis database number
  }
})
```

**Auto-provisioning**: No setup needed, keys are created on demand.

### MongoDB Backend

Stores suspended flows in MongoDB with automatic indexing.

```typescript
const hub = createPersistenceHub({
  backend: 'mongodb',
  backendConfig: {
    connectionString: 'mongodb://localhost:27017',
    database: 'flows',               // Database name
    collection: 'suspended_flows'    // Collection name
  }
})
```

**Auto-provisioning**:
- Creates database if it doesn't exist
- Creates collection with indexes:
  - `key` (unique)
  - `createdAt`
  - `expiresAt` (TTL index for automatic cleanup)
  - `toolId`

### Neo4j Backend

Stores suspended flows as nodes in Neo4j graph database.

```typescript
const hub = createPersistenceHub({
  backend: 'neo4j',
  backendConfig: {
    connectionString: 'neo4j://localhost:7687',
    username: 'neo4j',
    password: 'password',
    database: 'neo4j'               // Database name
  }
})
```

**Auto-provisioning**:
- Creates database if it doesn't exist (Neo4j 4.0+)
- Creates constraints and indexes:
  ```cypher
  CREATE CONSTRAINT flow_key IF NOT EXISTS 
  FOR (f:SuspendedFlow) REQUIRE f.key IS UNIQUE;
  
  CREATE INDEX flow_created IF NOT EXISTS 
  FOR (f:SuspendedFlow) ON (f.createdAt);
  ```

## Security Features

### Encryption

When enabled, all flow states are encrypted using AES-256-GCM before storage.

```typescript
const hub = createPersistenceHub({
  backend: 'filesystem',
  encryptionEnabled: true,
  backendConfig: {
    encryptionKey: process.env.FLOW_ENCRYPTION_KEY // 32-byte key
  }
})
```

### Compression

When enabled, flow states are compressed using gzip before storage (and after encryption if both are enabled).

```typescript
const hub = createPersistenceHub({
  backend: 'filesystem',
  compressionEnabled: true  // Reduces storage by 60-80% typically
})
```

## Error Handling

The persistence module defines specific error types:

```typescript
try {
  const result = await hub.resume(key, input)
} catch (error) {
  if (error instanceof SuspensionKeyNotFound) {
    // Key doesn't exist or has expired
  } else if (error instanceof InputValidationError) {
    // Input doesn't match expected schema
  } else if (error instanceof StorageError) {
    // Backend storage error
  }
}
```

## Example: Conversation with Persistence

See the complete working example in `examples/static/16-conversation-final.ts` that demonstrates:
- LLM-powered conversation routing with `Flow.switchRoute`
- Filesystem persistence for conversation state
- Terminal interface for natural interaction
- Real OpenAI integration without mocking

```typescript
import { Effect, pipe, Schema, Duration } from 'effect'
import { Flow, LLMLive, createOpenAiCompletionTool, BackendFactory, createDefaultPersistenceHub } from '@jambudipa/dynamic-flow'

// Create conversation with persistence
async function createConversationWithPersistence() {
  // 1. Set up filesystem persistence
  const backend = await Effect.runPromise(
    BackendFactory.create({
      type: 'filesystem',
      config: { basePath: './conversation-state' }
    })
  )

  const persistenceStorage = await Effect.runPromise(
    createDefaultPersistenceHub(backend, {
      enableEncryption: false,
      enableCompression: true,
      defaultTimeout: Duration.hours(24)
    })
  )

  // 2. Create conversation tools
  const responseTool = createOpenAiCompletionTool(
    'conversation-response',
    'Conversation Response',
    'Generates conversation responses'
  )

  // 3. Create routing flow with LLM decision making
  const conversationFlow = Flow.switchRoute(
    (input: { userMessage: string; conversationHistory: string }) =>
      `Analyze this user message and decide the conversation flow:
      Current message: "${input.userMessage}"
      Conversation context: ${input.conversationHistory}
      
      Rules:
      - Choose "end" if they want to END the conversation (goodbye, bye, quit, exit, stop)
      - Choose "continue" for everything else`,
    
    [continueConversationTool, endConversationTool],
    
    {
      'continue': (input: { userMessage: string; conversationHistory: string }) =>
        pipe(
          Effect.succeed({
            prompt: `You are a helpful AI assistant. Here's the conversation so far:
            ${input.conversationHistory}
            User: ${input.userMessage}
            Respond naturally and helpfully.`
          }),
          Effect.flatMap((promptInput) => responseTool.execute(promptInput, {} as any)),
          Effect.map((response: any) => ({
            shouldContinue: true,
            response: response.response
          }))
        ),
      
      'end': (input: { userMessage: string; conversationHistory: string }) =>
        // Similar structure for ending conversation
    },
    { retries: 2 }
  )

  return { conversationFlow, persistenceStorage }
}
```

## Example: Human-in-the-Loop Workflow

```typescript
import { Effect, pipe, Duration } from 'effect'
import { Flow, BackendFactory, createDefaultPersistenceHub, createAwaitInputTool } from '@jambudipa/dynamic-flow'

// Create persistence hub
const backend = await Effect.runPromise(
  BackendFactory.create({
    type: 'postgres',
    config: { connectionString: 'postgresql://user:pass@localhost/db' }
  })
)

const hub = await Effect.runPromise(
  createDefaultPersistenceHub(backend, {
    enableEncryption: true,
    enableCompression: true,
    defaultTimeout: Duration.hours(24)
  })
)

// Define tools
const analyzeDocument = {
  id: 'analyze',
  name: 'Document Analysis',
  description: 'AI analysis of document',
  inputSchema: DocumentSchema,
  outputSchema: Schema.Struct({
    riskScore: Schema.Number,
    flaggedItems: Schema.Array(Schema.String)
  }),
  execute: (doc: Document) => Effect.succeed({
    riskScore: 0.7,
    flaggedItems: ['suspicious_transaction', 'unusual_amount']
  })
}

const awaitReview = createAwaitInputTool({
  id: 'human-review',
  name: 'Human Review Required',
  description: 'Document requires human review due to high risk score',
  schema: Schema.Struct({
    approved: Schema.Boolean,
    comments: Schema.String,
    approvedBy: Schema.String
  }),
  timeout: Duration.hours(4),
  defaultValue: {
    approved: false,
    comments: 'Review timed out',
    approvedBy: 'system'
  }
}, hub)

const processDocument = {
  id: 'process',
  name: 'Process Document',
  description: 'Process approved document',
  inputSchema: Schema.Unknown,
  outputSchema: Schema.Struct({
    processed: Schema.Boolean,
    id: Schema.String
  }),
  execute: (input: any) => Effect.succeed({
    processed: true,
    id: `DOC-${Date.now()}`
  })
}

// Create flow with routing
const documentFlow = Flow.switchRoute(
  (result: { riskScore: number }) => 
    result.riskScore > 0.5 ? 'review' : 'auto',
  
  [
    { id: 'review', name: 'Review Required', description: 'Needs human review' },
    { id: 'auto', name: 'Auto Process', description: 'Can auto-process' }
  ],
  
  {
    review: pipe(
      Flow.tool(awaitReview), // Triggers suspension
      Flow.filter((result: any) => result.approved),
      Flow.tool(processDocument)
    ),
    auto: Flow.tool(processDocument)
  }
)

// Execute flow
const result = await Flow.run(
  pipe(
    Flow.succeed(document),
    Flow.tool(analyzeDocument),
    documentFlow,
    Effect.provide(/* dependencies */)
  )
)

// Check for suspension and handle resumption
if (result.suspended) {
  // Notify reviewer with suspension key
  await notifyReviewer(result.suspensionKey)
  
  // Later, when reviewer responds:
  const approval = { 
    approved: true, 
    comments: "Looks good",
    approvedBy: "jane@company.com" 
  }
  const resumedResult = await Effect.runPromise(
    hub.resume(result.suspensionKey, approval)
  )
}
```

## Best Practices

1. **Use appropriate timeouts**: Set reasonable timeouts for AwaitInput tools to prevent indefinite suspension
2. **Clean up regularly**: Use the cleanup functionality to remove expired suspensions
3. **Secure sensitive data**: Enable encryption when dealing with sensitive information
4. **Choose the right backend**: 
   - Filesystem for development and simple deployments
   - PostgreSQL for production with ACID requirements
   - Redis for high-performance with automatic expiration
   - MongoDB for document-oriented workflows
   - Neo4j for graph-based workflow relationships
5. **Handle suspension gracefully**: Always check for suspension in flow results
6. **Validate resumption input**: The library automatically validates against the expected schema
7. **Monitor suspended flows**: Use the query API to monitor and report on suspended flows
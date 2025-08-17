# Runtime Graph Generation

The cornerstone feature of DynamicFlow is runtime graph generation - the ability for AI models to create complete execution graphs from natural language prompts. This capability fundamentally differentiates DynamicFlow from traditional workflow frameworks.

## What is Runtime Graph Generation?

### Traditional Approach Limitations

Most workflow frameworks require you to define the entire graph structure at development time:

```typescript
// Traditional static workflow definition
const staticWorkflow = new WorkflowBuilder()
  .addNode('validate', validateUserTool)
  .addNode('process', processDataTool) 
  .addNode('notify', sendEmailTool)
  .addEdge('validate', 'process')
  .addEdge('process', 'notify')
  .addConditional('validate', (result) => result.valid)
  .build()
```

This approach forces you to:
- **Predict all possible workflows** at development time
- **Hard-code decision logic** into your application
- **Rebuild and redeploy** for new workflow patterns
- **Maintain multiple workflow definitions** for different scenarios

### DynamicFlow's Innovation

DynamicFlow enables AI to generate the entire graph topology at runtime:

```typescript
// Dynamic graph generation from natural language
const workflow = await DynamicFlow.generate({
  prompt: `
    Validate the user's data, and if valid, process their request.
    If processing succeeds, send a success notification.
    If validation fails, send an error notification with suggestions.
    If processing fails but validation passed, log the error and send a retry notification.
  `,
  tools: [validateTool, processTool, notifyTool, logTool],
  joins: [],
  model: OpenAi.completion('gpt-5')
})

// The AI generates the complete graph structure:
// - Nodes for each operation
// - Edges connecting operations  
// - Conditional branches based on outcomes
// - Parallel execution where appropriate
// - Error handling and recovery paths
```

## How Graph Generation Works

### 1. Prompt Analysis

The LLM analyzes the natural language prompt to identify:

- **Required operations** - What needs to be done
- **Data dependencies** - What depends on what
- **Conditional logic** - When to branch
- **Error scenarios** - How to handle failures
- **Parallelization opportunities** - What can run concurrently

### 2. Tool Capability Assessment

The LLM evaluates available tools to determine:

- **Input/output compatibility** - Which tools can connect
- **Functional capabilities** - What each tool can accomplish
- **Performance characteristics** - Speed, reliability, resource usage
- **Error handling** - What can go wrong and recovery options

### 3. Graph Construction

The LLM creates a complete graph structure:

```json
{
  "version": "1.0",
  "metadata": {
    "name": "User Data Processing Workflow",
    "description": "Validates user data and processes with error handling",
    "generated": true,
    "model": "gpt-5",
    "complexity": "medium"
  },
  "nodes": [
    {
      "id": "validate_user_data",
      "type": "tool",
      "toolId": "validateUser",
      "inputs": { "userData": "$input" }
    },
    {
      "id": "process_request", 
      "type": "conditional",
      "condition": "$validate_user_data.valid === true",
      "ifTrue": {
        "type": "tool",
        "toolId": "processData",
        "inputs": { "validatedData": "$validate_user_data.data" }
      },
      "ifFalse": {
        "type": "tool",
        "toolId": "notifyError",
        "inputs": {
          "email": "$input.email",
          "errors": "$validate_user_data.errors"
        }
      }
    },
    {
      "id": "handle_success",
      "type": "conditional", 
      "condition": "$process_request.success === true",
      "ifTrue": {
        "type": "tool",
        "toolId": "notifySuccess",
        "inputs": {
          "email": "$input.email",
          "result": "$process_request.data"
        }
      },
      "ifFalse": {
        "type": "parallel",
        "branches": [
          {
            "type": "tool",
            "toolId": "logError",
            "inputs": { "error": "$process_request.error" }
          },
          {
            "type": "tool", 
            "toolId": "notifyRetry",
            "inputs": {
              "email": "$input.email",
              "retryAfter": "5 minutes"
            }
          }
        ]
      }
    }
  ],
  "edges": [
    { "from": "validate_user_data", "to": "process_request" },
    { "from": "process_request", "to": "handle_success" }
  ]
}
```

## Graph Types and Patterns

### Sequential Graphs

Linear execution where each step depends on the previous:

```typescript
const sequentialPrompt = `
  1. Fetch user profile data
  2. Validate the profile completeness  
  3. Calculate user score based on profile
  4. Update user tier based on score
  5. Send tier update notification
`

// Generated graph: A → B → C → D → E
```

### Conditional Graphs

Branching logic based on intermediate results:

```typescript
const conditionalPrompt = `
  Check if user is premium subscriber.
  If premium: Process request with priority handling and send premium notification.
  If standard: Check request size - if large, queue for batch processing, if small process immediately.
  For all users: Log the request for analytics.
`

// Generated graph includes conditional nodes and multiple execution paths
```

### Parallel Graphs

Independent operations that can run concurrently:

```typescript
const parallelPrompt = `
  For new user registration:
  - Validate email address (can run independently)
  - Check username availability (can run independently)  
  - Verify phone number (can run independently)
  - Once all validations complete, create user account
  - Send welcome email and SMS notification (can run in parallel)
`

// Generated graph identifies parallel execution opportunities
```

### Complex Mixed Graphs

Real-world workflows combining all patterns:

```typescript
const complexPrompt = `
  Process incoming customer support ticket:
  
  1. Parse ticket content and extract key information
  2. In parallel:
     - Classify ticket type (technical, billing, general)
     - Determine sentiment (positive, negative, neutral)
     - Extract customer identity and look up account
  3. Based on classification and sentiment:
     - High priority (negative sentiment + billing): Route to senior agent immediately
     - Technical issues: Check knowledge base for solutions first
     - General inquiries: Route to standard queue
  4. For all tickets:
     - Log in CRM system
     - Send acknowledgment email to customer
     - Update customer interaction history
  5. If auto-resolution found in knowledge base:
     - Send solution to customer
     - Mark ticket as resolved
     - Ask for feedback
  6. Otherwise:
     - Assign to appropriate agent queue
     - Send estimated response time to customer
`

// Generated graph includes sequential, parallel, and conditional elements
```

## Advanced Graph Features

### Error Recovery Subgraphs

The AI can generate sophisticated error handling:

```typescript
const errorHandlingPrompt = `
  Process payment with comprehensive error handling:
  
  1. Validate payment details
  2. Attempt payment processing
  3. If payment fails:
     - If insufficient funds: Suggest payment plan options
     - If card expired: Request updated payment method  
     - If fraud detected: Initiate security verification
     - If network error: Retry up to 3 times with exponential backoff
     - If unknown error: Log for investigation and notify admin
  4. For successful payments:
     - Send confirmation receipt
     - Update account balance
     - Process any pending orders
`

// AI generates error recovery subgraphs for each failure scenario
```

### Dynamic Parallelization

The AI identifies parallelization opportunities automatically:

```typescript
const dataProcessingPrompt = `
  Generate monthly business report:
  
  - Collect sales data from database
  - Collect customer feedback from support system
  - Collect marketing metrics from analytics platform
  - Collect financial data from accounting system
  
  Once all data is collected:
  - Analyze sales trends
  - Analyze customer satisfaction
  - Analyze marketing ROI
  - Analyze profit margins
  
  Combine all analyses into executive summary report.
`

// AI recognizes that data collection and analysis can be parallelized
```

### Adaptive Complexity

Graph complexity adapts to the prompt requirements:

```typescript
// Simple prompt → Simple graph
const simplePrompt = "Send welcome email to new user"
// Generated: 1-2 nodes, linear execution

// Complex prompt → Complex graph  
const complexPrompt = `
  Handle enterprise customer escalation with full audit trail,
  compliance checking, multi-level approvals, and integration
  with external systems following SOX requirements.
`
// Generated: 15-20 nodes, multiple branches, parallel execution
```

## Graph Optimisation

### Automatic Optimisation

The AI applies optimisations during generation:

```typescript
// Inefficient human description
const inefficientPrompt = `
  Get user data, then get user preferences, then get user history,
  then combine all the data, then process it.
`

// AI optimizes to:
// - Parallel data fetching for user data, preferences, and history
// - Single combination/processing step
// - Reduced total execution time
```

### Resource-Aware Generation

The AI considers resource constraints:

```typescript
const resourceAwarePrompt = `
  Process large dataset with memory constraints.
  Split into chunks, process each chunk independently,
  and combine results efficiently.
`

// AI generates streaming/batching patterns automatically
```

### Dependency Optimisation

The AI minimizes dependencies and maximizes parallelization:

```typescript
const dependencyPrompt = `
  For user onboarding:
  - Create user account (requires email validation)
  - Set up user preferences (requires account)  
  - Send welcome email (requires account)
  - Create user workspace (requires account)
  - Send team notifications (requires workspace)
  
  Optimize for fastest completion time.
`

// AI generates optimal dependency graph:
// email_validation → account_creation → [preferences, welcome_email, workspace] → team_notifications
```

## Graph Validation and Safety

### Structural Validation

Generated graphs are validated for:

- **Cycle detection** - No infinite loops
- **Unreachable nodes** - All nodes have paths
- **Data flow validation** - Compatible inputs/outputs
- **Resource constraints** - Within system limits

### Semantic Validation

The AI ensures logical consistency:

```typescript
// The AI validates that this makes sense:
const validatedPrompt = `
  If payment succeeds, send success notification.
  If payment fails, process refund.
`

// AI recognizes logical inconsistency: 
// Can't process refund if payment failed (nothing to refund)
// Suggests alternative: "If payment fails, suggest retry or alternative payment method"
```

### Security Validation

Generated workflows are checked for security issues:

- **Privilege escalation** - No unauthorized access
- **Data exposure** - Sensitive data handling
- **Resource abuse** - No excessive resource usage
- **Injection attacks** - Safe data processing

## Graph Execution Guarantees

### Deterministic Execution

Once generated, graphs execute deterministically:

- **Same input → Same output** - Reproducible results
- **No runtime planning changes** - Stable execution
- **Predictable resource usage** - Known performance characteristics
- **Complete audit trail** - Full execution history

### Type Safety

Generated graphs maintain type safety:

- **Schema validation** - All data validated
- **Type compatibility** - Safe data transformations
- **Error handling** - Graceful failure modes
- **Resource management** - Automatic cleanup

## Comparison with Traditional Approaches

### vs. Static Workflow Engines

| Feature | Traditional | DynamicFlow |
|---------|-------------|-------------|
| Graph Definition | Development time | Runtime |
| Flexibility | Limited to predefined paths | Unlimited combinations |
| Maintenance | Manual updates required | Automatic adaptation |
| Complexity Handling | Pre-planned scenarios only | Dynamic complexity scaling |
| Learning Curve | High (workflow DSL) | Low (natural language) |

### vs. Code Generation Approaches

| Feature | Code Generation | Graph Generation |
|---------|-----------------|------------------|
| Output | Executable code | Structured graph |
| Safety | Runtime errors possible | Validated structure |
| Debugging | Code-level debugging | Graph-level inspection |
| Reusability | Limited reuse | High reusability |
| Performance | Variable | Optimized execution |

### vs. Rule-Based Systems

| Feature | Rule-Based | AI Graph Generation |
|---------|------------|-------------------|
| Rule Definition | Manual expert rules | AI-derived patterns |
| Adaptability | Static rule sets | Dynamic adaptation |
| Complexity | Limited rule combinations | Unlimited complexity |
| Maintenance | Manual rule updates | Self-adapting |
| Domain Knowledge | Expert-encoded | AI-inferred |

## Best Practices for Graph Generation

### Prompt Design for Better Graphs

```typescript
// ✅ Good: Clear, structured prompt
const goodPrompt = `
  Order fulfillment workflow:
  
  Prerequisites:
  - Valid order data
  - Customer payment confirmed
  
  Steps:
  1. Validate inventory availability
  2. Reserve items in warehouse
  3. Calculate shipping options
  4. Generate picking list
  5. Create shipping label
  6. Send tracking info to customer
  
  Error handling:
  - Out of stock: Notify customer with alternatives
  - Shipping errors: Retry with backup carrier
  - Payment issues: Hold order and notify billing team
  
  Success criteria:
  - Order processed within 2 hours
  - Customer notified at each step
  - Full audit trail maintained
`

// ❌ Avoid: Vague prompt
const badPrompt = "Handle customer orders"
```

### Tool Design for Graph Generation

```typescript
// ✅ Good: Clear tool descriptions aid graph generation
const wellDescribedTool = Tools.createTool({
  id: 'validateInventory',
  name: 'Inventory Validator',
  description: `
    Checks product availability and reserves inventory.
    
    Capabilities:
    - Real-time inventory lookup
    - Multi-location checking
    - Automatic reservation with timeout
    - Alternative product suggestions
    
    Best used when:
    - Processing customer orders
    - Planning procurement
    - Validating cart contents
    
    Outputs:
    - Availability status for each item
    - Reserved quantities and expiration
    - Suggested alternatives for unavailable items
  `,
  // ... schemas and implementation
})
```

### Validation and Testing

```typescript
// Validate generated graphs before execution
const validateGraph = async (prompt: string) => {
  const workflow = await DynamicFlow.generate({
    prompt,
    tools: availableTools,
    joins: availableJoins,
    model
  })
  
  // Structural validation
  const structuralIssues = validateGraphStructure(workflow.ir)
  
  // Logical validation  
  const logicalIssues = validateGraphLogic(workflow.ir)
  
  // Performance validation
  const performanceIssues = validateGraphPerformance(workflow.ir)
  
  if ([...structuralIssues, ...logicalIssues, ...performanceIssues].length > 0) {
    throw new GraphValidationError('Generated graph has issues')
  }
  
  return workflow
}
```

Runtime graph generation represents a paradigm shift in workflow automation, enabling unprecedented flexibility while maintaining safety and performance. By understanding how to leverage this capability effectively, you can create truly adaptive systems that evolve with your business needs.

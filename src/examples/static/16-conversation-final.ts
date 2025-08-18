/**
 * Final Working Example: Conversation with LLM Routing and Filesystem Persistence
 *
 * A complete, working example demonstrating:
 * - LLM-powered conversation using Flow.switchRoute
 * - Filesystem persistence for conversation state
 * - Terminal user interface
 * - Proper library usage with real LLM integration
 *
 * Requirements:
 * - OPENAI_API_KEY environment variable
 * - Write permissions for ./conversation-state/ directory
 *
 * Run: npx tsx examples/static/25-conversation-final.ts
 */

import { Effect, pipe, Schema, Duration, Context } from 'effect'
import { Flow, LLMServiceLive } from '../../lib/index'
import { createOpenAiCompletionTool } from '../../lib/llm/providers/effect-openai-tool'
import { createDefaultPersistenceHub, PersistenceHubService } from '../../lib/persistence/hub'
import { BackendFactory } from '../../lib/persistence/backend-factory'
import { FilesystemStorageBackendLive, FilesystemStorageBackend } from '../../lib/persistence/backends/filesystem'
import { type SuspensionKey } from '../../lib/persistence/types'
import { loadEnv } from '../env'
import * as readline from 'readline'
import * as path from 'path'

// ============= Types =============

interface ConversationState {
  id: string
  messages: Array<{ role: 'user' | 'assistant'; content: string; timestamp: string }>
  isActive: boolean
}

interface ConversationResult {
  shouldContinue: boolean
  response: string
}

// ============= Terminal Interface =============

class TerminalInterface {
  private rl: readline.Interface

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    })
  }

  async getUserInput(prompt: string = '👤 You: '): Promise<string> {
    return new Promise((resolve) => {
      this.rl.question(prompt, (answer) => {
        resolve(answer.trim())
      })
    })
  }

  displayMessage(message: string, sender: 'user' | 'assistant' = 'assistant') {
    const icon = sender === 'user' ? '👤' : '🤖'
    const label = sender === 'user' ? 'You' : 'Assistant'
    console.log(`${icon} ${label}: ${message}`)
  }

  displayInfo(message: string) {
    console.log(`ℹ️  ${message}`)
  }

  close() {
    this.rl.close()
  }
}

// ============= Conversation Flow =============

/**
 * Create conversation flow with LLM routing via Flow.switchRoute
 */
function createConversationFlow() {
  const responseTool = createOpenAiCompletionTool(
    'conversation-response',
    'Conversation Response',
    'Generates conversation responses'
  )

  // Tool definitions for routing options (required by Flow.switchRoute)
  const continueConversationTool = {
    id: 'continue',
    name: 'Continue Conversation',
    description: 'Continue with a helpful response',
    inputSchema: Schema.String,
    outputSchema: Schema.Unknown,
    execute: (input: string, context: any) => Effect.succeed({})
  }

  const endConversationTool = {
    id: 'end',
    name: 'End Conversation',
    description: 'End the conversation gracefully',
    inputSchema: Schema.String,
    outputSchema: Schema.Unknown,
    execute: (input: string, context: any) => Effect.succeed({})
  }

  return Flow.switchRoute(
    (input: { userMessage: string; conversationHistory: string }) =>
      `Analyze this user message and decide the conversation flow:

Current message: "${input.userMessage}"

Conversation context:
${input.conversationHistory}

Rules:
- Choose "end" if they want to END the conversation (goodbye, bye, quit, exit, stop, end, thanks bye, see you later, etc.)
- Choose "continue" for everything else

Be decisive - look for clear ending signals.`,

    [continueConversationTool, endConversationTool],

    {
      'continue': (input: { userMessage: string; conversationHistory: string }) =>
        pipe(
          Effect.succeed({
            prompt: `You are a helpful AI assistant. Here's the conversation so far:

${input.conversationHistory}

User: ${input.userMessage}

Respond naturally and helpfully, using the conversation context to maintain continuity and remember what was discussed.`
          }),
          Effect.flatMap((promptInput) => responseTool.execute(promptInput, {} as any)),
          Effect.map((response: any) => ({
            shouldContinue: true,
            response: response.response
          } as ConversationResult))
        ),

      'end': (input: { userMessage: string; conversationHistory: string }) =>
        pipe(
          Effect.succeed({
            prompt: `The user wants to end the conversation with: "${input.userMessage}". 

Conversation context:
${input.conversationHistory}

Provide a warm, friendly goodbye message that acknowledges the conversation.`
          }),
          Effect.flatMap((promptInput) => responseTool.execute(promptInput, {} as any)),
          Effect.map((response: any) => ({
            shouldContinue: false,
            response: response.response
          } as ConversationResult))
        )
    },

    { retries: 2 }
  )
}

// ============= Persistence Management =============

async function createConversationPersistence() {
  // Create filesystem backend using Layer
  const filesystemLayer = FilesystemStorageBackendLive({
    basePath: path.join(process.cwd(), 'conversation-state')
  })

  // Get backend from layer
  const backend = await Effect.runPromise(
    Effect.gen(function* (_) {
      return yield* _(FilesystemStorageBackend)
    }).pipe(Effect.provide(filesystemLayer))
  )

  const hubLayer = createDefaultPersistenceHub({
    enableEncryption: false,
    enableCompression: true,
    defaultTimeout: Duration.hours(24)
  })
  
  const hub = await Effect.runPromise(
    Effect.gen(function* (_) {
      return yield* _(PersistenceHubService)
    }).pipe(Effect.provide(hubLayer))
  )

  // Return both the hub and a simple storage interface
  return {
    hub,
    backend,
    // Simple storage wrapper for conversation data
    store: async (id: string, data: ConversationState): Promise<void> => {
      const serializedState = {
        version: '1.0.0',
        data: JSON.stringify(data),
        metadata: {
          serializedAt: new Date().toISOString(),
          size: JSON.stringify(data).length,
          checksum: 'simple'
        }
      }

      // Cast string to SuspensionKey (following library pattern)
      const suspensionKey = id as SuspensionKey
      await Effect.runPromise(backend.store(suspensionKey, serializedState))
    },

    retrieve: async (id: string): Promise<ConversationState | null> => {
      try {
        // Cast string to SuspensionKey (following library pattern)
        const suspensionKey = id as SuspensionKey
        const result = await Effect.runPromise(backend.retrieve(suspensionKey))
        if (result._tag === 'Some') {
          return JSON.parse(result.value.data)
        }
        return null
      } catch {
        return null
      }
    }
  }
}

function createNewConversation(): ConversationState {
  return {
    id: `conv_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
    messages: [],
    isActive: true
  }
}

function addMessage(state: ConversationState, role: 'user' | 'assistant', content: string): ConversationState {
  return {
    ...state,
    messages: [...state.messages, {
      role,
      content,
      timestamp: new Date().toISOString()
    }]
  }
}

function formatConversationHistory(state: ConversationState): string {
  if (state.messages.length === 0) {
    return "This is the start of a new conversation."
  }

  return state.messages
    .map(msg => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content}`)
    .join('\n')
}

async function saveConversation(storage: any, state: ConversationState) {
  try {
    await storage.store(state.id, state)
  } catch (error) {
    console.warn('Failed to save conversation:', error)
  }
}

// ============= Main Conversation Runner =============

export async function runConversationWithLLMRouting(): Promise<void> {
  loadEnv()

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required for LLM routing')
  }

  console.log(`
╔═══════════════════════════════════════════════════════════╗
║        Conversation with LLM Routing & Persistence        ║
║                                                           ║
║  Features:                                                ║
║  • LLM-powered conversation routing with Flow.switchRoute ║
║  • Filesystem persistence for conversation state          ║
║  • Terminal interface for natural conversation            ║
║  • Real OpenAI integration for intelligent responses      ║
║                                                           ║
║  Instructions:                                            ║
║  • Chat naturally with the AI                             ║
║  • Say "goodbye", "bye", or "quit" to end                 ║
║  • Conversation automatically saved to disk               ║
║                                                           ║
║  Storage: ./conversation-state/                           ║
╚═══════════════════════════════════════════════════════════╝
`)

  const terminal = new TerminalInterface()

  try {
    // Setup
    terminal.displayInfo('Setting up conversation with LLM routing...')
    const persistenceStorage = await createConversationPersistence()
    let conversationState = createNewConversation()
    const conversationFlow = createConversationFlow()

    terminal.displayInfo(`Started conversation: ${conversationState.id}`)

    // Welcome
    terminal.displayMessage("Hello! I'm here to help. What would you like to talk about?")

    // Main conversation loop
    while (conversationState.isActive) {
      try {
        // Get user input
        const userMessage = await terminal.getUserInput()

        if (!userMessage) {
          terminal.displayInfo('Please enter a message.')
          continue
        }

        // Add to conversation
        conversationState = addMessage(conversationState, 'user', userMessage)

        // Process with LLM routing via Flow.switchRoute
        terminal.displayInfo('Processing with LLM routing...')

        const result = await Flow.run(
          pipe(
            Flow.succeed({
              userMessage,
              conversationHistory: formatConversationHistory(conversationState)
            }),
            conversationFlow,
            Effect.provide(LLMServiceLive)
          )
        ) as ConversationResult

        // Display response
        terminal.displayMessage(result.response)

        // Add to conversation
        conversationState = addMessage(conversationState, 'assistant', result.response)

        // Check if should continue
        if (!result.shouldContinue) {
          conversationState.isActive = false
          terminal.displayInfo('Conversation ended by LLM routing decision.')
        }

        // Save state
        await saveConversation(persistenceStorage, conversationState)

      } catch (error) {
        terminal.displayInfo(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`)
        terminal.displayInfo('You can continue or say "quit" to exit.')
      }
    }

    // Final save
    await saveConversation(persistenceStorage, conversationState)
    terminal.displayInfo(`Conversation saved with ${conversationState.messages.length} messages.`)

  } catch (error) {
    console.error(`Failed to start conversation: ${error instanceof Error ? error.message : 'Unknown error'}`)
    throw error
  } finally {
    terminal.close()
    // Force process exit since readline may keep it alive
    process.exit(0)
  }
}

// ============= Example Runner for Testing =============

export async function runExample(): Promise<{ messageCount: number }> {
  console.log('=== Conversation with LLM Routing & Persistence Example ===\n')

  loadEnv()

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required for this example')
  }

  try {
    const persistenceStorage = await createConversationPersistence()
    let conversationState = createNewConversation()
    const conversationFlow = createConversationFlow()

    console.log('Testing conversation flow with LLM routing...')

    // Simulate conversation with clear ending
    const testMessages = ["Hello!", "Tell me about the weather", "goodbye"]

    for (const userMessage of testMessages) {
      console.log(`\nUser: ${userMessage}`)

      conversationState = addMessage(conversationState, 'user', userMessage)

      const result = await Flow.run(
        pipe(
          Flow.succeed({
            userMessage,
            conversationHistory: formatConversationHistory(conversationState)
          }),
          conversationFlow,
          Effect.provide(LLMServiceLive)
        )
      ) as ConversationResult

      console.log(`Assistant: ${result.response}`)
      console.log(`Should continue: ${result.shouldContinue}`)

      conversationState = addMessage(conversationState, 'assistant', result.response)

      if (!result.shouldContinue) {
        conversationState.isActive = false
        console.log('LLM decided to end conversation.')
        break
      }

      await saveConversation(persistenceStorage, conversationState)
    }

    console.log(`\n✅ Conversation completed with ${conversationState.messages.length} messages`)
    console.log('Conversation state saved to filesystem')

    return { messageCount: conversationState.messages.length }

  } catch (error) {
    console.error('❌ Example failed:', error)
    throw error
  }
}

// Run when executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runConversationWithLLMRouting().catch((error) => {
    console.error('Failed to run conversation:', error)
    process.exit(1)
  })
}

/**
 * Expected Output:
 * ===============
 *
 * ╔═══════════════════════════════════════════════════════════╗
 * ║        Conversation with LLM Routing & Persistence        ║
 * ║                                                           ║
 * ║  Features:                                                ║
 * ║  • LLM-powered conversation routing with Flow.switchRoute ║
 * ║  • Filesystem persistence for conversation state          ║
 * ║  • Terminal interface for natural conversation            ║
 * ║  • Real OpenAI integration for intelligent responses      ║
 * ║                                                           ║
 * ║  Instructions:                                            ║
 * ║  • Chat naturally with the AI                             ║
 * ║  • Say "goodbye", "bye", or "quit" to end                 ║
 * ║  • Conversation automatically saved to disk               ║
 * ║                                                           ║
 * ║  Storage: ./conversation-state/                           ║
 * ╚═══════════════════════════════════════════════════════════╝
 *
 * ℹ️  Setting up conversation with LLM routing...
 * ℹ️  Started conversation: conv_1734567890_abc123
 * 🤖 Assistant: Hello! I'm here to help. What would you like to talk about?
 * 👤 You: Tell me about the weather
 * ℹ️  Processing with LLM routing...
 * 🤖 Assistant: I'd be happy to discuss weather! However, I don't have access to current weather data...
 * 👤 You: goodbye
 * ℹ️  Processing with LLM routing...
 * 🤖 Assistant: Thank you for our conversation! Have a wonderful day!
 * ℹ️  Conversation ended by LLM routing decision.
 * ℹ️  Conversation saved with 4 messages.
 *
 * Technical Implementation:
 * ========================
 *
 * 1. **Flow.switchRoute Usage**:
 *    - LLM analyzes user intent via structured prompt
 *    - Routes to 'continue' or 'end' branches based on analysis
 *    - Each branch generates appropriate response using responseTool
 *
 * 2. **Filesystem Persistence**:
 *    - createDefaultPersistenceHub with filesystem backend
 *    - Automatic conversation state saving after each turn
 *    - Stores in ./conversation-state/ directory
 *
 * 3. **Real LLM Integration**:
 *    - Uses createOpenAiCompletionTool for actual API calls
 *    - No mocked responses - requires valid OPENAI_API_KEY
 *    - Demonstrates proper library tool composition
 *
 * 4. **Error Handling**:
 *    - Graceful handling of LLM API failures
 *    - Conversation state preserved on errors
 *    - User can continue after errors occur
 *
 * This example demonstrates the complete integration of:
 * - DynamicFlow's Flow.switchRoute for LLM-powered routing
 * - Filesystem persistence for stateful conversations
 * - Real LLM tool integration without mocking
 * - Terminal UI for natural conversation experience
 *
 * Perfect for understanding how to build production conversation systems!
 */

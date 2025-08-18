import { Effect, Ref, Option, HashMap, Layer } from 'effect'
import { RegistrationError, ToolNotFoundError } from '../../errors'
import type { Tool } from '../../tools/types'

/**
 * Tool Registry Service - Manages tool registration and retrieval
 * Uses Effect.Service for singleton behavior
 */
export class ToolRegistryService extends Effect.Service<ToolRegistryService>()('ToolRegistryService', {
  effect: Effect.gen(function* () {
    // Internal registry state
    const tools = yield* Ref.make<HashMap.HashMap<string, Tool>>(HashMap.empty())
    
    return {
      /**
       * Register a new tool
       */
      register: (tool: Tool) => 
        Effect.gen(function* () {
          const currentTools = yield* Ref.get(tools)
          
          // Check if tool already exists
          if (HashMap.has(currentTools, tool.id)) {
            return yield* Effect.fail(new RegistrationError({
              item: tool.id,
              message: `Tool with id '${tool.id}' is already registered`
            }))
          }
          
          // Add tool to registry
          yield* Ref.update(tools, HashMap.set(tool.id, tool))
        }),
      
      /**
       * Unregister a tool
       */
      unregister: (id: string) => 
        Effect.gen(function* () {
          yield* Ref.update(tools, HashMap.remove(id))
        }),
      
      /**
       * Get a tool by ID
       */
      get: (id: string) => 
        Effect.gen(function* () {
          const currentTools = yield* Ref.get(tools)
          const tool = HashMap.get(currentTools, id)
          
          if (Option.isNone(tool)) {
            return yield* Effect.fail(new ToolNotFoundError({
              toolId: id,
              operation: 'get'
            }))
          }
          
          return tool.value
        }),
      
      /**
       * List all registered tools
       */
      list: () => 
        Effect.gen(function* () {
          const currentTools = yield* Ref.get(tools)
          return Array.from(HashMap.values(currentTools))
        }),
      
      /**
       * Clear all tools
       */
      clear: () => 
        Effect.gen(function* () {
          yield* Ref.set(tools, HashMap.empty())
        }),
      
      /**
       * Check if a tool exists
       */
      has: (id: string) =>
        Effect.gen(function* () {
          const currentTools = yield* Ref.get(tools)
          return HashMap.has(currentTools, id)
        }),
      
      /**
       * Get count of registered tools
       */
      size: () =>
        Effect.gen(function* () {
          const currentTools = yield* Ref.get(tools)
          return HashMap.size(currentTools)
        })
    }
  })
}) {}

/**
 * Test implementation
 */
export const ToolRegistryTest = Layer.succeed(
  ToolRegistryService,
  {
    register: () => Effect.void,
    unregister: () => Effect.void,
    get: (id: string) => Effect.fail(new ToolNotFoundError({ toolId: id, operation: 'get' })),
    list: () => Effect.succeed([]),
    clear: () => Effect.void,
    has: () => Effect.succeed(false),
    size: () => Effect.succeed(0),
    registerLLM: () => Effect.void,
    getLLM: (id: string) => Effect.fail(new ToolNotFoundError({ toolId: id, operation: 'getLLM' })),
    listByCategory: () => Effect.succeed([]),
    validateInput: () => Effect.void,
    validateOutput: () => Effect.void
  } as any
)
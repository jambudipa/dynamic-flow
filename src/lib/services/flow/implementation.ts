import { Effect, pipe, Duration } from 'effect'
import { DynamicFlowService } from './service'
import { CacheService } from '../cache/service'
import { ModelPoolService } from '../model-pool/service'
import { IRExecutorService } from '../executor/service'
import { JSONToIRCompiler } from '../../compiler/json-to-ir'
import { FlowError, ExecutionError, ValidationError } from '../../errors'
import type { 
  ExecutionResult, 
  ValidatedFlow,
  DynamicFlowOptions,
  AiModel
} from '../../generation/types'
import type { UntypedToolArray, ToolJoin } from '../../tools/types'
import type { IR } from '../../ir/core-types'

// Define missing types locally
export interface Flow {
  id: string
  name: string
  ir?: IR | any
  json?: any
  tools?: Map<string, any>
  joins?: Map<string, any>
  description?: string
  version?: string
  config?: {
    initialState?: Record<string, unknown>
  }
  metadata?: Record<string, unknown>
  createdAt?: Date
  updatedAt?: Date
}

export interface FlowConfig {
  name?: string
  description?: string
  prompt?: string
  tools?: UntypedToolArray
  joins?: ToolJoin<any, any>[]
  model?: AiModel
  initialState?: Record<string, unknown>
}

/**
 * Full implementation of DynamicFlowService with all dependencies
 */
export const DynamicFlowServiceImpl = Effect.gen(function* () {
  const cache = yield* CacheService
  const modelPool = yield* ModelPoolService
  const executor = yield* IRExecutorService
  
  const jsonCompiler = new JSONToIRCompiler()
  
  /**
   * Generate JSON from LLM using structured output
   */
  const generateJSONFromLLM = (
    prompt: string,
    tools: UntypedToolArray,
    joins: ReadonlyArray<ToolJoin<any, any>>,
    model: AiModel,
    options?: DynamicFlowOptions
  ) => Effect.gen(function* () {
    // Acquire model from pool
    const modelInstance = yield* modelPool.acquire(model.toString())
    
    try {
      // Build tool descriptions for LLM
      const toolDescriptions = tools.map((tool: any) => ({
        id: tool.id,
        name: tool.name,
        description: tool.description,
        inputs: tool.inputSchema ? extractSchemaShape(tool.inputSchema) : {}
      }))
      
      const joinDescriptions = joins.map((join) => ({
        from: join.fromTool,
        to: join.toTool,
        description: `Connect ${join.fromTool} to ${join.toTool}`
      }))
      
      // Generate system prompt
      const systemPrompt = `You are a flow generator. Generate a JSON flow that uses the provided tools to accomplish the user's task.
Available tools: ${JSON.stringify(toolDescriptions, null, 2)}
Available connections: ${JSON.stringify(joinDescriptions, null, 2)}

Generate a valid flow with these requirements:
1. Use only the provided tool IDs
2. Each step must have a unique ID
3. Steps should be in logical order
4. Include appropriate arguments for each tool`

      // Call LLM (placeholder - would use actual LLM service)
      const response = {
        metadata: {
          name: 'Generated Flow',
          description: prompt,
          generated: true,
          model: model.toString(),
          timestamp: new Date().toISOString()
        },
        flow: tools.slice(0, 2).map((tool: any, i: number) => ({
          id: `step-${i + 1}`,
          tool: tool.id,
          args: {}
        }))
      }
      
      return response
    } finally {
      yield* modelPool.release(modelInstance)
    }
  })
  
  const extractSchemaShape = (schema: any): any => {
    // Extract basic shape from schema
    if (typeof schema === 'object' && schema !== null) {
      if (schema.type === 'object' && schema.properties) {
        return Object.keys(schema.properties).reduce((acc, key) => {
          acc[key] = schema.properties[key].type || 'unknown'
          return acc
        }, {} as any)
      }
    }
    return {}
  }
  
  return {
    create: (config: FlowConfig) => Effect.gen(function* () {
      // Check cache first
      const cacheKey = `flow-create-${JSON.stringify(config)}`
      const cached = yield* cache.get<Flow>(cacheKey)
      
      if (cached._tag === 'Some') {
        return cached.value
      }
      
      try {
        // Generate flow from config
        const flow: Flow = {
          id: `flow-${Date.now()}`,
          name: config.name || 'Untitled Flow',
          description: config.description,
          version: '1.0.0',
          config,
          createdAt: new Date(),
          updatedAt: new Date()
        }
        
        // Cache the result
        yield* cache.set(cacheKey, flow, 3600)
        
        return flow
      } catch (error) {
        return yield* Effect.fail(new FlowError({
          message: `Failed to create flow: ${error}`,
          flowId: undefined
        }))
      }
    }),
    
    execute: (flow: Flow) => Effect.gen(function* () {
      const cacheKey = `flow-exec-${flow.id}`
      const cached = yield* cache.get<ExecutionResult>(cacheKey)
      
      if (cached._tag === 'Some') {
        return cached.value
      }
      
      try {
        // Execute the flow using IR executor
        const irNode = flow.ir || {} // Get IR from flow
        const execResult = yield* executor.execute(irNode, {
          initialState: flow.config?.initialState
        })
        
        const result: ExecutionResult = {
          output: execResult.value,
          metadata: {
            duration: Duration.millis(execResult.duration),
            toolsExecuted: []
          }
        }
        
        // Cache the result
        yield* cache.set(cacheKey, result, 300) // 5 minute cache
        
        return result
      } catch (error) {
        return yield* Effect.fail(new ExecutionError({
          message: `Flow execution failed: ${error}`,
          node: flow.id,
          phase: 'execution'
        }))
      }
    }),
    
    validate: (flow: Flow) => Effect.gen(function* () {
      try {
        // Validate flow structure
        if (!flow.id) {
          return yield* Effect.fail(new ValidationError({
            message: 'Flow missing ID',
            field: 'id'
          }))
        }
        
        // Validate IR if present
        if (flow.ir) {
          const isValid = yield* executor.validate(flow.ir)
          if (!isValid) {
            return yield* Effect.fail(new ValidationError({
              message: 'Invalid IR structure',
              field: 'ir'
            }))
          }
        }
        
        // Return validated flow
        const validated: ValidatedFlow = {
          ...flow,
          ir: flow.ir || {},
          json: flow.json || { version: '1.0', metadata: {}, nodes: [], edges: [] },
          tools: flow.tools || new Map(),
          joins: flow.joins || new Map(),
          warnings: []
        }
        
        return validated
      } catch (error) {
        return yield* Effect.fail(new ValidationError({
          message: `Validation failed: ${error}`,
          field: 'unknown'
        }))
      }
    }),
    
    generateFromPrompt: (prompt: string, config?: Partial<FlowConfig>) => 
      Effect.gen(function* () {
        const cacheKey = `flow-gen-${prompt}-${JSON.stringify(config || {})}`
        const cached = yield* cache.get<Flow>(cacheKey)
        
        if (cached._tag === 'Some') {
          return cached.value
        }
        
        // Default config
        const fullConfig: FlowConfig = {
          name: 'Generated Flow',
          description: prompt,
          ...config
        }
        
        try {
          // Generate JSON from LLM
          const tools = (config as any)?.tools || []
          const joins = (config as any)?.joins || []
          const model = (config as any)?.model || { toString: () => 'gpt-4' }
          
          const json = yield* generateJSONFromLLM(
            prompt,
            tools,
            joins,
            model,
            (config as any)?.options
          )
          
          // Compile to IR
          const ir = yield* Effect.promise(() => 
            Effect.runPromise(jsonCompiler.compile(json, tools, joins))
          )
          
          // Create flow
          const flow: Flow = {
            id: `flow-${Date.now()}`,
            name: fullConfig.name || 'Generated Flow',
            description: prompt,
            version: '1.0.0',
            config: fullConfig,
            ir,
            json,
            tools: new Map(tools.map((t: any) => [t.id, t])),
            joins: new Map(joins.map((j: any) => [`${j.fromTool}-${j.toTool}`, j])),
            createdAt: new Date(),
            updatedAt: new Date()
          }
          
          // Cache the result
          yield* cache.set(cacheKey, flow, 3600)
          
          return flow
        } catch (error) {
          return yield* Effect.fail(new FlowError({
            message: `Failed to generate flow: ${error}`,
            flowId: undefined
          }))
        }
      }),
    
    optimise: (flow: Flow) => Effect.gen(function* () {
      // Optimise the flow's IR
      if (flow.ir) {
        const optimisedIR = yield* executor.optimise(flow.ir)
        return {
          ...flow,
          ir: optimisedIR,
          updatedAt: new Date()
        }
      }
      return flow
    })
  }
})
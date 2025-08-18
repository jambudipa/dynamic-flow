import { Effect, Ref, pipe } from 'effect'
import { StateService } from '../state/service'
import { ExecutionError, ValidationError } from '../../errors'
import type { IRNode, IR, SequenceNode, ParallelNode, ConditionalNode, LoopNode, ToolNode } from '../../ir/core-types'
import { createStateManager } from '../../state/manager'
import { ToolRegistryImpl } from '../../tools/registry'
import { LoggingService } from '../logging'

export interface ExecutionContext {
  readonly nodes?: Map<string, IRNode>
  readonly initialState?: Record<string, unknown>
  readonly tools?: Array<{ id: string; execute: (input: any) => Effect.Effect<any, any> }>
}

export interface ExecutionResult {
  readonly value: unknown
  readonly state: Record<string, unknown>
  readonly logs: string[]
  readonly duration: number
}

/**
 * Full IRExecutor implementation
 */
export const IRExecutorServiceImpl = Effect.gen(function* () {
  const stateService = yield* StateService
  
  // Internal state
  const registry = new ToolRegistryImpl()
  const logsRef = yield* Ref.make<string[]>([])
  
  const addLog = (message: string) => 
    Ref.update(logsRef, logs => [...logs, `[${new Date().toISOString()}] ${message}`])
  
  /**
   * Execute a single IR node
   */
  const executeNode = (node: IRNode, context: ExecutionContext): Effect.Effect<unknown, ExecutionError, never> =>
    (Effect.gen(function* () {
      yield* addLog(`Executing node: ${node.id || 'unknown'}`)
      
      switch (node.type) {
        case 'tool': {
          // Execute tool node
          const tool = registry.get(node.tool)
          if (!tool) {
            return yield* Effect.fail(new ExecutionError({
              message: `Tool not found: ${node.tool}`,
              node: node.id,
              phase: 'validation'
            }))
          }
          
          // Get inputs from state
          const inputs = yield* resolveInputs(node.inputs || {})
          
          // Execute tool
          const result = yield* (tool as any).execute(inputs).pipe(
            Effect.mapError((error: any) => new ExecutionError({
              message: `Tool execution failed: ${error}`,
              node: node.id,
              phase: 'execution'
            }))
          )
          
          // Store result in state
          if (node.id) {
            yield* stateService.set(node.id, result)
          }
          
          return result
        }
        
        case 'sequence': {
          // Execute nodes in sequence
          const sequenceNode = node as SequenceNode
          let lastResult: unknown = undefined
          for (const childId of sequenceNode.steps || []) {
            const child = context.nodes?.get(childId)
            if (child) {
              lastResult = yield* executeNode(child, context)
            }
          }
          return lastResult
        }
        
        case 'parallel': {
          // Execute nodes in parallel
          const parallelNode = node as ParallelNode
          const allResults: unknown[][] = []
          
          for (const branch of parallelNode.branches || []) {
            const branchResults = yield* Effect.all(
              branch.map(nodeId => {
                const child = context.nodes?.get(nodeId)
                return child ? executeNode(child, context) : Effect.succeed(undefined)
              }),
              { concurrency: 'unbounded' }
            )
            allResults.push(branchResults)
          }
          
          return allResults
        }
        
        case 'conditional': {
          // Evaluate condition and execute branch
          const conditionalNode = node as ConditionalNode
          const condition = yield* resolveValue(conditionalNode.condition)
          const branchIds = condition ? conditionalNode.thenBranch : conditionalNode.elseBranch
          
          if (branchIds && branchIds.length > 0) {
            let lastResult: unknown = undefined
            for (const nodeId of branchIds) {
              const child = context.nodes?.get(nodeId)
              if (child) {
                lastResult = yield* executeNode(child, context)
              }
            }
            return lastResult
          }
          return undefined
        }
        
        case 'loop': {
          // Execute loop
          const loopNode = node as LoopNode
          const results: unknown[] = []
          
          if (loopNode.loopType === 'for' || loopNode.loopType === 'map') {
            const items = yield* resolveValue(loopNode.collection || [])
            
            if (Array.isArray(items)) {
              for (const item of items) {
                // Set loop variable
                if (loopNode.iteratorVar) {
                  yield* stateService.set(loopNode.iteratorVar, item)
                }
              
                // Execute body
                for (const bodyNodeId of loopNode.body || []) {
                  const bodyNode = context.nodes?.get(bodyNodeId)
                  if (bodyNode) {
                    const result = yield* executeNode(bodyNode, context)
                    results.push(result)
                  }
                }
              }
            }
          }
          
          return results
        }
        
        default:
          return yield* Effect.fail(new ExecutionError({
            message: `Unknown node type: ${(node as any).type}`,
            node: (node as any).id,
            phase: 'execution'
          }))
      }
    }) as Effect.Effect<unknown, ExecutionError, never>)
  
  /**
   * Resolve inputs from state or literals
   */
  const resolveInputs = (inputs: Record<string, any>): Effect.Effect<Record<string, any>, ExecutionError, never> =>
    Effect.gen(function* () {
      const resolved: Record<string, any> = {}
      
      for (const [key, value] of Object.entries(inputs)) {
        resolved[key] = yield* resolveValue(value)
      }
      
      return resolved
    })
  
  /**
   * Resolve a single value (could be reference or literal)
   */
  const resolveValue = (value: any): Effect.Effect<any, ExecutionError, never> =>
    Effect.gen(function* () {
      if (typeof value === 'string' && value.startsWith('$')) {
        // State reference
        const key = value.slice(1)
        const stateValue = yield* stateService.get(key).pipe(
          Effect.mapError(() => new ExecutionError({
            message: `Failed to get state value: ${key}`,
            phase: 'execution'
          }))
        )
        
        if ((stateValue as any)._tag === 'None') {
          return undefined
        }
        
        return (stateValue as any).value
      }
      
      return value
    })
  
  return {
    execute: (ir: IRNode | IR, context?: ExecutionContext) => 
      Effect.gen(function* () {
        const startTime = Date.now()
        
        // Clear logs
        yield* Ref.set(logsRef, [])
        
        // Initialize execution state
        yield* stateService.initialise(context?.initialState || {})
        
        // Register tools if provided
        if (context?.tools) {
          for (const tool of context.tools) {
            registry.register(tool as any)
            yield* addLog(`Registered tool: ${tool.id}`)
          }
        }
        
        // Handle both IR and IRNode formats
        let rootNode: IRNode
        if ('graph' in (ir as any)) {
          const irObj = ir as IR
          const entryNode = irObj.graph.nodes.get(irObj.graph.entryPoint)
          if (!entryNode) {
            return yield* Effect.fail(new ExecutionError({
              message: `Entry point node not found: ${irObj.graph.entryPoint}`,
              phase: 'validation'
            }))
          }
          rootNode = entryNode
          
          // Update context with all nodes
          if (!context) {
            context = { nodes: irObj.graph.nodes }
          } else {
            (context as any).nodes = irObj.graph.nodes
          }
        } else {
          rootNode = ir as IRNode
        }
        
        // Execute the IR
        const value = yield* pipe(
          executeNode(rootNode, context || {}),
          Effect.catchAll((error) => {
            return Effect.gen(function* () {
              yield* addLog(`Execution failed: ${error.message}`)
              return yield* Effect.fail(error)
            })
          })
        )
        
        // Get final state and logs
        const finalState = yield* stateService.getAll()
        const logs = yield* Ref.get(logsRef)
        
        return {
          value,
          state: finalState,
          logs,
          duration: Date.now() - startTime
        }
      }),
    
    validate: (ir: IRNode | IR) => 
      Effect.gen(function* () {
        try {
          // Basic validation
          let node: IRNode
          if ('graph' in (ir as any)) {
            const irObj = ir as IR
            const entryNode = irObj.graph.nodes.get(irObj.graph.entryPoint)
            if (!entryNode) {
              yield* addLog(`Validation failed: entry point not found: ${irObj.graph.entryPoint}`)
              return false
            }
            node = entryNode
          } else {
            node = ir as IRNode
          }
          
          if (!node.type) {
            yield* addLog('Validation failed: missing node type')
            return false
          }
          
          // Validate based on node type
          switch (node.type) {
            case 'tool':
              if (!node.tool) {
                yield* addLog('Validation failed: tool node missing tool')
                return false
              }
              break
              
            case 'sequence': {
              const seqNode = node as SequenceNode
              if (!seqNode.steps || !Array.isArray(seqNode.steps)) {
                yield* addLog(`Validation failed: sequence node missing steps array`)
                return false
              }
              break
            }
              
            case 'parallel': {
              const parNode = node as ParallelNode
              if (!parNode.branches || !Array.isArray(parNode.branches)) {
                yield* addLog(`Validation failed: parallel node missing branches array`)
                return false
              }
              break
            }
              
            case 'conditional': {
              const condNode = node as ConditionalNode
              if (!condNode.condition) {
                yield* addLog('Validation failed: conditional node missing condition')
                return false
              }
              if (!condNode.thenBranch || !Array.isArray(condNode.thenBranch)) {
                yield* addLog('Validation failed: conditional node missing thenBranch')
                return false
              }
              break
            }
              
            case 'loop': {
              const loopNode = node as LoopNode
              if (!loopNode.body || !Array.isArray(loopNode.body)) {
                yield* addLog('Validation failed: loop node missing body')
                return false
              }
              if ((loopNode.loopType === 'for' || loopNode.loopType === 'map') && !loopNode.collection) {
                yield* addLog('Validation failed: for/map loop missing collection')
                return false
              }
              if (loopNode.loopType === 'while' && !loopNode.condition) {
                yield* addLog('Validation failed: while loop missing condition')
                return false
              }
              break
            }
          }
          
          yield* addLog('Validation successful')
          return true
        } catch (error) {
          yield* addLog(`Validation error: ${error}`)
          return false
        }
      }),
    
    optimise: (ir: IRNode | IR) => 
      Effect.gen(function* () {
        // Simple optimisation passes
        let node: IRNode
        if ('graph' in (ir as any)) {
          const irObj = ir as IR
          const entryNode = irObj.graph.nodes.get(irObj.graph.entryPoint)
          if (!entryNode) {
            return ir // Can't optimize without entry node
          }
          node = entryNode
        } else {
          node = ir as IRNode
        }
        
        // Remove empty sequences
        if (node.type === 'sequence') {
          const seqNode = node as SequenceNode
          if (!seqNode.steps || seqNode.steps.length === 0) {
            // Return an empty sequence node
            return { type: 'sequence', id: node.id, steps: [] } as SequenceNode
          }
          // Flatten single-step sequences - would need to return the child node
          // This is more complex as we'd need to fetch it from the graph
        }
        
        // More optimisations could be added here
        
        return node
      }),
    
    compile: (source: unknown) => 
      Effect.gen(function* () {
        // Simple compilation from JSON to IR
        try {
          const json = typeof source === 'string' ? JSON.parse(source) : source
          
          // Basic IR structure
          const ir: SequenceNode = {
            type: 'sequence',
            id: 'root',
            steps: []
          }
          
          // Convert source to IR nodes
          if (Array.isArray(json)) {
            ir.steps = json.map((item, index) => `step-${index}`)
          }
          
          return ir
        } catch (error) {
          return yield* Effect.fail(new ValidationError({
            message: `Compilation failed: ${error}`,
            field: 'source'
          }))
        }
      })
  }
})
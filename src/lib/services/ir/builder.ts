import { Effect, Ref, HashMap } from 'effect'
import { CompilationError, ValidationError } from '../../errors'
import type { 
  IRNode, 
  IRGraph, 
  IRMetadata,
  ToolNode,
  ParallelNode,
  SequenceNode,
  ConditionalNode,
  LoopNode
} from '../../ir/core-types'

/**
 * IR Node configuration
 */
export interface IRNodeConfig {
  id: string
  type: string
  label?: string
  inputs?: string[]
  outputs?: string[]
  config?: any
  metadata?: IRMetadata
}

/**
 * IR Edge configuration
 */
export interface IREdgeConfig {
  from: string
  to: string
  condition?: any
  metadata?: Record<string, any>
}

/**
 * IR Builder options
 */
export interface IRBuilderOptions {
  validateOnBuild?: boolean
  optimizeGraph?: boolean
  detectCycles?: boolean
}

/**
 * IR Builder Service
 * Constructs Intermediate Representation graphs
 */
export class IRBuilderService extends Effect.Service<IRBuilderService>()('IRBuilderService', {
  effect: Effect.gen(function* () {
    const service = {
      /**
       * Create a new IR graph
       */
      createGraph: (id: string, metadata?: IRMetadata) =>
        Effect.succeed({
          nodes: new Map(),
          edges: [],
          entryPoint: '' // Will be set when first node is added
        } as IRGraph),
      
      /**
       * Create an IR node
       */
      createNode: (config: IRNodeConfig) =>
        Effect.gen(function* () {
          if (!config.id || !config.type) {
            return yield* Effect.fail(new CompilationError({
              message: 'Node must have ID and type',
              source: 'ir-node',
              cause: { config }
            }))
          }
          
          // Create node based on type
          let node: IRNode;
          switch (config.type) {
            case 'tool':
              node = {
                id: config.id,
                type: 'tool',
                tool: config.config?.tool || config.id,
                inputs: config.config?.inputs || {},
                outputVar: config.config?.outputVar
              } as ToolNode;
              break;
            case 'parallel':
              node = {
                id: config.id,
                type: 'parallel',
                branches: config.config?.branches || []
              } as ParallelNode;
              break;
            case 'sequence':
              node = {
                id: config.id,
                type: 'sequence',
                steps: config.config?.steps || []
              } as SequenceNode;
              break;
            case 'conditional':
              node = {
                id: config.id,
                type: 'conditional',
                condition: config.config?.condition || { type: 'literal', value: true },
                thenBranch: config.config?.thenBranch,
                elseBranch: config.config?.elseBranch
              } as ConditionalNode;
              break;
            case 'loop':
              node = {
                id: config.id,
                type: 'loop',
                loopType: config.config?.loopType || 'for',
                collection: config.config?.collection,
                iteratorVar: config.config?.iteratorVar || 'item',
                body: config.config?.body || [],
                outputVar: config.config?.outputVar
              } as LoopNode;
              break;
            default:
              return yield* Effect.fail(new CompilationError({
                message: `Unknown node type: ${config.type}`,
                source: 'ir-node',
                cause: { config }
              }));
          }
          
          return node
        }),
      
      /**
       * Add node to graph
       */
      addNode: (graph: IRGraph, node: IRNode) =>
        Effect.gen(function* () {
          if (graph.nodes.has(node.id)) {
            return yield* Effect.fail(new CompilationError({
              message: `Node with ID ${node.id} already exists`,
              source: 'ir-graph',
              cause: { nodeId: node.id }
            }))
          }
          
          graph.nodes.set(node.id, node)
          
          // Set entry point if this is the first node
          if (!graph.entryPoint) {
            graph.entryPoint = node.id
          }
          
          return graph
        }),
      
      /**
       * Add edge to graph
       */
      addEdge: (graph: IRGraph, edge: IREdgeConfig) =>
        Effect.gen(function* () {
          // Validate nodes exist
          if (!graph.nodes.has(edge.from)) {
            return yield* Effect.fail(new CompilationError({
              message: `Source node ${edge.from} does not exist`,
              source: 'ir-edge',
              cause: { edge }
            }))
          }
          
          if (!graph.nodes.has(edge.to)) {
            return yield* Effect.fail(new CompilationError({
              message: `Target node ${edge.to} does not exist`,
              source: 'ir-edge',
              cause: { edge }
            }))
          }
          
          graph.edges.push({
            from: edge.from,
            to: edge.to,
            condition: edge.condition,
            label: edge.metadata?.label
          })
          
          return graph
        }),
      
      /**
       * Build a complete IR graph
       */
      buildGraph: (nodes: IRNodeConfig[], edges: IREdgeConfig[], options?: IRBuilderOptions) =>
        Effect.gen(function* () {
          const graph = yield* service.createGraph(`graph-${Date.now()}`)
          
          // Add all nodes
          for (const nodeConfig of nodes) {
            const node = yield* service.createNode(nodeConfig)
            yield* service.addNode(graph, node)
          }
          
          // Add all edges
          for (const edge of edges) {
            yield* service.addEdge(graph, edge)
          }
          
          // Validate if requested
          if (options?.validateOnBuild) {
            yield* service.validateGraph(graph)
          }
          
          // Optimize if requested
          if (options?.optimizeGraph) {
            yield* service.optimizeGraph(graph)
          }
          
          // Detect cycles if requested
          if (options?.detectCycles) {
            const cycles = yield* service.detectCycles(graph)
            if (cycles.length > 0) {
              return yield* Effect.fail(new CompilationError({
                message: 'Graph contains cycles',
                source: 'ir-graph',
                cause: { cycles }
              }))
            }
          }
          
          return graph
        }),
      
      /**
       * Clone a graph
       */
      cloneGraph: (graph: IRGraph) =>
        Effect.succeed({
          nodes: new Map(graph.nodes),
          edges: [...graph.edges],
          entryPoint: graph.entryPoint
        } as IRGraph),
      
      /**
       * Merge two graphs
       */
      mergeGraphs: (graph1: IRGraph, graph2: IRGraph) =>
        Effect.gen(function* () {
          const merged = yield* service.createGraph(`merged-${Date.now()}`)
          
          // Merge nodes
          for (const [id, node] of graph1.nodes) {
            merged.nodes.set(id, node)
          }
          
          for (const [id, node] of graph2.nodes) {
            if (merged.nodes.has(id)) {
              // Handle conflict - prefix with graph2
              merged.nodes.set(`g2_${id}`, { ...node, id: `g2_${id}` })
            } else {
              merged.nodes.set(id, node)
            }
          }
          
          // Merge edges
          merged.edges = [...graph1.edges, ...graph2.edges]
          
          return merged
        }),
      
      /**
       * Validate graph structure
       */
      validateGraph: (graph: IRGraph) =>
        Effect.gen(function* () {
          const errors: ValidationError[] = []
          
          // Check for empty graph
          if (graph.nodes.size === 0) {
            errors.push(new ValidationError({
              field: 'nodes',
              message: 'Graph has no nodes'
            }))
          }
          
          // Check for orphaned nodes
          const connectedNodes = new Set<string>()
          for (const edge of graph.edges) {
            connectedNodes.add(edge.from)
            connectedNodes.add(edge.to)
          }
          
          for (const nodeId of graph.nodes.keys()) {
            if (!connectedNodes.has(nodeId) && graph.nodes.size > 1) {
              errors.push(new ValidationError({
                field: `node.${nodeId}`,
                message: `Node ${nodeId} is not connected`
              }))
            }
          }
          
          if (errors.length > 0) {
            return yield* Effect.fail(new CompilationError({
              message: 'Graph validation failed',
              source: 'ir-validation',
              cause: { errors }
            }))
          }
          
          return true
        }),
      
      /**
       * Optimize graph structure
       */
      optimizeGraph: (graph: IRGraph) =>
        Effect.gen(function* () {
          // Remove redundant edges
          const uniqueEdges = new Map<string, typeof graph.edges[0]>()
          
          for (const edge of graph.edges) {
            const key = `${edge.from}-${edge.to}`
            if (!uniqueEdges.has(key)) {
              uniqueEdges.set(key, edge)
            }
          }
          
          graph.edges = Array.from(uniqueEdges.values())
          
          // Remove unreachable nodes
          const reachable = new Set<string>()
          const queue = ['start'] // Assuming start node
          
          while (queue.length > 0) {
            const current = queue.shift()!
            if (reachable.has(current)) continue
            reachable.add(current)
            
            for (const edge of graph.edges) {
              if (edge.from === current) {
                queue.push(edge.to)
              }
            }
          }
          
          // Keep only reachable nodes
          for (const nodeId of graph.nodes.keys()) {
            if (!reachable.has(nodeId) && nodeId !== 'start') {
              graph.nodes.delete(nodeId)
            }
          }
          
          return graph
        }),
      
      /**
       * Detect cycles in graph
       */
      detectCycles: (graph: IRGraph) =>
        Effect.gen(function* () {
          const cycles: string[][] = []
          const visited = new Set<string>()
          const recursionStack = new Set<string>()
          
          const dfs = (nodeId: string, path: string[]): void => {
            visited.add(nodeId)
            recursionStack.add(nodeId)
            path.push(nodeId)
            
            for (const edge of graph.edges) {
              if (edge.from === nodeId) {
                if (!visited.has(edge.to)) {
                  dfs(edge.to, [...path])
                } else if (recursionStack.has(edge.to)) {
                  // Found a cycle
                  const cycleStart = path.indexOf(edge.to)
                  cycles.push(path.slice(cycleStart))
                }
              }
            }
            
            recursionStack.delete(nodeId)
          }
          
          for (const nodeId of graph.nodes.keys()) {
            if (!visited.has(nodeId)) {
              dfs(nodeId, [])
            }
          }
          
          return cycles
        }),
      
      /**
       * Topological sort of graph nodes
       */
      topologicalSort: (graph: IRGraph) =>
        Effect.gen(function* () {
          const inDegree = new Map<string, number>()
          const sorted: string[] = []
          
          // Initialize in-degree
          for (const nodeId of graph.nodes.keys()) {
            inDegree.set(nodeId, 0)
          }
          
          // Calculate in-degrees
          for (const edge of graph.edges) {
            inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1)
          }
          
          // Find nodes with no incoming edges
          const queue: string[] = []
          for (const [nodeId, degree] of inDegree) {
            if (degree === 0) {
              queue.push(nodeId)
            }
          }
          
          // Process nodes
          while (queue.length > 0) {
            const current = queue.shift()!
            sorted.push(current)
            
            for (const edge of graph.edges) {
              if (edge.from === current) {
                const newDegree = (inDegree.get(edge.to) || 0) - 1
                inDegree.set(edge.to, newDegree)
                
                if (newDegree === 0) {
                  queue.push(edge.to)
                }
              }
            }
          }
          
          if (sorted.length !== graph.nodes.size) {
            return yield* Effect.fail(new CompilationError({
              message: 'Graph contains cycles, cannot perform topological sort',
              source: 'topological-sort',
              cause: { sorted, totalNodes: graph.nodes.size }
            }))
          }
          
          return sorted
        })
    }
    
    return service
  })
}) {}
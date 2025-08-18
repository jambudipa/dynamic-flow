import { Effect, Schema, HashMap, Option } from 'effect'
import { ValidationError } from '../../errors'
import type { Flow } from './flow-types'
import type { IRNode } from '../../ir/core-types'

/**
 * Validation result for flows
 */
export interface ValidationResult {
  valid: boolean
  errors: ValidationError[]
  warnings: string[]
}

/**
 * Validated flow with metadata
 */
export interface ValidatedFlow {
  flow: Flow
  validationResult: ValidationResult
  validatedAt: Date
  metadata?: Record<string, any>
}

/**
 * Connectivity validation result
 */
export interface ConnectivityResult {
  connected: boolean
  unreachableNodes: string[]
  cycles: string[][]
  deadEnds: string[]
}

/**
 * Validation report with detailed information
 */
export interface ValidationReport {
  flow: Flow
  structuralValidation: ValidationResult
  connectivityValidation: ConnectivityResult
  schemaValidation: ValidationResult
  operatorValidation: ValidationResult
  overallValid: boolean
}

/**
 * Validation Service
 * Consolidates flow validation, connectivity checking, and schema validation
 */
export class ValidationService extends Effect.Service<ValidationService>()('ValidationService', {
  effect: Effect.gen(function* (_) {
    const service: any = {
      /**
       * Validate a flow completely
       */
      validateFlow: (flow: Flow) =>
        Effect.gen(function* () {
          const errors: ValidationError[] = []
          const warnings: string[] = []
          
          // Validate flow structure
          if (!flow.id || !flow.name) {
            errors.push(new ValidationError({
              field: !flow.id ? 'id' : 'name',
              message: 'Flow must have an ID and name'
            }))
          }
          
          // Validate nodes exist
          if (!flow.nodes || flow.nodes.length === 0) {
            errors.push(new ValidationError({
              field: 'nodes',
              message: 'Flow must have at least one node'
            }))
          }
          
          // Validate each node
          const nodeIds = new Set<string>()
          for (const node of flow.nodes || []) {
            if (!node.id) {
              errors.push(new ValidationError({
                field: `node`,
                message: 'Node must have an ID'
              }))
            } else if (nodeIds.has(node.id)) {
              errors.push(new ValidationError({
                field: `node.${node.id}`,
                message: `Duplicate node ID: ${node.id}`
              }))
            } else {
              nodeIds.add(node.id)
            }
            
            if (!node.type) {
              errors.push(new ValidationError({
                field: `node.${node.id}.type`,
                message: 'Node must have a type'
              }))
            }
          }
          
          // Validate edges reference existing nodes
          for (const edge of flow.edges || []) {
            if (!nodeIds.has(edge.from)) {
              errors.push(new ValidationError({
                field: `edge.from`,
                message: `Edge references non-existent node: ${edge.from}`
              }))
            }
            if (!nodeIds.has(edge.to)) {
              errors.push(new ValidationError({
                field: `edge.to`,
                message: `Edge references non-existent node: ${edge.to}`
              }))
            }
          }
          
          // Check for start and end nodes
          const hasStart = flow.nodes?.some(n => n.type === 'start')
          const hasEnd = flow.nodes?.some(n => n.type === 'end')
          
          if (!hasStart) {
            warnings.push('Flow has no explicit start node')
          }
          if (!hasEnd) {
            warnings.push('Flow has no explicit end node')
          }
          
          const validationResult: ValidationResult = {
            valid: errors.length === 0,
            errors,
            warnings
          }
          
          if (!validationResult.valid) {
            return yield* Effect.fail(new ValidationError({
              field: 'flow',
              value: flow.id,
              message: `Flow validation failed: ${errors.map(e => e.message).join(', ')}`
            }))
          }
          
          return {
            flow,
            validationResult,
            validatedAt: new Date()
          } as ValidatedFlow
        }),
      
      /**
       * Validate flow connectivity
       */
      validateConnectivity: (flow: Flow) =>
        Effect.gen(function* () {
          const nodeIds = new Set(flow.nodes?.map(n => n.id) || [])
          const edges = flow.edges || []
          
          // Build adjacency list
          const adjacency = new Map<string, Set<string>>()
          const reverseAdjacency = new Map<string, Set<string>>()
          
          for (const node of flow.nodes || []) {
            adjacency.set(node.id, new Set())
            reverseAdjacency.set(node.id, new Set())
          }
          
          for (const edge of edges) {
            adjacency.get(edge.from)?.add(edge.to)
            reverseAdjacency.get(edge.to)?.add(edge.from)
          }
          
          // Find unreachable nodes (not reachable from start)
          const startNode = flow.nodes?.find(n => n.type === 'start')?.id || flow.nodes?.[0]?.id
          const visited = new Set<string>()
          const queue = startNode ? [startNode] : []
          
          while (queue.length > 0) {
            const current = queue.shift()!
            if (visited.has(current)) continue
            visited.add(current)
            
            const neighbors = adjacency.get(current) || new Set()
            for (const neighbor of neighbors) {
              queue.push(neighbor)
            }
          }
          
          const unreachableNodes = Array.from(nodeIds).filter(id => !visited.has(id))
          
          // Find cycles using DFS
          const cycles: string[][] = []
          const detectCycles = (node: string, path: string[], visiting: Set<string>) => {
            if (visiting.has(node)) {
              // Found a cycle
              const cycleStart = path.indexOf(node)
              if (cycleStart !== -1) {
                cycles.push(path.slice(cycleStart))
              }
              return
            }
            
            visiting.add(node)
            path.push(node)
            
            const neighbors = adjacency.get(node) || new Set()
            for (const neighbor of neighbors) {
              detectCycles(neighbor, [...path], new Set(visiting))
            }
          }
          
          for (const node of nodeIds) {
            detectCycles(node, [], new Set())
          }
          
          // Find dead ends (nodes with no outgoing edges except end nodes)
          const deadEnds = Array.from(nodeIds).filter(id => {
            const node = flow.nodes?.find(n => n.id === id)
            const hasOutgoing = (adjacency.get(id)?.size || 0) > 0
            return node?.type !== 'end' && !hasOutgoing
          })
          
          return {
            connected: unreachableNodes.length === 0,
            unreachableNodes,
            cycles,
            deadEnds
          } as ConnectivityResult
        }),
      
      /**
       * Validate data against a schema
       */
      validateSchema: (data: unknown, schema: Schema.Schema<any>) =>
        Effect.gen(function* () {
          const result = yield* Schema.decodeUnknown(schema)(data).pipe(
            Effect.mapError(error => [new ValidationError({
              field: 'data',
              message: `Schema validation failed: ${error}`
            })]),
            Effect.map(() => ({
              valid: true,
              errors: [],
              warnings: []
            } as ValidationResult)),
            Effect.catchAll(errors => Effect.succeed({
              valid: false,
              errors,
              warnings: []
            } as ValidationResult))
          )
          
          return result.valid
        }),
      
      /**
       * Validate operator configuration
       */
      validateOperator: (operator: { type: string; config: any }) =>
        Effect.gen(function* () {
          // Basic operator validation
          const errors: ValidationError[] = []
          
          if (!operator.type) {
            errors.push(new ValidationError({
              field: 'type',
              message: 'Operator must have a type'
            }))
          }
          
          if (!operator.config) {
            errors.push(new ValidationError({
              field: 'config',
              message: 'Operator must have configuration'
            }))
          }
          
          // Type-specific validation would go here
          switch (operator.type) {
            case 'map':
              if (!operator.config.with) {
                errors.push(new ValidationError({
                  field: 'config.with',
                  message: 'Map operator requires "with" field'
                }))
              }
              break
            case 'filter':
              if (!operator.config.with) {
                errors.push(new ValidationError({
                  field: 'config.with',
                  message: 'Filter operator requires "with" field'
                }))
              }
              break
            case 'reduce':
              if (operator.config.initial === undefined) {
                errors.push(new ValidationError({
                  field: 'config.initial',
                  message: 'Reduce operator requires "initial" value'
                }))
              }
              break
          }
          
          return errors.length === 0
        }),
      
      /**
       * Get comprehensive validation report
       */
      getValidationReport: (flow: Flow) =>
        Effect.gen(function* () {
          // Run all validations
          const structuralValidation = yield* service.validateFlow(flow).pipe(
            Effect.map((vf: any) => vf.validationResult),
            Effect.catchAll(() => Effect.succeed({
              valid: false,
              errors: [new ValidationError({ field: 'flow', message: 'Structural validation failed' })],
              warnings: []
            }))
          )
          
          const connectivityValidation = yield* service.validateConnectivity(flow)
          
          // Validate all operators
          const operatorErrors: ValidationError[] = []
          for (const node of flow.nodes || []) {
            if (node.config) {
              const valid = yield* service.validateOperator({ type: node.type, config: node.config })
              if (!valid) {
                operatorErrors.push(new ValidationError({
                  field: `node.${node.id}`,
                  message: `Invalid operator configuration`
                }))
              }
            }
          }
          
          const operatorValidation: ValidationResult = {
            valid: operatorErrors.length === 0,
            errors: operatorErrors,
            warnings: []
          }
          
          // Schema validation (if flow has schemas)
          const schemaValidation: ValidationResult = {
            valid: true,
            errors: [],
            warnings: []
          }
          
          const overallValid = 
            structuralValidation.valid &&
            connectivityValidation.connected &&
            operatorValidation.valid &&
            schemaValidation.valid
          
          return {
            flow,
            structuralValidation,
            connectivityValidation,
            schemaValidation,
            operatorValidation,
            overallValid
          } as ValidationReport
        }),
      
      /**
       * Create a validated flow instance
       */
      createValidatedInstance: (flow: Flow) =>
        Effect.gen(function* () {
          const validated = yield* service.validateFlow(flow)
          
          // Store in cache or registry
          return {
            id: `validated-${flow.id}-${Date.now()}`,
            flow: validated.flow,
            validationResult: validated.validationResult,
            validatedAt: validated.validatedAt,
            metadata: {
              version: flow.version || '1.0.0',
              checksum: JSON.stringify(flow).length // Simple checksum
            }
          }
        })
    }
    
    return service
  })
}) {}
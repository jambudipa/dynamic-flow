import { Effect, Context, Schema } from 'effect'
import { OperatorError, ValidationError } from '../../errors'
import { ExecutionContextService } from '../execution/context'
import type { ExecutionContext } from '../execution/context-fix'

/**
 * Conditional configuration schema
 */
export interface ConditionalConfig {
  id: string
  if: any
  then: any
  else?: any
  output?: string
  timeout?: number
  retry?: number
  description?: string
}

/**
 * Conditional result type
 */
export interface ConditionalResult {
  value: any
  metadata?: {
    branch: 'then' | 'else'
    conditionValue: boolean
    executionTime: number
  }
}

/**
 * Conditional Operator Service Interface
 * Uses Context.Tag for different conditional strategies
 */
export interface ConditionalOperatorService {
  readonly execute: (
    config: ConditionalConfig,
    input: any,
    context: ExecutionContext
  ) => Effect.Effect<ConditionalResult, OperatorError, never>
  
  readonly validate: (
    config: ConditionalConfig
  ) => Effect.Effect<boolean, ValidationError, never>
  
  readonly getName: () => string
  readonly getDescription: () => string
}

/**
 * Conditional Operator Service Tag
 */
export const ConditionalOperatorService = Context.GenericTag<ConditionalOperatorService>('ConditionalOperatorService')

/**
 * Default Conditional Implementation
 */
export const DefaultConditionalOperatorService = Effect.gen(function* () {
  const executionContext = yield* ExecutionContextService
  
  return {
    execute: (config: ConditionalConfig, input: any, context: ExecutionContext): Effect.Effect<ConditionalResult, OperatorError, never> =>
      Effect.gen(function* () {
        const startTime = Date.now()
        
        // Evaluate condition
        const conditionValue = yield* Effect.try({
          try: () => {
            // If it's a function, call it
            if (typeof config.if === 'function') {
              return config.if(input)
            }
            
            // If it's a variable reference, get from context
            if (typeof config.if === 'string' && config.if.startsWith('$')) {
              return context.getVariable(config.if.slice(1))
            }
            
            // Otherwise, use as-is
            return config.if
          },
          catch: (error) => new OperatorError({
            operator: 'conditional',
            message: 'Failed to evaluate condition',
            cause: { error, condition: config.if }
          })
        }).pipe(
          Effect.map(Boolean)
        )
        
        // Execute appropriate branch
        let result: any
        let branch: 'then' | 'else'
        
        if (conditionValue) {
          branch = 'then'
          result = yield* Effect.try({
            try: () => {
              if (typeof config.then === 'function') {
                return config.then(input)
              }
              return config.then
            },
            catch: (error) => new OperatorError({
              operator: 'conditional',
              message: 'Failed to execute then branch',
              cause: error
            })
          })
        } else if (config.else !== undefined) {
          branch = 'else'
          result = yield* Effect.try({
            try: () => {
              if (typeof config.else === 'function') {
                return config.else(input)
              }
              return config.else
            },
            catch: (error) => new OperatorError({
              operator: 'conditional',
              message: 'Failed to execute else branch',
              cause: { error, else: config.else }
            })
          })
        } else {
          // No else branch, return undefined
          branch = 'else'
          result = undefined
        }
        
        // Store output if specified
        if (config.output) {
          yield* context.setVariable(config.output, result)
        }
        
        return {
          value: result,
          metadata: {
            branch,
            conditionValue,
            executionTime: Date.now() - startTime
          }
        }
      }).pipe(
        Effect.mapError((error: any) => {
          if (error instanceof OperatorError) {
            return error
          }
          return new OperatorError({
            operator: 'conditional',
            message: 'Conditional execution failed',
            operation: 'execute',
            cause: error
          })
        })
      ) as Effect.Effect<ConditionalResult, OperatorError, never>,
    
    validate: (config: ConditionalConfig) =>
      Effect.gen(function* () {
        // Validate required fields
        if (!config.id) {
          return yield* Effect.fail(new ValidationError({
            field: 'id',
            message: 'Conditional ID is required'
          }))
        }
        
        if (config.if === undefined) {
          return yield* Effect.fail(new ValidationError({
            field: 'if',
            message: 'Condition (if) is required'
          }))
        }
        
        if (config.then === undefined) {
          return yield* Effect.fail(new ValidationError({
            field: 'then',
            message: 'Then branch is required'
          }))
        }
        
        return true
      }),
    
    getName: () => 'conditional',
    getDescription: () => 'Executes different branches based on a condition'
  }
})

/**
 * Nested Conditional Implementation
 * Supports nested if-else-if chains
 */
export const NestedConditionalOperatorService = Effect.gen(function* () {
  const executionContext = yield* ExecutionContextService
  
  const service = {
    execute: (config: ConditionalConfig, input: any, context: ExecutionContext): Effect.Effect<any, OperatorError, never> =>
      Effect.gen(function* () {
        // Enhanced to support else-if chains
        // config.else could be another conditional config
        
        const startTime = Date.now()
        
        // Evaluate main condition
        const conditionValue = yield* Effect.try(() => {
          if (typeof config.if === 'function') {
            return config.if(input)
          }
          if (typeof config.if === 'string' && config.if.startsWith('$')) {
            return context.getVariable(config.if.slice(1))
          }
          return config.if
        }).pipe(
          Effect.flatten,
          Effect.map(Boolean),
          Effect.mapError(error => new OperatorError({
            operator: 'conditional',
            message: 'Failed to evaluate condition',
            cause: error
          }))
        )
        
        if (conditionValue) {
          const result = yield* Effect.try(() => {
            if (typeof config.then === 'function') {
              return config.then(input)
            }
            return config.then
          })
          
          if (config.output) {
            yield* context.setVariable(config.output, result)
          }
          
          return {
            value: result,
            metadata: {
              branch: 'then' as const,
              conditionValue: true,
              executionTime: Date.now() - startTime
            }
          }
        }
        
        // Check if else is another conditional (else-if)
        if (config.else && typeof config.else === 'object' && 'if' in config.else) {
          // Recursively evaluate nested conditional
          return yield* service.execute(config.else as ConditionalConfig, input, context)
        }
        
        // Regular else branch
        const result = config.else !== undefined ? config.else : undefined
        
        if (config.output) {
          yield* context.setVariable(config.output, result)
        }
        
        return {
          value: result,
          metadata: {
            branch: 'else' as const,
            conditionValue: false,
            executionTime: Date.now() - startTime
          }
        }
      }) as Effect.Effect<any, OperatorError, never>,
    
    validate: (config: ConditionalConfig) =>
      DefaultConditionalOperatorService.pipe(
        Effect.flatMap(service => service.validate(config))
      ),
    
    getName: () => 'nested-conditional',
    getDescription: () => 'Supports nested if-else-if chains'
  }
  
  return service
})

/**
 * Ternary Conditional Implementation
 * Optimized for simple ternary operations
 */
export const TernaryConditionalOperatorService = Effect.gen(function* () {
  const executionContext = yield* ExecutionContextService
  
  return {
    execute: (config: ConditionalConfig, input: any, context: ExecutionContext) =>
      Effect.gen(function* () {
        const startTime = Date.now()
        
        // Quick evaluation for ternary-style conditionals
        const condition = yield* Effect.try(() => Boolean(config.if))
        const result = condition ? config.then : (config.else ?? undefined)
        
        if (config.output) {
          yield* context.setVariable(config.output, result)
        }
        
        return {
          value: result,
          metadata: {
            branch: condition ? 'then' : 'else',
            conditionValue: condition,
            executionTime: Date.now() - startTime
          }
        }
      }),
    
    validate: (config: ConditionalConfig) =>
      Effect.gen(function* () {
        // Validate as ternary requires both then and else
        const baseValid = yield* DefaultConditionalOperatorService.pipe(
          Effect.flatMap(service => service.validate(config))
        )
        
        if (!baseValid) return false
        
        // Ternary should have else branch
        if (config.else === undefined) {
          return yield* Effect.fail(new ValidationError({
            field: 'else',
            message: 'Ternary conditional requires else branch'
          }))
        }
        
        return true
      }),
    
    getName: () => 'ternary-conditional',
    getDescription: () => 'Optimized ternary conditional operator'
  }
})

/**
 * Guard Conditional Implementation
 * Early return pattern for validation/guards
 */
export const GuardConditionalOperatorService = Effect.gen(function* () {
  const executionContext = yield* ExecutionContextService
  
  return {
    execute: (config: ConditionalConfig, input: any, context: ExecutionContext) =>
      Effect.gen(function* () {
        // Guard pattern: if condition fails, return early (else branch)
        // if condition passes, continue with then branch
        return yield* DefaultConditionalOperatorService.pipe(
          Effect.flatMap(service => service.execute(config, input, context))
        )
      }),
    
    validate: (config: ConditionalConfig) =>
      DefaultConditionalOperatorService.pipe(
        Effect.flatMap(service => service.validate(config))
      ),
    
    getName: () => 'guard-conditional',
    getDescription: () => 'Guard pattern for early returns and validation'
  }
})
import { Effect, Context, Schema } from 'effect'
import { OperatorError, ValidationError } from '../../errors'
import { ExecutionContextService } from '../execution/context'
import type { ExecutionContext } from '../execution/context-fix'

/**
 * Switch case configuration
 */
export interface SwitchCase {
  condition: any
  then: any
}

/**
 * Switch configuration schema
 */
export interface SwitchConfig {
  id: string
  switch: string
  cases: SwitchCase[]
  default?: any
  output?: string
  timeout?: number
  retry?: number
  description?: string
}

/**
 * Switch result type
 */
export interface SwitchResult {
  value: any
  metadata?: {
    selectedCase: number | 'default' | 'none'
    evaluationTime: number
  }
}

/**
 * Switch Operator Service
 * Uses Effect.Service for single switch implementation
 */
export class SwitchOperatorService extends Effect.Service<SwitchOperatorService>()('SwitchOperatorService', {
  effect: Effect.gen(function* () {
    const executionContext = yield* ExecutionContextService
    
    return {
      /**
       * Execute switch statement
       */
      execute: (config: SwitchConfig, input: any, context: ExecutionContext) =>
        Effect.gen(function* () {
          const startTime = Date.now()
          
          // Get the switch value
          const switchValue = yield* Effect.try(() => {
            // If switch is a variable reference, get it from context
            if (typeof config.switch === 'string' && config.switch.startsWith('$') && context) {
              return context.getVariable(config.switch.slice(1))
            }
            return config.switch
          }).pipe(
            Effect.mapError(error => new OperatorError({
              operator: 'switch',
              message: 'Failed to evaluate switch expression',
              cause: { error, expression: config.switch }
            }))
          )
          
          // Evaluate each case
          for (let i = 0; i < config.cases.length; i++) {
            const switchCase = config.cases[i]
            if (!switchCase) continue
            
            // Evaluate condition
            const conditionMet = yield* Effect.try(() => {
              if (typeof switchCase.condition === 'function') {
                return switchCase.condition(switchValue)
              }
              // Direct equality check
              return switchCase.condition === switchValue
            }).pipe(
              Effect.mapError(error => new OperatorError({
                operator: 'switch',
                message: `Failed to evaluate case condition at index ${i}`,
                cause: { error, condition: switchCase.condition }
              }))
            )
            
            if (conditionMet) {
              // Execute the matched case
              const result = yield* Effect.try(() => {
                // In real implementation, this would execute the nested step
                if (typeof switchCase.then === 'function') {
                  return switchCase.then(input)
                }
                return switchCase.then
              }).pipe(
                Effect.mapError(error => new OperatorError({
                  operator: 'switch',
                  message: `Failed to execute case at index ${i}`,
                  cause: { error, case: switchCase }
                }))
              )
              
              // Store output if specified
              if (config.output) {
                if (context) context.setVariable(config.output, result)
              }
              
              return {
                value: result,
                metadata: {
                  selectedCase: i,
                  evaluationTime: Date.now() - startTime
                }
              }
            }
          }
          
          // No case matched, use default if available
          if (config.default !== undefined) {
            const result = yield* Effect.try(() => {
              if (typeof config.default === 'function') {
                return config.default(input)
              }
              return config.default
            }).pipe(
              Effect.mapError(error => new OperatorError({
                operator: 'switch',
                message: 'Failed to execute default case',
                cause: { error, default: config.default }
              }))
            )
            
            // Store output
            if (config.output) {
              if (context) context.setVariable(config.output, result)
            }
            
            return {
              value: result,
              metadata: {
                selectedCase: 'default',
                evaluationTime: Date.now() - startTime
              }
            }
          }
          
          // No case matched and no default
          return {
            value: undefined,
            metadata: {
              selectedCase: 'none',
              evaluationTime: Date.now() - startTime
            }
          }
        }),
      
      /**
       * Validate switch configuration
       */
      validate: (config: SwitchConfig) =>
        Effect.gen(function* () {
          // Validate required fields
          if (!config.id) {
            return yield* Effect.fail(new ValidationError({
              field: 'id',
              message: 'Switch ID is required'
            }))
          }
          
          if (config.switch === undefined) {
            return yield* Effect.fail(new ValidationError({
              field: 'switch',
              message: 'Switch expression is required'
            }))
          }
          
          if (!config.cases || !Array.isArray(config.cases)) {
            return yield* Effect.fail(new ValidationError({
              field: 'cases',
              message: 'Cases array is required'
            }))
          }
          
          if (config.cases.length === 0) {
            return yield* Effect.fail(new ValidationError({
              field: 'cases',
              message: 'At least one case is required'
            }))
          }
          
          // Validate each case
          for (let i = 0; i < config.cases.length; i++) {
            const switchCase = config.cases[i]
            
            if (!switchCase || typeof switchCase !== 'object') {
              return yield* Effect.fail(new ValidationError({
                field: `cases[${i}]`,
                message: 'Case must be an object'
              }))
            }
            
            if (switchCase.condition === undefined) {
              return yield* Effect.fail(new ValidationError({
                field: `cases[${i}].condition`,
                message: 'Case condition is required'
              }))
            }
            
            if (switchCase.then === undefined) {
              return yield* Effect.fail(new ValidationError({
                field: `cases[${i}].then`,
                message: 'Case then clause is required'
              }))
            }
          }
          
          return true
        }),
      
      /**
       * Get operator name
       */
      getName: () => 'switch',
      
      /**
       * Get operator description
       */
      getDescription: () => 'Executes different branches based on switch value matching'
    }
  })
}) {}
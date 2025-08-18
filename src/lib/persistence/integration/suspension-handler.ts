/**
 * Suspension Handler - Integration layer for flow engine suspension
 * 
 * Handles FlowSuspensionSignal errors from AwaitInput tools and
 * coordinates with the persistence hub to suspend flows.
 */

import { Effect, pipe } from 'effect'
import { FlowSuspensionSignal } from '../types';
export { FlowSuspensionSignal };
import type { PersistenceHub, SuspensionResult, SuspensionContext, PersistenceError } from '../types'
import { logInfo, logError, logDebug } from '../../utils/logging'

/**
 * Flow context information for suspension
 */
export interface FlowSuspensionContext {
  readonly flowId: string
  readonly stepId: string
  readonly sessionId?: string | undefined
  readonly executionPosition: unknown
  readonly variables: Record<string, unknown>
  readonly metadata: Record<string, unknown>
}

/**
 * Suspension handler result
 */
export interface SuspensionHandlerResult {
  readonly suspended: true
  readonly suspensionKey: string
  readonly message: string
  readonly resumptionInstructions: string
}

/**
 * Handler for flow suspension signals
 */
export class FlowSuspensionHandler {
  constructor(private readonly persistenceHub: PersistenceHub) {}

  /**
   * Handle a FlowSuspensionSignal by suspending the flow
   */
  handleSuspension(
    signal: FlowSuspensionSignal,
    flowContext: FlowSuspensionContext,
    suspensionContext: SuspensionContext
  ): Effect.Effect<SuspensionHandlerResult, PersistenceError> {
    const self = this;
    return Effect.gen(function* () {
      yield* logInfo(`Handling flow suspension signal [toolId: ${suspensionContext.toolId}]`, {
        flowId: flowContext.flowId,
        stepId: flowContext.stepId,
        toolName: suspensionContext.toolId,
        metadata: { message: signal.message }
      })

      // Create flow instance representation for persistence
      const flowInstance = {
        flowId: flowContext.flowId,
        stepId: flowContext.stepId,
        sessionId: flowContext.sessionId,
        executionPosition: flowContext.executionPosition,
        variables: flowContext.variables,
        metadata: {
          ...flowContext.metadata,
          suspensionTriggeredBy: suspensionContext.toolId,
          suspensionMessage: signal.message
        }
      }

      yield* logDebug(`Created flow instance for suspension`, {
        toolName: suspensionContext.toolId,
        metadata: { flowInstance }
      })

      // Suspend the flow using the persistence hub
      const suspensionResult = yield* self.persistenceHub.suspend(flowInstance, suspensionContext)

      yield* logInfo(`Flow suspension completed [key: ${suspensionResult.key}]`, {
        metadata: {
          suspensionKey: suspensionResult.key,
          suspendedAt: suspensionResult.suspendedAt,
          expiresAt: suspensionResult.expiresAt
        }
      })

      // Create resumption instructions
      const resumptionInstructions = self.createResumptionInstructions(
        suspensionResult,
        suspensionContext
      )

      return {
        suspended: true,
        suspensionKey: suspensionResult.key,
        message: signal.message,
        resumptionInstructions
      }
    })
  }

  /**
   * Handle resumption of a suspended flow
   */
  handleResumption(
    suspensionKey: string,
    input: unknown
  ): Effect.Effect<unknown, PersistenceError> {
    const self = this;
    return Effect.gen(function* () {
      yield* logInfo(`Handling flow resumption [key: ${suspensionKey}]`, {
        metadata: {
          suspensionKey,
          hasInput: input !== undefined
        }
      })

      // Resume the flow using the persistence hub
      const resumptionResult = yield* self.persistenceHub.resume(suspensionKey as any, input)

      yield* logInfo(`Flow resumption completed [key: ${suspensionKey}]`, {
        metadata: {
          suspensionKey,
          resumedAt: resumptionResult.resumedAt,
          flowInstance: !!resumptionResult.flowInstance
        }
      })

      return resumptionResult.flowInstance
    })
  }

  /**
   * Check if an error is a FlowSuspensionSignal
   */
  isSuspensionSignal(error: unknown): error is FlowSuspensionSignal {
    return error instanceof Error && 
           error.constructor.name === 'FlowSuspensionSignal' &&
           '_tag' in error && 
           error._tag === 'FlowSuspensionSignal'
  }

  /**
   * Extract suspension context from a FlowSuspensionSignal
   */
  extractSuspensionContext(
    signal: FlowSuspensionSignal,
    toolId: string
  ): SuspensionContext {
    return {
      toolId,
      awaitingInputSchema: signal.awaitingSchema,
      timeout: undefined, // Will be set by the tool
      defaultValue: undefined, // Will be set by the tool
      metadata: {
        suspensionMessage: signal.message,
        suspensionKey: signal.suspensionKey,
        extractedAt: new Date().toISOString()
      }
    }
  }

  /**
   * Create human-readable resumption instructions
   */
  private createResumptionInstructions(
    suspensionResult: SuspensionResult,
    suspensionContext: SuspensionContext
  ): string {
    const lines = [
      'Flow has been suspended and is awaiting input.',
      '',
      `Suspension Key: ${suspensionResult.key}`,
      `Suspended At: ${suspensionResult.suspendedAt.toISOString()}`,
    ]

    if (suspensionResult.expiresAt) {
      lines.push(`Expires At: ${suspensionResult.expiresAt.toISOString()}`)
    }

    lines.push('')
    lines.push('To resume this flow:')
    lines.push('1. Collect the required input data')
    lines.push('2. Call the resumption API with the suspension key and input')
    lines.push('3. The flow will continue from where it was suspended')

    if (suspensionContext.timeout) {
      lines.push('')
      lines.push(`⚠️  This flow will timeout and fail if not resumed before the expiration time.`)
    }

    return lines.join('\n')
  }
}

/**
 * Effect combinator for handling suspension signals in flow execution
 */
export const withSuspensionHandling = <A, E, R>(
  effect: Effect.Effect<A, E | FlowSuspensionSignal, R>,
  handler: FlowSuspensionHandler,
  flowContext: FlowSuspensionContext
) => {
  return pipe(
    effect,
    Effect.catchTag('FlowSuspensionSignal', (signal) =>
      Effect.gen(function* () {
        // For now, we extract context from the signal
        // In a real integration, this would come from the flow engine
        const suspensionContext = handler.extractSuspensionContext(signal as any, 'unknown')
        
        const result = yield* handler.handleSuspension(signal as any, flowContext, suspensionContext)
        
        // Return a special suspension result that the flow engine can handle
        return {
          _type: 'suspended',
          ...result
        } as A
      })
    )
  )
}

/**
 * Create a suspension handler with persistence hub
 */
export const createSuspensionHandler = (persistenceHub: PersistenceHub): FlowSuspensionHandler => {
  return new FlowSuspensionHandler(persistenceHub)
}

/**
 * Utility for flow engines to integrate suspension handling
 */
export class FlowEngineIntegration {
  constructor(private readonly suspensionHandler: FlowSuspensionHandler) {}

  /**
   * Wrap tool execution with suspension handling
   */
  executeToolWithSuspension<T>(
    toolEffect: Effect.Effect<T, FlowSuspensionSignal | Error>,
    flowContext: FlowSuspensionContext,
    toolId: string
  ): Effect.Effect<T | SuspensionHandlerResult, Error> {
    const self = this;
    return pipe(
      toolEffect,
      Effect.catchTag('FlowSuspensionSignal', (signal) =>
        Effect.gen(function* () {
          const suspensionContext = self.suspensionHandler.extractSuspensionContext(signal, toolId)
          
          // Update suspension context with actual tool information
          const updatedSuspensionContext: SuspensionContext = {
            ...suspensionContext,
            toolId,
            metadata: {
              ...suspensionContext.metadata,
              flowId: flowContext.flowId,
              stepId: flowContext.stepId,
              sessionId: flowContext.sessionId
            }
          }

          return yield* self.suspensionHandler.handleSuspension(
            signal,
            flowContext,
            updatedSuspensionContext
          )
        })
      )
    )
  }

  /**
   * Resume a suspended flow
   */
  resumeFlow(suspensionKey: string, input: unknown): Effect.Effect<unknown, PersistenceError> {
    return this.suspensionHandler.handleResumption(suspensionKey, input)
  }

  /**
   * Check if a result indicates suspension
   */
  isSuspensionResult(result: unknown): result is SuspensionHandlerResult {
    return typeof result === 'object' &&
           result !== null &&
           'suspended' in result &&
           (result as any).suspended === true
  }
}

/**
 * Create flow engine integration helper
 */
export const createFlowEngineIntegration = (persistenceHub: PersistenceHub): FlowEngineIntegration => {
  const handler = createSuspensionHandler(persistenceHub)
  return new FlowEngineIntegration(handler)
}
/**
 * IRExecutorService - Unified executor for IR from both static and dynamic flows
 * 
 * Service that executes Intermediate Representation (IR) with full Effect integration,
 * suspension handling, and persistence support.
 */

import { Effect, Context, Layer, Stream, Data, pipe } from 'effect';
import { IRExecutionError, IRCompilationError } from '../errors';
import { StateService } from './state';
import { ToolRegistryService } from './tool-registry';
import { PersistenceService, type SuspensionContext } from './persistence';
import { LoggingService } from './logging';
import { type SuspensionKey } from './key-generator';
import type { IR } from '../ir';
import type { Tool } from '../tools/types';

// ============= Types =============

/**
 * IR execution options
 */
export interface IRExecutionOptions {
  readonly input?: unknown;
  readonly tools?: Tool<any, any>[];
  readonly timeout?: number;
  readonly trace?: boolean;
  readonly flowId?: string;
  readonly sessionId?: string;
}

/**
 * Execution result for completed flows
 */
export interface ExecutionResult {
  readonly output: unknown;
  readonly metadata: {
    readonly duration: number;
    readonly tokensUsed?: number;
    readonly toolsExecuted: string[];
    readonly suspended?: boolean;
    readonly suspensionKey?: string;
    readonly suspensionMessage?: string;
  };
}

/**
 * Execution result for suspended flows
 */
export interface SuspendedExecutionResult {
  readonly suspended: true;
  readonly suspensionKey: string;
  readonly message: string;
  readonly resumptionInstructions: string;
  readonly metadata: {
    readonly duration: number;
    readonly tokensUsed?: number;
    readonly toolsExecuted: string[];
    readonly suspendedAt: string;
  };
}

/**
 * Execution event for streaming
 */
export interface IRExecutionEvent {
  readonly type:
    | 'node-start'
    | 'node-complete'
    | 'node-error'
    | 'flow-complete'
    | 'flow-error'
    | 'flow-suspended'
    | 'flow-resumed';
  readonly nodeId?: string;
  readonly nodeType?: string;
  readonly data?: unknown;
  readonly error?: Error;
  readonly timestamp: number;
  readonly suspensionKey?: string;
  readonly suspensionMessage?: string;
}

/**
 * Flow suspension signal
 */
export class FlowSuspensionSignal extends Data.TaggedError('FlowSuspensionSignal')<{
  readonly suspensionKey: string;
  readonly message: string;
  readonly context?: Record<string, unknown>;
}> {}

/**
 * Flow suspension context
 */
export interface FlowSuspensionContext extends Record<string, unknown> {
  readonly flowId: string;
  readonly stepId: string;
  readonly sessionId?: string;
  readonly executionPosition: unknown;
  readonly variables: Record<string, unknown>;
  readonly metadata: Record<string, unknown>;
}

// ============= IRExecutorService Interface =============

export interface IRExecutorService {
  /**
   * Execute IR synchronously (collect all results)
   */
  readonly execute: (
    ir: IR,
    options?: IRExecutionOptions
  ) => Effect.Effect<ExecutionResult | SuspendedExecutionResult, IRExecutionError>;

  /**
   * Execute IR with streaming events
   */
  readonly executeStream: (
    ir: IR,
    options?: IRExecutionOptions
  ) => Stream.Stream<IRExecutionEvent, IRExecutionError>;

  /**
   * Resume a suspended flow execution
   */
  readonly resumeExecution: (
    suspensionKey: string,
    input: unknown
  ) => Effect.Effect<ExecutionResult, IRExecutionError>;

  /**
   * Register tools for execution
   */
  readonly registerTool: <TInput, TOutput>(
    tool: Tool<TInput, TOutput>
  ) => Effect.Effect<void>;

  /**
   * Get execution statistics
   */
  readonly getStats: () => Effect.Effect<{
    readonly toolsRegistered: number;
    readonly executionsCompleted: number;
    readonly executionsSuspended: number;
    readonly averageDuration: number;
  }>;
}

// ============= Context Tag =============

export const IRExecutorService = Context.GenericTag<IRExecutorService>('@services/IRExecutor');

// ============= Service Implementation =============

const makeIRExecutorService = (): Effect.Effect<IRExecutorService, never, LoggingService | StateService | ToolRegistryService | PersistenceService> =>
  Effect.gen(function* () {
    const logger = yield* LoggingService;
    const state = yield* StateService;
    const toolRegistry = yield* ToolRegistryService;
    const persistence = yield* PersistenceService;

    // Track execution statistics
    let executionsCompleted = 0;
    let executionsSuspended = 0;
    let totalDuration = 0;

    const executeWithSuspensionHandling = (
      ir: IR,
      toolsExecuted: string[],
      flowId: string,
      sessionId?: string
    ) =>
      Effect.gen(function* () {
        yield* logger.debug(`Executing IR nodes`, { 
          nodeCount: ir.graph?.nodes?.size || 0,
          flowId 
        });

        // Execute the IR graph
        if (ir.graph && ir.graph.nodes.size > 0) {
          // Start from entry point
          const entryPoint = ir.graph.entryPoint;
          if (entryPoint) {
            const startNode = ir.graph.nodes.get(entryPoint);
            if (startNode) {
              return yield* executeNodeWithSuspension(
                startNode,
                toolsExecuted,
                flowId,
                sessionId
              );
            }
          }
        }

        return null; // Placeholder result
      });

    const executeNodeWithSuspension = (
      node: any,
      toolsExecuted: string[],
      flowId: string,
      sessionId?: string
    ): any =>
      pipe(
        Effect.gen(function* () {
          yield* logger.debug('Executing node', { 
            nodeId: node.id,
            nodeType: node.type,
            flowId 
          });

          // Handle different node types
          switch (node.type) {
            case 'tool': {
              const tool = yield* toolRegistry.get(node.toolId);
              toolsExecuted.push(tool.id);

              // Create suspension context for this node
              const flowContext: FlowSuspensionContext = {
                flowId,
                stepId: node.id,
                sessionId,
                executionPosition: { nodeId: node.id, nodeType: node.type },
                variables: yield* state.getAll(),
                metadata: {
                  nodeType: node.type,
                  toolId: node.toolId,
                  executedAt: new Date().toISOString()
                }
              };

              // Execute tool with suspension handling
              const toolResult = yield* pipe(
                Effect.gen(function* () {
                  // Get current variables for tool context
                  const variables = yield* state.getAll();
                  
                  // Execute the tool
                  return yield* tool.execute(node.input, {
                    flowId,
                    stepId: node.id,
                    sessionId: sessionId || 'default-session',
                    variables,
                    metadata: {}
                  });
                }),
                Effect.mapError((error): IRExecutionError | FlowSuspensionSignal => {
                  // Map specific error types to IRExecutionError
                  if (error instanceof IRExecutionError || error instanceof FlowSuspensionSignal) {
                    return error;
                  }
                  return new IRExecutionError({
                    message: `Tool execution error: ${String(error)}`,
                    nodeId: node.id,
                    nodeType: 'tool',
                    cause: error
                  });
                }),
                Effect.catchAll((error: IRExecutionError | FlowSuspensionSignal) =>
                  Effect.gen(function* () {
                    // Check if this is a suspension request
                    if (error && typeof error === 'object' && 'suspend' in error) {
                      const suspensionContext: SuspensionContext = {
                        toolId: node.toolId,
                        timeout: undefined, // Could be configured
                        awaitingInputSchema: (error as any).inputSchema,
                        defaultValue: (error as any).defaultValue,
                        metadata: flowContext.metadata
                      };

                      // Suspend the flow
                      const suspensionResult = yield* persistence.suspend(
                        flowContext,
                        suspensionContext
                      );

                      // Throw suspension signal
                      return yield* Effect.fail(
                        new FlowSuspensionSignal({
                          suspensionKey: suspensionResult.key,
                          message: (error as any).message || 'Flow suspended for input',
                          context: flowContext
                        })
                      );
                    }

                    // Regular error handling
                    return yield* Effect.fail(
                      new IRExecutionError({
                        message: `Tool execution failed: ${error}`,
                        nodeId: node.id,
                        nodeType: 'tool',
                        cause: error
                      })
                    );
                  })
                )
              );

              // Store tool result in state if successful
              if (node.outputVariable) {
                yield* state.set(node.outputVariable, toolResult);
              }

              return toolResult;
            }

            case 'variable': {
              // Get or set variable
              if (node.operation === 'get') {
                return yield* state.get(node.name);
              } else if (node.operation === 'set') {
                yield* state.set(node.name, node.value);
                return node.value;
              }
              break;
            }

            case 'conditional': {
              // Evaluate condition and branch
              const condition = yield* state.get(node.condition);
              const nextNode = condition ? node.thenNode : node.elseNode;
              
              if (nextNode) {
                return yield* executeNodeWithSuspension(
                  nextNode,
                  toolsExecuted,
                  flowId,
                  sessionId
                );
              }
              break;
            }

            case 'loop': {
              // Execute loop body
              const items = yield* state.get(node.iterableVariable);
              if (Array.isArray(items)) {
                const results = [];
                for (const item of items) {
                  // Set loop variable
                  yield* state.set(node.itemVariable, item);
                  
                  // Execute loop body
                  const result: unknown = yield* executeNodeWithSuspension(
                    node.bodyNode,
                    toolsExecuted,
                    flowId,
                    sessionId
                  );
                  
                  results.push(result);
                }
                return results;
              }
              break;
            }

            default:
              yield* logger.warn(`Unknown node type: ${node.type}`, { nodeId: node.id });
          }

          return null;
      }),
      Effect.mapError((error): IRExecutionError | FlowSuspensionSignal => {
        // Pass through FlowSuspensionSignal unchanged
        if (error instanceof FlowSuspensionSignal) {
          return error;
        }
        // Map all other errors to IRExecutionError
        if (error instanceof IRExecutionError) {
          return error;
        }
        return new IRExecutionError({
          message: `Node execution failed: ${String(error)}`,
          nodeId: node.id,
          nodeType: node.type,
          cause: error
        });
      })
    );

    const service: IRExecutorService = {
      execute: (ir: IR, options?: IRExecutionOptions) =>
        Effect.gen(function* () {
          const startTime = Date.now();
          const toolsExecuted: string[] = [];
          const flowId = options?.flowId || `flow_${Date.now()}`;
          const sessionId = options?.sessionId;

          yield* logger.info(`Starting IR execution`, { flowId });

          // Register provided tools
          if (options?.tools) {
            for (const tool of options.tools) {
              yield* pipe(
                toolRegistry.register(tool),
                Effect.mapError((error) => new IRExecutionError({
                  message: `Failed to register tool ${tool.id}: ${error}`,
                  nodeType: 'tool',
                  cause: error
                }))
              );
              yield* logger.debug('Registered tool', { toolId: tool.id });
            }
          }

          // Register tools from IR registry
          if (ir.registry?.tools) {
            for (const [_, tool] of ir.registry.tools) {
              yield* pipe(
                toolRegistry.register(tool),
                Effect.mapError((error) => new IRExecutionError({
                  message: `Failed to register IR tool ${tool.id}: ${error}`,
                  nodeType: 'tool',
                  cause: error
                }))
              );
              yield* logger.debug('Registered IR tool', { toolId: tool.id });
            }
          }

          // Set initial input if provided
          if (options?.input !== undefined) {
            yield* state.set('input', options.input);
            yield* logger.debug('Set initial input');
          }

          // Execute with suspension handling
          const result = yield* executeWithSuspensionHandling(
            ir,
            toolsExecuted,
            flowId,
            sessionId
          ).pipe(
            Effect.catchIf(
              (error): error is FlowSuspensionSignal => error instanceof FlowSuspensionSignal,
              (signal) => {
                // Convert suspension signal to suspended result
                return Effect.succeed({
                  suspended: true as const,
                  suspensionKey: signal.suspensionKey,
                  message: signal.message,
                  resumptionInstructions: `Resume flow with suspension key: ${signal.suspensionKey}`,
                  metadata: {
                    duration: Date.now() - startTime,
                    toolsExecuted,
                    suspendedAt: new Date().toISOString()
                  }
                });
              }
            )
          );

          // Check if execution was suspended
          if (result && typeof result === 'object' && 'suspended' in result && result.suspended === true) {
            executionsSuspended++;
            yield* logger.info('Execution suspended', { flowId });
            return result as SuspendedExecutionResult;
          }

          // Execution completed successfully
          executionsCompleted++;
          const duration = Date.now() - startTime;
          totalDuration += duration;

          yield* logger.info('Execution completed successfully', { flowId, duration });

          return {
            output: result,
            metadata: {
              duration,
              toolsExecuted,
            },
          };
        }).pipe(
          Effect.mapError((error) => {
            if (error instanceof IRExecutionError) return error;
            return new IRExecutionError({
              message: `Execution failed: ${String(error)}`,
              nodeType: 'flow',
              cause: error
            });
          })
        ) as Effect.Effect<ExecutionResult | SuspendedExecutionResult, IRExecutionError, never>,

      executeStream: (ir: IR, options?: IRExecutionOptions) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const flowId = options?.flowId || `flow_${Date.now()}`;
            
            return Stream.async<IRExecutionEvent, IRExecutionError>((emit) => {
              const executeWithEvents = async () => {
                try {
                  // Emit start event
                  emit.single({
                    type: 'node-start',
                    nodeId: flowId,
                    nodeType: 'flow',
                    timestamp: Date.now()
                  });

                  // TODO: Implement full streaming execution
                  
                  // Emit completion event
                  emit.single({
                    type: 'flow-complete',
                    nodeId: flowId,
                    nodeType: 'flow',
                    timestamp: Date.now()
                  });

                } catch (error) {
                  emit.fail(
                    new IRExecutionError({
                      message: `Stream execution failed: ${error}`,
                      nodeType: 'flow',
                      cause: error
                    })
                  );
                }
              };

              executeWithEvents();
            });
          }) as Effect.Effect<Stream.Stream<IRExecutionEvent, IRExecutionError>, never, never>
        ) as Stream.Stream<IRExecutionEvent, IRExecutionError, never>,

      resumeExecution: (suspensionKey: string, input: unknown) =>
        Effect.gen(function* () {
          yield* logger.info(`Resuming suspended execution`, { suspensionKey });
          const startTime = Date.now();

          // Resume the flow through persistence service
          const resumptionResult = yield* pipe(
            persistence.resume(suspensionKey as SuspensionKey, input),
            Effect.mapError((error) => new IRExecutionError({
              message: `Failed to resume flow: ${error}`,
              nodeType: 'flow',
              cause: error
            }))
          );

          yield* logger.info(`Flow resumed successfully`, { suspensionKey });

          executionsCompleted++;
          const duration = Date.now() - startTime;
          totalDuration += duration;

          return {
            output: resumptionResult.flowInstance,
            metadata: {
              duration,
              toolsExecuted: [],
              suspended: false
            }
          };
        }) as Effect.Effect<ExecutionResult, IRExecutionError, never>,

      registerTool: <TInput, TOutput>(tool: Tool<TInput, TOutput>) =>
        Effect.gen(function* () {
          yield* pipe(
            toolRegistry.register(tool),
            Effect.orElse(() => Effect.void)
          );
          yield* logger.debug('Tool registered', { toolId: tool.id });
        }) as Effect.Effect<void, never, never>,

      getStats: () =>
        Effect.gen(function* () {
          const toolsRegistered = yield* toolRegistry.list();
          
          return {
            toolsRegistered: toolsRegistered.length,
            executionsCompleted,
            executionsSuspended,
            averageDuration: executionsCompleted > 0 ? totalDuration / executionsCompleted : 0
          };
        }) as Effect.Effect<{
          readonly toolsRegistered: number;
          readonly executionsCompleted: number;
          readonly executionsSuspended: number;
          readonly averageDuration: number;
        }, never, never>,
    };
    
    return service;
  });

// ============= Layer Implementation =============

/**
 * Live implementation of IRExecutorService
 */
export const IRExecutorServiceLive = Layer.effect(
  IRExecutorService,
  makeIRExecutorService()
);

/**
 * Test implementation for testing
 */
export const IRExecutorServiceTest = Layer.effect(
  IRExecutorService,
  makeIRExecutorService()
);

// ============= Helper Functions =============

/**
 * Execute IR with the current executor service
 */
export const executeIR = (ir: IR, options?: IRExecutionOptions) =>
  Effect.gen(function* () {
    const executor = yield* IRExecutorService;
    return yield* executor.execute(ir, options);
  });

/**
 * Execute IR with streaming
 */
export const executeIRStream = (ir: IR, options?: IRExecutionOptions) =>
  Effect.gen(function* () {
    const executor = yield* IRExecutorService;
    return executor.executeStream(ir, options);
  });

/**
 * Resume flow execution
 */
export const resumeFlowExecution = (suspensionKey: string, input: unknown) =>
  Effect.gen(function* () {
    const executor = yield* IRExecutorService;
    return yield* executor.resumeExecution(suspensionKey, input);
  });

/**
 * Register tool with executor
 */
export const registerExecutorTool = <TInput, TOutput>(tool: Tool<TInput, TOutput>) =>
  Effect.gen(function* () {
    const executor = yield* IRExecutorService;
    return yield* executor.registerTool(tool);
  });

/**
 * Get executor statistics
 */
export const getExecutorStats = () =>
  Effect.gen(function* () {
    const executor = yield* IRExecutorService;
    return yield* executor.getStats();
  });
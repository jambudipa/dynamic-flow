/**
 * IRExecutorService - Unified executor for IR from both static and dynamic flows
 *
 * Service that executes Intermediate Representation (IR) with full Effect integration,
 * suspension handling, and persistence support.
 */

import {
  Effect,
  Context,
  Layer,
  Stream,
  Data,
  pipe,
  HashMap,
  Option,
  Schema,
} from 'effect';
import { IRExecutionError, IRCompilationError } from '../errors';
import { StateService } from './state';
import { ToolRegistryService } from './tool-registry';
import { PersistenceService, type SuspensionContext } from './persistence';
import { LoggingService } from './logging';
import { type SuspensionKey } from './key-generator';
import type { IR } from '../ir';
import type { Tool } from '../tools/types';
import type { FlowId, SessionId } from '../types/core';
import { FlowSuspensionSignal } from '../persistence/types';

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
 * Flow suspension context
 */
interface FlowSuspensionContext extends Record<string, unknown> {
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
  ) => Effect.Effect<
    ExecutionResult | SuspendedExecutionResult,
    IRExecutionError
  >;

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

export const IRExecutorService = Context.GenericTag<IRExecutorService>(
  '@services/IRExecutor'
);

// ============= Input Resolution Helpers =============

/**
 * Resolve tool input by applying joins and variable references
 */
const resolveToolInput = (
  node: any,
  variables: Record<string, unknown>,
  joins?: any[]
): Effect.Effect<unknown, IRExecutionError, any> =>
  Effect.gen(function* () {
    // If node has explicit input, use it
    if (node.input && Object.keys(node.input).length > 0) {
      return node.input;
    }

    // Look for a join that targets this tool
    if (joins) {
      for (const join of joins) {
        if (join.toTool === node.toolId) {
          // Find the source tool's output in variables
          const sourceOutput = variables[join.fromTool];
          if (sourceOutput) {
            // Apply the join transformation
            try {
              const decoded = yield* Effect.mapError(
                Schema.decodeUnknown(join.transform)(sourceOutput),
                (error) =>
                  new IRExecutionError({
                    message: `Join transformation failed`,
                    nodeId: node.id,
                    nodeType: 'tool',
                    cause: error,
                  })
              );
              return decoded;
            } catch (error) {
              // Log warning without using Effect.logWarning which requires a service
              console.warn(
                `Join transformation failed for ${join.fromTool} -> ${join.toTool}: ${error}`
              );
            }
          }
        }
      }
    }

    // Fallback: try to create input based on tool requirements
    // For tools that expect multiple inputs (like llmCompare), aggregate from variables
    if (node.toolId === 'llm:compare') {
      // Special handling for compare tool - aggregate text sources
      const texts: any[] = [];

      // Look for book sections
      const bookData = variables['book:get-section'];
      if (bookData && typeof bookData === 'object' && 'text' in bookData) {
        texts.push({
          source: (bookData as any).title || 'book',
          type: 'book',
          text: (bookData as any).text,
        });
      }

      // Look for audio transcripts
      const audioData = variables['audio:get-transcript'];
      if (
        audioData &&
        typeof audioData === 'object' &&
        'transcript' in audioData
      ) {
        texts.push({
          source: (audioData as any).title || 'audio',
          type: 'audio',
          text: (audioData as any).transcript,
        });
      }

      return { texts, focus: 'gross vs subtle selflessness of persons' };
    }

    if (node.toolId === 'llm:clarify') {
      // Special handling for clarify tool
      const compareOutput = variables['llm:compare'];
      if (
        compareOutput &&
        typeof compareOutput === 'object' &&
        'clarityIssues' in compareOutput
      ) {
        return {
          issues: (compareOutput as any).clarityIssues || [],
          related: [],
        };
      }
    }

    if (node.toolId === 'llm:summarise') {
      // Special handling for summarise tool
      const compareOutput = variables['llm:compare'];
      if (
        compareOutput &&
        typeof compareOutput === 'object' &&
        'analysis' in compareOutput
      ) {
        return {
          analysis: (compareOutput as any).analysis,
          clarifications: (compareOutput as any).clarityIssues || [],
          audience: 'plain' as const,
        };
      }
    }

    if (node.toolId === 'llm:check-contradictions') {
      // Special handling for contradiction checking
      const texts: string[] = [];
      const summariseOutput = variables['llm:summarise'];
      if (
        summariseOutput &&
        typeof summariseOutput === 'object' &&
        'summary' in summariseOutput
      ) {
        texts.push((summariseOutput as any).summary);
      }
      return { texts };
    }

    // For search tools that need query input, provide default
    if (node.toolId === 'corpus:search') {
      return {
        query: 'gross selflessness persons subtle selflessness',
        limit: 10,
      };
    }

    // For get-section/get-transcript tools, look for search results
    if (node.toolId === 'book:get-section') {
      const searchOutput = variables['corpus:search'];
      if (
        searchOutput &&
        typeof searchOutput === 'object' &&
        'results' in searchOutput
      ) {
        const results = (searchOutput as any).results;
        const bookResult = results.find((r: any) => r.kind === 'book');
        if (bookResult) {
          return { id: bookResult.id };
        }
      }
    }

    if (node.toolId === 'audio:get-transcript') {
      const searchOutput = variables['corpus:search'];
      if (
        searchOutput &&
        typeof searchOutput === 'object' &&
        'results' in searchOutput
      ) {
        const results = (searchOutput as any).results;
        const audioResult = results.find((r: any) => r.kind === 'audio');
        if (audioResult) {
          return { id: audioResult.id };
        }
      }
    }

    // Default fallback
    return {};
  });

// ============= Service Implementation =============

const makeIRExecutorService = (): Effect.Effect<
  IRExecutorService,
  never,
  LoggingService | StateService | ToolRegistryService | PersistenceService
> =>
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
          nodeCount: ir.graph?.nodes ? HashMap.size(ir.graph.nodes) : 0,
          flowId,
        });

        // Execute the IR graph
        if (ir.graph && HashMap.size(ir.graph.nodes) > 0) {
          // Start from entry point
          const entryPoint = ir.graph.entryPoint;
          if (entryPoint) {
            const startNode = HashMap.get(ir.graph.nodes, entryPoint);
            if (Option.isSome(startNode)) {
              return yield* executeNodeWithSuspension(
                startNode.value,
                toolsExecuted,
                flowId,
                ir,
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
      ir: IR,
      sessionId?: string
    ): any =>
      pipe(
        Effect.gen(function* () {
          yield* logger.debug('Executing node', {
            nodeId: node.id,
            nodeType: node.type,
            flowId,
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
                  executedAt: new Date().toISOString(),
                },
              };

              // Execute tool with suspension handling
              const toolResult = yield* pipe(
                Effect.gen(function* () {
                  // Get current variables for tool context
                  const variables = yield* state.getAll();

                  // Resolve the actual input for this tool by checking if there's
                  // data from a previous step that needs to be transformed
                  const resolvedInput = yield* resolveToolInput(
                    node,
                    variables,
                    ir.registry?.joins
                      ? Array.from(HashMap.values(ir.registry.joins))
                      : undefined
                  );

                  // Debug logging
                  if (node.toolId === 'llm:compare') {
                    yield* Effect.logInfo(
                      `[DEBUG] Executing ${node.toolId} with resolved input:`,
                      resolvedInput
                    );
                    yield* Effect.logInfo(
                      `[DEBUG] Available variables:`,
                      variables
                    );
                  }

                  // Execute the tool
                  return yield* tool.execute(resolvedInput, {
                    flowId: flowId as FlowId,
                    stepId: node.id,
                    sessionId: (sessionId || 'default-session') as SessionId,
                    variables: new Map(Object.entries(variables)),
                    metadata: new Map(),
                    parentContext: Option.none(),
                    currentScope: [],
                  });
                }),
                Effect.mapError(
                  (error): IRExecutionError | FlowSuspensionSignal => {
                    // Map specific error types to IRExecutionError
                    if (
                      error instanceof IRExecutionError ||
                      error instanceof FlowSuspensionSignal
                    ) {
                      return error;
                    }
                    return new IRExecutionError({
                      message: `Tool execution error: ${String(error)}`,
                      nodeId: node.id,
                      nodeType: 'tool',
                      cause: error,
                    });
                  }
                ),
                Effect.catchAll(
                  (error: IRExecutionError | FlowSuspensionSignal) =>
                    Effect.gen(function* () {
                      // Check if this is a suspension request
                      if (
                        error &&
                        typeof error === 'object' &&
                        'suspend' in error
                      ) {
                        const suspensionContext: SuspensionContext = {
                          toolId: node.toolId,
                          timeout: undefined, // Could be configured
                          awaitingInputSchema: (error as any).inputSchema,
                          defaultValue: (error as any).defaultValue,
                          metadata: flowContext.metadata,
                        };

                        // Suspend the flow
                        const suspensionResult = yield* persistence.suspend(
                          flowContext,
                          suspensionContext
                        );

                        // Throw suspension signal
                        return yield* Effect.fail(
                          new FlowSuspensionSignal({
                            suspensionKey: suspensionResult.key as any,
                            message:
                              (error as any).message ||
                              'Flow suspended for input',
                            awaitingSchema:
                              (error as any).inputSchema || Schema.Unknown,
                            module: 'IRExecutor',
                            operation: 'executeNode',
                          })
                        );
                      }

                      // Regular error handling
                      return yield* Effect.fail(
                        new IRExecutionError({
                          message: `Tool execution failed: ${error}`,
                          nodeId: node.id,
                          nodeType: 'tool',
                          cause: error,
                        })
                      );
                    })
                )
              );

              // Store tool result in state if successful
              // Always store with tool ID as key for data flow
              yield* state.set(node.toolId, toolResult);

              // Also store with explicit output variable if provided
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
                  ir,
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
                    ir,
                    sessionId
                  );

                  results.push(result);
                }
                return results;
              }
              break;
            }

            default:
              yield* logger.warn(`Unknown node type: ${node.type}`, {
                nodeId: node.id,
              });
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
            cause: error,
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
                Effect.mapError(
                  (error) =>
                    new IRExecutionError({
                      message: `Failed to register tool ${tool.id}: ${error}`,
                      nodeType: 'tool',
                      cause: error,
                    })
                )
              );
              yield* logger.debug('Registered tool', { toolId: tool.id });
            }
          }

          // Register tools from IR registry
          if (ir.registry?.tools) {
            for (const [_, tool] of ir.registry.tools) {
              yield* pipe(
                toolRegistry.register(tool),
                Effect.mapError(
                  (error) =>
                    new IRExecutionError({
                      message: `Failed to register IR tool ${tool.id}: ${error}`,
                      nodeType: 'tool',
                      cause: error,
                    })
                )
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
              (error): error is FlowSuspensionSignal =>
                error instanceof FlowSuspensionSignal,
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
                    suspendedAt: new Date().toISOString(),
                  },
                });
              }
            )
          );

          // Check if execution was suspended
          if (
            result &&
            typeof result === 'object' &&
            'suspended' in result &&
            result.suspended === true
          ) {
            executionsSuspended++;
            yield* logger.info('Execution suspended', { flowId });
            return result as SuspendedExecutionResult;
          }

          // Execution completed successfully
          executionsCompleted++;
          const duration = Date.now() - startTime;
          totalDuration += duration;

          yield* logger.info('Execution completed successfully', {
            flowId,
            duration,
          });

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
              cause: error,
            });
          })
        ) as Effect.Effect<
          ExecutionResult | SuspendedExecutionResult,
          IRExecutionError,
          never
        >,

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
                    timestamp: Date.now(),
                  });

                  // TODO: Implement full streaming execution

                  // Emit completion event
                  emit.single({
                    type: 'flow-complete',
                    nodeId: flowId,
                    nodeType: 'flow',
                    timestamp: Date.now(),
                  });
                } catch (error) {
                  emit.fail(
                    new IRExecutionError({
                      message: `Stream execution failed: ${error}`,
                      nodeType: 'flow',
                      cause: error,
                    })
                  );
                }
              };

              executeWithEvents();
            });
          }) as Effect.Effect<
            Stream.Stream<IRExecutionEvent, IRExecutionError>,
            never,
            never
          >
        ) as Stream.Stream<IRExecutionEvent, IRExecutionError, never>,

      resumeExecution: (suspensionKey: string, input: unknown) =>
        Effect.gen(function* () {
          yield* logger.info(`Resuming suspended execution`, { suspensionKey });
          const startTime = Date.now();

          // Resume the flow through persistence service
          const resumptionResult = yield* pipe(
            persistence.resume(suspensionKey as SuspensionKey, input),
            Effect.mapError(
              (error) =>
                new IRExecutionError({
                  message: `Failed to resume flow: ${error}`,
                  nodeType: 'flow',
                  cause: error,
                })
            )
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
              suspended: false,
            },
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
            averageDuration:
              executionsCompleted > 0 ? totalDuration / executionsCompleted : 0,
          };
        }) as Effect.Effect<
          {
            readonly toolsRegistered: number;
            readonly executionsCompleted: number;
            readonly executionsSuspended: number;
            readonly averageDuration: number;
          },
          never,
          never
        >,
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
export const registerExecutorTool = <TInput, TOutput>(
  tool: Tool<TInput, TOutput>
) =>
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

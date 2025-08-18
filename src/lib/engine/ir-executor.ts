/**
 * DynamicFlow - IR Executor
 *
 * Unified executor for IR from both static and dynamic flows
 */
import { Data, Effect, Stream } from 'effect';
import type { IR } from '@/lib/ir';
import { ToolRegistryImpl } from '@/lib/tools/registry';
import { Tool, type ToolJoin } from '@/lib/tools/types';
import type { ToolRequirements } from '@/lib/types';
import type { StateManager } from '@/lib/state/manager';
import { createStateManager } from '@/lib/state/manager';
import type {
  PersistenceHub,
  SuspensionResult
} from '@/lib/persistence/types';
import {
  FlowSuspensionSignal,
  FlowSuspensionHandler,
  FlowEngineIntegration,
  createFlowEngineIntegration,
  type FlowSuspensionContext,
  type SuspensionHandlerResult
} from '@/lib/persistence/integration/suspension-handler';
import { logInfo, logDebug, logError } from '@/lib/utils/logging';
export interface ExecutionResult {
  output: unknown;
  metadata: {
    duration: number;
    tokensUsed?: number;
    toolsExecuted: string[];
    suspended?: boolean;
    suspensionKey?: string | undefined;
    suspensionMessage?: string | undefined;
  };
}
export interface SuspendedExecutionResult {
  suspended: true;
  suspensionKey: string;
  message: string;
  resumptionInstructions: string;
  metadata: {
    duration: number;
    tokensUsed?: number;
    toolsExecuted: string[];
    suspendedAt: string;
  };
}
export class ExecutionError extends Data.TaggedError('ExecutionError')<{
  readonly message: string;
  readonly nodeId?: string | undefined;
  readonly nodeType?: string | undefined;
  readonly step?: string;
  readonly context?: Record<string, unknown>;
}> {
  get displayMessage(): string {
    const nodeInfo =
      this.nodeId !== null && this.nodeId !== undefined && this.nodeId !== ''
        ? ` in node '${this.nodeId}'`
        : '';
    const typeInfo =
      this.nodeType !== null &&
      this.nodeType !== undefined &&
      this.nodeType !== ''
        ? ` (${this.nodeType})`
        : '';
    const stepInfo =
      this.step !== null && this.step !== undefined && this.step !== ''
        ? ` at step '${this.step}'`
        : '';
    return `Execution failed${nodeInfo}${typeInfo}${stepInfo}: ${this.message}`;
  }
}
export interface IRExecutionOptions {
  input?: unknown;
  tools?: Tool<any, any>[];
  joins?: ToolJoin<any, any>[];
  timeout?: number;
  trace?: boolean;
  persistenceHub?: PersistenceHub;
  flowId?: string;
  sessionId?: string;
}
export interface IRExecutionEvent {
  type:
    | 'node-start'
    | 'node-complete'
    | 'node-error'
    | 'flow-complete'
    | 'flow-error'
    | 'flow-suspended'
    | 'flow-resumed';
  nodeId?: string | undefined;
  nodeType?: string | undefined;
  data?: unknown | undefined;
  error?: Error | undefined;
  timestamp: number;
  suspensionKey?: string | undefined;
  suspensionMessage?: string | undefined;
}
/**
 * Executor for the new IR format with persistence support
 */
export class IRExecutor {
  private registry: ToolRegistryImpl;
  private stateManager: StateManager;
  private flowEngineIntegration?: FlowEngineIntegration;
  private currentFlowId?: string;
  private currentSessionId?: string;
  constructor() {
    this.registry = new ToolRegistryImpl();
    this.stateManager = createStateManager();
  }
  /**
   * Configure persistence for this executor
   */
  configurePersistence(persistenceHub: PersistenceHub): void {
    this.flowEngineIntegration = createFlowEngineIntegration(persistenceHub);
  }
  /**
   * Execute IR synchronously (collect all results)
   */
  execute(
    ir: IR,
    options?: IRExecutionOptions
  ): Effect.Effect<ExecutionResult | SuspendedExecutionResult, ExecutionError, ToolRequirements> {
    const self = this;
    return Effect.gen(function* () {
      const startTime = Date.now();
      const toolsExecuted: string[] = [];
      // Configure persistence if provided
      if (options?.persistenceHub) {
        self.configurePersistence(options.persistenceHub);
      }
      // Set flow identifiers
      self.currentFlowId = options?.flowId || `flow_${Date.now()}`;
      self.currentSessionId = options?.sessionId;
      yield* logInfo(`Starting IR execution [flowId: ${self.currentFlowId}]`, {});
      // Register tools if provided
      if (options?.tools !== null && options?.tools !== undefined) {
        for (const tool of options.tools) {
          self.registry.register(tool);
          yield* logDebug('Registered tool');
        }
      }
      // Register tools from IR registry
      if (ir.registry?.tools !== null && ir.registry?.tools !== undefined) {
        for (const [_, tool] of ir.registry.tools) {
          self.registry.register(tool);
          yield* logDebug('Registered IR tool');
        }
      }
      // Set initial input if provided
      if (options?.input !== undefined) {
        yield* self.stateManager.set('input', options.input);
        yield* logDebug('Set initial input');
      }
      try {
        // Execute the IR with suspension handling
        const result = yield* self.executeWithSuspensionHandling(ir, toolsExecuted).pipe(
          Effect.catchTag('FlowSuspensionSignal', (signal) => {
            // Convert suspension signal to a suspended result
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
          })
        );

        // Check if execution was suspended
        if (result && typeof result === 'object' && 'suspended' in result && result.suspended === true) {
          yield* logInfo('Execution suspended');
          return result as SuspendedExecutionResult;
        }
        yield* logInfo('Execution completed successfully');
        return {
          output: result,
          metadata: {
            duration: Date.now() - startTime,
            toolsExecuted,
          },
        };
      } catch (error) {
        yield* logError('Execution failed');

        if (error instanceof ExecutionError) {
          return yield* Effect.fail(error);
        }

        return yield* Effect.fail(new ExecutionError({
          message: `Unexpected execution error: ${error}`,
          nodeId: self.currentFlowId,
          context: { originalError: error }
        }));
      }
    });
  }
  /**
   * Execute IR with suspension signal handling
   */
  private executeWithSuspensionHandling(
    ir: IR,
    toolsExecuted: string[]
  ): Effect.Effect<unknown, ExecutionError | FlowSuspensionSignal> {
    const self = this;
    return Effect.gen(function* () {
      // TODO: Implement actual IR execution
      // For now, we'll simulate basic execution with tool invocation

      // This is where the actual IR interpretation would happen
      // The key is that tool execution would be wrapped with suspension handling

      // Log IR execution info
      const nodeCount = ir.graph?.nodes?.size || 0;
      yield* logDebug(`Executing IR nodes [count: ${nodeCount}]`, {});
      // Execute the IR graph
      if (ir.graph && ir.graph.nodes.size > 0) {
        // Start from entry point
        const entryPoint = ir.graph.entryPoint;
        if (entryPoint) {
          const startNode = ir.graph.nodes.get(entryPoint);
          if (startNode) {
            yield* self.executeNodeWithSuspension(startNode, toolsExecuted);
          }
        }
        // TODO: Follow edges to traverse full graph
      }
      return null; // Placeholder result
    });
  }
  /**
   * Execute a single IR node with suspension handling
   */
  private executeNodeWithSuspension(
    node: any,
    toolsExecuted: string[]
  ): Effect.Effect<unknown, ExecutionError | FlowSuspensionSignal> {
    const self = this;
    return Effect.gen(function* () {
      yield* logDebug(`Executing node`, {});
      // If this node involves tool execution, wrap with suspension handling
      if (node.type === 'tool' && self.flowEngineIntegration) {
        const toolEffect = self.registry.get(node.toolId);
        const toolResult = yield* Effect.either(toolEffect);
        if (toolResult._tag === 'Right') {
          const tool = toolResult.right;
          toolsExecuted.push(tool.id);

          // Create flow context for suspension
          const flowContext: FlowSuspensionContext = {
            flowId: self.currentFlowId!,
            stepId: node.id,
            sessionId: self.currentSessionId || undefined,
            executionPosition: { nodeId: node.id, nodeType: node.type },
            variables: yield* self.stateManager.getAll(),
            metadata: {
              nodeType: node.type,
              toolId: node.toolId,
              executedAt: new Date().toISOString()
            }
          };
          // Execute tool with suspension handling
          const toolEffect = tool.execute(node.input, {
            flowId: self.currentFlowId!,
            stepId: node.id,
            sessionId: self.currentSessionId || 'default-session',
            variables: yield* self.stateManager.getAll(),
            metadata: {}
          }).pipe(
            Effect.mapError((error): Error | FlowSuspensionSignal => {
              if (error instanceof FlowSuspensionSignal) {
                return error;
              }
              return new Error(`Tool execution failed: ${error}`);
            }),
            // Remove Tool service provision - not needed here
          ) as Effect.Effect<unknown, Error | FlowSuspensionSignal>;

          return yield* self.flowEngineIntegration.executeToolWithSuspension(
            toolEffect,
            flowContext,
            tool.id
          ).pipe(
            Effect.mapError((error): ExecutionError | FlowSuspensionSignal => {
              if (error instanceof FlowSuspensionSignal) {
                return error;
              }
              return new ExecutionError({
                message: `Tool execution failed: ${error}`,
                nodeId: node.id,
                nodeType: 'tool',
                step: node.toolId
              });
            })
          );
        }
      }
      // Handle other node types
      return null;
    });
  }
  /**
   * Resume a suspended flow execution
   */
  resumeExecution(
    suspensionKey: string,
    input: unknown
  ): Effect.Effect<ExecutionResult, ExecutionError> {
    const self = this;
    return Effect.gen(function* () {
      if (!self.flowEngineIntegration) {
        return yield* Effect.fail(new ExecutionError({
          message: 'Cannot resume execution: persistence not configured'
        }));
      }
      yield* logInfo(`Resuming suspended execution [key: ${suspensionKey}]`, {});
      const startTime = Date.now();

      try {
        const flowInstance = yield* self.flowEngineIntegration.resumeFlow(suspensionKey, input).pipe(
          Effect.mapError((error) => new ExecutionError({
            message: `Failed to resume flow: ${error instanceof Error ? error.message : String(error)}`,
            nodeId: suspensionKey,
            context: { originalError: error }
          }))
        );

        yield* logInfo(`Flow resumed successfully [key: ${suspensionKey}, hasFlowInstance: ${!!flowInstance}]`, {});
        // Continue execution from where it was suspended
        // TODO: Implement resumption logic with restored state

        return {
          output: flowInstance,
          metadata: {
            duration: Date.now() - startTime,
            toolsExecuted: [],
            suspended: false
          }
        };
      } catch (error) {
        yield* logError('Failed to resume execution');

        return yield* Effect.fail(new ExecutionError({
          message: `Failed to resume execution: ${error}`,
          context: { suspensionKey, error }
        }));
      }
    });
  }
  /**
   * Execute IR with streaming events
   */
  executeStream(
    ir: IR,
    options?: IRExecutionOptions
  ): Stream.Stream<IRExecutionEvent, ExecutionError, never> {
    return Stream.unwrap(
      Effect.gen(
        function* (this: IRExecutor) {
          // Configure persistence if provided
          if (options?.persistenceHub) {
            this.configurePersistence(options.persistenceHub);
          }
          const self = this;
          // Set flow identifiers
          self.currentFlowId = options?.flowId || `flow_${Date.now()}`;
          self.currentSessionId = options?.sessionId;
          // Register tools if provided
          if (options?.tools !== null && options?.tools !== undefined) {
            for (const tool of options.tools) {
              yield* Effect.sync(() => this.registry.register(tool));
            }
          }
          // Register tools from IR registry
          if (ir.registry?.tools !== null && ir.registry?.tools !== undefined) {
            for (const [_, tool] of ir.registry.tools) {
              yield* Effect.sync(() => this.registry.register(tool));
            }
          }
          // Set initial input if provided
          if (options?.input !== undefined) {
            yield* this.stateManager.set('input', options.input);
          }
          // Create event stream with suspension support
          return Stream.async<IRExecutionEvent, ExecutionError>((emit) => {
            const executeWithEvents = async () => {
              try {
                // Emit start event
                emit.single({
                  type: 'node-start',
                  nodeId: self.currentFlowId || 'unknown',
                  nodeType: 'flow',
                  timestamp: Date.now(),
                });
                // Execute with suspension handling
                const executionEffect = self.executeWithSuspensionHandling(ir, []);

                const result = await Effect.runPromise(
                  Effect.catchTag(executionEffect, 'FlowSuspensionSignal', (signal) =>
                    Effect.gen(function* () {
                      // Emit suspension event
                      emit.single({
                        type: 'flow-suspended',
                        nodeId: self.currentFlowId || 'unknown',
                        timestamp: Date.now(),
                        suspensionMessage: signal.message
                      });
                      // Handle suspension if integration is available
                      if (self.flowEngineIntegration) {
                        const flowContext: FlowSuspensionContext = {
                          flowId: self.currentFlowId!,
                          stepId: 'stream-execution',
                          sessionId: self.currentSessionId,
                          executionPosition: { streaming: true },
                          variables: {},
                          metadata: {
                            streamExecution: true,
                            suspendedAt: new Date().toISOString()
                          }
                        };
                        const suspensionHandler = new FlowSuspensionHandler(options?.persistenceHub!);
                        const suspensionContext = suspensionHandler
                          .extractSuspensionContext(signal, 'stream-execution');
                        const suspensionResult = yield* suspensionHandler
                          .handleSuspension(signal, flowContext, suspensionContext);
                        emit.single({
                          type: 'flow-suspended',
                          nodeId: self.currentFlowId || 'unknown',
                          timestamp: Date.now(),
                          suspensionKey: suspensionResult.suspensionKey,
                          suspensionMessage: suspensionResult.message
                        });
                        return suspensionResult;
                      }
                      return signal;
                    })
                  )
                );
                // Emit completion or suspension event based on result
                if (self.flowEngineIntegration?.isSuspensionResult(result)) {
                  // Already emitted suspension event above
                } else {
                  emit.single({
                    type: 'flow-complete',
                    nodeId: self.currentFlowId || 'unknown',
                    timestamp: Date.now(),
                    data: result
                  });
                }
                emit.end();
              } catch (error) {
                emit.single({
                  type: 'flow-error',
                  nodeId: self.currentFlowId || 'unknown',
                  error: error instanceof Error ? error : new Error(String(error)),
                  timestamp: Date.now(),
                });
                emit.end();
              }
            };
            void executeWithEvents();
          });
        }.bind(this as IRExecutor)
      )
    );
  }
  /**
   * Reset executor state
   */
  reset(): void {
    this.registry = new ToolRegistryImpl();
    this.stateManager = createStateManager();
  }
}
/**
 * Create a new IR executor
 */
export const createIRExecutor = (): IRExecutor => {
  return new IRExecutor();
};
/**
 * Execute IR directly (convenience function)
 */
export const executeIR = (
  ir: IR,
  options?: IRExecutionOptions
): Effect.Effect<ExecutionResult | SuspendedExecutionResult, ExecutionError, ToolRequirements> => {
  const executor = createIRExecutor();
  return executor.execute(ir, options);
};
/**
 * Execute IR with streaming (convenience function)
 */
export const executeIRStream = (
  ir: IR,
  options?: IRExecutionOptions
): Stream.Stream<IRExecutionEvent, ExecutionError> => {
  const executor = createIRExecutor();
  return executor.executeStream(ir, options);
};
/**
 * Resume a suspended IR execution (convenience function)
 */
export const resumeIRExecution = (
  suspensionKey: string,
  input: unknown,
  persistenceHub: PersistenceHub
): Effect.Effect<ExecutionResult, ExecutionError> => {
  const executor = createIRExecutor();
  executor.configurePersistence(persistenceHub);
  return executor.resumeExecution(suspensionKey, input);
};

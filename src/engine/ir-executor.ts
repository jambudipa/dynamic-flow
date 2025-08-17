/**
 * DynamicFlow - IR Executor
 *
 * Unified executor for IR from both static and dynamic flows
 */

import { Data, Effect, Stream } from 'effect';
import type { IR } from '@/ir';
import { ToolRegistryImpl } from '@/tools/registry';
import type { Tool, ToolJoin } from '@/tools/types';
import type { ToolRequirements } from '@/types';
import type { StateManager } from '@/state/manager';
import { createStateManager } from '@/state/manager';

export interface ExecutionResult {
  output: unknown;
  metadata: {
    duration: number;
    tokensUsed?: number;
    toolsExecuted: string[];
  };
}

export class ExecutionError extends Data.TaggedError('ExecutionError')<{
  readonly message: string;
  readonly nodeId?: string;
  readonly nodeType?: string;
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
}

export interface IRExecutionEvent {
  type:
    | 'node-start'
    | 'node-complete'
    | 'node-error'
    | 'flow-complete'
    | 'flow-error';
  nodeId?: string;
  nodeType?: string;
  data?: unknown;
  error?: Error;
  timestamp: number;
}

/**
 * Executor for the new IR format
 */
export class IRExecutor {
  private registry: ToolRegistryImpl;
  private stateManager: StateManager;

  constructor() {
    this.registry = new ToolRegistryImpl();
    this.stateManager = createStateManager();
  }

  /**
   * Execute IR synchronously (collect all results)
   */
  execute(
    ir: IR,
    options?: IRExecutionOptions
  ): Effect.Effect<ExecutionResult, ExecutionError, ToolRequirements> {
    // Register tools if provided
    if (options?.tools !== null && options?.tools !== undefined) {
      for (const tool of options.tools) {
        this.registry.register(tool);
      }
    }

    // Register tools from IR registry
    if (ir.registry?.tools !== null && ir.registry?.tools !== undefined) {
      for (const [_, tool] of ir.registry.tools) {
        this.registry.register(tool);
      }
    }

    // Set initial input if provided
    if (options?.input !== undefined) {
      Effect.runSync(this.stateManager.set('input', options.input));
    }

    // Execute IR directly - TODO: implement actual execution
    return Effect.succeed({
      output: null,
      metadata: {
        duration: 0,
        toolsExecuted: [],
      },
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

          // Create event stream
          return Stream.async<IRExecutionEvent, ExecutionError>((emit) => {
            // Start execution
            void emit.single({
              type: 'flow-complete',
              timestamp: Date.now(),
            } as IRExecutionEvent);

            // TODO: Implement proper streaming execution
            // For now, just emit completion event
          });
        }.bind(this)
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
): Effect.Effect<ExecutionResult, ExecutionError, ToolRequirements> => {
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

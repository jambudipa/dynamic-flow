/**
 * DynamicFlow - IR Executor
 *
 * Unified executor for IR from both static and dynamic flows
 */

import { Effect, Stream } from 'effect';
import type { IR } from '@/ir';
import { ToolRegistryImpl } from '@/tools/registry';
import type { Tool, ToolJoin } from '@/tools/types';
import type { ToolRequirements } from '@/types';

export interface ExecutionResult {
  output: unknown;
  metadata: {
    duration: number;
    tokensUsed?: number;
    toolsExecuted: string[];
  };
}

export class ExecutionError extends Error {
  constructor(
    message: string,
    public readonly nodeId?: string
  ) {
    super(message);
    this.name = 'ExecutionError';
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
  private stateManager: any; // StateManager type issue

  constructor() {
    this.registry = new ToolRegistryImpl();
    // Import the actual StateManager constructor
    const { createStateManager } = require('../state/manager');
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
    if (options?.tools) {
      for (const tool of options.tools) {
        this.registry.register(tool);
      }
    }

    // Register tools from IR registry
    if (ir.registry?.tools) {
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
    const self = this;
    return Stream.unwrap(
      Effect.gen(function* () {
        // Register tools if provided
        if (options?.tools) {
          for (const tool of options.tools) {
            yield* Effect.sync(() => self.registry.register(tool));
          }
        }

        // Register tools from IR registry
        if (ir.registry?.tools) {
          for (const [_, tool] of ir.registry.tools) {
            yield* Effect.sync(() => self.registry.register(tool));
          }
        }

        // Set initial input if provided
        if (options?.input !== undefined) {
          yield* self.stateManager.set('input', options.input);
        }

        // Create event stream
        return Stream.async<IRExecutionEvent, ExecutionError>((emit) => {
          // Start execution
          emit.single({
            type: 'flow-complete',
            timestamp: Date.now(),
          } as IRExecutionEvent);

          // TODO: Implement proper streaming execution
          // For now, just emit completion event
        });
      })
    ) as Stream.Stream<IRExecutionEvent, ExecutionError, never>;
  }

  /**
   * Reset executor state
   */
  reset(): void {
    this.registry = new ToolRegistryImpl();
    const { createStateManager } = require('../state/manager');
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

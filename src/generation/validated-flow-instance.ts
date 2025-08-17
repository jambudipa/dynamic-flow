/**
 * Validated Flow Instance - Executable flow with streaming support
 */

import { Duration, Effect, pipe, Ref, Stream } from 'effect';
import { StreamExecutor } from './stream-executor';
import type { ExecutionError } from './types';
import {
  type DynamicFlowOptions,
  type ExecutionOptions,
  type ExecutionResult,
  type FlowEvent,
  type FlowJSON,
  type FlowSnapshot,
  type FlowState,
  RestoreError,
  type ValidatedFlow
} from './types';

//TODO Is this still required? Is a ValidatedFlow pertaining to the IR, or has it been superseded by something else?
/**
 * Represents an executable flow instance
 */
export class ValidatedFlowInstance {
  private executor: StreamExecutor;
  private stateRef: Ref.Ref<FlowState>;

  constructor(
    private validatedFlow: ValidatedFlow,
    private options?: DynamicFlowOptions | undefined
  ) {
    this.executor = new StreamExecutor();
    this.stateRef = Ref.unsafeMake<FlowState>({
      status: 'idle',
      variables: new Map(),
      errors: [],
    });
  }

  /**
   * Run with streaming results
   */
  run(
    _input?: unknown,
    _options?: ExecutionOptions
  ): Stream.Stream<FlowEvent, ExecutionError> {
    // Current executor does not take input/options; kept for API compatibility
    const stream = this.executor.execute(this.validatedFlow);
    return Stream.tap(stream, (event) => this.updateState(event));
  }

  /**
   * Return a JSON copy of the validated flow plan (IR) that this instance will execute.
   * The returned object is a clone and safe to inspect or serialize.
   */
  getPlanJSON(): FlowJSON {
    const json = this.validatedFlow.json;
    // Prefer structuredClone if available (Node >= 18), else fall back to JSON clone
    try {
      // @ts-expect-error - structuredClone is available in Node 18+
      return structuredClone(json);
    } catch {
      return JSON.parse(JSON.stringify(json)) as FlowJSON;
    }
  }

  /**
   * Run and collect all results (convenience method)
   */
  runCollect(
    input?: unknown,
    options?: ExecutionOptions
  ): Effect.Effect<ExecutionResult, ExecutionError> {
    const results: unknown[] = [];
    let finalResult: unknown = undefined;
    const startTime = Date.now();
    const toolsExecuted = new Set<string>();

    return pipe(
      this.run(input, options),
      Stream.runForEach((event) =>
        Effect.sync(() => {
          if (event.type === 'node-complete') {
            // Collect node results
            results.push((event as any).result);
          } else if (event.type === 'flow-complete') {
            finalResult = (event as any).result;
          }
        })
      ),
      Effect.map(() => ({
        output: finalResult !== undefined ? finalResult : results,
        metadata: {
          duration: Duration.millis(Date.now() - startTime),
          toolsExecuted: Array.from(toolsExecuted),
        },
      }))
    );
  }

  /**
   * Snapshot current state
   */
  snapshot(): Effect.Effect<FlowSnapshot, never> {
    return pipe(
      Ref.get(this.stateRef),
      Effect.map((state) => {
        const completedSteps = Array.from(
          (this.validatedFlow.json?.nodes || [])
            .filter((n) => n?.id && this.isNodeCompleted(n.id, state))
            .map((n) => n.id)
        );

        const pendingSteps = Array.from(
          (this.validatedFlow.json?.nodes || [])
            .filter((n) => n?.id && !this.isNodeCompleted(n.id, state))
            .map((n) => n.id)
        );

        return {
          timestamp: Date.now(),
          state,
          completedSteps,
          pendingSteps,
          intermediateResults: new Map(state.variables ?? new Map()),
          metadata: {
            flowName: this.validatedFlow.json?.metadata?.name,
            model: this.options?.model?.toString(),
          },
        };
      })
    );
  }

  /**
   * Restore from snapshot
   */
  restore(snapshot: FlowSnapshot): Effect.Effect<void, RestoreError> {
    return pipe(
      Ref.set(this.stateRef, snapshot?.state),
      Effect.catchAll((error) =>
        Effect.fail(new RestoreError(`Failed to restore state: ${error}`))
      )
    );
  }

  /**
   * Get flow metadata
   */
  getMetadata(): FlowMetadata {
    const jsonData = this.validatedFlow.json;
    const nodes = jsonData?.nodes || [];

    return {
      name: jsonData?.metadata?.name,
      description: jsonData?.metadata?.description,
      generated: jsonData?.metadata?.generated ?? false,
      model: jsonData?.metadata?.model,
      nodeCount: nodes.length,
      toolCount: this.validatedFlow.tools?.size ?? 0,
      hasConditionals: nodes.some((n) => n?.type === 'if-then'),
      hasFunctionalOps: nodes.some((n) =>
        ['map', 'filter', 'reduce'].includes(n?.type)
      ),
    };
  }

  /**
   * Validate the flow structure
   */
  validate(): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check for disconnected nodes
    const connectedNodes = new Set<string>();
    const jsonData = this.validatedFlow.json;

    if (jsonData) {
      (jsonData.edges || []).forEach((edge) => {
        if (edge?.from) connectedNodes.add(edge.from);
        if (edge?.to) connectedNodes.add(edge.to);
      });

      (jsonData.nodes || []).forEach((node) => {
        if (
          node?.id &&
          !connectedNodes.has(node.id) &&
          (jsonData.nodes?.length || 0) > 1
        ) {
          warnings.push(`Node '${node.id}' is not connected to any other node`);
        }
      });
    }

    // Tools are part of ValidatedFlow; no revalidation required

    return {
      valid: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Optimise the flow (placeholder for future optimisations)
   */
  optimise(): ValidatedFlowInstance {
    // Future: Implement flow optimisation strategies
    // - Merge sequential operations
    // - Parallelise independent branches
    // - Cache repeated operations
    return this;
  }

  // Private helper methods

  private updateState(event: FlowEvent): Effect.Effect<void, never> {
    return Ref.update(this.stateRef, (state) => {
      switch (event?.type) {
        case 'state-change':
          return event.state;
        case 'node-start':
          return {
            ...state,
            currentNode: event?.nodeId,
            status: 'running' as const,
          };
        case 'node-error':
          return {
            ...state,
            errors: [...(state?.errors ?? []), (event as any).error],
            status: 'error' as const,
          };
        case 'flow-complete':
          return { ...state, status: 'completed' as const };
        default:
          return state;
      }
    });
  }

  private isNodeCompleted(nodeId: string, state: FlowState): boolean {
    // Simple check - in real implementation would track execution history
    return (state.variables ?? new Map()).has(`${nodeId}_output`);
  }
}

// Type definitions

interface FlowMetadata {
  name?: string | undefined;
  description?: string | undefined;
  generated: boolean;
  model?: string | undefined;
  nodeCount: number;
  toolCount: number;
  hasConditionals: boolean;
  hasFunctionalOps: boolean;
}

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

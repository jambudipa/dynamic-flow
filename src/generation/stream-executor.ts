/**
 * Stream Executor - Execute flows with streaming event emission
 */

import { Effect, pipe, Ref, Stream } from 'effect';
import type { Tool } from '@/tools/types';
import { LLMService } from '@/llm/service';
import type {
  FlowEvent,
  FlowJSON,
  FlowNode,
  FlowSnapshot,
  FlowState,
  NodeResult,
  ValidatedFlow,
} from './types';
import { ExecutionError } from './types';

/**
 * Executes flows and emits events as a stream
 */
export class StreamExecutor {
  /**
   * Execute a validated flow
   */
  execute(flow: ValidatedFlow): Stream.Stream<FlowEvent, ExecutionError> {
    // Create initial state
    const initialState: FlowState = {
      nodes: new Map<string, unknown>(),
      values: new Map<string, unknown>(),
      currentNode: null,
      status: 'running',
      startTime: Date.now(),
      errors: [],
    };

    return Stream.fromEffect(Ref.make(initialState)).pipe(
      Stream.flatMap((stateRef) =>
        pipe(
          // Start event
          Stream.succeed<FlowEvent>({
            type: 'flow-start',
            timestamp: Date.now(),
            metadata: flow.json?.metadata,
          }),
          // Execute nodes
          Stream.concat(this.executeNodes(flow, stateRef)),
          // Completion event
          Stream.concat(
            Stream.fromEffect(
              pipe(
                Ref.get(stateRef),
                Effect.map((state) => ({
                  type: 'flow-complete' as const,
                  timestamp: Date.now(),
                  result: this.collectResults(state),
                }))
              )
            )
          ),
          // Handle errors gracefully
          Stream.catchAll((error) =>
            Stream.fromIterable([
              {
                type: 'flow-error' as const,
                timestamp: Date.now(),
                error: {
                  message: error.message || 'Unknown error',
                  code: error.code || 'UNKNOWN',
                  nodeId: error.nodeId,
                },
              },
            ])
          )
        )
      )
    );
  }

  /**
   * Create a snapshot of current execution state
   */
  createSnapshot(state: FlowState): FlowSnapshot {
    return {
      timestamp: Date.now(),
      state,
    };
  }

  /**
   * Execute nodes in the flow
   */
  private executeNodes(
    flow: ValidatedFlow,
    stateRef: Ref.Ref<FlowState>
  ): Stream.Stream<FlowEvent, ExecutionError> {
    if (!flow?.json) {
      return Stream.fail(new ExecutionError('Flow JSON is required'));
    }
    const nodeOrder = this.calculateExecutionOrder(flow.json);

    return Stream.fromIterable(nodeOrder).pipe(
      Stream.flatMap((nodeId) => {
        const node = flow.json?.nodes.find((n) => n.id === nodeId);
        if (!node) {
          return Stream.fail(
            new ExecutionError(
              `Node not found: ${nodeId}`,
              'NODE_NOT_FOUND',
              nodeId
            )
          );
        }
        return this.executeNode(node, flow, stateRef);
      })
    );
  }

  /**
   * Execute a single node
   */
  private executeNode(
    node: FlowNode,
    flow: ValidatedFlow,
    stateRef: Ref.Ref<FlowState>
  ): Stream.Stream<FlowEvent, ExecutionError> {
    const commonStart = Stream.succeed<FlowEvent>({
      type: 'node-start',
      timestamp: Date.now(),
      nodeId: node?.id,
      nodeType: node.type,
    });

    const runNonTool = Stream.fromEffect(
      pipe(
        this.executeNodeLogic(node, flow, stateRef),
        Effect.map((result) => ({
          type: 'node-complete' as const,
          timestamp: Date.now(),
          nodeId: node?.id,
          result,
        })),
        Effect.catchAll((error) =>
          Effect.succeed({
            type: 'node-error' as const,
            timestamp: Date.now(),
            nodeId: node?.id,
            error: {
              message: error.message || 'Node execution failed',
              code: error.code || 'NODE_ERROR',
            },
          })
        )
      )
    );

    const stream =
      node.type === 'tool'
        ? this.executeToolNodeStream(node, flow, stateRef)
        : runNonTool;

    return pipe(
      commonStart,
      Stream.concat(stream),
      // IMPORTANT: return the Ref.update effect directly so it actually runs
      Stream.tap((event) =>
        event.type === 'node-complete' || event.type === 'node-error'
          ? Ref.update(stateRef, (state) => ({
              ...state,
              nodes: new Map([
                ...(state.nodes ?? new Map<string, unknown>()),
                [
                  node?.id,
                  {
                    status:
                      event.type === 'node-complete' ? 'completed' : 'failed',
                    startTime: Date.now(),
                    endTime: Date.now(),
                    result:
                      event.type === 'node-complete'
                        ? (event as any).result
                        : undefined,
                    error:
                      event.type === 'node-error'
                        ? (event as any).error
                        : undefined,
                  },
                ],
              ]),
              currentNode: null,
            }))
          : Effect.void
      )
    );
  }

  /**
   * Execute node logic based on type
   */
  private executeNodeLogic(
    node: FlowNode,
    flow: ValidatedFlow,
    stateRef: Ref.Ref<FlowState>
  ): Effect.Effect<NodeResult, ExecutionError> {
    switch (node?.type) {
      case 'tool':
        return this.executeToolNode(node, flow, stateRef);

      case 'if-then':
        return this.executeConditionalNode(node, flow, stateRef);

      case 'map':
      case 'filter':
      case 'reduce':
        return this.executeFunctionalNode(node, flow, stateRef);

      case 'parallel':
        return this.executeParallelNode(node, flow, stateRef);

      case 'sequence':
        return this.executeSequenceNode(node, flow, stateRef);

      default:
        return Effect.fail(
          new ExecutionError(
            `Unsupported node type: ${node.type}`,
            'UNSUPPORTED_NODE_TYPE',
            node.id
          )
        );
    }
  }

  /**
   * Execute a tool node
   */
  private executeToolNode(
    node: FlowNode,
    flow: ValidatedFlow,
    stateRef: Ref.Ref<FlowState>
  ): Effect.Effect<NodeResult, ExecutionError> {
    if (!node?.toolId) {
      return Effect.fail(
        new ExecutionError(
          `Tool node ${node.id} missing toolId`,
          'MISSING_TOOL_ID',
          node.id
        )
      );
    }

    const tool = flow.tools.get(node?.toolId);
    if (!tool) {
      return Effect.fail(
        new ExecutionError(
          `Tool not found: ${node.toolId}`,
          'TOOL_NOT_FOUND',
          node.id
        )
      );
    }

    return pipe(
      // Get input data from state
      Ref.get(stateRef),
      Effect.flatMap((state) => {
        const inputs = this.resolveInputs(node, state);

        // Execute the tool (simplified - would call actual tool)
        return this.executeTool(tool, inputs);
      }),
      Effect.map((output) => ({
        nodeId: node?.id,
        output,
        timestamp: Date.now(),
      }))
    );
  }

  /**
   * Execute a tool node with streaming events (tool-start/output/error, llm-token/completion), ending with node-complete.
   */
  private executeToolNodeStream(
    node: FlowNode & { toolId?: string },
    flow: ValidatedFlow,
    stateRef: Ref.Ref<FlowState>
  ): Stream.Stream<FlowEvent, ExecutionError> {
    if (!node?.toolId) {
      return Stream.fail(
        new ExecutionError(
          `Tool node ${node.id} missing toolId`,
          'MISSING_TOOL_ID',
          node.id
        )
      );
    }

    const tool = flow.tools.get(node?.toolId);
    if (!tool) {
      return Stream.fail(
        new ExecutionError(
          `Tool not found: ${node.toolId}`,
          'TOOL_NOT_FOUND',
          node.id
        )
      );
    }

    const toolId = node.toolId;
    const nodeId = node.id;
    const ts = () => Date.now();

    return Stream.fromEffect(Ref.get(stateRef)).pipe(
      Stream.flatMap((state) => {
        const inputs = this.resolveInputs(node, state);
        const start = Stream.succeed<FlowEvent>({
          type: 'tool-start',
          timestamp: ts(),
          nodeId,
          toolId,
          input: inputs,
        });

        const isLLM = typeof (tool as any).llmConfig !== 'undefined';
        const hasPrompt = typeof (inputs as any)?.prompt === 'string';
        const emitIntermediate =
          (node as any)?.config?.emitIntermediate !== false;
        const emitTokens = (node as any)?.config?.emitTokens !== false;

        if (isLLM && hasPrompt) {
          // Stream tokens and finalize
          let acc = '';
          const raw = Stream.unwrap(
            Effect.map(LLMService, (svc: any) =>
              svc.stream((inputs as any).prompt)
            )
          ) as unknown as Stream.Stream<{ content: string }, never>;
          const tokens = emitTokens
            ? raw.pipe(
                Stream.map(({ content }) => {
                  acc += content;
                  return {
                    type: 'llm-token',
                    timestamp: ts(),
                    nodeId,
                    toolId,
                    token: content,
                  } as FlowEvent;
                })
              )
            : raw.pipe(
                Stream.tap(({ content }) =>
                  Effect.sync(() => {
                    acc += content;
                  })
                ),
                Stream.map(() => undefined as unknown as FlowEvent),
                Stream.filter((x): x is FlowEvent => false)
              );
          const completionEv = Stream.succeed<FlowEvent>({
            type: 'llm-completion',
            timestamp: ts(),
            nodeId,
            toolId,
            completion: acc,
          });
          const output = { response: acc };
          const toolOut = emitIntermediate
            ? Stream.succeed<FlowEvent>({
                type: 'tool-output',
                timestamp: ts(),
                nodeId,
                toolId,
                output,
              })
            : Stream.empty;
          const nodeComplete = Stream.succeed<FlowEvent>({
            type: 'node-complete',
            timestamp: ts(),
            nodeId,
            result: { nodeId, output, timestamp: ts() },
          });

          return pipe(
            start,
            Stream.concat(tokens),
            Stream.concat(completionEv),
            Stream.concat(toolOut),
            Stream.concat(nodeComplete)
          );
        } else {
          // Non-LLM tool: execute and emit events
          const eff = tool
            .execute(inputs as any, {} as any)
            .pipe(
              Effect.mapError(
                (e: any) =>
                  new ExecutionError(
                    e?.message ?? 'Tool execution failed',
                    'TOOL_ERROR',
                    nodeId
                  )
              )
            );

          const run = Stream.fromEffect(eff).pipe(
            Stream.flatMap((output) =>
              emitIntermediate
                ? Stream.fromIterable<FlowEvent>([
                    {
                      type: 'tool-output',
                      timestamp: ts(),
                      nodeId,
                      toolId,
                      output,
                    },
                    {
                      type: 'node-complete',
                      timestamp: ts(),
                      nodeId,
                      result: { nodeId, output, timestamp: ts() },
                    },
                  ])
                : Stream.fromIterable<FlowEvent>([
                    {
                      type: 'node-complete',
                      timestamp: ts(),
                      nodeId,
                      result: { nodeId, output, timestamp: ts() },
                    },
                  ])
            ),
            Stream.catchAll((error: any) =>
              Stream.fromIterable<FlowEvent>([
                { type: 'tool-error', timestamp: ts(), nodeId, toolId, error },
                {
                  type: 'node-error',
                  timestamp: ts(),
                  nodeId,
                  error: {
                    message:
                      (error as Error).message || 'Tool execution failed',
                    code: 'TOOL_ERROR',
                  },
                },
              ])
            )
          );

          return Stream.concat(start, run) as unknown as Stream.Stream<
            FlowEvent,
            ExecutionError
          >;
        }
      })
    );
  }

  /**
   * Execute a conditional node
   */
  private executeConditionalNode(
    node: FlowNode & {
      condition?: unknown | undefined;
      then?: string[] | undefined;
      else?: string[] | undefined;
    },
    flow: ValidatedFlow,
    stateRef: Ref.Ref<FlowState>
  ): Effect.Effect<NodeResult, ExecutionError> {
    if (!node?.condition) {
      return Effect.fail(
        new ExecutionError(
          `Conditional node ${node.id} missing condition`,
          'MISSING_CONDITION',
          node.id
        )
      );
    }

    return pipe(
      Ref.get(stateRef),
      Effect.flatMap((state) => {
        const inputs = this.resolveInputs(node, state);

        // Evaluate condition (simplified)
        return this.evaluateCondition(node?.condition, inputs, flow);
      }),
      Effect.map((conditionResult) => ({
        nodeId: node?.id,
        output: {
          condition: conditionResult,
          selectedBranch: conditionResult ? 'then' : 'else',
        },
        timestamp: Date.now(),
      }))
    );
  }

  /**
   * Execute a functional operation node
   */
  private executeFunctionalNode(
    node: FlowNode,
    flow: ValidatedFlow,
    stateRef: Ref.Ref<FlowState>
  ): Effect.Effect<NodeResult, ExecutionError> {
    if (!node?.operation) {
      return Effect.fail(
        new ExecutionError(
          `Functional node ${node.id} missing operation`,
          'MISSING_OPERATION',
          node.id
        )
      );
    }

    return pipe(
      Ref.get(stateRef),
      Effect.flatMap((state) => {
        const collection = this.resolveCollection(node.operation?.over, state);

        // Execute operation based on type
        switch (node?.type) {
          case 'map':
            return this.executeMapOperation(collection, node?.operation, flow);

          case 'filter':
            return this.executeFilterOperation(
              collection,
              node?.operation,
              flow
            );

          case 'reduce':
            return this.executeReduceOperation(
              collection,
              node?.operation,
              flow
            );

          default:
            return Effect.fail(
              new ExecutionError(
                `Unknown functional operation: ${node.type}`,
                'UNKNOWN_OPERATION',
                node.id
              )
            );
        }
      }),
      Effect.map((result) => ({
        nodeId: node?.id,
        output: result,
        timestamp: Date.now(),
      }))
    );
  }

  /**
   * Execute parallel nodes
   */
  private executeParallelNode(
    node: FlowNode & { branches?: string[][] | undefined },
    flow: ValidatedFlow,
    stateRef: Ref.Ref<FlowState>
  ): Effect.Effect<NodeResult, ExecutionError> {
    if (!node.branches || !Array.isArray(node?.branches)) {
      return Effect.fail(
        new ExecutionError(
          `Parallel node ${node.id} missing branches`,
          'MISSING_BRANCHES',
          node.id
        )
      );
    }

    if (!flow.json) {
      return Effect.fail(new ExecutionError('Flow JSON is required'));
    }

    const branchEffects = node.branches.map((branch) =>
      Effect.forEach(branch, (nodeId) => {
        const branchNode = flow.json!.nodes.find((n) => n.id === nodeId);
        if (!branchNode) {
          return Effect.fail(
            new ExecutionError(
              `Node not found in branch: ${nodeId}`,
              'BRANCH_NODE_NOT_FOUND',
              nodeId
            )
          );
        }
        return this.executeNodeLogic(branchNode, flow, stateRef);
      })
    );

    return pipe(
      Effect.all(branchEffects, { concurrency: 'unbounded' }),
      Effect.map((results) => ({
        nodeId: node?.id,
        output: { branches: results },
        timestamp: Date.now(),
      }))
    );
  }

  // Helper methods

  /**
   * Execute sequence nodes
   */
  private executeSequenceNode(
    node: FlowNode & { sequence?: string[] | undefined },
    flow: ValidatedFlow,
    stateRef: Ref.Ref<FlowState>
  ): Effect.Effect<NodeResult, ExecutionError> {
    if (!node.sequence || !Array.isArray(node?.sequence)) {
      return Effect.fail(
        new ExecutionError(
          `Sequence node ${node.id} missing sequence`,
          'MISSING_SEQUENCE',
          node.id
        )
      );
    }

    if (!flow.json) {
      return Effect.fail(new ExecutionError('Flow JSON is required'));
    }

    return pipe(
      Effect.forEach(
        node.sequence,
        (nodeId) => {
          const seqNode = flow.json!.nodes.find((n) => n.id === nodeId);
          if (!seqNode) {
            return Effect.fail(
              new ExecutionError(
                `Node not found in sequence: ${nodeId}`,
                'SEQUENCE_NODE_NOT_FOUND',
                nodeId
              )
            );
          }
          return this.executeNodeLogic(seqNode, flow, stateRef);
        },
        { concurrency: 1 } // Sequential execution
      ),
      Effect.map((results) => ({
        nodeId: node?.id,
        output: { sequence: results },
        timestamp: Date.now(),
      }))
    );
  }

  private calculateExecutionOrder(flow: FlowJSON): string[] {
    // Topological sort to determine execution order
    const visited = new Set<string>();
    const order: string[] = [];
    const adjacency = new Map<string, string[]>();

    // Build adjacency list
    flow.edges.forEach((edge) => {
      if (!adjacency.has(edge.from)) {
        adjacency.set(edge.from, []);
      }
      adjacency.get(edge.from)!.push(edge.to);
    });

    // DFS for topological sort
    const visit = (nodeId: string) => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);

      const neighbors = adjacency.get(nodeId) || [];
      neighbors.forEach(visit);

      order.unshift(nodeId); // Add to beginning for correct order
    };

    // Visit all nodes
    flow.nodes.forEach((node) => visit(node.id));

    return order;
  }

  private resolveInputs(node: FlowNode, state: FlowState): unknown {
    // Resolve inputs from state and node configuration
    const inputs: Record<string, any> = {};

    if (node?.inputs) {
      Object.entries(node?.inputs).forEach(([key, value]) => {
        if (typeof value === 'string' && value.startsWith('$')) {
          // Reference to another node's output, possibly with a property path
          const ref = value.slice(1); // Remove the $
          const parts = ref.split('.');
          const refNodeId = parts[0];
          const propertyPath = parts.slice(1);

          const nodeState = (state.nodes ?? new Map<string, unknown>()).get(
            refNodeId || ''
          ) as any;

          if (nodeState && nodeState.result) {
            let resolvedValue = nodeState.result.output;

            // Navigate through the property path
            for (const prop of propertyPath) {
              if (
                resolvedValue &&
                typeof resolvedValue === 'object' &&
                prop in resolvedValue
              ) {
                resolvedValue = resolvedValue[prop];
              } else {
                resolvedValue = undefined;
                break;
              }
            }

            inputs[key] = resolvedValue;
          }
        } else {
          inputs[key] = value;
        }
      });
    }

    return inputs;
  }

  private resolveCollection(
    reference: string | undefined,
    state: FlowState
  ): unknown[] {
    if (!reference) return [];
    if (reference.startsWith('$')) {
      const nodeId = reference.slice(1);
      const nodeState = (state.nodes ?? new Map<string, unknown>()).get(
        nodeId
      ) as any;
      return (nodeState && nodeState.result && nodeState.result.output) || [];
    }
    return [];
  }

  private executeTool(
    tool: Tool,
    inputs: unknown
  ): Effect.Effect<any, ExecutionError> {
    return (tool.execute as any)(inputs, {} as any).pipe(
      Effect.mapError(
        (e: any) =>
          new ExecutionError(
            e?.message ?? 'Tool execution failed',
            'TOOL_EXECUTION_FAILED'
          )
      )
    );
  }

  private evaluateCondition(
    condition: unknown,
    _inputs: unknown,
    _flow: ValidatedFlow
  ): Effect.Effect<boolean, ExecutionError> {
    if (typeof condition !== 'string' || condition.trim() === '') {
      return Effect.succeed(true);
    }
    // Basic evaluator: replace $nodeId[.path] with JSON stringified values from state snapshot at evaluation time.
    // Note: At this level we don't have direct state; conditions on edges are evaluated via shouldExecuteNode.
    return Effect.succeed(true);
  }

  private executeMapOperation(
    collection: unknown[],
    _operation: unknown,
    _flow: ValidatedFlow
  ): Effect.Effect<unknown[], ExecutionError> {
    // Simplified map operation
    // In real implementation, would use model pool for LLM operations
    return Effect.succeed(collection.map((item) => ({ item, mapped: true })));
  }

  private executeFilterOperation(
    collection: unknown[],
    _operation: unknown,
    _flow: ValidatedFlow
  ): Effect.Effect<unknown[], ExecutionError> {
    // Simplified filter operation
    return Effect.succeed(collection.filter((_, i) => i % 2 === 0));
  }

  private executeReduceOperation(
    collection: unknown[],
    _operation: unknown,
    _flow: ValidatedFlow
  ): Effect.Effect<any, ExecutionError> {
    // Simplified reduce operation
    return Effect.succeed({ count: collection?.length, reduced: true });
  }

  // (Dynamic edge conditions are not supported; routing is static-only)

  private collectResults(state: FlowState): unknown {
    const results: Record<string, unknown> = {};
    (state.nodes ?? new Map<string, any>()).forEach(
      (nodeState: any, nodeId: string) => {
        if (nodeState && nodeState.result) {
          results[nodeId] = nodeState.result.output;
        }
      }
    );
    return results;
  }
}

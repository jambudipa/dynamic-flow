/**
 * Stream Executor - Execute flows with streaming event emission
 */

import { Effect, pipe, Ref, Stream } from 'effect';
import type { Tool } from '@/tools/types';
import { LLMService, type LLMRuntime } from '@/llm/service';
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
import type { ExecutionContext } from '@/types/core';

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
                  message: error.message ?? 'Unknown error',
                  code: error.code ?? 'UNKNOWN',
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
    if (flow?.json === null || flow?.json === undefined) {
      return Stream.fail(new ExecutionError('Flow JSON is required'));
    }
    const nodeOrder = this.calculateExecutionOrder(flow.json);

    return Stream.fromIterable(nodeOrder).pipe(
      Stream.flatMap((nodeId) => {
        const node = flow.json?.nodes.find((n) => n.id === nodeId);
        if (node === null || node === undefined) {
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
      nodeId: node?.id ?? '',
      nodeType: node.type,
    });

    const runNonTool = Stream.fromEffect(
      pipe(
        this.executeNodeLogic(node, flow, stateRef),
        Effect.map((result) => ({
          type: 'node-complete' as const,
          timestamp: Date.now(),
          nodeId: node?.id ?? '',
          result,
        })),
        Effect.catchAll((error) =>
          Effect.succeed({
            type: 'node-error' as const,
            timestamp: Date.now(),
            nodeId: node?.id ?? '',
            error: {
              message: error.message ?? 'Node execution failed',
              code: error.code ?? 'NODE_ERROR',
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
                  node?.id ?? '',
                  {
                    status:
                      event.type === 'node-complete' ? 'completed' : 'failed',
                    startTime: Date.now(),
                    endTime: Date.now(),
                    result:
                      event.type === 'node-complete'
                        ? (event as { result?: unknown }).result
                        : undefined,
                    error:
                      event.type === 'node-error'
                        ? (event as { error?: unknown }).error
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
    if (
      node?.toolId === null ||
      node?.toolId === undefined ||
      node.toolId === ''
    ) {
      return Effect.fail(
        new ExecutionError(
          `Tool node ${node.id} missing toolId`,
          'MISSING_TOOL_ID',
          node.id
        )
      );
    }

    const tool = flow.tools.get(node?.toolId ?? '');
    if (tool === null || tool === undefined) {
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
        nodeId: node?.id ?? '',
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
    if (
      node?.toolId === null ||
      node?.toolId === undefined ||
      node.toolId === ''
    ) {
      return Stream.fail(
        new ExecutionError(
          `Tool node ${node.id} missing toolId`,
          'MISSING_TOOL_ID',
          node.id
        )
      );
    }

    const tool = flow.tools.get(node?.toolId ?? '');
    if (tool === null || tool === undefined) {
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
    const ts = (): number => Date.now();

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

        const isLLM =
          typeof (tool as { llmConfig?: unknown }).llmConfig !== 'undefined';
        const hasPrompt =
          typeof (inputs as { prompt?: unknown })?.prompt === 'string';
        const emitIntermediate =
          (node as { config?: { emitIntermediate?: boolean } })?.config
            ?.emitIntermediate !== false;
        const emitTokens =
          (node as { config?: { emitTokens?: boolean } })?.config
            ?.emitTokens !== false;

        if (isLLM && hasPrompt) {
          // Stream tokens and finalize
          let acc = '';
          const raw = Stream.unwrap(
            Effect.map(
              LLMService,
              (svc: {
                stream: (
                  prompt: string
                ) => Stream.Stream<{ content: string }, never>;
              }) => svc.stream((inputs as { prompt: string }).prompt)
            )
          ) as Stream.Stream<{ content: string }, never>;
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
          const context: ExecutionContext = {
            flowId: 'stream-flow',
            stepId: node.id,
            sessionId: 'stream-session',
            variables: {},
            metadata: {},
          };
          const eff = tool
            .execute(inputs as Record<string, unknown>, context)
            .pipe(
              Effect.mapError(
                (e: { message?: string }) =>
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
                      output: output as Record<string, unknown>,
                    },
                    {
                      type: 'node-complete',
                      timestamp: ts(),
                      nodeId,
                      result: {
                        nodeId,
                        output: output as Record<string, unknown>,
                        timestamp: ts(),
                      },
                    },
                  ])
                : Stream.fromIterable<FlowEvent>([
                    {
                      type: 'node-complete',
                      timestamp: ts(),
                      nodeId,
                      result: {
                        nodeId,
                        output: output as Record<string, unknown>,
                        timestamp: ts(),
                      },
                    },
                  ])
            ),
            Stream.catchAll((error: { message?: string }) =>
              Stream.fromIterable<FlowEvent>([
                {
                  type: 'tool-error',
                  timestamp: ts(),
                  nodeId,
                  toolId,
                  error: new Error(error?.message ?? 'Unknown error'),
                },
                {
                  type: 'node-error',
                  timestamp: ts(),
                  nodeId,
                  error: {
                    message:
                      (error as Error).message ?? 'Tool execution failed',
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
      condition?: string | undefined;
      then?: string[] | undefined;
      else?: string[] | undefined;
    },
    flow: ValidatedFlow,
    stateRef: Ref.Ref<FlowState>
  ): Effect.Effect<NodeResult, ExecutionError> {
    if (node?.condition === null || node?.condition === undefined) {
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
        nodeId: node?.id ?? '',
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
    if (node?.operation === null || node?.operation === undefined) {
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
      Effect.flatMap((state): Effect.Effect<NodeResult, ExecutionError> => {
        const collection = this.resolveCollection(node.operation?.over, state);

        // Execute operation based on type
        switch (node?.type) {
          case 'map':
            return pipe(
              this.executeMapOperation(collection, node?.operation ?? {}, flow),
              Effect.map(
                (output): NodeResult => ({
                  nodeId: node.id,
                  output,
                  timestamp: Date.now(),
                })
              )
            );

          case 'filter':
            return pipe(
              this.executeFilterOperation(
                collection,
                node?.operation ?? {},
                flow
              ),
              Effect.map(
                (output): NodeResult => ({
                  nodeId: node.id,
                  output,
                  timestamp: Date.now(),
                })
              )
            );

          case 'reduce':
            return pipe(
              this.executeReduceOperation(
                collection,
                node?.operation ?? {},
                flow
              ),
              Effect.map(
                (output): NodeResult => ({
                  nodeId: node.id,
                  output,
                  timestamp: Date.now(),
                })
              )
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
        nodeId: node?.id ?? '',
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
    if (
      node.branches === null ||
      node.branches === undefined ||
      !Array.isArray(node.branches)
    ) {
      return Effect.fail(
        new ExecutionError(
          `Parallel node ${node.id} missing branches`,
          'MISSING_BRANCHES',
          node.id
        )
      );
    }

    if (flow.json === null || flow.json === undefined) {
      return Effect.fail(new ExecutionError('Flow JSON is required'));
    }

    const flowJson = flow.json;
    const branchEffects = node.branches.map((branch) =>
      Effect.forEach(branch, (nodeId) => {
        const branchNode = flowJson.nodes.find((n) => n.id === nodeId);
        if (branchNode === null || branchNode === undefined) {
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
        nodeId: node?.id ?? '',
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
    if (
      node.sequence === null ||
      node.sequence === undefined ||
      !Array.isArray(node.sequence)
    ) {
      return Effect.fail(
        new ExecutionError(
          `Sequence node ${node.id} missing sequence`,
          'MISSING_SEQUENCE',
          node.id
        )
      );
    }

    if (flow.json === null || flow.json === undefined) {
      return Effect.fail(new ExecutionError('Flow JSON is required'));
    }

    const flowJson = flow.json;
    return pipe(
      Effect.forEach(
        node.sequence,
        (nodeId) => {
          const seqNode = flowJson.nodes.find((n) => n.id === nodeId);
          if (seqNode === null || seqNode === undefined) {
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
        nodeId: node?.id ?? '',
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
      const fromAdjacency = adjacency.get(edge.from);
      if (fromAdjacency !== undefined) {
        fromAdjacency.push(edge.to);
      }
    });

    // DFS for topological sort
    const visit = (nodeId: string): void => {
      if (visited.has(nodeId)) return;
      visited.add(nodeId);

      const neighbors = adjacency.get(nodeId) ?? [];
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

    if (node?.inputs !== null && node?.inputs !== undefined) {
      Object.entries(node.inputs).forEach(([key, value]) => {
        if (typeof value === 'string' && value.startsWith('$')) {
          // Reference to another node's output, possibly with a property path
          const ref = value.slice(1); // Remove the $
          const parts = ref.split('.');
          const refNodeId = parts[0];
          const propertyPath = parts.slice(1);

          const nodeState = (state.nodes ?? new Map<string, unknown>()).get(
            refNodeId ?? ''
          ) as { result?: { output?: unknown } } | undefined;

          if (
            nodeState !== null &&
            nodeState !== undefined &&
            nodeState.result !== null &&
            nodeState.result !== undefined
          ) {
            let resolvedValue = nodeState.result.output;

            // Navigate through the property path
            for (const prop of propertyPath) {
              if (
                resolvedValue !== null &&
                resolvedValue !== undefined &&
                typeof resolvedValue === 'object' &&
                prop in resolvedValue
              ) {
                resolvedValue = (resolvedValue as Record<string, unknown>)[
                  prop
                ];
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
    if (reference === null || reference === undefined || reference === '')
      return [];
    if (reference.startsWith('$')) {
      const nodeId = reference.slice(1);
      const nodeState = (state.nodes ?? new Map<string, unknown>()).get(
        nodeId
      ) as { result?: { output?: unknown[] } } | undefined;
      return nodeState !== null &&
        nodeState !== undefined &&
        nodeState.result !== null &&
        nodeState.result !== undefined &&
        Array.isArray(nodeState.result.output)
        ? nodeState.result.output
        : [];
    }
    return [];
  }

  private executeTool(
    tool: Tool,
    inputs: unknown
  ): Effect.Effect<unknown, ExecutionError> {
    return (
      tool.execute as unknown as (
        inputs: unknown,
        context: Record<string, unknown>
      ) => Effect.Effect<unknown, unknown>
    )(inputs, {} as Record<string, unknown>).pipe(
      Effect.mapError(
        (e: unknown) =>
          new ExecutionError(
            typeof e === 'object' &&
            e !== null &&
            'message' in e &&
            typeof (e as any).message === 'string'
              ? (e as any).message
              : 'Tool execution failed',
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
  ): Effect.Effect<{ count: number; reduced: boolean }, ExecutionError> {
    // Simplified reduce operation
    return Effect.succeed({ count: collection?.length ?? 0, reduced: true });
  }

  // (Dynamic edge conditions are not supported; routing is static-only)

  private collectResults(state: FlowState): unknown {
    const results: Record<string, unknown> = {};
    (state.nodes ?? new Map<string, unknown>()).forEach(
      (nodeState: unknown, nodeId: string) => {
        if (
          nodeState !== null &&
          nodeState !== undefined &&
          typeof nodeState === 'object' &&
          'result' in nodeState
        ) {
          const ns = nodeState as { result?: { output?: unknown } };
          if (ns.result !== null && ns.result !== undefined) {
            results[nodeId] = ns.result.output;
          }
        }
      }
    );
    return results;
  }
}

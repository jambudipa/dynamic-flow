/**
 * FlowService - High-level flow orchestration service
 *
 * Provides the main API for creating, executing, and managing flows
 * with full Effect integration and service coordination.
 */

import {
  Effect,
  Context,
  Layer,
  Duration,
  pipe,
  HashMap,
  Option,
  Chunk,
} from 'effect';
import { FlowExecutionError, FlowCompilationError } from '../errors';
import {
  IRExecutorService,
  type ExecutionResult,
  type SuspendedExecutionResult,
  type IRExecutionOptions,
} from './ir-executor';
import { StateService } from './state';
import {
  PersistenceService,
  type QueryCriteria,
  type CleanupCriteria,
} from './persistence';
import { LoggingService } from './logging';
import { ConfigService } from './config';
import { type SuspensionKey } from './key-generator';
import type { IR } from '../ir';
import { NodeId, ToolId } from '../ir/core-types';
import type { Tool } from '../tools/types';

// ============= Types =============

/**
 * Flow definition
 */
export interface FlowDefinition {
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly version: string;
  readonly ir?: IR;
  readonly tools?: Tool<any, any>[];
  readonly metadata?: Record<string, unknown>;
}

/**
 * Flow execution context
 */
export interface FlowExecutionContext {
  readonly flowId: string;
  readonly sessionId?: string;
  readonly input?: unknown;
  readonly timeout?: Duration.Duration;
  readonly trace?: boolean;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Flow execution status
 */
export type FlowExecutionStatus =
  | 'pending'
  | 'running'
  | 'suspended'
  | 'completed'
  | 'failed'
  | 'cancelled';

/**
 * Flow execution info
 */
export interface FlowExecutionInfo {
  readonly flowId: string;
  readonly sessionId?: string;
  readonly status: FlowExecutionStatus;
  readonly startedAt: Date;
  readonly completedAt?: Date;
  readonly suspendedAt?: Date;
  readonly suspensionKey?: SuspensionKey;
  readonly error?: string;
  readonly metadata: Record<string, unknown>;
}

/**
 * Flow compilation options
 */
export interface FlowCompilationOptions {
  readonly optimise?: boolean;
  readonly validate?: boolean;
  readonly trace?: boolean;
}

/**
 * Flow execution options
 */
export interface FlowExecutionOptions extends IRExecutionOptions {
  readonly persistenceEnabled?: boolean;
  readonly maxDuration?: Duration.Duration;
  readonly retryCount?: number;
}

// ============= FlowService Interface =============

export interface FlowService {
  /**
   * Compile a flow definition to IR
   */
  readonly compile: (
    definition: FlowDefinition,
    options?: FlowCompilationOptions
  ) => Effect.Effect<IR, FlowCompilationError>;

  /**
   * Execute a flow
   */
  readonly execute: (
    flow: FlowDefinition | IR,
    context: FlowExecutionContext,
    options?: FlowExecutionOptions
  ) => Effect.Effect<
    ExecutionResult | SuspendedExecutionResult,
    FlowExecutionError
  >;

  /**
   * Resume a suspended flow
   */
  readonly resume: (
    suspensionKey: SuspensionKey,
    input: unknown,
    options?: FlowExecutionOptions
  ) => Effect.Effect<ExecutionResult, FlowExecutionError>;

  /**
   * Cancel a running or suspended flow
   */
  readonly cancel: (flowId: string) => Effect.Effect<void, FlowExecutionError>;

  /**
   * Get flow execution info
   */
  readonly getExecutionInfo: (
    flowId: string
  ) => Effect.Effect<FlowExecutionInfo | null>;

  /**
   * List suspended flows
   */
  readonly listSuspended: (
    criteria?: QueryCriteria
  ) => Effect.Effect<FlowExecutionInfo[]>;

  /**
   * Cleanup completed/expired flows
   */
  readonly cleanup: (
    criteria?: CleanupCriteria
  ) => Effect.Effect<{ deletedCount: number; errors: string[] }>;

  /**
   * Get flow service statistics
   */
  readonly getStats: () => Effect.Effect<{
    readonly flowsExecuted: number;
    readonly flowsSuspended: number;
    readonly flowsCompleted: number;
    readonly averageExecutionTime: number;
  }>;

  /**
   * Validate a flow definition
   */
  readonly validate: (
    definition: FlowDefinition
  ) => Effect.Effect<{ valid: boolean; errors: string[] }>;
}

// ============= Context Tag =============

export const FlowService = Context.GenericTag<FlowService>('@services/Flow');

// ============= Service Implementation =============

const makeFlowService = (): Effect.Effect<
  FlowService,
  never,
  | LoggingService
  | ConfigService
  | IRExecutorService
  | PersistenceService
  | StateService
> =>
  Effect.gen(function* () {
    const logger = yield* LoggingService;
    const config = yield* ConfigService;
    const executor = yield* IRExecutorService;
    const persistence = yield* PersistenceService;
    const state = yield* StateService;

    // Track execution statistics
    let flowsExecuted = 0;
    let flowsSuspended = 0;
    let flowsCompleted = 0;
    let totalExecutionTime = 0;
    const executionInfoMap = new Map<string, FlowExecutionInfo>();

    const updateExecutionInfo = (
      flowId: string,
      updates: Partial<FlowExecutionInfo>
    ) => {
      const existing = executionInfoMap.get(flowId);
      if (existing) {
        executionInfoMap.set(flowId, { ...existing, ...updates });
      }
    };

    const compileFlowToIR = (
      definition: FlowDefinition,
      options?: FlowCompilationOptions
    ) =>
      Effect.gen(function* () {
        yield* logger.debug('Compiling flow to IR', { flowId: definition.id });

        // If IR is already provided, use it
        if (definition.ir) {
          if (options?.validate) {
            // TODO: Implement IR validation
            yield* logger.debug('Validating provided IR', {
              flowId: definition.id,
            });
          }

          return definition.ir;
        }

        // TODO: Implement actual compilation from flow definition to IR
        // For now, create a basic IR structure
        let ir: IR = {
          version: '1.0.0',
          metadata: {
            source: 'dynamic' as const,
            created: new Date().toISOString(),
            name: Option.fromNullable(definition.name),
            description: Option.fromNullable(definition.description),
            hash: Option.none(),
          },
          graph: {
            nodes: HashMap.empty(),
            edges: Chunk.empty(),
            entryPoint: NodeId('start'),
          },
          registry: {
            tools: HashMap.empty(),
            joins: HashMap.empty(),
          },
        };

        // Add tools to registry if provided
        if (definition.tools && ir.registry) {
          let updatedTools = ir.registry.tools;
          for (const tool of definition.tools) {
            updatedTools = HashMap.set(updatedTools, ToolId(tool.id), tool);
          }
          // Create a new registry with updated tools
          ir = {
            ...ir,
            registry: {
              ...ir.registry,
              tools: updatedTools,
            },
          };
        }

        yield* logger.info('Flow compiled to IR successfully', {
          flowId: definition.id,
          nodeCount: ir.graph?.nodes ? HashMap.size(ir.graph.nodes) : 0,
          toolCount: ir.registry?.tools ? HashMap.size(ir.registry.tools) : 0,
        });

        return ir;
      });

    const validateFlowDefinition = (definition: FlowDefinition) =>
      Effect.gen(function* () {
        const errors: string[] = [];

        // Basic validation
        if (!definition.id || definition.id.trim() === '') {
          errors.push('Flow ID is required');
        }

        if (!definition.name || definition.name.trim() === '') {
          errors.push('Flow name is required');
        }

        if (!definition.version || definition.version.trim() === '') {
          errors.push('Flow version is required');
        }

        // Validate tools if provided
        if (definition.tools) {
          for (const tool of definition.tools) {
            if (!tool.id || tool.id.trim() === '') {
              errors.push(`Tool missing ID: ${tool.name || 'unnamed'}`);
            }
            if (!tool.execute || typeof tool.execute !== 'function') {
              errors.push(`Tool ${tool.id} missing execute function`);
            }
          }
        }

        // Validate IR if provided
        if (definition.ir) {
          if (!definition.ir.version) {
            errors.push('IR version is required');
          }
          if (!definition.ir.graph) {
            errors.push('IR graph is required');
          }
        }

        return {
          valid: errors.length === 0,
          errors,
        };
      });

    return {
      compile: (definition: FlowDefinition, options?: FlowCompilationOptions) =>
        Effect.gen(function* () {
          yield* logger.info('Starting flow compilation', {
            flowId: definition.id,
            options,
          });

          // Validate definition first
          const validation = yield* validateFlowDefinition(definition);
          if (!validation.valid) {
            return yield* Effect.fail(
              new FlowCompilationError({
                path: definition.id,
                source: 'typescript',
                cause: `Flow validation failed: ${validation.errors.join(', ')}`,
              })
            );
          }

          // Compile to IR
          return yield* compileFlowToIR(definition, options).pipe(
            Effect.mapError(
              (error) =>
                new FlowCompilationError({
                  path: definition.id,
                  source: 'typescript',
                  cause: error,
                })
            )
          );
        }),

      execute: (
        flow: FlowDefinition | IR,
        context: FlowExecutionContext,
        options?: FlowExecutionOptions
      ) =>
        Effect.gen(function* () {
          const startTime = Date.now();
          flowsExecuted++;

          yield* logger.info('Starting flow execution', {
            flowId: context.flowId,
            sessionId: context.sessionId,
          });

          // Create execution info
          const executionInfo: FlowExecutionInfo = {
            flowId: context.flowId,
            sessionId: context.sessionId,
            status: 'running',
            startedAt: new Date(),
            metadata: context.metadata || {},
          };
          executionInfoMap.set(context.flowId, executionInfo);

          // Get IR (compile if needed)
          const ir = yield* Effect.gen(function* () {
            if ('version' in flow && 'graph' in flow) {
              // Already compiled IR
              return flow as IR;
            } else {
              // Flow definition - needs compilation
              return yield* compileFlowToIR(flow as FlowDefinition);
            }
          }).pipe(
            Effect.mapError(
              (error) =>
                new FlowExecutionError({
                  nodeId: context.flowId,
                  cause: error,
                })
            )
          );

          // Execute with IR executor
          const result = yield* executor
            .execute(ir, {
              input: context.input,
              flowId: context.flowId,
              sessionId: context.sessionId,
              timeout: options?.timeout
                ? Duration.toMillis(options.timeout)
                : undefined,
              trace: options?.trace || context.trace,
              tools:
                'tools' in flow ? (flow as FlowDefinition).tools : undefined,
            })
            .pipe(
              Effect.mapError(
                (error) =>
                  new FlowExecutionError({
                    nodeId: context.flowId,
                    cause: error,
                  })
              )
            );

          // Update execution info based on result
          const endTime = Date.now();
          const duration = endTime - startTime;
          totalExecutionTime += duration;

          if ('suspended' in result && result.suspended) {
            // Flow was suspended
            flowsSuspended++;
            updateExecutionInfo(context.flowId, {
              status: 'suspended',
              suspendedAt: new Date(),
              suspensionKey: result.suspensionKey as SuspensionKey,
            });

            yield* logger.info('Flow execution suspended', {
              flowId: context.flowId,
              suspensionKey: result.suspensionKey,
              duration,
            });
          } else {
            // Flow completed
            flowsCompleted++;
            updateExecutionInfo(context.flowId, {
              status: 'completed',
              completedAt: new Date(),
            });

            yield* logger.info('Flow execution completed', {
              flowId: context.flowId,
              duration,
            });
          }

          return result;
        }),

      resume: (
        suspensionKey: SuspensionKey,
        input: unknown,
        options?: FlowExecutionOptions
      ) =>
        Effect.gen(function* () {
          yield* logger.info('Resuming suspended flow', { suspensionKey });

          const result = yield* executor
            .resumeExecution(suspensionKey, input)
            .pipe(
              Effect.mapError(
                (error) =>
                  new FlowExecutionError({
                    nodeId: suspensionKey,
                    cause: error,
                  })
              )
            );

          flowsCompleted++;
          yield* logger.info('Flow resumed and completed', { suspensionKey });

          return result;
        }),

      cancel: (flowId: string) =>
        Effect.gen(function* () {
          yield* logger.info('Cancelling flow', { flowId });

          // Update execution info
          updateExecutionInfo(flowId, {
            status: 'cancelled',
            completedAt: new Date(),
          });

          // If the flow is suspended, cancel the suspension
          const info = executionInfoMap.get(flowId);
          if (info?.suspensionKey) {
            yield* persistence.cancel(info.suspensionKey).pipe(
              Effect.catchAll((error) =>
                logger.warn('Failed to cancel suspension', {
                  error: String(error),
                })
              )
            );
          }

          yield* logger.info('Flow cancelled', { flowId });
        }),

      getExecutionInfo: (flowId: string) =>
        Effect.gen(function* () {
          return executionInfoMap.get(flowId) || null;
        }),

      listSuspended: (criteria?: QueryCriteria) =>
        Effect.gen(function* () {
          const suspendedFlows = yield* pipe(
            persistence.query(criteria),
            Effect.orElse(() => Effect.succeed([]))
          );

          return suspendedFlows.map((flow: any) => ({
            flowId: (flow.metadata.flowId as string) || 'unknown',
            sessionId: flow.metadata.sessionId as string,
            status: 'suspended' as const,
            startedAt: flow.createdAt,
            suspendedAt: flow.createdAt,
            suspensionKey: flow.key,
            metadata: flow.metadata,
          }));
        }),

      cleanup: (criteria?: CleanupCriteria) =>
        Effect.gen(function* () {
          yield* logger.info('Starting flow cleanup', { criteria });

          const result = yield* pipe(
            persistence.cleanup(criteria),
            Effect.orElse(() => Effect.succeed({ deletedCount: 0, errors: [] }))
          );

          // Clean up execution info for deleted flows
          for (const error of result.errors) {
            const info = Array.from(executionInfoMap.values()).find(
              (info) => info.suspensionKey === error.key
            );
            if (info) {
              executionInfoMap.delete(info.flowId);
            }
          }

          yield* logger.info('Flow cleanup completed', {
            deletedCount: result.deletedCount,
            errorCount: result.errors.length,
          });

          return {
            deletedCount: result.deletedCount,
            errors: result.errors.map((e) => e.error),
          };
        }),

      getStats: () =>
        Effect.gen(function* () {
          return {
            flowsExecuted,
            flowsSuspended,
            flowsCompleted,
            averageExecutionTime:
              flowsExecuted > 0 ? totalExecutionTime / flowsExecuted : 0,
          };
        }),

      validate: validateFlowDefinition,
    };
  });

// ============= Layer Implementation =============

/**
 * Live implementation of FlowService
 */
export const FlowServiceLive = Layer.effect(FlowService, makeFlowService());

/**
 * Test implementation for testing
 */
export const FlowServiceTest = Layer.effect(FlowService, makeFlowService());

// ============= Helper Functions =============

/**
 * Execute a flow with the current flow service
 */
export const executeFlow = (
  flow: FlowDefinition | IR,
  context: FlowExecutionContext,
  options?: FlowExecutionOptions
) =>
  Effect.gen(function* () {
    const flowService = yield* FlowService;
    return yield* flowService.execute(flow, context, options);
  });

/**
 * Resume a suspended flow
 */
export const resumeSuspendedFlow = (
  suspensionKey: SuspensionKey,
  input: unknown,
  options?: FlowExecutionOptions
) =>
  Effect.gen(function* () {
    const flowService = yield* FlowService;
    return yield* flowService.resume(suspensionKey, input, options);
  });

/**
 * Cancel a flow
 */
export const cancelFlow = (flowId: string) =>
  Effect.gen(function* () {
    const flowService = yield* FlowService;
    return yield* flowService.cancel(flowId);
  });

/**
 * Get flow execution information
 */
export const getFlowExecutionInfo = (flowId: string) =>
  Effect.gen(function* () {
    const flowService = yield* FlowService;
    return yield* flowService.getExecutionInfo(flowId);
  });

/**
 * List all suspended flows
 */
export const listSuspendedFlows = (criteria?: QueryCriteria) =>
  Effect.gen(function* () {
    const flowService = yield* FlowService;
    return yield* flowService.listSuspended(criteria);
  });

/**
 * Cleanup flows
 */
export const cleanupFlows = (criteria?: CleanupCriteria) =>
  Effect.gen(function* () {
    const flowService = yield* FlowService;
    return yield* flowService.cleanup(criteria);
  });

/**
 * Get flow service statistics
 */
export const getFlowStats = () =>
  Effect.gen(function* () {
    const flowService = yield* FlowService;
    return yield* flowService.getStats();
  });

/**
 * Validate a flow definition
 */
export const validateFlow = (definition: FlowDefinition) =>
  Effect.gen(function* () {
    const flowService = yield* FlowService;
    return yield* flowService.validate(definition);
  });

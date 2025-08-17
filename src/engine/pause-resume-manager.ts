/**
 * Pause/Resume Manager
 *
 * Manages flow pause and resume functionality with state _serialization,
 * persistence, and timeout handling.
 */

import { Chunk, Duration, Effect, Fiber, Option, Queue, Ref, Schema } from 'effect';
import type { FlowEffect } from '@/types';
import { FlowError, mapToFlowError } from '@/types/errors';

/**
 * Pausable flow state
 */
export interface PausableFlowState {
  id: string;
  flowName: string;
  isPaused: boolean;
  pausedAt?: Date | undefined;
  resumedAt?: Date | undefined;
  pauseReason?: string | undefined;
  currentStep: string;
  executionStack: ExecutionFrame[];
  variables: Record<string, unknown>;
  metadata: Record<string, unknown>;
  timeout?: Duration.Duration | undefined;
  expiresAt?: Date | undefined;
}

/**
 * Execution frame for stack tracking
 */
export interface ExecutionFrame {
  id: string;
  type: 'tool' | 'flow' | 'control';
  name: string;
  input: unknown;
  output?: unknown | undefined;
  status: 'pending' | 'running' | 'paused' | 'completed' | 'failed';
  startedAt: Date;
  completedAt?: Date | undefined;
}

/**
 * Serialized flow state for persistence
 */
export const SerializedFlowState = Schema.Struct({
  id: Schema.String,
  flowName: Schema.String,
  isPaused: Schema.Boolean,
  pausedAt: Schema.optional(Schema.Date),
  resumedAt: Schema.optional(Schema.Date),
  pauseReason: Schema.optional(Schema.String),
  currentStep: Schema.String,
  executionStack: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      type: Schema.Literal('tool', 'flow', 'control'),
      name: Schema.String,
      input: Schema.Unknown,
      output: Schema.optional(Schema.Unknown),
      status: Schema.Literal(
        'pending',
        'running',
        'paused',
        'completed',
        'failed'
      ),
      startedAt: Schema.Date,
      completedAt: Schema.optional(Schema.Date),
    })
  ),
  variables: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  metadata: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
  expiresAt: Schema.optional(Schema.Date),
});

// Encoded type alias intentionally omitted to avoid unused type warnings

/**
 * Pause point definition
 */
export interface PausePoint {
  id: string;
  condition?: (state: PausableFlowState) => boolean;
  timeout?: Duration.Duration | undefined;
  allowResume: boolean;
  requiresUserInput?: boolean | undefined;
}

/**
 * Resume context with restored state
 */
export interface ResumeContext {
  state: PausableFlowState;
  userInput?: unknown | undefined;
  skipToStep?: string | undefined;
  modifiedVariables?: Record<string, unknown> | undefined;
}

/**
 * Pause/Resume Manager implementation
 */
export class PauseResumeManager {
  private pausedFlows: Map<string, Ref.Ref<PausableFlowState>> = new Map();
  private pausePoints: Map<string, PausePoint> = new Map();
  private resumeQueue: Queue.Queue<ResumeContext>;
  private persistenceAdapter: PersistenceAdapter | null = null;
  // Some timeout handlers may fail when persistence adapters fail; capture FlowError in fiber error channel
  private timeoutFibers: Map<string, Fiber.RuntimeFiber<void, FlowError>> =
    new Map();

  constructor(persistenceAdapter?: PersistenceAdapter | undefined) {
    this.resumeQueue = Effect.runSync(Queue.unbounded<ResumeContext>());
    this.persistenceAdapter = persistenceAdapter || null;
  }

  /**
   * Register a pause point in the flow
   */
  registerPausePoint(point: PausePoint): void {
    this.pausePoints.set(point.id, point);
  }

  /**
   * Pause a flow at the current execution point
   */
  pauseFlow(
    flowId: string,
    state: Omit<PausableFlowState, 'id' | 'isPaused' | 'pausedAt'>,
    reason?: string | undefined
  ): Effect.Effect<void, FlowError, never> {
    const self = this;
    return Effect.gen(function* () {
      const pausedState: PausableFlowState = {
        ...state,
        id: flowId,
        isPaused: true,
        pausedAt: new Date(),
        pauseReason: reason,
      };

      // Calculate expiration if timeout is set
      if (state.timeout) {
        const expiresAt = new Date();
        expiresAt.setTime(
          expiresAt.getTime() + Duration.toMillis(state.timeout)
        );
        pausedState.expiresAt = expiresAt;
      }

      const stateRef = yield* Ref.make(pausedState);
      self.pausedFlows.set(flowId, stateRef);

      // Persist state if adapter is available
      if (self.persistenceAdapter) {
        yield* self.persistState(pausedState);
      }

      // Set up timeout if specified
      if (state.timeout) {
        yield* self.setupTimeout(flowId, state.timeout);
      }

      // Log pause event
      yield* Effect.log(
        `Flow ${flowId} paused: ${reason || 'No reason specified'}`
      );
    });
  }

  /**
   * Resume a paused flow
   */
  resumeFlow(
    flowId: string,
    userInput?: unknown | undefined,
    modifiedVariables?: Record<string, unknown> | undefined
  ): Effect.Effect<PausableFlowState, FlowError, never> {
    const self = this;
    return mapToFlowError(
      Effect.gen(function* () {
        const stateRef = self.pausedFlows.get(flowId);
        if (!stateRef) {
          return yield* Effect.fail(
            new FlowError(`Flow ${flowId} is not paused or not found`)
          );
        }

        const state = yield* Ref.get(stateRef);

        // Check if flow can be resumed
        const pausePoint = self.pausePoints.get(state.currentStep);
        if (pausePoint && !pausePoint.allowResume) {
          return yield* Effect.fail(
            new FlowError(
              `Flow ${flowId} cannot be resumed at current pause point`
            )
          );
        }

        // Check if user input is required
        if (pausePoint?.requiresUserInput && !userInput) {
          return yield* Effect.fail(
            new FlowError(`Flow ${flowId} requires user input to resume`)
          );
        }

        // Update state
        const resumedState = yield* Ref.updateAndGet(stateRef, (s) => ({
          ...s,
          isPaused: false,
          resumedAt: new Date(),
          variables: modifiedVariables
            ? { ...s.variables, ...modifiedVariables }
            : s.variables,
        }));

        // Cancel timeout if exists
        const timeoutFiber = self.timeoutFibers.get(flowId);
        if (timeoutFiber) {
          yield* Fiber.interrupt(timeoutFiber);
          self.timeoutFibers.delete(flowId);
        }

        // Add to resume queue
        const resumeContext: ResumeContext = {
          state: resumedState,
          userInput,
          modifiedVariables,
        };
        yield* Queue.offer(self.resumeQueue, resumeContext);

        // Remove from paused flows
        self.pausedFlows.delete(flowId);

        // Remove persisted state
        if (self.persistenceAdapter) {
          yield* self.removePersisted(flowId);
        }

        yield* Effect.log(`Flow ${flowId} resumed`);

        return resumedState;
      })
    );
  }

  /**
   * Get paused flow state
   */
  getPausedFlow(
    flowId: string
  ): Effect.Effect<Option.Option<PausableFlowState>, never, never> {
    const stateRef = this.pausedFlows.get(flowId);
    if (!stateRef) {
      return Effect.succeed(Option.none());
    }
    return Effect.map(Ref.get(stateRef), Option.some);
  }

  /**
   * List all paused flows
   */
  listPausedFlows(): Effect.Effect<PausableFlowState[], never, never> {
    return Effect.all(
      Array.from(this.pausedFlows.values()).map((ref) => Ref.get(ref))
    );
  }

  /**
   * Check if flow should pause at current point
   */
  shouldPause(
    _flowId: string,
    currentStep: string,
    state: PausableFlowState
  ): boolean {
    const pausePoint = this.pausePoints.get(currentStep);
    if (!pausePoint) return false;

    // Check pause condition if defined
    if (pausePoint.condition) {
      return pausePoint.condition(state);
    }

    // Default to pausing if point is registered
    return true;
  }

  /**
   * Wait for resume signal
   */
  waitForResume(flowId: string): FlowEffect<ResumeContext, FlowError, never> {
    const self = this;
    return Effect.gen(function* () {
      // Check if already resumed
      const context = yield* Queue.takeAll(self.resumeQueue);
      const resumeContext = Chunk.findFirst(
        context,
        (c): c is ResumeContext => c.state.id === flowId
      );

      if (Option.isSome(resumeContext)) {
        return resumeContext.value;
      }

      // Wait for resume
      while (true) {
        const ctx = yield* Queue.take(self.resumeQueue);
        if (ctx.state.id === flowId) {
          return ctx;
        }
        // Put back if not for this flow
        yield* Queue.offer(self.resumeQueue, ctx);
        yield* Effect.sleep(Duration.millis(100));
      }
    });
  }

  /**
   * Load persisted flow states
   */
  loadPersistedFlows(): Effect.Effect<PausableFlowState[], FlowError, never> {
    if (!this.persistenceAdapter) {
      return Effect.succeed([]);
    }

    const self = this;
    return mapToFlowError(
      Effect.gen(function* () {
        const ids = yield* self.persistenceAdapter!.listIds();
        const states: PausableFlowState[] = [];

        for (const id of ids) {
          const serialized = yield* self.persistenceAdapter!.load(id);
          if (serialized) {
            const state = yield* Schema.decodeUnknown(SerializedFlowState)(
              serialized
            ).pipe(
              Effect.orDie,
              Effect.mapError(
                (error) =>
                  new FlowError(`Failed to deserialize flow state: ${error}`)
              )
            );

            // Check if expired
            if (!state.expiresAt || state.expiresAt > new Date()) {
              states.push(state as unknown as PausableFlowState);
              const stateRef = yield* Ref.make(
                state as unknown as PausableFlowState
              );
              self.pausedFlows.set(id, stateRef);
            } else {
              // Remove expired state
              yield* self.persistenceAdapter!.remove(id);
            }
          }
        }

        return states;
      })
    );
  }

  /**
   * Cleanup manager resources
   */
  cleanup(): Effect.Effect<void, never, never> {
    const self = this;
    return Effect.gen(function* () {
      // Interrupt all timeout fibers
      for (const fiber of self.timeoutFibers.values()) {
        yield* Fiber.interrupt(fiber);
      }

      self.pausedFlows.clear();
      self.pausePoints.clear();
      self.timeoutFibers.clear();
    });
  }

  /**
   * Persist flow state
   */
  private persistState(
    state: PausableFlowState
  ): Effect.Effect<void, FlowError, never> {
    if (!this.persistenceAdapter) {
      return Effect.void;
    }

    const self = this;
    return mapToFlowError(
      Effect.gen(function* () {
        const serialized = yield* Schema.encode(SerializedFlowState)(
          state as Schema.Schema.Type<typeof SerializedFlowState>
        ).pipe(
          Effect.orDie,
          Effect.mapError(
            (error) => new FlowError(`Failed to serialize flow state: ${error}`)
          )
        );

        yield* self.persistenceAdapter!.save(
          state.id,
          serialized as Record<string, unknown>
        );
      })
    );
  }

  /**
   * Remove persisted state
   */
  private removePersisted(
    flowId: string
  ): Effect.Effect<void, FlowError, never> {
    if (!this.persistenceAdapter) {
      return Effect.void;
    }
    return this.persistenceAdapter.remove(flowId);
  }

  /**
   * Set up timeout for paused flow
   */
  private setupTimeout(
    flowId: string,
    timeout: Duration.Duration
  ): Effect.Effect<void, never, never> {
    const self = this;
    return Effect.gen(function* () {
      const fiber = yield* Effect.fork(
        Effect.gen(function* () {
          yield* Effect.sleep(timeout);

          // Timeout expired - handle expiration
          const stateRef = self.pausedFlows.get(flowId);
          if (stateRef) {
            yield* Ref.update(stateRef, (s) => ({
              ...s,
              isPaused: false,
              pauseReason: 'Timeout expired',
            }));

            self.pausedFlows.delete(flowId);

            if (self.persistenceAdapter) {
              yield* self.removePersisted(flowId);
            }

            yield* Effect.log(`Flow ${flowId} pause timeout expired`);
          }
        })
      );

      self.timeoutFibers.set(flowId, fiber);
    });
  }
}

/**
 * Persistence adapter interface
 */
export interface PersistenceAdapter {
  save(
    id: string,
    state: Record<string, unknown>
  ): Effect.Effect<void, FlowError, never>;

  load(
    id: string
  ): Effect.Effect<Record<string, unknown> | null, FlowError, never>;

  remove(id: string): Effect.Effect<void, FlowError, never>;

  listIds(): Effect.Effect<string[], FlowError, never>;
}

/**
 * In-memory persistence adapter for testing
 */
export class InMemoryPersistenceAdapter implements PersistenceAdapter {
  private storage = new Map<string, Record<string, unknown>>();

  save(
    id: string,
    state: Record<string, unknown>
  ): Effect.Effect<void, FlowError, never> {
    return Effect.sync(() => {
      this.storage.set(id, state);
    });
  }

  load(
    id: string
  ): Effect.Effect<Record<string, unknown> | null, FlowError, never> {
    return Effect.sync(() => {
      return this.storage.get(id) || null;
    });
  }

  remove(id: string): Effect.Effect<void, FlowError, never> {
    return Effect.sync(() => {
      this.storage.delete(id);
    });
  }

  listIds(): Effect.Effect<string[], FlowError, never> {
    return Effect.sync(() => {
      return Array.from(this.storage.keys());
    });
  }
}

/**
 * Global pause/resume manager instance
 */
let globalManager: PauseResumeManager | null = null;

/**
 * Get or create the global pause/resume manager
 */
export function getPauseResumeManager(
  adapter?: PersistenceAdapter | undefined
): PauseResumeManager {
  if (!globalManager) {
    globalManager = new PauseResumeManager(adapter);
  }
  return globalManager;
}

/**
 * Reset the global pause/resume manager
 */
export function resetPauseResumeManager(): Effect.Effect<void, never, never> {
  if (globalManager) {
    const cleanup = globalManager.cleanup();
    globalManager = null;
    return cleanup;
  }
  return Effect.void;
}

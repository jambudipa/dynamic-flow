import { Effect, Ref, HashMap, Option } from 'effect';
import { ExecutionError, StateError } from '../../errors';
import { PersistenceService } from '../persistence/service';

/**
 * Execution checkpoint
 */
export interface ExecutionCheckpoint {
  id: string;
  flowId: string;
  nodeId: string;
  timestamp: Date;
  state: Record<string, any>;
  metadata?: Record<string, any>;
}

/**
 * Pause/Resume state
 */
export interface PauseState {
  flowId: string;
  pausedAt: Date;
  checkpoint: ExecutionCheckpoint;
  reason?: string;
}

/**
 * Resume options
 */
export interface ResumeOptions {
  skipToNode?: string;
  overrideState?: Record<string, any>;
  continueOnError?: boolean;
}

/**
 * Pause Resume Service
 * Manages flow execution pause, resume, and checkpointing
 */
export class PauseResumeService extends Effect.Service<PauseResumeService>()(
  'PauseResumeService',
  {
    effect: Effect.gen(function* () {
      const persistence = yield* PersistenceService;

      // In-memory pause states
      const pausedFlows = yield* Ref.make<HashMap.HashMap<string, PauseState>>(
        HashMap.empty()
      );
      const checkpoints = yield* Ref.make<
        HashMap.HashMap<string, ExecutionCheckpoint[]>
      >(HashMap.empty());

      return {
        /**
         * Pause flow execution
         */
        pause: (
          flowId: string,
          nodeId: string,
          state: Record<string, any>,
          reason?: string
        ) =>
          Effect.gen(function* () {
            // Create checkpoint
            const checkpoint: ExecutionCheckpoint = {
              id: `checkpoint-${Date.now()}`,
              flowId,
              nodeId,
              timestamp: new Date(),
              state,
              metadata: { reason },
            };

            // Save checkpoint
            yield* saveCheckpoint(checkpoint);

            // Create pause state
            const pauseState: PauseState = {
              flowId,
              pausedAt: new Date(),
              checkpoint,
              reason,
            };

            // Store pause state
            yield* Ref.update(pausedFlows, HashMap.set(flowId, pauseState));

            // Persist pause state
            yield* persistence.save(`pause-${flowId}`, pauseState);

            return checkpoint.id;
          }),

        /**
         * Resume flow execution
         */
        resume: (flowId: string, options?: ResumeOptions) =>
          Effect.gen(function* () {
            // Get pause state
            const currentPaused = yield* Ref.get(pausedFlows);
            const pauseState = HashMap.get(currentPaused, flowId);

            if (Option.isNone(pauseState)) {
              // Try to load from persistence
              const persistedState = yield* persistence
                .load(`pause-${flowId}`)
                .pipe(
                  Effect.mapError(
                    () =>
                      new StateError({
                        message: `No paused state found for flow ${flowId}`,
                        operation: 'pause-resume',
                      })
                  )
                );

              if (!persistedState) {
                return yield* Effect.fail(
                  new StateError({
                    message: `Flow ${flowId} is not paused`,
                    operation: 'pause-resume',
                  })
                );
              }

              return {
                checkpoint: (persistedState as any).checkpoint,
                state:
                  options?.overrideState ||
                  (persistedState as any).checkpoint.state,
                resumeFrom:
                  options?.skipToNode ||
                  (persistedState as any).checkpoint.nodeId,
              };
            }

            const state = pauseState.value;

            // Remove from paused flows
            yield* Ref.update(pausedFlows, HashMap.remove(flowId));

            // Delete persisted pause state
            yield* persistence.delete(`pause-${flowId}`);

            return {
              checkpoint: state.checkpoint,
              state: options?.overrideState || state.checkpoint.state,
              resumeFrom: options?.skipToNode || state.checkpoint.nodeId,
            };
          }),

        /**
         * Create a checkpoint
         */
        checkpoint: (
          flowId: string,
          nodeId: string,
          state: Record<string, any>
        ) =>
          Effect.gen(function* () {
            const checkpoint: ExecutionCheckpoint = {
              id: `checkpoint-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
              flowId,
              nodeId,
              timestamp: new Date(),
              state,
              metadata: {},
            };

            yield* saveCheckpoint(checkpoint);

            return checkpoint.id;
          }),

        /**
         * List checkpoints for a flow
         */
        listCheckpoints: (flowId: string) =>
          Effect.gen(function* () {
            const allCheckpoints = yield* Ref.get(checkpoints);
            const flowCheckpoints = HashMap.get(allCheckpoints, flowId);

            if (Option.isNone(flowCheckpoints)) {
              // Try to load from persistence
              const persisted = yield* persistence
                .load(`checkpoints-${flowId}`)
                .pipe(Effect.orElse(() => Effect.succeed([])));

              return persisted || [];
            }

            return flowCheckpoints.value;
          }),

        /**
         * Get a specific checkpoint
         */
        getCheckpoint: (checkpointId: string) =>
          Effect.gen(function* () {
            const allCheckpoints = yield* Ref.get(checkpoints);

            // Search all flows for the checkpoint
            for (const [_, flowCheckpoints] of allCheckpoints) {
              const checkpoint = flowCheckpoints.find(
                (cp) => cp.id === checkpointId
              );
              if (checkpoint) {
                return checkpoint;
              }
            }

            // Try to load from persistence
            const persisted = yield* persistence
              .load(`checkpoint-${checkpointId}`)
              .pipe(
                Effect.mapError(
                  () =>
                    new StateError({
                      message: `Checkpoint ${checkpointId} not found`,
                      operation: 'checkpoint',
                    })
                )
              );

            return persisted;
          }),

        /**
         * Restore from checkpoint
         */
        restoreFromCheckpoint: (checkpointId: string) =>
          Effect.gen(function* () {
            const checkpoint = yield* Effect.gen(function* () {
              // Try memory first
              const allCheckpoints = yield* Ref.get(checkpoints);
              for (const [, flowCps] of allCheckpoints) {
                const found = flowCps.find((cp) => cp.id === checkpointId);
                if (found) return found;
              }

              // Try persistence
              const persisted = yield* persistence
                .load(`checkpoint-${checkpointId}`)
                .pipe(
                  Effect.mapError(
                    () =>
                      new StateError({
                        message: `Checkpoint ${checkpointId} not found`,
                        operation: 'checkpoint',
                      })
                  )
                );

              return persisted;
            });

            return {
              flowId: (checkpoint as any).flowId,
              nodeId: (checkpoint as any).nodeId,
              state: (checkpoint as any).state,
              metadata: (checkpoint as any).metadata,
            };
          }),

        /**
         * Delete checkpoint
         */
        deleteCheckpoint: (checkpointId: string) =>
          Effect.gen(function* () {
            // Remove from memory
            yield* Ref.update(checkpoints, (allCps) => {
              const updated = HashMap.empty<string, ExecutionCheckpoint[]>();

              for (const [flowId, flowCps] of allCps) {
                const filtered = flowCps.filter((cp) => cp.id !== checkpointId);
                if (filtered.length > 0) {
                  HashMap.set(flowId, filtered)(updated);
                }
              }

              return updated;
            });

            // Delete from persistence
            yield* persistence.delete(`checkpoint-${checkpointId}`);
          }),

        /**
         * Clean old checkpoints
         */
        cleanOldCheckpoints: (olderThan: Date) =>
          Effect.gen(function* () {
            const cutoffTime = olderThan.getTime();
            let deletedCount = 0;

            yield* Ref.update(checkpoints, (allCps) => {
              const updated = HashMap.empty<string, ExecutionCheckpoint[]>();

              for (const [flowId, flowCps] of allCps) {
                const filtered = flowCps.filter((cp) => {
                  if (cp.timestamp.getTime() < cutoffTime) {
                    deletedCount++;
                    // Also delete from persistence
                    Effect.runSync(persistence.delete(`checkpoint-${cp.id}`));
                    return false;
                  }
                  return true;
                });

                if (filtered.length > 0) {
                  HashMap.set(flowId, filtered)(updated);
                }
              }

              return updated;
            });

            return deletedCount;
          }),

        /**
         * Check if flow is paused
         */
        isPaused: (flowId: string) =>
          Effect.gen(function* () {
            const paused = yield* Ref.get(pausedFlows);
            return HashMap.has(paused, flowId);
          }),

        /**
         * Get pause state
         */
        getPauseState: (flowId: string) =>
          Effect.gen(function* () {
            const paused = yield* Ref.get(pausedFlows);
            const state = HashMap.get(paused, flowId);

            if (Option.isNone(state)) {
              // Try persistence
              return yield* persistence
                .load(`pause-${flowId}`)
                .pipe(Effect.orElse(() => Effect.succeed(null)));
            }

            return state.value;
          }),

        /**
         * List all paused flows
         */
        listPausedFlows: () =>
          Effect.gen(function* () {
            const paused = yield* Ref.get(pausedFlows);
            return Array.from(HashMap.keys(paused));
          }),
      };

      // Helper to save checkpoint
      function saveCheckpoint(checkpoint: ExecutionCheckpoint) {
        return Effect.gen(function* () {
          // Add to memory
          yield* Ref.update(checkpoints, (allCps) => {
            const flowCps = HashMap.get(allCps, checkpoint.flowId);

            if (Option.isNone(flowCps)) {
              return HashMap.set(checkpoint.flowId, [checkpoint])(allCps);
            }

            const updated = [...flowCps.value, checkpoint];
            return HashMap.set(checkpoint.flowId, updated)(allCps);
          });

          // Persist
          yield* persistence.save(`checkpoint-${checkpoint.id}`, checkpoint);

          // Update flow's checkpoint list
          const allCheckpoints = yield* Ref.get(checkpoints);
          const flowCheckpoints = Option.getOrElse(
            HashMap.get(allCheckpoints, checkpoint.flowId),
            () => [] as ExecutionCheckpoint[]
          );
          yield* persistence.save(
            `checkpoints-${checkpoint.flowId}`,
            flowCheckpoints
          );
        });
      }
    }),
  }
) {}

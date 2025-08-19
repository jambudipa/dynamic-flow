import {
  Effect,
  Ref,
  Option,
  Duration,
  FiberRef,
  HashMap,
  Layer,
} from 'effect';
import { v4 as uuidv4 } from 'uuid';
import { ExecutionError } from '../../errors';
import type {
  VariableScope,
  WorkerPool,
  PauseResumeManager,
  FlowControlManager,
} from '../../core/context/execution-context';

/**
 * Worker statistics
 */
export interface WorkerStats {
  readonly available: number;
  readonly total: number;
  readonly queued: number;
}

/**
 * Execution Context Service - Consolidated context management
 * Uses Effect.Service for single implementation pattern
 */
export class ExecutionContextService extends Effect.Service<ExecutionContextService>()(
  'ExecutionContextService',
  {
    effect: Effect.gen(function* () {
      // Core state
      const variables = yield* Ref.make<HashMap.HashMap<string, unknown>>(
        HashMap.empty()
      );
      const metadata = yield* Ref.make<HashMap.HashMap<string, unknown>>(
        HashMap.empty()
      );
      const flowId = yield* Ref.make<string>('default-flow');
      const stepId = yield* Ref.make<string>('default-step');
      const sessionId = yield* Ref.make<string>(uuidv4());

      // Variable scope management (hierarchical)
      const parentScopes = yield* Ref.make<
        Array<HashMap.HashMap<string, unknown>>
      >([]);

      // Worker pool state
      const maxWorkers = yield* Ref.make(4);
      const activeWorkers = yield* Ref.make(0);
      const taskQueue = yield* Ref.make<Array<() => void>>([]);

      // Flow control state
      const shouldBreak = yield* Ref.make(false);
      const shouldContinue = yield* Ref.make(false);
      const isParallel = yield* Ref.make(false);
      const contextStack = yield* Ref.make<boolean[]>([]);

      // Pause/resume state
      const pauseState = yield* Ref.make<
        Option.Option<{
          prompt: string;
          resolver: (value: unknown) => void;
        }>
      >(Option.none());

      return {
        // ===== Variable Scope Operations =====

        /**
         * Get a variable value
         */
        getVariable: (name: string) =>
          Effect.gen(function* () {
            const vars = yield* Ref.get(variables);
            const value = HashMap.get(vars, name);

            if (Option.isNone(value)) {
              // Check parent scopes
              const parents = yield* Ref.get(parentScopes);
              for (const parentScope of parents.reverse()) {
                const parentValue = HashMap.get(parentScope, name);
                if (Option.isSome(parentValue)) {
                  return parentValue.value;
                }
              }

              return yield* Effect.fail(
                new ExecutionError({
                  message: `Variable '${name}' not found`,
                  phase: 'execution',
                })
              );
            }

            return value.value;
          }),

        /**
         * Set a variable value
         */
        setVariable: (name: string, value: unknown) =>
          Effect.gen(function* () {
            yield* Ref.update(variables, HashMap.set(name, value));
          }),

        /**
         * Check if variable exists
         */
        hasVariable: (name: string) =>
          Effect.gen(function* () {
            const vars = yield* Ref.get(variables);
            if (HashMap.has(vars, name)) return true;

            const parents = yield* Ref.get(parentScopes);
            for (const parentScope of parents) {
              if (HashMap.has(parentScope, name)) return true;
            }

            return false;
          }),

        /**
         * Delete a variable
         */
        deleteVariable: (name: string) =>
          Effect.gen(function* () {
            yield* Ref.update(variables, HashMap.remove(name));
          }),

        /**
         * List all variable names
         */
        listVariables: () =>
          Effect.gen(function* () {
            const vars = yield* Ref.get(variables);
            const keys = new Set(Array.from(HashMap.keys(vars)));

            const parents = yield* Ref.get(parentScopes);
            for (const parentScope of parents) {
              for (const key of HashMap.keys(parentScope)) {
                keys.add(key);
              }
            }

            return Array.from(keys);
          }),

        /**
         * Clear all variables at current level
         */
        clearVariables: () =>
          Effect.gen(function* () {
            yield* Ref.set(variables, HashMap.empty());
          }),

        // ===== Worker Pool Operations =====

        /**
         * Submit a task to the worker pool
         */
        submitTask: <T>(task: () => Promise<T>) =>
          Effect.gen(function* () {
            const max = yield* Ref.get(maxWorkers);
            const active = yield* Ref.get(activeWorkers);

            // Wait if at capacity
            if (active >= max) {
              yield* Effect.async<void>((resume) => {
                Ref.update(taskQueue, (queue) => [
                  ...queue,
                  () => resume(Effect.void),
                ]).pipe(Effect.runSync);
              });
            }

            // Increment active workers
            yield* Ref.update(activeWorkers, (n) => n + 1);

            // Use Effect.acquireUseRelease for proper resource management
            return yield* Effect.acquireUseRelease(
              // Acquire: increment worker count
              Effect.succeed(undefined),
              // Use: execute the task
              () =>
                Effect.tryPromise({
                  try: task,
                  catch: (error) =>
                    new ExecutionError({
                      message: `Task execution failed: ${error}`,
                      phase: 'execution',
                    }),
                }),
              // Release: decrement workers and process queue
              () =>
                Effect.gen(function* () {
                  // Decrement active workers
                  yield* Ref.update(activeWorkers, (n) => n - 1);

                  // Process next queued task
                  const queue = yield* Ref.get(taskQueue);
                  if (queue.length > 0) {
                    const [next, ...rest] = queue;
                    yield* Ref.set(taskQueue, rest);
                    if (next) next();
                  }
                })
            );
          }),

        /**
         * Submit multiple tasks in parallel
         */
        submitParallelTasks: <T>(tasks: Array<() => Promise<T>>) =>
          Effect.gen(function* (self) {
            const service = yield* ExecutionContextService;
            return yield* Effect.all(
              tasks.map((task) => service.submitTask(task)),
              { concurrency: 'unbounded' }
            );
          }),

        /**
         * Get worker pool statistics
         */
        getWorkerStats: () =>
          Effect.gen(function* () {
            const max = yield* Ref.get(maxWorkers);
            const active = yield* Ref.get(activeWorkers);
            const queue = yield* Ref.get(taskQueue);

            return {
              available: max - active,
              total: max,
              queued: queue.length,
            };
          }),

        /**
         * Set maximum workers
         */
        setMaxWorkers: (count: number) =>
          Effect.gen(function* () {
            yield* Ref.set(maxWorkers, Math.max(1, count));
          }),

        // ===== Flow Control Operations =====

        /**
         * Signal break in current context
         */
        signalBreak: () =>
          Effect.gen(function* () {
            const parallel = yield* Ref.get(isParallel);
            if (parallel) {
              return yield* Effect.fail(
                new ExecutionError({
                  message: 'Break not allowed in parallel context',
                  phase: 'execution',
                })
              );
            }
            yield* Ref.set(shouldBreak, true);
          }),

        /**
         * Signal continue in current context
         */
        signalContinue: () =>
          Effect.gen(function* () {
            const parallel = yield* Ref.get(isParallel);
            if (parallel) {
              return yield* Effect.fail(
                new ExecutionError({
                  message: 'Continue not allowed in parallel context',
                  phase: 'execution',
                })
              );
            }
            yield* Ref.set(shouldContinue, true);
          }),

        /**
         * Check if should break
         */
        checkBreak: () => Ref.get(shouldBreak),

        /**
         * Check if should continue
         */
        checkContinue: () => Ref.get(shouldContinue),

        /**
         * Reset flow control signals
         */
        resetFlowControl: () =>
          Effect.gen(function* () {
            yield* Ref.set(shouldBreak, false);
            yield* Ref.set(shouldContinue, false);
          }),

        /**
         * Enter parallel context
         */
        enterParallelContext: () =>
          Effect.gen(function* () {
            const current = yield* Ref.get(isParallel);
            yield* Ref.update(contextStack, (stack) => [...stack, current]);
            yield* Ref.set(isParallel, true);
          }),

        /**
         * Enter sequential context
         */
        enterSequentialContext: () =>
          Effect.gen(function* () {
            const current = yield* Ref.get(isParallel);
            yield* Ref.update(contextStack, (stack) => [...stack, current]);
            yield* Ref.set(isParallel, false);
          }),

        /**
         * Exit current context
         */
        exitContext: () =>
          Effect.gen(function* () {
            const stack = yield* Ref.get(contextStack);
            if (stack.length > 0) {
              const [prev, ...rest] = stack.reverse();
              yield* Ref.set(contextStack, rest.reverse());
              yield* Ref.set(isParallel, prev ?? false);
            }
          }),

        // ===== Pause/Resume Operations =====

        /**
         * Pause execution and wait for input
         */
        pause: <T>(prompt: string) =>
          Effect.async<T, never>((resume) => {
            Ref.update(pauseState, () =>
              Option.some({
                prompt,
                resolver: (value: unknown) =>
                  resume(Effect.succeed(value as T)),
              })
            ).pipe(Effect.runSync);
          }),

        /**
         * Resume execution with value
         */
        resume: <T>(value: T) =>
          Effect.gen(function* () {
            const state = yield* Ref.get(pauseState);

            if (Option.isNone(state)) {
              return yield* Effect.fail(
                new ExecutionError({
                  message: 'Not currently paused',
                  phase: 'execution',
                })
              );
            }

            const { resolver } = state.value;
            yield* Ref.set(pauseState, Option.none());
            resolver(value);
          }),

        /**
         * Check if currently paused
         */
        isPaused: () =>
          Effect.gen(function* () {
            const state = yield* Ref.get(pauseState);
            return Option.isSome(state);
          }),

        /**
         * Get current pause prompt
         */
        getPausePrompt: () =>
          Effect.gen(function* () {
            const state = yield* Ref.get(pauseState);
            return Option.map(state, (s) => s.prompt);
          }),

        /**
         * Cancel current pause
         */
        cancelPause: () =>
          Effect.gen(function* () {
            const state = yield* Ref.get(pauseState);
            if (Option.isSome(state)) {
              const { resolver } = state.value;
              yield* Ref.set(pauseState, Option.none());
              resolver(null);
            }
          }),

        // ===== Context Management =====

        /**
         * Create a child context (pushes current variables to parent stack)
         */
        createChildContext: () =>
          Effect.gen(function* () {
            const currentVars = yield* Ref.get(variables);
            yield* Ref.update(parentScopes, (parents) => [
              ...parents,
              currentVars,
            ]);
            yield* Ref.set(variables, HashMap.empty());

            return yield* Ref.get(sessionId);
          }),

        /**
         * Merge context (pops parent stack)
         */
        mergeContext: () =>
          Effect.gen(function* () {
            const parents = yield* Ref.get(parentScopes);
            if (parents.length > 0) {
              const [...rest] = parents;
              const last = rest.pop();
              yield* Ref.set(parentScopes, rest);

              if (last) {
                // Merge current variables with parent
                const currentVars = yield* Ref.get(variables);
                const merged = HashMap.union(last, currentVars);
                yield* Ref.set(variables, merged);
              }
            }
          }),

        /**
         * Get session ID
         */
        getSessionId: () => Ref.get(sessionId),

        /**
         * Set session ID
         */
        setSessionId: (id: string) => Ref.set(sessionId, id),

        /**
         * Get flow ID
         */
        getFlowId: () => Ref.get(flowId),

        /**
         * Set flow ID
         */
        setFlowId: (id: string) => Ref.set(flowId, id),

        /**
         * Get step ID
         */
        getStepId: () => Ref.get(stepId),

        /**
         * Set step ID
         */
        setStepId: (id: string) => Ref.set(stepId, id),

        /**
         * Get metadata
         */
        getMetadata: (key: string) =>
          Effect.gen(function* () {
            const meta = yield* Ref.get(metadata);
            return HashMap.get(meta, key);
          }),

        /**
         * Set metadata
         */
        setMetadata: (key: string, value: unknown) =>
          Effect.gen(function* () {
            yield* Ref.update(metadata, HashMap.set(key, value));
          }),

        /**
         * Checkpoint current state
         */
        checkpoint: () =>
          Effect.gen(function* () {
            const vars = yield* Ref.get(variables);
            const meta = yield* Ref.get(metadata);
            const flow = yield* Ref.get(flowId);
            const step = yield* Ref.get(stepId);
            const session = yield* Ref.get(sessionId);

            const checkpointId = uuidv4();

            // In a real implementation, this would persist to storage
            // For now, we just return the checkpoint ID
            return checkpointId;
          }),

        /**
         * Cleanup resources
         */
        dispose: () =>
          Effect.gen(function* () {
            // Clear all state
            yield* Ref.set(variables, HashMap.empty());
            yield* Ref.set(metadata, HashMap.empty());
            yield* Ref.set(parentScopes, []);
            yield* Ref.set(taskQueue, []);
            yield* Ref.set(contextStack, []);
            yield* Ref.set(pauseState, Option.none());
            yield* Ref.set(shouldBreak, false);
            yield* Ref.set(shouldContinue, false);
          }),
      };
    }),
  }
) {}

/**
 * Test implementation
 */
export const ExecutionContextTest = Layer.succeed(ExecutionContextService, {
  getVariable: () =>
    Effect.fail(
      new ExecutionError({ message: 'Variable not found', phase: 'execution' })
    ),
  setVariable: () => Effect.void,
  hasVariable: () => Effect.succeed(false),
  deleteVariable: () => Effect.void,
  listVariables: () => Effect.succeed([]),
  clearVariables: () => Effect.void,
  submitTask: () =>
    Effect.fail(
      new ExecutionError({ message: 'Task failed', phase: 'execution' })
    ),
  submitParallelTasks: () => Effect.succeed([]),
  getWorkerStats: () => Effect.succeed({ available: 4, total: 4, queued: 0 }),
  setMaxWorkers: () => Effect.void,
  signalBreak: () => Effect.void,
  signalContinue: () => Effect.void,
  checkBreak: () => Effect.succeed(false),
  checkContinue: () => Effect.succeed(false),
  resetFlowControl: () => Effect.void,
  enterParallelContext: () => Effect.void,
  enterSequentialContext: () => Effect.void,
  exitContext: () => Effect.void,
  pause: () => Effect.never,
  resume: () => Effect.void,
  isPaused: () => Effect.succeed(false),
  getPausePrompt: () => Effect.succeed(Option.none()),
  cancelPause: () => Effect.void,
  createChildContext: () => Effect.succeed(uuidv4()),
  mergeContext: () => Effect.void,
  getSessionId: () => Effect.succeed('test-session'),
  setSessionId: () => Effect.void,
  getFlowId: () => Effect.succeed('test-flow'),
  setFlowId: () => Effect.void,
  getStepId: () => Effect.succeed('test-step'),
  setStepId: () => Effect.void,
  getMetadata: () => Effect.succeed(Option.none()),
  setMetadata: () => Effect.void,
  checkpoint: () => Effect.succeed('test-checkpoint'),
  dispose: () => Effect.void,
} as any);

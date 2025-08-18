/**
 * ExecutionContextService - Execution context management service
 * 
 * Provides shared state and services across all executable entities
 * with hierarchical scoping, session management, and proper cleanup.
 */

import { Effect, Context, Layer, Ref, Duration, Option } from 'effect';
import { v4 as uuidv4 } from 'uuid';
import { ExecutionError } from '../errors';
import { createFiberPool, parallelWithConfig } from '../utils/concurrency';
import { safeAsyncOp } from '../utils/effect-patterns';

// ============= Types =============

/**
 * Variable scope with hierarchical parent/child relationships
 */
export interface VariableScope {
  readonly get: <T>(key: string) => Effect.Effect<Option.Option<T>>;
  readonly set: <T>(key: string, value: T) => Effect.Effect<void>;
  readonly has: (key: string) => Effect.Effect<boolean>;
  readonly delete: (key: string) => Effect.Effect<boolean>;
  readonly createScope: () => Effect.Effect<VariableScope>;
  readonly getParentScope: () => Effect.Effect<Option.Option<VariableScope>>;
  readonly getKeys: () => Effect.Effect<string[]>;
  readonly clear: () => Effect.Effect<void>;
}

/**
 * Worker pool interface for parallel execution
 */
export interface WorkerPool {
  readonly execute: <T>(task: () => Promise<T>) => Effect.Effect<T, unknown>;
  readonly executeParallel: <T>(tasks: Array<() => Promise<T>>) => Effect.Effect<T[], unknown>;
  readonly getAvailableWorkers: () => Effect.Effect<number>;
  readonly getMaxWorkers: () => Effect.Effect<number>;
  readonly setMaxWorkers: (count: number) => Effect.Effect<void>;
  readonly shutdown: () => Effect.Effect<void>;
}

/**
 * Pause/Resume manager for interactive flows
 */
export interface PauseResumeManager {
  readonly pause: <T>(prompt: string) => Effect.Effect<T>;
  readonly resume: <T>(value: T) => Effect.Effect<void>;
  readonly isPaused: () => Effect.Effect<boolean>;
  readonly getCurrentPrompt: () => Effect.Effect<Option.Option<string>>;
  readonly cancel: () => Effect.Effect<void>;
}

/**
 * Flow control manager for break/continue operations
 */
export interface FlowControlManager {
  readonly isParallelContext: () => Effect.Effect<boolean>;
  readonly canBreak: () => Effect.Effect<boolean>;
  readonly canContinue: () => Effect.Effect<boolean>;
  readonly break: () => Effect.Effect<void, ExecutionError>;
  readonly continue: () => Effect.Effect<void, ExecutionError>;
  readonly enterSequentialContext: () => Effect.Effect<void>;
  readonly enterParallelContext: () => Effect.Effect<void>;
  readonly exitContext: () => Effect.Effect<void>;
  readonly shouldBreak: () => Effect.Effect<boolean>;
  readonly shouldContinue: () => Effect.Effect<boolean>;
  readonly reset: () => Effect.Effect<void>;
}

/**
 * Execution context configuration
 */
export interface ExecutionContextConfig {
  readonly flowId?: string;
  readonly stepId?: string;
  readonly sessionId?: string;
  readonly metadata?: Record<string, unknown>;
  readonly maxWorkers?: number;
}

// ============= ExecutionContextService Interface =============

export interface ExecutionContextService {
  readonly flowId: () => Effect.Effect<string>;
  readonly stepId: () => Effect.Effect<string>;
  readonly sessionId: () => Effect.Effect<string>;
  readonly metadata: () => Effect.Effect<Record<string, unknown>>;
  
  readonly variableScope: () => Effect.Effect<VariableScope>;
  readonly workerPool: () => Effect.Effect<WorkerPool>;
  readonly pauseResumeManager: () => Effect.Effect<PauseResumeManager>;
  readonly flowControlManager: () => Effect.Effect<FlowControlManager>;
  
  readonly createChildContext: (
    config?: Partial<ExecutionContextConfig>
  ) => Effect.Effect<ExecutionContextService>;
  
  readonly addManagedResource: (cleanup: () => Effect.Effect<void>) => Effect.Effect<void>;
  readonly withResource: <T, E, R>(
    acquire: Effect.Effect<T, E, R>,
    use: (resource: T) => Effect.Effect<any, E, R>
  ) => Effect.Effect<any, E, R>;
  
  readonly dispose: () => Effect.Effect<void>;
}

// ============= Context Tag =============

export const ExecutionContextService = Context.GenericTag<ExecutionContextService>('@services/ExecutionContext');

// ============= Variable Scope Implementation =============

const makeVariableScope = (parent?: VariableScope): Effect.Effect<VariableScope, never, never> =>
  Effect.gen(function* () {
    const variablesRef = yield* Ref.make(new Map<string, unknown>());

    const scope: VariableScope = {
      get: <T>(key: string): Effect.Effect<Option.Option<T>, never, never> =>
        Effect.gen(function* () {
          const variables = yield* Ref.get(variablesRef);
          if (variables.has(key)) {
            return Option.some(variables.get(key) as T);
          }
          if (parent) {
            return yield* parent.get<T>(key);
          }
          return Option.none() as Option.Option<T>;
        }),

      set: <T>(key: string, value: T) =>
        Effect.gen(function* () {
          yield* Ref.update(variablesRef, (current) => {
            const newMap = new Map(current);
            newMap.set(key, value);
            return newMap;
          });
        }),

      has: (key: string) =>
        Effect.gen(function* () {
          const variables = yield* Ref.get(variablesRef);
          if (variables.has(key)) {
            return true;
          }
          if (parent) {
            return yield* parent.has(key);
          }
          return false;
        }),

      delete: (key: string) =>
        Effect.gen(function* () {
          const variables = yield* Ref.get(variablesRef);
          const existed = variables.has(key);
          if (existed) {
            yield* Ref.update(variablesRef, (current) => {
              const newMap = new Map(current);
              newMap.delete(key);
              return newMap;
            });
          }
          return existed;
        }),

      createScope: () => Effect.gen(function* () {
        const currentScope = yield* Effect.succeed(scope);
        return yield* makeVariableScope(currentScope);
      }),

      getParentScope: () => Effect.succeed(parent ? Option.some(parent) : Option.none()),

      getKeys: () =>
        Effect.gen(function* () {
          const variables = yield* Ref.get(variablesRef);
          const keys = Array.from(variables.keys());
          if (parent) {
            const parentKeys = yield* parent.getKeys();
            const allKeys = new Set([...parentKeys, ...keys]);
            return Array.from(allKeys);
          }
          return keys;
        }),

      clear: () =>
        Effect.gen(function* () {
          yield* Ref.set(variablesRef, new Map());
        }),
    };
    
    return scope;
  });

// ============= Worker Pool Implementation =============

const makeWorkerPool = (maxWorkers: number = 4): Effect.Effect<WorkerPool, never, never> =>
  Effect.gen(function* () {
    const maxWorkersRef = yield* Ref.make(maxWorkers);
    const activeTasksRef = yield* Ref.make(0);
    const taskQueueRef = yield* Ref.make<Array<() => void>>([]);

    const pool: WorkerPool = {
      execute: <T>(task: () => Promise<T>): Effect.Effect<T, unknown, never> =>
        Effect.gen(function* () {
          const maxWorkers = yield* Ref.get(maxWorkersRef);
          const activeTasks = yield* Ref.get(activeTasksRef);

          if (activeTasks >= maxWorkers) {
            yield* Effect.async<void>((resume) =>
              Effect.gen(function* () {
                yield* Ref.update(taskQueueRef, (queue) => [...queue, () => resume(Effect.void)]);
              })
            );
          }

          yield* Ref.update(activeTasksRef, (count) => count + 1);

          const result = yield* Effect.tryPromise({
            try: task,
            catch: (error) => error,
          }).pipe(
            Effect.ensuring(
              Effect.gen(function* () {
                yield* Ref.update(activeTasksRef, (count) => count - 1);
                const queue = yield* Ref.get(taskQueueRef);
                const nextTask = queue[0];
                if (nextTask) {
                  yield* Ref.update(taskQueueRef, (current) => current.slice(1));
                  nextTask();
                }
              })
            )
          );

          return result;
        }),

      executeParallel: <T>(tasks: Array<() => Promise<T>>): Effect.Effect<T[], unknown, never> =>
        Effect.gen(function* () {
          return yield* Effect.all(
            tasks.map((task) => pool.execute(task)),
            { concurrency: 'unbounded' }
          ) as Effect.Effect<T[], unknown, never>;
        }),

      getAvailableWorkers: () =>
        Effect.gen(function* () {
          const maxWorkers = yield* Ref.get(maxWorkersRef);
          const activeTasks = yield* Ref.get(activeTasksRef);
          return Math.max(0, maxWorkers - activeTasks);
        }),

      getMaxWorkers: () => Ref.get(maxWorkersRef),

      setMaxWorkers: (count: number) =>
        Effect.gen(function* () {
          yield* Ref.set(maxWorkersRef, Math.max(1, count));
        }),

      shutdown: () =>
        Effect.gen(function* () {
          let activeTasks = yield* Ref.get(activeTasksRef);
          while (activeTasks > 0) {
            yield* Effect.sleep(Duration.millis(10));
            activeTasks = yield* Ref.get(activeTasksRef);
          }
          yield* Ref.set(taskQueueRef, []);
        }),
    };
    
    return pool;
  });

// ============= Flow Control Manager Implementation =============

const makeFlowControlManager = (): Effect.Effect<FlowControlManager, never, never> =>
  Effect.gen(function* () {
    const shouldBreakRef = yield* Ref.make(false);
    const shouldContinueRef = yield* Ref.make(false);
    const contextStackRef = yield* Ref.make<boolean[]>([]);
    const isParallelContextRef = yield* Ref.make(false);

    const manager: FlowControlManager = {
      isParallelContext: () => Ref.get(isParallelContextRef),

      canBreak: () =>
        Effect.gen(function* () {
          const isParallel = yield* Ref.get(isParallelContextRef);
          return !isParallel;
        }),

      canContinue: () =>
        Effect.gen(function* () {
          const isParallel = yield* Ref.get(isParallelContextRef);
          return !isParallel;
        }),

      break: (): Effect.Effect<void, ExecutionError, never> =>
        Effect.gen(function* () {
          const canBreak = yield* manager.canBreak();
          if (!canBreak) {
            return yield* Effect.fail(
              new ExecutionError({
                message: 'Break is not allowed in parallel execution context',
                phase: 'execution' as const,
              })
            );
          }
          yield* Ref.set(shouldBreakRef, true);
        }) as Effect.Effect<void, ExecutionError, never>,

      continue: (): Effect.Effect<void, ExecutionError, never> =>
        Effect.gen(function* () {
          const canContinue = yield* manager.canContinue();
          if (!canContinue) {
            return yield* Effect.fail(
              new ExecutionError({
                message: 'Continue is not allowed in parallel execution context',
                phase: 'execution' as const,
              })
            );
          }
          yield* Ref.set(shouldContinueRef, true);
        }) as Effect.Effect<void, ExecutionError, never>,

      enterSequentialContext: () =>
        Effect.gen(function* () {
          const isParallel = yield* Ref.get(isParallelContextRef);
          yield* Ref.update(contextStackRef, (stack) => [...stack, isParallel]);
          yield* Ref.set(isParallelContextRef, false);
        }),

      enterParallelContext: () =>
        Effect.gen(function* () {
          const isParallel = yield* Ref.get(isParallelContextRef);
          yield* Ref.update(contextStackRef, (stack) => [...stack, isParallel]);
          yield* Ref.set(isParallelContextRef, true);
        }),

      exitContext: () =>
        Effect.gen(function* () {
          const stack = yield* Ref.get(contextStackRef);
          const previousContext = stack[stack.length - 1];
          if (previousContext !== undefined) {
            yield* Ref.update(contextStackRef, (current) => current.slice(0, -1));
            yield* Ref.set(isParallelContextRef, previousContext);
          }
        }),

      shouldBreak: () => Ref.get(shouldBreakRef),

      shouldContinue: () => Ref.get(shouldContinueRef),

      reset: () =>
        Effect.gen(function* () {
          yield* Ref.set(shouldBreakRef, false);
          yield* Ref.set(shouldContinueRef, false);
        }),
    };
    
    return manager;
  });

// ============= Pause/Resume Manager Implementation =============

const makePauseResumeManager = (): Effect.Effect<PauseResumeManager, never, never> =>
  Effect.gen(function* () {
    const pausePromiseRef = yield* Ref.make<Promise<unknown> | null>(null);
    const resumeCallbackRef = yield* Ref.make<((value: unknown) => void) | null>(null);
    const currentPromptRef = yield* Ref.make<Option.Option<string>>(Option.none());

    const pauseManager: PauseResumeManager = {
      pause: <T>(prompt: string): Effect.Effect<T, never, never> =>
        Effect.gen(function* () {
          const existingPromise = yield* Ref.get(pausePromiseRef);
          if (existingPromise !== null) {
            return yield* Effect.fail(new Error('Already paused - cannot pause again'));
          }

          yield* Ref.set(currentPromptRef, Option.some(prompt));

          return yield* Effect.async<T, never>((resume) =>
            Effect.gen(function* () {
              const pausePromise = new Promise<T>((resolve) => {
                Effect.runSync(Ref.set(resumeCallbackRef, resolve as (value: unknown) => void));
              });

              yield* Ref.set(pausePromiseRef, pausePromise);

              pausePromise.then((value) => {
                resume(Effect.succeed(value));
              });
            })
          );
        }) as Effect.Effect<T, never, never>,

      resume: <T>(value: T): Effect.Effect<void, never, never> =>
        Effect.gen(function* () {
          const callback = yield* Ref.get(resumeCallbackRef);
          if (callback === null) {
            return yield* Effect.fail(new Error('Not currently paused'));
          }

          yield* Ref.set(resumeCallbackRef, null);
          yield* Ref.set(pausePromiseRef, null);
          yield* Ref.set(currentPromptRef, Option.none());

          callback(value as unknown);
        }) as Effect.Effect<void, never, never>,

      isPaused: () =>
        Effect.gen(function* () {
          const promise = yield* Ref.get(pausePromiseRef);
          return promise !== null;
        }),

      getCurrentPrompt: () => Ref.get(currentPromptRef),

      cancel: () =>
        Effect.gen(function* () {
          const callback = yield* Ref.get(resumeCallbackRef);
          if (callback !== null) {
            yield* Ref.set(resumeCallbackRef, null);
            yield* Ref.set(pausePromiseRef, null);
            yield* Ref.set(currentPromptRef, Option.none());
            callback(null as unknown);
          }
        }),
    };
    
    return pauseManager;
  });

// ============= Service Implementation =============

const makeExecutionContextService = (
  config: ExecutionContextConfig = {}
): Effect.Effect<ExecutionContextService, never, never> =>
  Effect.gen(function* () {
    const flowIdRef = yield* Ref.make(config.flowId || 'default-flow');
    const stepIdRef = yield* Ref.make(config.stepId || 'default-step');
    const sessionIdRef = yield* Ref.make(config.sessionId || uuidv4());
    const metadataRef = yield* Ref.make(config.metadata || {});
    const managedResourcesRef = yield* Ref.make<Array<() => Effect.Effect<void>>>([]);

    const variableScopeInstance = yield* makeVariableScope();
    const workerPoolInstance = yield* makeWorkerPool(config.maxWorkers || 4);
    const pauseResumeInstance = yield* makePauseResumeManager();
    const flowControlInstance = yield* makeFlowControlManager();

    const service: ExecutionContextService = {
      flowId: () => Ref.get(flowIdRef),
      stepId: () => Ref.get(stepIdRef),
      sessionId: () => Ref.get(sessionIdRef),
      metadata: () => Ref.get(metadataRef),

      variableScope: () => Effect.succeed(variableScopeInstance),
      workerPool: () => Effect.succeed(workerPoolInstance),
      pauseResumeManager: () => Effect.succeed(pauseResumeInstance),
      flowControlManager: () => Effect.succeed(flowControlInstance),

      createChildContext: (childConfig?: Partial<ExecutionContextConfig>) =>
        Effect.gen(function* () {
          const currentSessionId = yield* Ref.get(sessionIdRef);
          const currentFlowId = yield* Ref.get(flowIdRef);
          const currentMetadata = yield* Ref.get(metadataRef);

          const childScope = yield* variableScopeInstance.createScope();

          return yield* makeExecutionContextService({
            flowId: childConfig?.flowId || currentFlowId,
            stepId: childConfig?.stepId || 'child-step',
            sessionId: childConfig?.sessionId || currentSessionId,
            metadata: { ...currentMetadata, ...childConfig?.metadata },
            maxWorkers: childConfig?.maxWorkers || 4,
          });
        }),

      addManagedResource: (cleanup: () => Effect.Effect<void>) =>
        Effect.gen(function* () {
          yield* Ref.update(managedResourcesRef, (resources) => [...resources, cleanup]);
        }),

      withResource: <T, E, R>(
        acquire: Effect.Effect<T, E, R>,
        use: (resource: T) => Effect.Effect<any, E, R>
      ): Effect.Effect<any, E, R> =>
        Effect.gen(function* () {
          return yield* Effect.acquireUseRelease(
            acquire,
            use,
            (resource) => {
              Effect.runSync(service.addManagedResource(() => Effect.void));
              return Effect.void;
            }
          );
        }),

      dispose: () =>
        Effect.gen(function* () {
          // Clean up managed resources
          const resources = yield* Ref.get(managedResourcesRef);
          if (resources.length > 0) {
            yield* Effect.forEach(resources, (cleanup) => cleanup(), {
              concurrency: 'unbounded',
            }).pipe(
              Effect.catchAll(() => Effect.void)
            );
          }

          // Clean up other resources
          yield* variableScopeInstance.clear();
          yield* workerPoolInstance.shutdown();
          yield* pauseResumeInstance.cancel();
          yield* flowControlInstance.reset();
        }),
    };
    
    return service;
  });

// ============= Layer Implementation =============

/**
 * Live implementation of ExecutionContextService
 */
export const ExecutionContextServiceLive = Layer.effect(
  ExecutionContextService,
  makeExecutionContextService()
);

/**
 * Test implementation with custom configuration
 */
export const ExecutionContextServiceTest = (config?: ExecutionContextConfig) =>
  Layer.effect(
    ExecutionContextService,
    makeExecutionContextService(config || {})
  );

// ============= Helper Functions =============

/**
 * Create variable scope
 */
export const createVariableScope = (parent?: VariableScope) =>
  makeVariableScope(parent);

/**
 * Create worker pool
 */
export const createWorkerPool = (maxWorkers?: number) =>
  makeWorkerPool(maxWorkers);

/**
 * Create flow control manager
 */
export const createFlowControlManager = () =>
  makeFlowControlManager();

/**
 * Create pause/resume manager
 */
export const createPauseResumeManager = () =>
  makePauseResumeManager();

/**
 * Execute with execution context
 */
export const withExecutionContext = <A, E>(
  effect: Effect.Effect<A, E>,
  config?: ExecutionContextConfig
) =>
  Effect.gen(function* () {
    const contextService = yield* makeExecutionContextService(config || {});
    return yield* effect.pipe(
      Effect.provide(Layer.succeed(ExecutionContextService, contextService))
    );
  });

/**
 * Get current execution context variables
 */
export const getExecutionVariables = () =>
  Effect.gen(function* () {
    const context = yield* ExecutionContextService;
    const scope = yield* context.variableScope();
    const keys = yield* scope.getKeys();
    
    const variables: Record<string, unknown> = {};
    for (const key of keys) {
      const value = yield* scope.get(key);
      if (Option.isSome(value)) {
        variables[key] = value.value;
      }
    }
    
    return variables;
  });
/**
 * Execution Context Implementation
 *
 * Provides shared state and services across all executable entities
 * with hierarchical scoping, session management, and proper cleanup.
 */

import { Duration, Effect, Option } from 'effect';
import { v4 as uuidv4 } from 'uuid';
import { createFiberPool, parallelWithConfig } from '../../utils/concurrency';
import { safeAsyncOp } from '../../utils/effect-patterns';

// ============= Core Context Types =============

/**
 * Variable scope with hierarchical parent/child relationships
 */
export interface VariableScope {
  /**
   * Get a variable value by key
   */
  get<T>(key: string): Option.Option<T>;

  /**
   * Set a variable value
   */
  set<T>(key: string, value: T): void;

  /**
   * Check if a variable exists
   */
  has(key: string): boolean;

  /**
   * Delete a variable
   */
  delete(key: string): boolean;

  /**
   * Create a child scope that inherits from this scope
   */
  createScope(): VariableScope;

  /**
   * Get the parent scope, if any
   */
  getParentScope(): Option.Option<VariableScope>;

  /**
   * Get all variable keys at this level
   */
  getKeys(): string[];

  /**
   * Clear all variables at this level
   */
  clear(): void;
}

/**
 * Worker pool interface for parallel execution
 */
export interface WorkerPool {
  /**
   * Execute a single task
   */
  execute<T>(task: () => Promise<T>): Effect.Effect<T, unknown>;

  /**
   * Execute multiple tasks in parallel
   */
  executeParallel<T>(tasks: Array<() => Promise<T>>): Effect.Effect<T[], unknown>;

  /**
   * Get number of available workers
   */
  getAvailableWorkers(): number;

  /**
   * Get maximum number of workers
   */
  getMaxWorkers(): number;

  /**
   * Set maximum number of workers
   */
  setMaxWorkers(count: number): void;

  /**
   * Shutdown the worker pool
   */
  shutdown(): Effect.Effect<void, never>;
}

/**
 * Pause/Resume manager for interactive flows
 */
export interface PauseResumeManager {
  /**
   * Pause execution and wait for external input
   */
  pause<T>(prompt: string): Effect.Effect<T, never>;

  /**
   * Resume execution with provided value
   */
  resume<T>(value: T): void;

  /**
   * Check if currently paused
   */
  isPaused(): boolean;

  /**
   * Get the current pause prompt
   */
  getCurrentPrompt(): Option.Option<string>;

  /**
   * Cancel current pause
   */
  cancel(): void;
}

/**
 * Flow control manager for break/continue operations
 */
export interface FlowControlManager {
  /**
   * Check if we're in a parallel execution context
   */
  readonly isParallelContext: boolean;

  /**
   * Check if break is allowed in current context
   */
  readonly canBreak: boolean;

  /**
   * Check if continue is allowed in current context
   */
  readonly canContinue: boolean;

  /**
   * Signal break (only in sequential contexts)
   */
  break(): void;

  /**
   * Signal continue (only in sequential contexts)
   */
  continue(): void;

  /**
   * Enter sequential execution context
   */
  enterSequentialContext(): void;

  /**
   * Enter parallel execution context
   */
  enterParallelContext(): void;

  /**
   * Exit current execution context
   */
  exitContext(): void;

  /**
   * Check if break was signaled
   */
  shouldBreak(): boolean;

  /**
   * Check if continue was signaled
   */
  shouldContinue(): boolean;

  /**
   * Reset break/continue signals
   */
  reset(): void;
}

/**
 * Enhanced execution context with Effect integration
 */
export interface EnhancedExecutionContext {
  /** Flow identifier */
  readonly flowId: string;

  /** Step identifier */
  readonly stepId: string;

  /** Unique session identifier */
  readonly sessionId: string;

  /** Variables as record (compatible with base ExecutionContext) */
  readonly variables: Record<string, unknown>;

  /** Session metadata */
  readonly metadata: Record<string, unknown>;

  /** Hierarchical variable scope */
  readonly variableScope: VariableScope;

  /** Worker pool for parallel execution */
  readonly workers: WorkerPool;

  /** Pause/resume manager for interactive flows */
  readonly pauseResume: PauseResumeManager;

  /** Flow control manager for break/continue */
  readonly flowControl: FlowControlManager;

  /* TODO: Fix Layer type mismatch - comment out until Layer types are resolved
  readonly layers: {
    http: Layer.Layer<unknown>;
    llm: Layer.Layer<unknown>;
    database: Layer.Layer<unknown>;
  };
  */

  /* TODO: Fix provide method - comment out until Layer and FlowContext types are resolved
  provide<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, Exclude<R, FlowContext>>;
  */

  /**
   * Create a child context with optional variable scope
   */
  createChildContext(scope?: Partial<VariableScope>): EnhancedExecutionContext;

  /**
   * Dispose of this context and clean up resources
   */
  dispose(): Effect.Effect<void, never>;
}

// ============= Variable Scope Implementation =============

/**
 * Hierarchical variable scope implementation
 */
export class VariableScopeImpl implements VariableScope {
  private variables = new Map<string, unknown>();

  constructor(private parent?: VariableScope) {}

  get<T>(key: string): Option.Option<T> {
    if (this.variables.has(key)) {
      return Option.some(this.variables.get(key) as T);
    }
    return this.parent?.get(key) ?? Option.none();
  }

  set<T>(key: string, value: T): void {
    this.variables.set(key, value);
  }

  has(key: string): boolean {
    return this.variables.has(key) || this.parent?.has(key) || false;
  }

  delete(key: string): boolean {
    return this.variables.delete(key);
  }

  createScope(): VariableScope {
    return new VariableScopeImpl(this);
  }

  getParentScope(): Option.Option<VariableScope> {
    return this.parent ? Option.some(this.parent) : Option.none();
  }

  getKeys(): string[] {
    const keys = Array.from(this.variables.keys());
    if (this.parent !== null && this.parent !== undefined) {
      const parentKeys = this.parent.getKeys();
      // Merge keys, child scope keys override parent keys
      const allKeys = new Set([...parentKeys, ...keys]);
      return Array.from(allKeys);
    }
    return keys;
  }

  clear(): void {
    this.variables.clear();
  }
}

// ============= Worker Pool Implementation =============

/**
 * Simple worker pool implementation
 */
export class WorkerPoolImpl implements WorkerPool {
  private maxWorkers: number;
  private activeTasks = 0;
  private taskQueue: Array<() => void> = [];

  constructor(maxWorkers: number = 4) {
    this.maxWorkers = maxWorkers;
  }

  execute<T>(task: () => Promise<T>): Effect.Effect<T, unknown> {
    const self = this;
    return Effect.gen(function* () {
      if (self.activeTasks >= self.maxWorkers) {
        yield* Effect.async<void>((resume) => {
          self.taskQueue.push(() => resume(Effect.void));
        });
      }

      self.activeTasks++;
      try {
        const result = yield* Effect.tryPromise({
          try: task,
          catch: (error) => error,
        });
        return result;
      } finally {
        self.activeTasks--;
        const nextTask = self.taskQueue.shift();
        if (nextTask) {
          nextTask();
        }
      }
    });
  }

  executeParallel<T>(tasks: Array<() => Promise<T>>): Effect.Effect<T[], unknown> {
    return Effect.all(
      tasks.map((task) => this.execute(task)),
      { concurrency: 'unbounded' }
    );
  }

  getAvailableWorkers(): number {
    return Math.max(0, this.maxWorkers - this.activeTasks);
  }

  /**
   * Execute tasks using Effect-based concurrency with Fiber management
   */
  executeWithEffects<T>(
    tasks: Array<() => Promise<T>>,
    options?: {
      concurrency?: number;
      timeout?: Duration.Duration;
    }
  ): Effect.Effect<ReadonlyArray<T>, unknown> {
    const concurrency = options?.concurrency || this.maxWorkers;
    const timeout = options?.timeout || Duration.seconds(30);

    return parallelWithConfig(
      tasks,
      (task, index) =>
        safeAsyncOp(task, (error) => ({
          _tag: 'TaskError' as const,
          error,
        })).pipe(Effect.timeout(timeout)),
      {
        concurrency,
        failFast: false,
        timeout,
      }
    );
  }

  getMaxWorkers(): number {
    return this.maxWorkers;
  }

  setMaxWorkers(count: number): void {
    this.maxWorkers = Math.max(1, count);
  }

  shutdown(): Effect.Effect<void, never> {
    const self = this;
    return Effect.gen(function* () {
      // Wait for all active tasks to complete
      while (self.activeTasks > 0) {
        yield* Effect.sleep(Duration.millis(10));
      }
      self.taskQueue.length = 0;
    });
  }
}

// ============= Flow Control Manager Implementation =============

/**
 * Flow control manager implementation
 */
export class FlowControlManagerImpl implements FlowControlManager {
  private _shouldBreak = false;
  private _shouldContinue = false;
  private contextStack: boolean[] = [];

  private _isParallelContext = false;

  get isParallelContext(): boolean {
    return this._isParallelContext;
  }

  get canBreak(): boolean {
    return !this._isParallelContext;
  }

  get canContinue(): boolean {
    return !this._isParallelContext;
  }

  break(): void {
    if (!this.canBreak) {
      throw new Error('Break is not allowed in parallel execution context');
    }
    this._shouldBreak = true;
  }

  continue(): void {
    if (!this.canContinue) {
      throw new Error('Continue is not allowed in parallel execution context');
    }
    this._shouldContinue = true;
  }

  enterSequentialContext(): void {
    this.contextStack.push(this._isParallelContext);
    this._isParallelContext = false;
  }

  enterParallelContext(): void {
    this.contextStack.push(this._isParallelContext);
    this._isParallelContext = true;
  }

  exitContext(): void {
    const previousContext = this.contextStack.pop();
    if (previousContext !== null && previousContext !== undefined) {
      this._isParallelContext = previousContext;
    }
  }

  shouldBreak(): boolean {
    return this._shouldBreak;
  }

  shouldContinue(): boolean {
    return this._shouldContinue;
  }

  reset(): void {
    this._shouldBreak = false;
    this._shouldContinue = false;
  }
}

// ============= Pause/Resume Manager Implementation =============

/**
 * Pause/Resume manager implementation
 */
export class PauseResumeManagerImpl implements PauseResumeManager {
  private pausePromise: Promise<unknown> | null = null;
  private resumeCallback: ((value: unknown) => void) | null = null;
  private currentPrompt: Option.Option<string> = Option.none();

  pause<T>(prompt: string): Effect.Effect<T, never, never> {
    const self = this;
    return Effect.gen(function* () {
      if (self.pausePromise !== null && self.pausePromise !== undefined) {
        yield* Effect.fail(new Error('Already paused - cannot pause again'));
      }

      self.currentPrompt = Option.some(prompt);
      
      return yield* Effect.async<T, never>((resume) => {
        self.pausePromise = new Promise<T>((resolve) => {
          self.resumeCallback = resolve as (value: unknown) => void;
        });
        
        // The promise will be resolved via the resume method
        self.pausePromise.then((value) => {
          resume(Effect.succeed(value as T));
        });
      });
    }) as Effect.Effect<T, never, never>;
  }

  resume<T>(value: T): void {
    if (this.resumeCallback === null || this.resumeCallback === undefined) {
      throw new Error('Not currently paused');
    }

    const callback = this.resumeCallback;
    this.resumeCallback = null;
    this.pausePromise = null;
    this.currentPrompt = Option.none();

    callback(value as unknown);
  }

  isPaused(): boolean {
    return this.pausePromise !== null;
  }

  getCurrentPrompt(): Option.Option<string> {
    return this.currentPrompt;
  }

  cancel(): void {
    if (this.resumeCallback !== null && this.resumeCallback !== undefined) {
      const callback = this.resumeCallback;
      this.resumeCallback = null;
      this.pausePromise = null;
      this.currentPrompt = Option.none();

      // Resume with null to indicate cancellation
      callback(null as unknown);
    }
  }
}

// ============= Execution Context Implementation =============

/**
 * Full execution context implementation
 */
export class ExecutionContextImpl implements EnhancedExecutionContext {
  public readonly flowId: string;
  public readonly stepId: string;
  public readonly sessionId: string;
  public readonly variables: Record<string, unknown>;
  public readonly metadata: Record<string, unknown>;
  public readonly variableScope: VariableScope;
  public readonly workers: WorkerPool;
  public readonly pauseResume: PauseResumeManager;
  public readonly flowControl: FlowControlManager;
  private readonly fiberPool?: Effect.Effect<any, never>;
  private readonly managedResources: Array<() => Effect.Effect<void>> = [];

  /* TODO: Fix Layer type mismatch - comment out until Layer types are resolved
  public readonly layers: {
    http: Layer.Layer<unknown>;
    llm: Layer.Layer<unknown>;
    database: Layer.Layer<unknown>;
  };
  */

  constructor(
    options: {
      flowId?: string;
      stepId?: string;
      sessionId?: string;
      variables?: VariableScope;
      workers?: WorkerPool;
      pauseResume?: PauseResumeManager;
      flowControl?: FlowControlManager;
      metadata?: Record<string, unknown>;
      /* TODO: Fix Layer namespace - commenting out until imports are resolved
    layers?: {
      http: Layer.Layer<unknown>;
      llm: Layer.Layer<unknown>;
      database: Layer.Layer<unknown>;
    };
    */
    } = {}
  ) {
    this.flowId = options.flowId || 'default-flow';
    this.stepId = options.stepId || 'default-step';
    this.sessionId = options.sessionId || uuidv4();
    this.variableScope = options.variables || new VariableScopeImpl();
    this.workers = options.workers || new WorkerPoolImpl();
    this.pauseResume = options.pauseResume || new PauseResumeManagerImpl();
    this.flowControl = options.flowControl || new FlowControlManagerImpl();
    this.metadata = options.metadata || {};
    /* TODO: Fix Layer type mismatch - Layer.Layer vs Layer
    this.layers = options.layers || {
      http: Layer.empty,
      llm: Layer.empty,
      database: Layer.empty
    };
    */

    // Create variables record from variable scope
    this.variables = Object.fromEntries(
      this.variableScope
        .getKeys()
        .map((key) => [key, this.variableScope.get(key)])
    );
  }

  /* TODO: Fix 'variables' property error and unknown type issues
  provide<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, Exclude<R, FlowContext>> {
    return Effect.provide(
      effect,
      Layer.succeed(Context.GenericTag<FlowContext>('FlowContext'), {
        executionContext: this,
        variables: Object.fromEntries(
          this.variables.getKeys().map(key => [key, this.variables.get(key)])
        ),
        metadata: this.metadata
      })
    );
  }
  */

  createChildContext(
    scopeOverrides?: Partial<VariableScope>
  ): EnhancedExecutionContext {
    const childVariables = this.variableScope.createScope();

    // Apply scope overrides if provided
    if (scopeOverrides !== null && scopeOverrides !== undefined) {
      Object.entries(scopeOverrides).forEach(([key, value]) => {
        if (typeof value !== 'undefined') {
          childVariables.set(key, value);
        }
      });
    }

    return new ExecutionContextImpl({
      flowId: this.flowId,
      stepId: this.stepId,
      sessionId: this.sessionId, // Share session ID with child
      variables: childVariables,
      workers: this.workers, // Share worker pool
      pauseResume: this.pauseResume, // Share pause/resume manager
      flowControl: this.flowControl, // Share flow control
      metadata: { ...this.metadata }, // Copy metadata
      // TODO: Fix layers property reference
      // layers: this.layers // Share layers
    });
  }

  /**
   * Add a managed resource that will be cleaned up when the context is disposed
   */
  addManagedResource(cleanup: () => Effect.Effect<void>): void {
    this.managedResources.push(cleanup);
  }

  /**
   * Execute an effect with managed resources
   */
  withResource<T, E, R>(
    acquire: Effect.Effect<T, E, R>,
    use: (resource: T) => Effect.Effect<any, E, R>
  ): Effect.Effect<any, E, R> {
    return Effect.acquireUseRelease(acquire, use, (resource) => {
      // Add cleanup to managed resources
      this.addManagedResource(() => Effect.void);
      return Effect.void;
    });
  }

  /**
   * Get the fiber pool for concurrent operations
   */
  getFiberPool(): Effect.Effect<any, never> {
    if (this.fiberPool === null || this.fiberPool === undefined) {
      return createFiberPool(this.workers.getMaxWorkers());
    }
    return this.fiberPool;
  }

  dispose(): Effect.Effect<void, never> {
    const self = this;
    return Effect.gen(function* () {
      // Clean up managed Effect resources first
      if (self.managedResources.length > 0) {
        yield* Effect.forEach(self.managedResources, (cleanup) => cleanup(), {
          concurrency: 'unbounded',
        }).pipe(
          Effect.catchAll(() => Effect.void) // Don't fail disposal on cleanup errors
        );
      }

      // Clean up other resources
      self.variableScope.clear();
      yield* self.workers.shutdown();
      self.pauseResume.cancel();
      self.flowControl.reset();
    });
  }
}

// ============= Factory Functions =============

/* TODO: Fix Function constraint error - 'Function' does not satisfy constraint '(...args: unknown) => any'
export function createExecutionContext(
  options?: Parameters<typeof ExecutionContextImpl.prototype.constructor>[0]
): EnhancedExecutionContext {
  return new ExecutionContextImpl(options);
}
*/

/**
 * Create a new variable scope
 */
export function createVariableScope(parent?: VariableScope): VariableScope {
  return new VariableScopeImpl(parent);
}

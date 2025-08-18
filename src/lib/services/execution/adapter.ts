import { Effect, Runtime, Layer, Option, ManagedRuntime } from 'effect'
import { ExecutionContextService } from './context'
import type { 
  EnhancedExecutionContext, 
  VariableScope, 
  WorkerPool, 
  PauseResumeManager, 
  FlowControlManager 
} from '../../core/context/execution-context'
import { v4 as uuidv4 } from 'uuid'

/**
 * Variable Scope Adapter
 */
class VariableScopeAdapter implements VariableScope {
  constructor(private runtime: Runtime.Runtime<ExecutionContextService>) {}
  
  get<T>(key: string): Option.Option<T> {
    return Runtime.runSync(this.runtime)(
      Effect.gen(function* () {
        const service = yield* ExecutionContextService
        const value = yield* service.getVariable(key).pipe(
          Effect.catchAll(() => Effect.succeed(undefined))
        )
        return value !== undefined ? Option.some(value as T) : Option.none()
      })
    )
  }
  
  set<T>(key: string, value: T): void {
    Runtime.runSync(this.runtime)(
      Effect.gen(function* () {
        const service = yield* ExecutionContextService
        yield* service.setVariable(key, value)
      })
    )
  }
  
  has(key: string): boolean {
    return Runtime.runSync(this.runtime)(
      Effect.gen(function* () {
        const service = yield* ExecutionContextService
        return yield* service.hasVariable(key)
      })
    )
  }
  
  delete(key: string): boolean {
    return Runtime.runSync(this.runtime)(
      Effect.gen(function* () {
        const service = yield* ExecutionContextService
        yield* service.deleteVariable(key)
        return true
      })
    )
  }
  
  createScope(): VariableScope {
    Runtime.runSync(this.runtime)(
      Effect.gen(function* () {
        const service = yield* ExecutionContextService
        yield* service.createChildContext()
      })
    )
    return new VariableScopeAdapter(this.runtime)
  }
  
  getParentScope(): Option.Option<VariableScope> {
    // Parent scope management is handled internally by the service
    return Option.none()
  }
  
  getKeys(): string[] {
    return Runtime.runSync(this.runtime)(
      Effect.gen(function* () {
        const service = yield* ExecutionContextService
        return yield* service.listVariables()
      })
    )
  }
  
  clear(): void {
    Runtime.runSync(this.runtime)(
      Effect.gen(function* () {
        const service = yield* ExecutionContextService
        yield* service.clearVariables()
      })
    )
  }
}

/**
 * Worker Pool Adapter
 */
class WorkerPoolAdapter implements WorkerPool {
  constructor(private runtime: Runtime.Runtime<ExecutionContextService>) {}
  
  execute<T>(task: () => Promise<T>): Effect.Effect<T, unknown> {
    return Runtime.runPromise(this.runtime)(
      Effect.gen(function* () {
        const service = yield* (ExecutionContextService)
        return yield* (service.submitTask(task))
      })
    ).then(result => Effect.succeed(result)).catch(error => Effect.fail(error)) as any
  }
  
  executeParallel<T>(tasks: Array<() => Promise<T>>): Effect.Effect<T[], unknown> {
    return Runtime.runPromise(this.runtime)(
      Effect.gen(function* () {
        const service = yield* (ExecutionContextService)
        return yield* (service.submitParallelTasks(tasks))
      })
    ).then(result => Effect.succeed(result)).catch(error => Effect.fail(error)) as any
  }
  
  getAvailableWorkers(): number {
    return Runtime.runSync(this.runtime)(
      Effect.gen(function* () {
        const service = yield* ExecutionContextService
        const stats = yield* service.getWorkerStats()
        return stats.available
      })
    )
  }
  
  getMaxWorkers(): number {
    return Runtime.runSync(this.runtime)(
      Effect.gen(function* () {
        const service = yield* ExecutionContextService
        const stats = yield* service.getWorkerStats()
        return stats.total
      })
    )
  }
  
  setMaxWorkers(count: number): void {
    Runtime.runSync(this.runtime)(
      Effect.gen(function* () {
        const service = yield* ExecutionContextService
        yield* service.setMaxWorkers(count)
      })
    )
  }
  
  shutdown(): Effect.Effect<void, never> {
    return Effect.promise(() => 
      Runtime.runPromise(this.runtime)(
        Effect.gen(function* () {
          const service = yield* (ExecutionContextService)
          yield* (service.dispose())
        })
      )
    )
  }
}

/**
 * Pause/Resume Manager Adapter
 */
class PauseResumeManagerAdapter implements PauseResumeManager {
  constructor(private runtime: Runtime.Runtime<ExecutionContextService>) {}
  
  pause<T>(prompt: string): Effect.Effect<T, never> {
    return Effect.promise(() =>
      Runtime.runPromise(this.runtime)(
        Effect.gen(function* () {
          const service = yield* (ExecutionContextService)
          return yield* (service.pause<T>(prompt))
        })
      )
    ) as Effect.Effect<T, never>
  }
  
  resume<T>(value: T): void {
    Runtime.runSync(this.runtime)(
      Effect.gen(function* () {
        const service = yield* ExecutionContextService
        yield* service.resume(value)
      })
    )
  }
  
  isPaused(): boolean {
    return Runtime.runSync(this.runtime)(
      Effect.gen(function* () {
        const service = yield* ExecutionContextService
        return yield* service.isPaused()
      })
    )
  }
  
  getCurrentPrompt(): Option.Option<string> {
    return Runtime.runSync(this.runtime)(
      Effect.gen(function* () {
        const service = yield* ExecutionContextService
        return yield* service.getPausePrompt()
      })
    )
  }
  
  cancel(): void {
    Runtime.runSync(this.runtime)(
      Effect.gen(function* () {
        const service = yield* ExecutionContextService
        yield* service.cancelPause()
      })
    )
  }
}

/**
 * Flow Control Manager Adapter
 */
class FlowControlManagerAdapter implements FlowControlManager {
  constructor(private runtime: Runtime.Runtime<ExecutionContextService>) {}
  
  get isParallelContext(): boolean {
    // This would need to track state, simplified for now
    return false
  }
  
  get canBreak(): boolean {
    return !this.isParallelContext
  }
  
  get canContinue(): boolean {
    return !this.isParallelContext
  }
  
  break(): void {
    Runtime.runSync(this.runtime)(
      Effect.gen(function* () {
        const service = yield* ExecutionContextService
        yield* service.signalBreak()
      })
    )
  }
  
  continue(): void {
    Runtime.runSync(this.runtime)(
      Effect.gen(function* () {
        const service = yield* ExecutionContextService
        yield* service.signalContinue()
      })
    )
  }
  
  enterSequentialContext(): void {
    Runtime.runSync(this.runtime)(
      Effect.gen(function* () {
        const service = yield* ExecutionContextService
        yield* service.enterSequentialContext()
      })
    )
  }
  
  enterParallelContext(): void {
    Runtime.runSync(this.runtime)(
      Effect.gen(function* () {
        const service = yield* ExecutionContextService
        yield* service.enterParallelContext()
      })
    )
  }
  
  exitContext(): void {
    Runtime.runSync(this.runtime)(
      Effect.gen(function* () {
        const service = yield* ExecutionContextService
        yield* service.exitContext()
      })
    )
  }
  
  shouldBreak(): boolean {
    return Runtime.runSync(this.runtime)(
      Effect.gen(function* () {
        const service = yield* ExecutionContextService
        return yield* service.checkBreak()
      })
    )
  }
  
  shouldContinue(): boolean {
    return Runtime.runSync(this.runtime)(
      Effect.gen(function* () {
        const service = yield* ExecutionContextService
        return yield* service.checkContinue()
      })
    )
  }
  
  reset(): void {
    Runtime.runSync(this.runtime)(
      Effect.gen(function* () {
        const service = yield* ExecutionContextService
        yield* service.resetFlowControl()
      })
    )
  }
}

/**
 * Backward compatibility adapter for ExecutionContextImpl
 * Maintains the original class-based API
 */
export class ExecutionContextImpl implements EnhancedExecutionContext {
  private runtime: Runtime.Runtime<ExecutionContextService>
  public readonly variableScope: VariableScope
  public readonly workers: WorkerPool
  public readonly pauseResume: PauseResumeManager
  public readonly flowControl: FlowControlManager
  
  constructor(options: {
    flowId?: string
    stepId?: string
    sessionId?: string
    variables?: VariableScope
    workers?: WorkerPool
    pauseResume?: PauseResumeManager
    flowControl?: FlowControlManager
    metadata?: Record<string, unknown>
  } = {}) {
    // Create runtime with the ExecutionContextService layer
    this.runtime = Layer.toRuntime(ExecutionContextService.Default).pipe(
      Effect.scoped,
      Effect.runSync
    )
    
    // Initialize service with options
    Runtime.runSync(this.runtime)(
      Effect.gen(function* () {
        const service = yield* ExecutionContextService
        if (options.flowId) yield* service.setFlowId(options.flowId)
        if (options.stepId) yield* service.setStepId(options.stepId)
        if (options.sessionId) yield* service.setSessionId(options.sessionId)
        
        if (options.metadata) {
          for (const [key, value] of Object.entries(options.metadata)) {
            yield* service.setMetadata(key, value)
          }
        }
      })
    )
    
    // Create adapters
    this.variableScope = options.variables || new VariableScopeAdapter(this.runtime)
    this.workers = options.workers || new WorkerPoolAdapter(this.runtime)
    this.pauseResume = options.pauseResume || new PauseResumeManagerAdapter(this.runtime)
    this.flowControl = options.flowControl || new FlowControlManagerAdapter(this.runtime)
  }
  
  get flowId(): string {
    return Runtime.runSync(this.runtime)(
      Effect.gen(function* () {
        const service = yield* ExecutionContextService
        return yield* service.getFlowId()
      })
    )
  }
  
  get stepId(): string {
    return Runtime.runSync(this.runtime)(
      Effect.gen(function* () {
        const service = yield* ExecutionContextService
        return yield* service.getStepId()
      })
    )
  }
  
  get sessionId(): string {
    return Runtime.runSync(this.runtime)(
      Effect.gen(function* () {
        const service = yield* ExecutionContextService
        return yield* service.getSessionId()
      })
    )
  }
  
  get variables(): Record<string, unknown> {
    const keys = this.variableScope.getKeys()
    const result: Record<string, unknown> = {}
    
    for (const key of keys) {
      const value = this.variableScope.get(key)
      if (Option.isSome(value)) {
        result[key] = value.value
      }
    }
    
    return result
  }
  
  get metadata(): Record<string, unknown> {
    // Simplified - would need to track all metadata keys
    return {}
  }
  
  createChildContext(scope?: Partial<VariableScope>): EnhancedExecutionContext {
    Runtime.runSync(this.runtime)(
      Effect.gen(function* () {
        const service = yield* ExecutionContextService
        yield* service.createChildContext()
      })
    )
    
    return new ExecutionContextImpl({
      flowId: this.flowId,
      stepId: this.stepId,
      sessionId: this.sessionId,
      variables: this.variableScope.createScope()
    })
  }
  
  dispose(): Effect.Effect<void, never, never> {
    return Effect.promise(() =>
      Runtime.runPromise(this.runtime)(
        Effect.gen(function* () {
          const service = yield* ExecutionContextService
          yield* service.dispose()
        })
      )
    )
  }
}

/**
 * Factory functions for backward compatibility
 */
export class VariableScopeImpl extends VariableScopeAdapter {
  constructor(parent?: VariableScope) {
    const runtime = Layer.toRuntime(ExecutionContextService.Default).pipe(
      Effect.scoped,
      Effect.runSync
    )
    super(runtime)
  }
}

export class WorkerPoolImpl extends WorkerPoolAdapter {
  constructor(maxWorkers: number = 4) {
    const runtime = Layer.toRuntime(ExecutionContextService.Default).pipe(
      Effect.scoped,
      Effect.runSync
    )
    super(runtime)
    this.setMaxWorkers(maxWorkers)
  }
}

export class PauseResumeManagerImpl extends PauseResumeManagerAdapter {
  constructor() {
    const runtime = Layer.toRuntime(ExecutionContextService.Default).pipe(
      Effect.scoped,
      Effect.runSync
    )
    super(runtime)
  }
}

export class FlowControlManagerImpl extends FlowControlManagerAdapter {
  constructor() {
    const runtime = Layer.toRuntime(ExecutionContextService.Default).pipe(
      Effect.scoped,
      Effect.runSync
    )
    super(runtime)
  }
}
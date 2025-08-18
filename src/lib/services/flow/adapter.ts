import { Effect, Layer, Runtime, ManagedRuntime } from 'effect'
import { DynamicFlowService } from './service'
import { CacheService } from '../cache/service'
import { ModelPoolService } from '../model-pool/service'
import { IRExecutorService } from '../executor/service'
import { StateService } from '../state/service'
import { InMemoryCacheLive } from '../cache/in-memory'
import { OpenAIPoolLive } from '../model-pool/openai'
import type { ValidatedFlow, AiModel, DynamicFlowOptions } from '../../generation/types'
import type { UntypedToolArray, ToolJoin } from '../../tools/types'

// Default layers for backward compatibility
const DefaultLayers = Layer.mergeAll(
  InMemoryCacheLive(),
  OpenAIPoolLive,
  Layer.succeed(IRExecutorService, {
    execute: () => Effect.succeed({ value: undefined, state: {}, logs: [], duration: 0 }),
    validate: () => Effect.succeed(true),
    optimise: (ir: any) => Effect.succeed(ir),
    compile: () => Effect.succeed({})
  } as any),
  Layer.succeed(StateService, {
    get: () => Effect.succeed(undefined),
    set: () => Effect.void,
    has: () => Effect.succeed(false),
    delete: () => Effect.void,
    getAll: () => Effect.succeed({}),
    clear: () => Effect.void,
    initialise: () => Effect.void,
    checkpoint: () => Effect.succeed('checkpoint-1'),
    restore: () => Effect.void,
    getLogs: () => Effect.succeed([]),
    log: () => Effect.void
  } as any)
)

// Create runtime with default services including DynamicFlowService
import { ConfigService } from '../config'

const AllLayers = Layer.mergeAll(
  DefaultLayers,
  DynamicFlowService.Default,
  Layer.succeed(ConfigService, {
    get: (key: string) => Effect.succeed(undefined),
    getAll: () => Effect.succeed({}),
    set: () => Effect.void,
    has: () => Effect.succeed(false)
  } as any)
)

const runtime = ManagedRuntime.make(AllLayers as any).pipe(
  Effect.runSync
) as any

/**
 * Backward compatibility adapter for DynamicFlowOrchestrator
 */
export class DynamicFlowOrchestratorAdapter {
  private runtime = runtime

  async execute(config: {
    prompt: string;
    tools: UntypedToolArray;
    joins: ReadonlyArray<ToolJoin<any, any>>;
    model: AiModel;
    options?: DynamicFlowOptions | undefined;
    input?: unknown | undefined;
  }): Promise<ValidatedFlow> {
    return Runtime.runPromise(this.runtime)(
      Effect.gen(function* () {
        const flowService = yield* DynamicFlowService
        
        // Generate flow from prompt
        const flow = yield* flowService.generateFromPrompt(config.prompt, {
          tools: config.tools as any,
          joins: config.joins as any,
          model: config.model,
          options: config.options,
          initialState: config.input ? { input: config.input } : undefined
        } as any)
        
        // Validate and return
        return yield* flowService.validate(flow)
      })
    )
  }

  async compile(config: {
    prompt: string;
    tools: UntypedToolArray;
    joins: ReadonlyArray<ToolJoin<any, any>>;
    model: AiModel;
    options?: DynamicFlowOptions | undefined;
  }): Promise<ValidatedFlow> {
    return this.execute({ ...config, input: undefined })
  }
}

/**
 * Backward compatibility adapter for DynamicFlow
 */
export class DynamicFlowAdapter {
  private runtime = runtime
  private config: any

  constructor(config?: any) {
    this.config = config || {}
  }

  static create(config: any): DynamicFlowAdapter {
    return new DynamicFlowAdapter(config)
  }

  async execute(input?: unknown): Promise<any> {
    const config = this.config
    return Runtime.runPromise(this.runtime)(
      Effect.gen(function* () {
        const flowService = yield* DynamicFlowService
        
        // Create flow from config
        const flow = yield* flowService.create({
          ...config,
          initialState: input ? { input } : undefined
        })
        
        // Execute flow
        const result = yield* flowService.execute(flow)
        
        return (result as any).value
      })
    )
  }

  async validate(): Promise<boolean> {
    const config = this.config
    return Runtime.runPromise(this.runtime)(
      Effect.gen(function* () {
        const flowService = yield* DynamicFlowService
        
        // Create and validate flow
        const flow = yield* flowService.create(config)
        const validated = yield* flowService.validate(flow)
        
        return validated.warnings.length === 0
      })
    )
  }
}

// Export adapters with original names for drop-in replacement
export { DynamicFlowOrchestratorAdapter as DynamicFlowOrchestrator }
export { DynamicFlowAdapter as DynamicFlow }
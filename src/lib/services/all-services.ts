import { Layer } from 'effect'

// Core Infrastructure Services
export { ToolRegistryService } from './tools/registry'
export { OperatorRegistryService } from './operators/registry'
export { ExecutionContextService, ExecutionContextTest } from './execution/context'

// Operator Services
export { 
  ReduceOperatorService,
  DefaultReduceOperatorService,
  ParallelReduceOperatorService,
  StreamingReduceOperatorService
} from './operators/reduce'
export {
  MapOperatorService,
  SequentialMapOperatorService,
  ParallelMapOperatorService,
  BatchedMapOperatorService
} from './operators/map'
export {
  FilterOperatorService,
  DefaultFilterOperatorService,
  ParallelFilterOperatorService,
  CompositeFilterOperatorService
} from './operators/filter'
export { SwitchOperatorService } from './operators/switch'
export { LoopOperatorService } from './operators/loop'
export {
  ConditionalOperatorService,
  DefaultConditionalOperatorService,
  NestedConditionalOperatorService,
  TernaryConditionalOperatorService
} from './operators/conditional'
export { 
  OperatorService,
  OperatorServiceLive,
  OperatorServiceParallel,
  OperatorServiceTest
} from './operators/unified'

// LLM and Builder Services
export {
  LLMService,
  OpenAILLMService,
  AnthropicLLMService,
  LocalLLMService,
  TestLLMService
} from './llm/service'
export { ToolBuilderService } from './tools/builder'

// Flow and Validation Services
export { ValidationService } from './validation/service'
export { FlowGeneratorService } from './flow/generator'
export { IRBuilderService } from './ir/builder'

// Supporting Services
export { PauseResumeService } from './execution/pause-resume'
export { StreamExecutorService } from './execution/stream-executor'
export { ErrorRecoveryService } from './execution/error-recovery'
export { CacheWarmerService } from './cache/warmer'
export { BackendFactoryService } from './persistence/backend-factory'

// Existing Services (already migrated)
export { ConfigService } from './config/service'
export { CacheService, InMemoryCacheLive, CacheTest } from './cache'
export { ModelPoolService } from './model-pool/service'
export { ModelPoolLive, ModelPoolTest } from './model-pool'
export { StateService } from './state/service'
export { StateServiceLive, StateServiceTest } from './state'
export { PersistenceService } from './persistence/service'
export { PersistenceServiceLive, PersistenceServiceTest } from './persistence'
export { DynamicFlowService } from './flow/service'
export { DynamicFlowServiceImpl } from './flow/implementation'
export { IRExecutorService } from './executor/service'
export { IRExecutorServiceImpl } from './executor/implementation'

/**
 * Complete service layer with all services
 */
export const AllServicesLive = Layer.empty // Services are composed in layers as needed

/**
 * Test service layer with mock implementations
 */
export const AllServicesTest = Layer.empty // Test layers are composed as needed

/**
 * Minimal service layer for basic operations
 */
export const MinimalServicesLive = Layer.empty // Services are composed in layers as needed

/**
 * Service types for convenience
 */
export type Services = {
  // Services are typed as needed when imported
  [key: string]: any
}
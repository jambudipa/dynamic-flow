import { Effect } from 'effect'
import { FlowError, ValidationError, ExecutionError } from '../../errors'
import { CacheService } from '../cache/service'
import { ModelPoolService } from '../model-pool/service'
import type { ExecutionResult, ValidatedFlow } from '../../generation/types'
import type { Flow, FlowConfig } from './implementation' // Import from implementation where they're defined

import { DynamicFlowServiceImpl } from './implementation'

/**
 * Dynamic flow orchestration service.
 * Uses Effect.Service as there's a single core implementation.
 */
export class DynamicFlowService extends Effect.Service<DynamicFlowService>()('DynamicFlowService', {
  effect: DynamicFlowServiceImpl
}) {}
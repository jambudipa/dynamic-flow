export { ModelPoolService, type ModelInstance, type PoolStats } from './service'
export { OpenAIPoolLive } from './openai'
export { AnthropicPoolLive } from './anthropic'
export { ModelPoolTest } from './test'

// Default pool based on config
import { Layer, Effect } from 'effect'
import { ConfigService } from '../config/service'
import { OpenAIPoolLive } from './openai'
import { AnthropicPoolLive } from './anthropic'

/**
 * Default model pool that selects provider based on configuration
 */
export const ModelPoolLive = OpenAIPoolLive // Default to OpenAI for now
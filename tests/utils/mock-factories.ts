/**
 * Mock factory utilities for testing
 * 
 * Provides factories for creating mock objects used in tests
 */

import { Effect } from 'effect'
import type { LLMProvider } from '@lib/llm/types'
import type { Tool } from '@lib/tools/types'
import type { Flow } from '@lib/flow/types'
import type { IR, IRNode } from '@lib/ir/types'
import { faker } from '@faker-js/faker'

/**
 * Create a mock LLM provider
 */
export const createMockLLMProvider = (
  responses: Map<string, string> = new Map()
): LLMProvider => {
  return {
    generate: (prompt: string) => {
      const response = responses.get(prompt) || `Mock response for: ${prompt}`
      return Effect.succeed(response)
    },
    generateStreaming: (prompt: string) => {
      const response = responses.get(prompt) || `Mock streaming response for: ${prompt}`
      return Effect.succeed(response)
    },
    generateWithSchema: (prompt: string, schema: any) => {
      const response = responses.get(prompt) || { mockData: true }
      return Effect.succeed(response)
    }
  }
}

/**
 * Create a mock tool
 */
export const createMockTool = <I = any, O = any>(
  overrides?: Partial<Tool<I, O>>
): Tool<I, O> => {
  return {
    id: overrides?.id || faker.string.uuid(),
    name: overrides?.name || faker.commerce.productName(),
    description: overrides?.description || faker.lorem.sentence(),
    inputSchema: overrides?.inputSchema || {},
    outputSchema: overrides?.outputSchema || {},
    execute: overrides?.execute || ((input: I) => Effect.succeed({} as O)),
    ...overrides
  }
}

/**
 * Create a mock flow configuration
 */
export const createMockFlow = (config?: Partial<Flow>): Flow => {
  return {
    id: config?.id || faker.string.uuid(),
    name: config?.name || faker.commerce.productName(),
    description: config?.description || faker.lorem.sentence(),
    nodes: config?.nodes || [],
    edges: config?.edges || [],
    metadata: config?.metadata || {},
    ...config
  }
}

/**
 * Create a mock IR node
 */
export const createMockIRNode = (overrides?: Partial<IRNode>): IRNode => {
  return {
    id: overrides?.id || faker.string.uuid(),
    type: overrides?.type || 'transform',
    inputs: overrides?.inputs || [],
    outputs: overrides?.outputs || [],
    config: overrides?.config || {},
    ...overrides
  }
}

/**
 * Create a mock IR
 */
export const createMockIR = (nodes?: IRNode[]): IR => {
  const mockNodes = nodes || [
    createMockIRNode({ id: 'node1' }),
    createMockIRNode({ id: 'node2', inputs: ['node1'] })
  ]
  
  return {
    version: '1.0.0',
    nodes: mockNodes,
    entryPoint: mockNodes[0]?.id || 'entry',
    metadata: {
      createdAt: new Date().toISOString(),
      generator: 'mock-factory'
    }
  }
}

/**
 * Create a mock execution context
 */
export const createMockExecutionContext = (overrides?: any) => {
  return {
    flowId: faker.string.uuid(),
    executionId: faker.string.uuid(),
    startTime: new Date(),
    state: new Map(),
    logger: {
      info: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn()
    },
    ...overrides
  }
}

/**
 * Create mock LLM responses for common scenarios
 */
export const createCommonLLMResponses = (): Map<string, string> => {
  const responses = new Map<string, string>()
  
  // Common flow generation response
  responses.set('generate-flow', JSON.stringify({
    nodes: [
      { id: 'start', type: 'input' },
      { id: 'process', type: 'transform' },
      { id: 'end', type: 'output' }
    ],
    edges: [
      { from: 'start', to: 'process' },
      { from: 'process', to: 'end' }
    ]
  }))
  
  // Error scenario response
  responses.set('error-prompt', JSON.stringify({
    error: 'Invalid request'
  }))
  
  return responses
}

/**
 * Create a mock state store
 */
export const createMockStateStore = () => {
  const store = new Map<string, any>()
  
  return {
    get: (key: string) => Effect.succeed(store.get(key)),
    set: (key: string, value: any) => {
      store.set(key, value)
      return Effect.succeed(void 0)
    },
    delete: (key: string) => {
      store.delete(key)
      return Effect.succeed(void 0)
    },
    clear: () => {
      store.clear()
      return Effect.succeed(void 0)
    },
    size: () => Effect.succeed(store.size)
  }
}

/**
 * Create a mock cache service
 */
export const createMockCacheService = () => {
  const cache = new Map<string, any>()
  
  return {
    get: (key: string) => cache.get(key),
    set: (key: string, value: any, ttl?: number) => {
      cache.set(key, value)
      if (ttl) {
        setTimeout(() => cache.delete(key), ttl)
      }
    },
    has: (key: string) => cache.has(key),
    delete: (key: string) => cache.delete(key),
    clear: () => cache.clear(),
    size: () => cache.size
  }
}

/**
 * Create test fixtures for complex scenarios
 */
export const createTestFixtures = () => {
  return {
    simpleFlow: createMockFlow({
      name: 'Simple Sequential Flow',
      nodes: [
        { id: 'input', type: 'input' },
        { id: 'transform', type: 'transform' },
        { id: 'output', type: 'output' }
      ],
      edges: [
        { from: 'input', to: 'transform' },
        { from: 'transform', to: 'output' }
      ]
    }),
    
    parallelFlow: createMockFlow({
      name: 'Parallel Processing Flow',
      nodes: [
        { id: 'input', type: 'input' },
        { id: 'branch1', type: 'transform' },
        { id: 'branch2', type: 'transform' },
        { id: 'merge', type: 'merge' },
        { id: 'output', type: 'output' }
      ],
      edges: [
        { from: 'input', to: 'branch1' },
        { from: 'input', to: 'branch2' },
        { from: 'branch1', to: 'merge' },
        { from: 'branch2', to: 'merge' },
        { from: 'merge', to: 'output' }
      ]
    }),
    
    conditionalFlow: createMockFlow({
      name: 'Conditional Routing Flow',
      nodes: [
        { id: 'input', type: 'input' },
        { id: 'condition', type: 'condition' },
        { id: 'trueBranch', type: 'transform' },
        { id: 'falseBranch', type: 'transform' },
        { id: 'output', type: 'output' }
      ],
      edges: [
        { from: 'input', to: 'condition' },
        { from: 'condition', to: 'trueBranch', condition: 'true' },
        { from: 'condition', to: 'falseBranch', condition: 'false' },
        { from: 'trueBranch', to: 'output' },
        { from: 'falseBranch', to: 'output' }
      ]
    })
  }
}
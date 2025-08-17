/**
 * @fileoverview DynamicFlow – Main Entry Point
 *
 * @description This is the main entry point for the DynamicFlow library. It provides
 * a complete surface API for building both static (programmatic) and dynamic (AI-generated)
 * workflows using functional composition patterns built on Effect.js.
 *
 * ## Key Exports
 *
 * ### Core Flow Operations
 * - `Flow` - Namespace containing all pipeable flow operations
 * - Use `pipe` and `Effect` directly from `effect`
 * - `Tools` - Tool creation and management utilities
 *
 * ### Dynamic Flow Generation
 * - `DynamicFlow` - AI-powered workflow generation from natural language
 * - `ValidatedFlowInstance` - Wrapper for compiled and validated flows
 *
 * ### Tool System
 * - Tool creation functions and interfaces
 * - Registry management for tool discovery and execution
 * - Type-safe tool composition with schema validation
 *
 * ### Execution Engine
 * - IR (Intermediate Representation) types and compilation
 * - Streaming execution with real-time events
 * - State management and context handling
 *
 * ## Usage Examples
 *
 * ### Static Flow (Programmatic)
 * ```typescript
 * import { Flow } from '@jambudipa/dynamic-flow'
 * import { Effect, pipe } from 'effect'
 *
 * const myFlow = pipe(
 *   Effect.succeed("Hello"),
 *   Flow.andThen(greeting => Effect.succeed(`${greeting}, World!`)),
 *   Flow.map(message => message.toUpperCase())
 * )
 *
 * const result = await Flow.run(myFlow)
 * ```
 *
 * ### Dynamic Flow (AI-Generated)
 * ```typescript
 * import { DynamicFlow, Tools } from '@jambudipa/dynamic-flow'
 * import { OpenAi } from '@effect/ai-openai'
 *
 * await DynamicFlow.execute({
 *   prompt: "Check weather and send email summary",
 *   tools: [weatherTool, emailTool],
 *   joins: [],
 *   model: OpenAi.completion('gpt-4')
 * })
 * ```
 *
 * ### Tool Creation
 * ```typescript
 * import { Tools } from '@jambudipa/dynamic-flow'
 * import * as S from 'effect/Schema'
 *
 * const myTool = Tools.createTool({
 *   id: 'myTool',
 *   name: 'My Tool',
 *   description: 'Does something useful',
 *   inputSchema: S.Struct({ input: S.String }),
 *   outputSchema: S.Struct({ output: S.String }),
 *   execute: (input, context) => Effect.succeed({ output: input.input.toUpperCase() })
 * })
 * ```
 *
 * @since 0.1.0
 * @author DynamicFlow Contributors
 * @license MIT
 */

// ============= Re-exports =============

/**
 * Core pipeable operations for functional workflow composition.
 *
 * @example
 * ```typescript
 * import { Flow, Tools } from '@jambudipa/dynamic-flow'
 * import { pipe, Effect } from 'effect'
 *
 * const workflow = pipe(
 *   Effect.succeed(input),
 *   Flow.andThen(Tools.createTool(myTool)),
 *   Flow.map(result => result.data)
 * )
 * ```
 */
export { Flow, Tools } from './flow/flow';

/**
 * Utility functions for creating and managing Effects in flows.
 *
 * These functions provide convenient ways to create Effects from various sources:
 * - `succeed`: Create a successful Effect from a value
 * - `fail`: Create a failing Effect from an error
 * - `sync`: Create an Effect from a synchronous function
 * - `promise`: Create an Effect from a Promise-returning function
 * - `fromEffect`: Convert an existing Effect to a Flow-compatible type
 * - `provideContext`: Provide context/environment to an Effect
 * - `typed`: Add explicit typing to an Effect
 */
export {
  succeed,
  fail,
  sync,
  promise,
  fromEffect,
  provideContext,
  typed,
} from './flow/index';

// Flow types - removed due to missing module
// export type { ... } from './flow/types';

/**
 * AI-powered workflow generation system.
 *
 * The `DynamicFlow` class enables natural language prompts to be converted into
 * complete execution graphs by Large Language Models. This is the core innovation
 * of DynamicFlow - runtime graph generation rather than static workflow definition.
 *
 * @example
 * ```typescript
 * import { DynamicFlow } from '@jambudipa/dynamic-flow'
 * import { OpenAi } from '@effect/ai-openai'
 *
 * // Generate and execute workflow from natural language
 * await DynamicFlow.execute({
 *   prompt: "Process customer order: validate payment, check inventory, create shipment",
 *   tools: [paymentTool, inventoryTool, shippingTool],
 *   joins: [],
 *   model: OpenAi.completion('gpt-4')
 * })
 * ```
 */
export { DynamicFlow } from './generation';

/**
 * Container for compiled and validated dynamic flows.
 *
 * A `ValidatedFlowInstance` wraps a compiled workflow with its associated tools,
 * joins, and metadata. It provides methods for execution with both streaming
 * and non-streaming modes.
 *
 * @example
 * ```typescript
 * // Generate workflow instance
 * const instance = await DynamicFlow.generate({
 *   prompt: "Send welcome email to new users",
 *   tools: [emailTool, userTool],
 *   joins: [],
 *   model
 * })
 *
 * // Execute with streaming events
 * const events = instance.run()
 *
 * // Or execute and collect final result
 * const result = await Effect.runPromise(
 *   instance.runCollect({ userId: '123' })
 * )
 * ```
 */
export { ValidatedFlowInstance } from './generation/validated-flow-instance';

// Compilation service removed - IR compilation is now integrated

// Re-export unified core types and utilities.
export * from './core';

// Export unified operators
export * from './operators';

// Export types from other modules (selective to avoid conflicts)
export {
  type Step,
  type ArgumentValue,
  isVariableReference,
  extractVariableName,
  DynamicFlow as DynamicFlowSchema,
  type DynamicFlowType,
  type StepType,
  type FlatStepType,
  type FlatDynamicFlowType,
} from './schema/flow-schema';

// Validator exports - removed due to missing module
// export { ... } from './validator/flow-validator';

// Export IR types
export {
  type IR,
  type IRMetadata,
  type IRGraph,
  type IRRegistry,
  type IRNode,
  type IREdge,
  type IRCondition,
  type IRValue,
  type BaseIRNode,
  type ToolNode,
  type ConditionalNode,
  type ParallelNode,
  type SequenceNode,
  type LoopNode,
  type NodeConfig,
  IRCompilationError,
  IRValidationError,
  IRBuilder,
} from './ir';

// Export JSON to IR compiler
export {
  JSONToIRCompiler,
  createCompiler,
  compileToIR,
} from './compiler/json-to-ir';

// Export IR executor
export {
  IRExecutor,
  createIRExecutor,
  executeIR,
  executeIRStream,
  type IRExecutionOptions,
  type IRExecutionEvent,
} from './engine/ir-executor';

export {
  type Tool,
  type LLMTool,
  type LLMConfig,
  type ToolConfig,
  type ToolRegistry,
  type ToolExecutor,
  type ToolResult,
  type ToolMetadata,
  type ToolError,
  type ToolJoin,
  RegistrationError,
  ToolNotFoundError,
  ValidationError,
  ParseError,
  TimeoutError,
  /** @deprecated Use Tools.createTool() instead */
  tool,
} from './tools/types';

export {
  ToolRegistryImpl,
  createRegistry,
  createRegistryWithTools,
  getGlobalRegistry,
  resetGlobalRegistry,
  registerMany,
  findTools,
  getMany,
} from './tools/registry';

// Routing in dynamic flows is not supported; no router tool export

// LLM adapter exports - removed due to missing module
// export { ... } from './llm/adapter';

// LLM Effect service exports
export {
  LLMService as LLMServiceTag,
  LLMLive,
  type LLMRuntime,
} from './llm/service';

export {
  type StateManager,
  type StateSnapshot,
  type VariableMetadata,
  StateError,
  VariableNotFoundError,
  createStateManager,
  createStateManagerWithInitial,
} from './state/manager';

// Engine executor exports - removed due to missing module
// export { ... } from './engine/executor';

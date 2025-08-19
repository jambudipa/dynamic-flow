/**
 * Base interface and types for Unified Operators
 *
 * @module operators/base
 *
 * The unified operator architecture provides a single source of truth for:
 * - Schema definitions (recursive and flat representations)
 * - Runtime execution logic using Effect
 * - Bidirectional transformation between recursive and flat formats
 * - IR (Intermediate Representation) generation for compilation
 *
 * Each operator encapsulates all knowledge about its specific operation,
 * making the system extensible and maintainable.
 *
 * @example
 * ```typescript
 * import { UnifiedOperator } from './base';
 *
 * class MyOperator implements UnifiedOperator<MyConfig> {
 *   // Implementation
 * }
 * ```
 */

import type { Effect } from 'effect';
import { Schema } from 'effect';
import type { Tool, ToolJoin } from '@/lib/tools/types';
import type { IRNode } from '@/lib/ir';

/**
 * Base interface for all unified operators
 *
 * @interface UnifiedOperator
 * @template Config - The configuration type for this operator
 * @template Input - The input type this operator accepts
 * @template Output - The output type this operator produces
 *
 * @description
 * Unified operators are the core building blocks of DynamicFlow. Each operator
 * encapsulates all aspects of a flow operation including schema validation,
 * execution logic, and IR generation.
 */
export interface UnifiedOperator<Config = any, Input = any, Output = any> {
  /**
   * Human-readable name of the operator
   * @example "Conditional Branch"
   */
  readonly name: string;

  /**
   * Unique type identifier for this operator
   * @example "conditional"
   */
  readonly type: string;

  /**
   * Description of what this operator does
   * @example "Executes different branches based on a condition"
   */
  readonly description: string;

  /**
   * Schema for the recursive (nested) representation of this operator
   *
   * @description
   * The recursive schema allows nesting of other operators within this one,
   * enabling complex flow compositions.
   *
   * @example
   * ```typescript
   * Schema.Struct({
   *   condition: Schema.String,
   *   if_true: Schema.Array(StepSchema),
   *   if_false: Schema.Array(StepSchema)
   * })
   * ```
   */
  readonly recursiveSchema: Schema.Schema<Config>;

  /**
   * Schema for the flat representation of this operator
   *
   * @description
   * The flat schema uses IDs to reference other steps instead of nesting,
   * useful for serialization and avoiding circular references.
   *
   * @example
   * ```typescript
   * Schema.Struct({
   *   condition: Schema.String,
   *   ifTrueIds: Schema.Array(Schema.String),
   *   ifFalseIds: Schema.Array(Schema.String)
   * })
   * ```
   */
  readonly flatSchema: Schema.Schema<any>;

  /**
   * Executes the operator with the given input and configuration
   *
   * @param input - The input data to process
   * @param config - The operator configuration
   * @param context - The execution context containing tools, variables, etc.
   * @returns An Effect that produces the output or an error
   *
   * @example
   * ```typescript
   * execute(data, { condition: "$value > 10" }, ctx)
   * ```
   */
  execute(
    input: Input,
    config: Config,
    context: ExecutionContext
  ): Effect.Effect<Output, any, any>;

  /**
   * Converts a recursive configuration to flat format
   *
   * @param recursive - The recursive configuration
   * @returns The flat representation
   *
   * @description
   * Replaces nested step objects with their IDs for serialization
   */
  toFlat(recursive: Config): any;

  /**
   * Converts a flat configuration back to recursive format
   *
   * @param flat - The flat configuration
   * @param resolver - Optional resolver to lookup steps by ID
   * @returns The recursive configuration
   *
   * @description
   * Resolves step IDs back to their full objects for execution
   */
  fromFlat(flat: any, resolver?: StepResolver): Config;

  /**
   * Generates an IR node for this operator
   *
   * @param config - The operator configuration
   * @param context - Context for IR generation including node ID generator
   * @returns The IR node representation
   *
   * @description
   * Converts the operator configuration into an executable IR node that
   * can be processed by the DynamicFlow engine.
   */
  toIR(config: Config, context: IRGenerationContext): IRNode;
}

/**
 * Execution context passed to operators during runtime
 *
 * @interface ExecutionContext
 *
 * @description
 * Contains all the runtime state and dependencies needed for operator execution
 * including available tools, variables, and metadata.
 */
export interface ExecutionContext {
  tools: Map<string, Tool<any, any>>;
  joins: Map<string, ToolJoin<any, any>>;
  state: Map<string, any>;
  variables: Map<string, any>;
  metadata?: {
    flowId?: string;
    executionId?: string;
    timestamp?: number;
  };
}

/**
 * Context for IR generation during compilation
 *
 * @interface IRGenerationContext
 *
 * @description
 * Provides utilities and registries needed during the compilation of
 * operators into IR nodes.
 */
export interface IRGenerationContext {
  nodeIdGenerator: () => string;
  tools?: Map<string, Tool<any, any>>;
  joins?: Map<string, ToolJoin<any, any>>;
  validateConnections?: boolean;
  addNode: (node: IRNode) => void;
}

/**
 * Resolves step IDs to actual step objects
 *
 * @interface StepResolver
 *
 * @description
 * Used during flat-to-recursive conversion to lookup step objects by their IDs.
 * This enables reconstruction of the nested flow structure from flat format.
 */
export interface StepResolver {
  resolve(id: string): any;

  resolveMany(ids: string[]): any[];
}

/**
 * Common fields shared by all operator configurations
 *
 * @constant BaseFields
 *
 * @description
 * These fields are present in every operator configuration providing
 * common functionality like output variable assignment, timeouts, and retries.
 *
 * @example
 * ```typescript
 * const mySchema = Schema.Struct({
 *   ...BaseFields,
 *   myCustomField: Schema.String
 * })
 * ```
 */
export const BaseFields = {
  id: Schema.String,
  output: Schema.optional(Schema.String),
  timeout: Schema.optional(Schema.Number),
  retry: Schema.optional(Schema.Number),
  description: Schema.optional(Schema.String),
};

/**
 * Union of all supported operator types
 *
 * @type OperatorType
 *
 * @description
 * Defines all the operator types available in the system.
 * Used for type discrimination and registry lookups.
 */
export type OperatorType =
  | 'tool'
  | 'filter'
  | 'conditional'
  | 'loop'
  | 'map'
  | 'reduce'
  | 'parallel'
  | 'switch';

/**
 * Base configuration interface for any step/operator
 *
 * @interface BaseStepConfig
 *
 * @description
 * Common configuration fields that all steps must have.
 * Individual operators extend this with their specific fields.
 */
export interface BaseStepConfig {
  id: string;
  output?: string;
  timeout?: number;
  retry?: number;
  description?: string;
}

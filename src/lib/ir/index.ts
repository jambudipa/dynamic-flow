/**
 * DynamicFlow - IR Module Exports
 *
 * Public API for the Intermediate Representation (IR) system
 */

// Export core types
export type {
  IR,
  IRMetadata,
  IRGraph,
  IRRegistry,
  IRNode,
  IREdge,
  IRCondition,
  IRValue,
  BaseIRNode,
  ToolNode,
  ConditionalNode,
  ParallelNode,
  SequenceNode,
  LoopNode,
  NodeConfig,
} from './core-types';

// Export classes separately
export { IRCompilationError, IRValidationError } from './core-types';

// Export builder
export { IRBuilder } from './builder';

// Re-export legacy types for compatibility (will be migrated)
export {
  type TypedValue,
  type ExecutionContext,
  type ExecutionResult,
  type ToolDefinition,
  type ToolConfig,
  CompilationError,
  ExecutionError,
  createToolNode,
  createControlNode,
  createParallelNode,
  createSequenceNode,
} from './types';

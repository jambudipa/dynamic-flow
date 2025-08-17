/**
 * Unified Operators - Single source of truth for all flow operations
 *
 * Each operator provides:
 * - Schema definitions (recursive and flat)
 * - Runtime execution logic
 * - Bidirectional transformation
 */

// Base types
export * from './base';

// Individual operators
export { ToolOperator } from './tool';
export { FilterOperator } from './filter';
export { ConditionalOperator } from './conditional';
export { LoopOperator } from './loop';
export { MapOperator } from './map';
export { ReduceOperator } from './reduce';
export { ParallelOperator } from './parallel';
export { SwitchOperator } from './switch';

// Registry
export { OperatorRegistry } from './registry';

// Utilities
export * from './utils';

// Re-export types for convenience
export type { ToolConfig } from './tool';
export type { FilterConfig } from './filter';
export type { ConditionalConfig } from './conditional';
export type { LoopConfig } from './loop';
export type { MapConfig } from './map';
export type { ReduceConfig } from './reduce';
export type { ParallelConfig } from './parallel';
export type { SwitchConfig } from './switch';

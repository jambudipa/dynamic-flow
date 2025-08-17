/**
 * DynamicFlow Types - Central Type System
 *
 * This module serves as the single source of truth for all types used
 * throughout the DynamicFlow system. It consolidates and exports all
 * core types, interfaces, and utilities to eliminate type conflicts
 * and ensure consistency across modules.
 */

// ============= Core Types =============
export type {
  ExecutionContext,
  SourceLocation,
  ComponentMetadata,
  ResourceRequirements,
  ExecutableSchema,
  ValidationResult,
} from './core';

export {
  validationSuccess,
  validationFailure,
  isExecutionContext,
  isValidationSuccess,
  isValidationFailure,
} from './core';

// ============= Error Types =============
export type { AnyFlowError } from './errors';

export {
  FlowError,
  FlowExecutionError,
  FlowTypeError,
  FlowMappingError,
  FlowValidationError,
  ToolError,
  LLMError,
  FlowCompilationError,
  FlowSchemaError,

  // Type guards
  isFlowError,
  isFlowExecutionError,
  isFlowTypeError,
  isFlowMappingError,
  isFlowValidationError,
  isToolError,
  isLLMError,
  isFlowCompilationError,
  isFlowSchemaError,

  // Error constructors
  createFlowExecutionError,
  createFlowTypeError,
  createToolError,
  createLLMError,
} from './errors';

// ============= Effect Types =============
export type {
  FlowEffect,
  FlowContext,
  ToolRequirements,
  ExtractSuccess,
  ExtractError,
  ExtractRequirements,
  DynamicFlowEffect, // @deprecated
} from './effects';

export {
  flowSuccess,
  flowFailure,
  flowFromPromise,
  flowMap,
  flowFlatMap,
  flowMapError,
  flowCatchAll,
  createFlowContext,
  createToolRequirements,
  isFlowEffect,
} from './effects';

// ============= Tool Types =============
export type {
  Tool,
  Executable,
  ExecutableMetadata,
  ToolConfig,
  RetryConfig,
  RateLimitConfig,
  LegacyTool, // @deprecated
} from '../tools/types';

export {
  ExecutableType,

  // Type guards
  isExecutable,
  isLegacyTool,
} from '../tools/types';

// ============= Schema Types =============
export type {
  SchemaEncoded,
  SchemaDecoded,
  SchemaContext,
  Mutable,
  MutableSchema,
  OptionalSchema,
  RequiredSchema,
  LegacySchema, // @deprecated
} from './schemas';

export {
  mutableArray,
  mutableRecord,
  optionalField,
  requiredField,
  validateWithSchema,
  encodeWithSchema,
  validateSyncWithSchema,

  // Common schemas
  IdSchema,
  DescriptionSchema,
  VersionSchema,
  TimestampSchema,
  UrlSchema,
  EmailSchema,

  // Composition utilities (commented out - not available in current Effect Schema API)
  // extendSchema,
  // partialSchema,
  // pickFromSchema,
  // omitFromSchema,
  transformSchema,
  filterSchema,

  // Utilities
  upgradeLegacySchema,
  isSchema,
  isParseError,
} from './schemas';

// ============= Type Guards =============
export {
  // Core guards (isExecutionContext already exported above)
  isCompleteExecutionContext,
  isValidationResult,
  isComponentMetadata,

  // Error guards (re-exported from errors module for convenience)
  isAnyFlowError,

  // Effect guards
  isEffect,
  isFlowContext,
  isToolRequirements,

  // Tool guards are now in tools/types

  // Schema guards
  isSchemaWithDescription,

  // Utility guards
  isNonEmptyString,
  isValidId,
  isValidVersion,
  isValidUrl,
  isValidEmail,
  isPlainObject,
  isNonEmptyArray,

  // Predicate utilities
  allOf,
  anyOf,
  not,
  optional,
} from './guards';

// ============= Module Information =============

/**
 * Version information for the type system
 */
export const TYPE_SYSTEM_VERSION = '1.0.0';

/**
 * Supported Effect version range
 */
export const SUPPORTED_EFFECT_VERSION = '^0.60.0';

/**
 * Type system metadata
 */
export const TYPE_SYSTEM_METADATA = {
  version: TYPE_SYSTEM_VERSION,
  supportedEffect: SUPPORTED_EFFECT_VERSION,
  created: '2024-12-19',
  description: 'Unified type system for DynamicFlow',
  breaking_changes: [
    'Consolidated ExecutionContext interfaces',
    'Unified FlowError hierarchy',
    'Standardized Effect patterns',
  ],
} as const;

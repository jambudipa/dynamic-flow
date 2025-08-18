/**
 * Factory functions for creating errors with consistent patterns.
 * These helpers ensure errors are created with proper context and structure.
 */

import {
  ConfigError,
  DynamicFlowError,
  ExecutionError,
  LLMError,
  NetworkError,
  ParseError,
  ResourceError,
  TimeoutError,
  ToolError,
  ValidationError,
} from './base';

// ============= Validation Errors =============

export const makeValidationError = (
  field: string,
  value: unknown,
  expected: string,
  details?: string
): ValidationError =>
  new ValidationError({
    field,
    value,
    expected,
    message: details || `Expected ${expected}, got ${typeof value}`,
  });

export const makeRequiredFieldError = (field: string): ValidationError =>
  new ValidationError({
    field,
    value: undefined,
    expected: 'defined value',
    message: `${field} is required`,
  });

export const makeTypeError = (
  field: string,
  value: unknown,
  expectedType: string
): ValidationError =>
  new ValidationError({
    field,
    value,
    expected: expectedType,
    message: `Expected ${expectedType}, got ${typeof value}`,
  });

// ============= Execution Errors =============

export const makeExecutionError = (
  step: string,
  input: unknown,
  details: string,
  cause?: unknown
): ExecutionError =>
  new ExecutionError({
    step,
    input,
    message: details,
    cause,
  });

export const makeStepNotFoundError = (step: string): ExecutionError =>
  new ExecutionError({
    step,
    input: undefined,
    message: `Step ${step} not found in flow`,
  });

export const makeStepFailedError = (
  step: string,
  input: unknown,
  cause: unknown
): ExecutionError =>
  new ExecutionError({
    step,
    input,
    message: `Step execution failed`,
    cause,
  });

// ============= Tool Errors =============

export const makeToolError = (
  toolName: string,
  operation: string,
  details: string,
  cause?: unknown
): ToolError =>
  new ToolError({
    toolName,
    operation,
    message: details,
    cause,
  });

export const makeToolNotFoundError = (toolName: string): ToolError =>
  new ToolError({
    toolName,
    operation: 'lookup',
    message: `Tool ${toolName} not found in registry`,
  });

export const makeToolExecutionError = (
  toolName: string,
  cause: unknown
): ToolError =>
  new ToolError({
    toolName,
    operation: 'execution',
    message: 'Tool execution failed',
    cause,
  });

export const makeToolRegistrationError = (
  toolName: string,
  reason: string
): ToolError =>
  new ToolError({
    toolName,
    operation: 'registration',
    message: reason,
  });

// ============= LLM Errors =============

export const makeLLMError = (
  message: string,
  options?: {
    model?: string;
    prompt?: string;
    cause?: unknown;
  }
): LLMError =>
  new LLMError({
    message,
    ...options,
  });

export const makeLLMGenerationError = (
  model: string,
  cause: unknown
): LLMError =>
  new LLMError({
    model,
    message: 'Failed to generate response',
    cause,
  });

export const makeLLMParseError = (
  response: string,
  expected: string
): LLMError =>
  new LLMError({
    message: `Failed to parse LLM response as ${expected}`,
    cause: response,
  });

// ============= Network Errors =============

export const makeNetworkError = (
  url: string,
  statusCode?: number,
  cause?: unknown
): NetworkError =>
  new NetworkError({
    url,
    ...(statusCode !== undefined && { statusCode }),
    message: statusCode
      ? `Request failed with status ${statusCode}`
      : 'Network request failed',
    cause,
  });

export const makeConnectionError = (
  url: string,
  cause: unknown
): NetworkError =>
  new NetworkError({
    url,
    message: 'Failed to establish connection',
    cause,
  });

// ============= Timeout Errors =============

export const makeTimeoutError = (
  operation: string,
  duration: number
): TimeoutError =>
  new TimeoutError({
    operation,
    duration,
  });

// ============= Parse Errors =============

export const makeParseError = (
  input: string,
  expected: string,
  cause?: unknown
): ParseError =>
  new ParseError({
    input: input.length > 100 ? input.substring(0, 100) + '...' : input,
    expected,
    message: `Invalid ${expected} format`,
    cause,
  });

export const makeJSONParseError = (input: string, cause: unknown): ParseError =>
  new ParseError({
    input: input.length > 100 ? input.substring(0, 100) + '...' : input,
    expected: 'JSON',
    message: 'Invalid JSON syntax',
    cause,
  });

// ============= Config Errors =============

export const makeConfigError = (
  key: string,
  message: string,
  cause?: unknown
): ConfigError =>
  new ConfigError({
    key,
    message,
    cause,
  });

export const makeMissingConfigError = (key: string): ConfigError =>
  new ConfigError({
    key,
    message: `Required configuration ${key} is missing`,
  });

export const makeInvalidConfigError = (
  key: string,
  value: unknown,
  expected: string
): ConfigError =>
  new ConfigError({
    key,
    message: `Invalid value for ${key}: expected ${expected}, got ${typeof value}`,
  });

// ============= Resource Errors =============

export const makeResourceError = (
  resource: string,
  operation: 'acquire' | 'release' | 'use',
  cause?: unknown
): ResourceError =>
  new ResourceError({
    resource,
    operation,
    message: `Failed to ${operation} resource`,
    cause,
  });

export const makeResourceAcquisitionError = (
  resource: string,
  cause: unknown
): ResourceError =>
  new ResourceError({
    resource,
    operation: 'acquire',
    message: 'Resource acquisition failed',
    cause,
  });

export const makeResourceReleaseError = (
  resource: string,
  cause: unknown
): ResourceError =>
  new ResourceError({
    resource,
    operation: 'release',
    message: 'Resource cleanup failed',
    cause,
  });

// ============= Generic Error Creation =============

export const wrapUnknownError = (
  error: unknown,
  context: {
    module: string;
    operation: string;
  }
): DynamicFlowError => {
  if (error instanceof DynamicFlowError) {
    return error;
  }

  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Unknown error occurred';

  return new DynamicFlowError({
    module: context.module,
    operation: context.operation,
    message,
    cause: error,
  });
};

/**
 * Type utility functions for runtime type checking and validation.
 * These utilities replace unsafe type assertions with proper type guards.
 */

/**
 * Type guard to check if a value is a plain object (not array or null).
 */
export const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

/**
 * Type guard to check if a value is an Error instance.
 */
export const isError = (value: unknown): value is Error => {
  return value instanceof Error;
};

/**
 * Type guard to check if a value has a message property.
 */
export const hasMessage = (value: unknown): value is { message: string } => {
  return isRecord(value) && typeof value.message === 'string';
};

/**
 * Type guard to check if a value has a code property.
 */
export const hasCode = (value: unknown): value is { code: string | number } => {
  return (
    isRecord(value) &&
    (typeof value.code === 'string' || typeof value.code === 'number')
  );
};

/**
 * Type guard to check if a value is a string.
 */
export const isString = (value: unknown): value is string => {
  return typeof value === 'string';
};

/**
 * Type guard to check if a value is a number.
 */
export const isNumber = (value: unknown): value is number => {
  return typeof value === 'number' && !isNaN(value);
};

/**
 * Type guard to check if a value is a boolean.
 */
export const isBoolean = (value: unknown): value is boolean => {
  return typeof value === 'boolean';
};

/**
 * Type guard to check if a value is an array.
 */
export const isArray = <T = unknown>(value: unknown): value is T[] => {
  return Array.isArray(value);
};

/**
 * Type guard to check if a value is a function.
 */
export const isFunction = <T extends (...args: unknown[]) => unknown>(
  value: unknown
): value is T => {
  return typeof value === 'function';
};

/**
 * Type guard to check if a value is null or undefined.
 */
export const isNullish = (value: unknown): value is null | undefined => {
  return value === null || value === undefined;
};

/**
 * Type guard to check if a value is defined (not null or undefined).
 */
export const isDefined = <T>(value: T | null | undefined): value is T => {
  return value !== null && value !== undefined;
};

/**
 * Safely extract error message from unknown error value.
 */
export const getErrorMessage = (error: unknown): string => {
  if (isError(error)) {
    return error.message;
  }
  if (hasMessage(error)) {
    return error.message;
  }
  if (isString(error)) {
    return error;
  }
  return String(error);
};

/**
 * Safely extract error code from unknown error value.
 */
export const getErrorCode = (error: unknown): string | number | undefined => {
  if (hasCode(error)) {
    return error.code;
  }
  return undefined;
};

/**
 * Type guard for checking if a value matches a specific literal type.
 */
export const isLiteral = <T extends string | number | boolean>(
  value: unknown,
  literal: T
): value is T => {
  return value === literal;
};

/**
 * Type guard for checking if a value is one of the specified literals.
 */
export const isOneOf = <T extends readonly (string | number | boolean)[]>(
  value: unknown,
  literals: T
): value is T[number] => {
  return literals.includes(value as T[number]);
};

/**
 * Assert that a condition is true, narrowing the type.
 */
export function assert(
  condition: unknown,
  message?: string
): asserts condition {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

/**
 * Assert that a value is defined, narrowing the type.
 */
export function assertDefined<T>(
  value: T | null | undefined,
  message?: string
): asserts value is T {
  if (!isDefined(value)) {
    throw new Error(message || 'Value is null or undefined');
  }
}

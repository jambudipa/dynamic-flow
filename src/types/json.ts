/**
 * JSON type definitions and utilities for type-safe JSON processing.
 */

import { Data, Effect, Schema } from 'effect';
import { safeOp } from '../utils/effect-patterns';

/**
 * Primitive JSON values.
 */
export type JsonPrimitive = string | number | boolean | null;

/**
 * JSON object type.
 */
export type JsonObject = { [key: string]: JsonValue };

/**
 * JSON array type.
 */
export type JsonArray = JsonValue[];

/**
 * Union of all valid JSON types.
 */
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;

/**
 * Error thrown when JSON parsing fails.
 */
export class JsonParseError extends Data.TaggedError('JsonParseError')<{
  readonly message: string;
  readonly input?: string;
  readonly cause?: unknown;
}> {
  get displayMessage(): string {
    const inputInfo = this.input
      ? ` (input: ${this.input.slice(0, 100)}...)`
      : '';
    const cause = this.cause ? ` (caused by: ${this.cause})` : '';
    return `JSON parse error${inputInfo}${cause}: ${this.message}`;
  }
}

/**
 * Error thrown when JSON validation fails.
 */
export class JsonValidationError extends Data.TaggedError(
  'JsonValidationError'
)<{
  readonly message: string;
  readonly path?: string;
  readonly expected?: string;
  readonly actual?: unknown;
}> {
  get displayMessage(): string {
    const path = this.path ? ` at path '${this.path}'` : '';
    const expected = this.expected ? ` (expected: ${this.expected})` : '';
    const actual =
      this.actual !== undefined ? ` (actual: ${typeof this.actual})` : '';
    return `JSON validation error${path}${expected}${actual}: ${this.message}`;
  }
}

/**
 * Interface for JSON processing with validation.
 */
export interface JsonProcessor<T> {
  /**
   * Parse JSON string and validate against schema.
   */
  parse(json: string): Effect.Effect<T, JsonParseError | JsonValidationError>;

  /**
   * Validate that unknown data matches the expected type.
   */
  validate(data: unknown): data is T;

  /**
   * Stringify typed data to JSON.
   */
  stringify(data: T): string;
}

/**
 * Type guard to check if a value is valid JSON primitive.
 */
export const isJsonPrimitive = (value: unknown): value is JsonPrimitive => {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
};

/**
 * Type guard to check if a value is a JSON object.
 */
export const isJsonObject = (value: unknown): value is JsonObject => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  // Check all values are valid JSON
  for (const key in value) {
    if (!isJsonValue((value as Record<string, unknown>)[key])) {
      return false;
    }
  }

  return true;
};

/**
 * Type guard to check if a value is a JSON array.
 */
export const isJsonArray = (value: unknown): value is JsonArray => {
  if (!Array.isArray(value)) {
    return false;
  }

  // Check all elements are valid JSON
  return value.every(isJsonValue);
};

/**
 * Type guard to check if a value is valid JSON.
 */
export const isJsonValue = (value: unknown): value is JsonValue => {
  return isJsonPrimitive(value) || isJsonObject(value) || isJsonArray(value);
};

/**
 * Safely parse JSON string with proper error handling.
 */
export const parseJsonSafe = (
  json: string
): Effect.Effect<JsonValue, JsonParseError> =>
  Effect.try({
    try: () => {
      const parsed: unknown = JSON.parse(json);
      if (!isJsonValue(parsed)) {
        throw new Error('Parsed value is not valid JSON');
      }
      return parsed;
    },
    catch: (error) =>
      new JsonParseError({
        message: `Failed to parse JSON: ${error instanceof Error ? error.message : String(error)}`,
        input: json,
        cause: error,
      }),
  });

/**
 * Parse JSON with schema validation.
 */
export const parseJsonWithSchema = <T>(
  json: string,
  schema: Schema.Schema<T, JsonValue>
): Effect.Effect<T, JsonParseError | JsonValidationError> =>
  parseJsonSafe(json).pipe(
    Effect.flatMap((parsed) =>
      Effect.try({
        try: () => Schema.decodeUnknownSync(schema)(parsed),
        catch: (error) =>
          new JsonValidationError({
            message: `JSON validation failed: ${error instanceof Error ? error.message : String(error)}`,
            actual: parsed,
          }),
      })
    )
  );

/**
 * Create a JSON processor with schema validation.
 */
export const createJsonProcessor = <T>(
  schema: Schema.Schema<T, JsonValue>
): JsonProcessor<T> => ({
  parse: (json: string) => parseJsonWithSchema(json, schema),

  validate: (data: unknown): data is T => {
    return Effect.runSync(
      safeOp(
        () => {
          if (!isJsonValue(data)) {
            return false;
          }
          Schema.decodeUnknownSync(schema)(data);
          return true;
        },
        () => ({ _tag: 'ValidationError' as const, result: false })
      ).pipe(Effect.catchAll(() => Effect.succeed(false)))
    );
  },

  stringify: (data: T) => JSON.stringify(data, null, 2),
});

/**
 * Utility to safely access nested JSON properties.
 */
export const getJsonPath = (
  obj: JsonValue,
  path: string[]
): JsonValue | undefined => {
  let current: JsonValue = obj;

  for (const key of path) {
    if (!isJsonObject(current)) {
      return undefined;
    }

    const next = current[key];
    if (next === undefined) {
      return undefined;
    }

    current = next;
  }

  return current;
};

/**
 * Deep clone a JSON value.
 */
export const cloneJson = <T extends JsonValue>(value: T): T => {
  return JSON.parse(JSON.stringify(value)) as T;
};

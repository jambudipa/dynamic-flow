/**
 * Schema Types - Schema-related types and utilities
 *
 * This module provides types and utilities for working with Effect Schema
 * in the context of DynamicFlow operations.
 */

import { Effect, Schema } from 'effect';
import type { ParseError } from 'effect/ParseResult';
import { FlowSchemaError } from './errors';
import { safeOp } from '../utils/effect-patterns';

// ============= Schema Utility Types =============

/**
 * Extract the encoded type from a Schema
 */
export type SchemaEncoded<T> =
  T extends Schema.Schema<infer A, unknown, unknown> ? A : never;

/**
 * Extract the decoded type from a Schema
 */
export type SchemaDecoded<T> =
  T extends Schema.Schema<unknown, infer I, unknown> ? I : never;

/**
 * Extract the context type from a Schema
 */
export type SchemaContext<T> =
  T extends Schema.Schema<unknown, unknown, infer R> ? R : never;

/**
 * Mutable version of a type (removes readonly modifiers)
 */
export type Mutable<T> = {
  -readonly [K in keyof T]: T[K] extends ReadonlyArray<infer U>
    ? Array<Mutable<U>>
    : T[K] extends Record<string, unknown>
      ? Mutable<T[K]>
      : T[K];
};

// ============= Schema Helper Types =============

/**
 * Schema that accepts mutable arrays instead of readonly arrays
 */
export type MutableSchema<A> = Schema.Schema<Mutable<A>, Mutable<A>, never>;

/**
 * Optional schema field
 */
export type OptionalSchema<A> = Schema.Schema<
  A | undefined,
  A | undefined,
  never
>;

/**
 * Required schema field (removes undefined from type)
 */
export type RequiredSchema<A> = A extends undefined
  ? never
  : Schema.Schema<A, A, never>;

// ============= Schema Constructors =============

/**
 * Create a mutable version of an array schema
 */
export const mutableArray = <A>(
  itemSchema: Schema.Schema<A>
): Schema.Schema<ReadonlyArray<A>> => {
  // Effect Schema models arrays as ReadonlyArray for type-safety
  return Schema.Array(itemSchema);
};

/**
 * Create a mutable version of a record schema
 */
export const mutableRecord = <A>(
  valueSchema: Schema.Schema<A>
): Schema.Schema<Record<string, A>> => {
  return Schema.Record({ key: Schema.String, value: valueSchema });
};

/**
 * Create an optional schema field
 */
export const optionalField = <A>(
  schema: Schema.Schema<A>
): Schema.Schema<A | undefined> => {
  return Schema.Union(schema, Schema.Undefined) as Schema.Schema<A | undefined>;
};

/**
 * Create a required schema field
 */
export const requiredField = <A>(
  schema: Schema.Schema<A>
): Schema.Schema<A> => {
  return schema;
};

// ============= Validation Utilities =============

/**
 * Validate data with a schema and convert ParseError to FlowSchemaError
 */
export const validateWithSchema = <A, I, R>(
  schema: Schema.Schema<A, I, R>,
  input: I,
  schemaName?: string
): Effect.Effect<A, FlowSchemaError, R> => {
  return Effect.mapError(
    Schema.decode(schema)(input),
    (parseError: ParseError) => {
      const props: {
        schemaName?: string;
        fieldPath?: string;
        cause?: unknown;
      } = {
        cause: parseError,
      };

      if (schemaName !== undefined) {
        props.schemaName = schemaName;
      }

      return new FlowSchemaError(props);
    }
  );
};

/**
 * Encode data with a schema and convert ParseError to FlowSchemaError
 */
export const encodeWithSchema = <A, I, R>(
  schema: Schema.Schema<A, I, R>,
  data: A,
  schemaName?: string
): Effect.Effect<I, FlowSchemaError, R> => {
  return Effect.mapError(
    Schema.encode(schema)(data),
    (parseError: ParseError) => {
      const props: {
        schemaName?: string;
        fieldPath?: string;
        cause?: unknown;
      } = {
        cause: parseError,
      };

      if (schemaName !== undefined) {
        props.schemaName = schemaName;
      }

      return new FlowSchemaError(props);
    }
  );
};

/**
 * Synchronous validation that throws on error
 */
export const validateSyncWithSchema = <A, I>(
  schema: Schema.Schema<A, I, never>,
  input: I,
  schemaName?: string
): A => {
  return Effect.runSync(
    safeOp(
      () => Schema.decodeSync(schema)(input),
      (error) => {
        const props: {
          schemaName?: string;
          fieldPath?: string;
          cause?: unknown;
        } = {
          cause: error,
        };

        if (schemaName !== undefined) {
          props.schemaName = schemaName;
        }

        return new FlowSchemaError(props);
      }
    )
  );
};

// ============= Common Schema Patterns =============

/**
 * Schema for string identifiers
 */
export const IdSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(100)
);

/**
 * Schema for descriptions
 */
export const DescriptionSchema = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(1000)
);

/**
 * Schema for version strings
 */
export const VersionSchema = Schema.String.pipe(
  Schema.pattern(/^\d+\.\d+\.\d+$/)
);

/**
 * Schema for timestamps
 */
export const TimestampSchema = Schema.String.pipe(
  Schema.minLength(1) // Simplified for now
);

/**
 * Schema for URLs
 */
export const UrlSchema = Schema.String.pipe(Schema.pattern(/^https?:\/\/.+$/));

/**
 * Schema for email addresses
 */
export const EmailSchema = Schema.String.pipe(
  Schema.pattern(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
);

// ============= Schema Composition Utilities =============

/**
 * Get the fields of a struct schema
 * Helper function to extract fields from a struct schema
 */
const getSchemaFields = <A>(
  schema: Schema.Schema<A>
): Record<string, Schema.Schema.Any> => {
  // Access the AST to get struct fields
  const ast = (schema as any).ast;
  if (ast && ast._tag === 'TypeLiteral') {
    const fields: Record<string, Schema.Schema.Any> = {};
    for (const prop of ast.propertySignatures) {
      fields[prop.name] = Schema.make(prop.type);
    }
    return fields;
  }
  return {};
};

/**
 * Extend a schema with additional fields
 * Fixed: Using Schema.Struct composition to merge schemas
 */
export const extendSchema = <A, B>(
  baseSchema: Schema.Schema<A>,
  extension: Schema.Schema<B>
): Schema.Schema<A & B> => {
  const baseFields = getSchemaFields(baseSchema);
  const extFields = getSchemaFields(extension);
  return Schema.Struct({
    ...baseFields,
    ...extFields,
  }) as unknown as Schema.Schema<A & B>;
};

/**
 * Make all fields in a schema optional
 * Fixed: Using Schema.partial from Effect/Schema
 */
export const partialSchema = <A>(
  schema: Schema.Schema<A>
): Schema.Schema<Partial<A>> => {
  return Schema.partial(schema) as Schema.Schema<Partial<A>>;
};

/**
 * Pick specific fields from a schema
 * Fixed: Using Schema.pick from Effect/Schema
 */
export const pickFromSchema = <A, K extends keyof A>(
  schema: Schema.Schema<A>,
  keys: readonly K[]
): Schema.Schema<Pick<A, K>> => {
  return (Schema.pick as any)(schema, ...keys) as unknown as Schema.Schema<
    Pick<A, K>
  >;
};

/**
 * Omit specific fields from a schema
 * Fixed: Using Schema.omit from Effect/Schema
 */
export const omitFromSchema = <A, K extends keyof A>(
  schema: Schema.Schema<A>,
  keys: readonly K[]
): Schema.Schema<Omit<A, K>> => {
  return (Schema.omit as any)(schema, ...keys) as unknown as Schema.Schema<
    Omit<A, K>
  >;
};

// ============= Transform Utilities =============

/**
 * Create a transformation schema
 */
export const transformSchema = <A, B>(
  from: Schema.Schema<A>,
  to: Schema.Schema<B>,
  decode: (a: A) => B,
  encode: (b: B) => A
): Schema.Schema<B, A> => {
  return Schema.transformOrFail(from, to, {
    decode: (a: A) => Effect.succeed(decode(a)),
    encode: (b: B) => Effect.succeed(encode(b)),
  });
};

/**
 * Create a filter schema
 */
export const filterSchema = <A>(
  schema: Schema.Schema<A>,
  predicate: (a: A) => boolean,
  message?: string
): Schema.Schema<A> => {
  return schema.pipe(
    Schema.filter(predicate, {
      message: () => message || 'Filter predicate failed',
    })
  );
};

// ============= Legacy Compatibility =============

/**
 * @deprecated Use Schema.Schema directly
 */
export type LegacySchema<T> = Schema.Schema<T, T, never>;

/**
 * Convert legacy schema to modern schema
 */
export const upgradeLegacySchema = <T>(
  legacySchema: unknown
): Schema.Schema<T> => {
  // This would handle migration from old schema formats
  if (
    legacySchema !== null &&
    typeof legacySchema === 'object' &&
    'type' in (legacySchema as Record<string, unknown>)
  ) {
    // Handle old schema format
    const ls = legacySchema as { type?: string };
    switch (ls.type) {
      case 'string':
        return Schema.String as unknown as Schema.Schema<T>;
      case 'number':
        return Schema.Number as unknown as Schema.Schema<T>;
      case 'boolean':
        return Schema.Boolean as unknown as Schema.Schema<T>;
      default:
        return Schema.Unknown as unknown as Schema.Schema<T>;
    }
  }

  // Assume it's already a modern schema
  return legacySchema as Schema.Schema<T>;
};

// ============= Type Guards =============

/**
 * Type guard to check if a value is a Schema
 */
export const isSchema = (value: unknown): value is Schema.Schema<unknown> => {
  return (
    typeof value === 'object' &&
    value !== null &&
    '_tag' in (value as Record<string, unknown>) &&
    (value as { _tag?: unknown })._tag === 'Schema'
  );
};

/**
 * Type guard for ParseError
 */
export const isParseError = (error: unknown): error is ParseError => {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const errorAsObject = error as Record<string, unknown>;
  return '_tag' in errorAsObject && errorAsObject._tag === 'ParseError';
};

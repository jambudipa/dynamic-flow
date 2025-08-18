/**
 * Type utilities for replacing any usage and improving type safety
 */

/**
 * Makes a type nullable (can be null)
 */
export type Nullable<T> = T | null;

/**
 * Makes a type optional (can be undefined)
 */
export type Optional<T> = T | undefined;

/**
 * Creates an exact/branded type for nominal typing
 */
export type Exact<T> = T & { readonly _brand: unique symbol };

/**
 * Deep partial - makes all properties and nested properties optional
 */
export type DeepPartial<T> = T extends object
  ? { [P in keyof T]?: DeepPartial<T[P]> }
  : T;

/**
 * Deep readonly - makes all properties and nested properties readonly
 */
export type DeepReadonly<T> = T extends object
  ? { readonly [P in keyof T]: DeepReadonly<T[P]> }
  : T;

/**
 * Extract keys of a specific type from an object
 */
export type KeysOfType<T, U> = {
  [K in keyof T]: T[K] extends U ? K : never;
}[keyof T];

/**
 * Make specific keys required
 */
export type RequireKeys<T, K extends keyof T> = T & Required<Pick<T, K>>;

/**
 * Make specific keys optional
 */
export type PartialKeys<T, K extends keyof T> = Omit<T, K> &
  Partial<Pick<T, K>>;

/**
 * Non-nullable - removes null and undefined from a type
 */
export type NonNullable<T> = T extends null | undefined ? never : T;

/**
 * Extract the promise type
 */
export type PromiseType<T extends Promise<unknown>> =
  T extends Promise<infer U> ? U : never;

/**
 * Extract array element type
 */
export type ArrayElement<T extends ReadonlyArray<unknown>> =
  T extends ReadonlyArray<infer U> ? U : never;

/**
 * Union to intersection
 */
export type UnionToIntersection<U> = (
  U extends unknown ? (k: U) => void : never
) extends (k: infer I) => void
  ? I
  : never;

/**
 * Get function arguments type
 */
export type ArgumentsType<T extends (...args: never[]) => unknown> = T extends (
  ...args: infer A
) => unknown
  ? A
  : never;

/**
 * Get function return type (built-in ReturnType alternative)
 */
export type ReturnType<T extends (...args: never[]) => unknown> = T extends (
  ...args: never[]
) => infer R
  ? R
  : never;

/**
 * Type guard result
 */
export type TypeGuard<T> = (value: unknown) => value is T;

/**
 * JSON-serializable types
 */
export type JsonPrimitive = string | number | boolean | null;
export type JsonObject = { [key: string]: JsonValue };
export type JsonArray = JsonValue[];
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;

/**
 * Replace any in a type with unknown
 */
export type NoAny<T> = 0 extends 1 & T ? unknown : T;

/**
 * Strict function type
 */
export type StrictFunction<Args extends ReadonlyArray<unknown>, Return> = (
  ...args: Args
) => Return;

/**
 * Error result type
 */
export type Result<T, E = Error> =
  | { success: true; value: T }
  | { success: false; error: E };

/**
 * Maybe type (similar to Option)
 */
export type Maybe<T> = T | null | undefined;

/**
 * Ensure no any in type (compile-time check)
 */
export type AssertNoAny<T> = 0 extends 1 & T ? never : T;

/**
 * Replace specific type in a union
 */
export type ReplaceType<T, TReplace, TWith> = T extends TReplace ? TWith : T;

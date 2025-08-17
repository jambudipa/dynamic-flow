/**
 * @fileoverview Flow type definitions for the pipeable API
 */

/**
 * Core Flow type representing a composable flow operation
 */
export interface Flow<A> {
  readonly _tag: 'Flow';
  readonly value: A;
}

/**
 * Creates a Flow from a value
 */
export const of = <A>(value: A): Flow<A> => ({
  _tag: 'Flow',
  value,
});

/**
 * Extracts the value from a Flow
 */
export const unwrap = <A>(flow: Flow<A>): A => flow.value;

/**
 * Type guard for Flow
 */
export const isFlow = (value: unknown): value is Flow<unknown> =>
  value !== null &&
  typeof value === 'object' &&
  '_tag' in value &&
  (value as Record<string, unknown>)['_tag'] === 'Flow';

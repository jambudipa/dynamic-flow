/**
 * @fileoverview Layer type for dependency injection
 */

/**
 * Represents a layer providing context/dependencies
 */
export interface Layer<R> {
  readonly _tag: 'Layer';
  readonly context: R;
}

/**
 * Creates a Layer from a context
 */
export const Layer = {
  /**
   * Creates a Layer with the given context
   */
  of: <R>(context: R): Layer<R> => ({
    _tag: 'Layer',
    context,
  }),

  /**
   * Merges two layers
   */
  merge: <R1, R2>(layer1: Layer<R1>, layer2: Layer<R2>): Layer<R1 & R2> => ({
    _tag: 'Layer',
    context: { ...layer1.context, ...layer2.context },
  }),

  /**
   * Empty layer
   */
  empty: (): Layer<{}> => ({
    _tag: 'Layer',
    context: {},
  }),
};

/**
 * Type guard for Layer
 */
export const isLayer = (value: unknown): value is Layer<unknown> =>
  value !== null &&
  typeof value === 'object' &&
  '_tag' in value &&
  (value as Record<string, unknown>)['_tag'] === 'Layer';

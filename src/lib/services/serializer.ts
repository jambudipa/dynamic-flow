/**
 * SerializerService - State serialization service
 *
 * Handles complex state serialization for flow persistence including:
 * - Circular reference detection and handling
 * - Compression for large states
 * - Integrity checking with checksums
 * - Versioned serialization formats
 * - Effect-specific object handling
 */

import { Effect, Context, Layer } from 'effect';
import { createHash } from 'crypto';
import { gzip, gunzip } from 'zlib';
import { promisify } from 'util';
import { SerializationError, CompressionError } from '../errors';

// Promisify zlib functions for Effect integration
const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

// ============= Types =============

/**
 * Current serialization format version
 */
const SERIALIZATION_VERSION = '1.0.0';

/**
 * Minimum size threshold for compression (1KB)
 */
const COMPRESSION_THRESHOLD = 1024;

/**
 * Maximum state size allowed (100MB)
 */
const MAX_STATE_SIZE = 100 * 1024 * 1024;

/**
 * Serialized state metadata
 */
export interface SerializedState {
  readonly version: string;
  readonly data: string;
  readonly metadata: {
    readonly serializedAt: string;
    readonly size: number;
    readonly checksum: string;
  };
}

/**
 * Compressed state extends serialized state
 */
export interface CompressedState extends SerializedState {
  readonly compressed: boolean;
  readonly originalSize: number;
  readonly compressedSize: number;
}

// ============= SerializerService Interface =============

export interface SerializerService {
  /**
   * Serialize flow state with circular reference handling and versioning
   */
  readonly serialize: (
    state: unknown
  ) => Effect.Effect<SerializedState, SerializationError>;

  /**
   * Deserialize flow state with circular reference restoration
   */
  readonly deserialize: (
    data: SerializedState
  ) => Effect.Effect<unknown, SerializationError>;

  /**
   * Compress serialized state using gzip
   */
  readonly compress: (
    data: SerializedState
  ) => Effect.Effect<CompressedState, CompressionError>;

  /**
   * Decompress state back to original format
   */
  readonly decompress: (
    data: CompressedState
  ) => Effect.Effect<SerializedState, CompressionError>;

  /**
   * Calculate checksum for data integrity
   */
  readonly calculateChecksum: (data: string) => Effect.Effect<string>;

  /**
   * Check version compatibility
   */
  readonly isVersionCompatible: (version: string) => Effect.Effect<boolean>;
}

// ============= Context Tag =============

export const SerializerService = Context.GenericTag<SerializerService>(
  '@services/Serializer'
);

// ============= Service Implementation =============

const makeSerializerService = (): Effect.Effect<SerializerService> =>
  Effect.gen(function* () {
    const service: SerializerService = {
      serialize: (state: unknown) =>
        Effect.gen(function* () {
          // Handle circular references with a visited set
          const visited = new WeakSet();
          const circularRefMap = new Map<object, string>();
          let refCounter = 0;

          const replacer = (key: string, value: unknown): unknown => {
            if (value === null || typeof value !== 'object') {
              return value;
            }

            // Handle special Effect objects
            if (value && typeof value === 'object') {
              // Handle Effect Fiber objects
              if ('_tag' in value && value._tag === 'Fiber') {
                return { _effectType: 'Fiber', _fiberState: 'suspended' };
              }

              // Handle Effect Context objects
              if ('_tag' in value && value._tag === 'Context') {
                return { _effectType: 'Context', _contextId: 'preserved' };
              }

              // Handle Effect Scope objects
              if ('_tag' in value && value._tag === 'Scope') {
                return { _effectType: 'Scope', _scopeState: 'active' };
              }

              // Handle Functions (can't be serialized)
              if (typeof value === 'function') {
                return {
                  _effectType: 'Function',
                  _functionName: value.name || 'anonymous',
                };
              }

              // Handle Symbol
              if (typeof value === 'symbol') {
                return {
                  _effectType: 'Symbol',
                  _symbolDescription: (value as any).description,
                };
              }

              // Handle BigInt
              if (typeof value === 'bigint') {
                return {
                  _effectType: 'BigInt',
                  _bigIntValue: (value as any).toString(),
                };
              }

              // Handle Map
              if (value instanceof Map) {
                return {
                  _effectType: 'Map',
                  _mapEntries: Array.from(value.entries()),
                };
              }

              // Handle Set
              if (value instanceof Set) {
                return {
                  _effectType: 'Set',
                  _setValues: Array.from(value.values()),
                };
              }

              // Handle Date
              if (value instanceof Date) {
                return {
                  _effectType: 'Date',
                  _dateValue: value.toISOString(),
                };
              }

              // Handle RegExp
              if (value instanceof RegExp) {
                return {
                  _effectType: 'RegExp',
                  _regexpSource: value.source,
                  _regexpFlags: value.flags,
                };
              }

              // Handle circular references
              if (visited.has(value)) {
                if (!circularRefMap.has(value)) {
                  circularRefMap.set(value, `__circularRef_${refCounter++}`);
                }
                return { _circularRef: circularRefMap.get(value) };
              }

              visited.add(value);
            }

            return value;
          };

          // Serialize with custom replacer
          const serialized = yield* Effect.try({
            try: () => JSON.stringify(state, replacer, 0), // No indentation for size
            catch: (error) =>
              new SerializationError({
                message: `Serialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                operation: 'serialize',
                cause: error,
              }),
          });

          // Check size limits
          if (serialized.length > MAX_STATE_SIZE) {
            return yield* Effect.fail(
              new SerializationError({
                message: `State size ${serialized.length} exceeds maximum allowed size ${MAX_STATE_SIZE}`,
                operation: 'serialize',
                cause: {
                  actualSize: serialized.length,
                  maxSize: MAX_STATE_SIZE,
                },
              })
            );
          }

          // Calculate checksum for integrity verification
          const checksum = yield* service.calculateChecksum(serialized);

          return {
            version: SERIALIZATION_VERSION,
            data: serialized,
            metadata: {
              serializedAt: new Date().toISOString(),
              size: serialized.length,
              checksum,
            },
          };
        }),

      deserialize: (data: SerializedState) =>
        Effect.gen(function* () {
          // Verify checksum
          const calculatedChecksum = yield* service.calculateChecksum(
            data.data
          );
          if (calculatedChecksum !== data.metadata.checksum) {
            return yield* Effect.fail(
              new SerializationError({
                message: 'Checksum mismatch - data may be corrupted',
                operation: 'deserialize',
                cause: {
                  expected: data.metadata.checksum,
                  calculated: calculatedChecksum,
                },
              })
            );
          }

          // Check version compatibility
          const isCompatible = yield* service.isVersionCompatible(data.version);
          if (!isCompatible) {
            return yield* Effect.fail(
              new SerializationError({
                message: `Unsupported serialization version: ${data.version}`,
                operation: 'deserialize',
                cause: {
                  version: data.version,
                  supportedVersion: SERIALIZATION_VERSION,
                },
              })
            );
          }

          // Store circular reference objects for resolution
          const circularRefs = new Map<string, unknown>();

          const reviver = (key: string, value: unknown): unknown => {
            if (value && typeof value === 'object' && !Array.isArray(value)) {
              const obj = value as Record<string, unknown>;

              // Handle circular references
              if (
                '_circularRef' in obj &&
                typeof obj._circularRef === 'string'
              ) {
                const refId = obj._circularRef;
                if (circularRefs.has(refId)) {
                  return circularRefs.get(refId);
                }
                // Will be resolved in second pass
                return obj;
              }

              // Restore Effect-specific objects
              if ('_effectType' in obj) {
                switch (obj._effectType) {
                  case 'Date':
                    return new Date(obj._dateValue as string);

                  case 'RegExp':
                    return new RegExp(
                      obj._regexpSource as string,
                      obj._regexpFlags as string
                    );

                  case 'Map':
                    return new Map(obj._mapEntries as [unknown, unknown][]);

                  case 'Set':
                    return new Set(obj._setValues as unknown[]);

                  case 'BigInt':
                    return BigInt(obj._bigIntValue as string);

                  case 'Symbol':
                    return Symbol(obj._symbolDescription as string);

                  case 'Function':
                    // Functions can't be restored, return a placeholder
                    return function restoredFunction() {
                      throw new Error(
                        `Cannot execute restored function: ${obj._functionName}`
                      );
                    };

                  case 'Fiber':
                  case 'Context':
                  case 'Scope':
                    // These Effect objects need special handling by the flow engine
                    return obj;
                }
              }

              // Store objects that might be referenced circularly
              if (key && typeof obj === 'object') {
                circularRefs.set(key, obj);
              }
            }

            return value;
          };

          // First pass: deserialize with reviver
          const deserialized = yield* Effect.try({
            try: () => JSON.parse(data.data, reviver),
            catch: (error) =>
              new SerializationError({
                message: `Deserialization failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                operation: 'deserialize',
                cause: error,
              }),
          });

          // Second pass: resolve any remaining circular references
          const resolveCircularRefs = (
            obj: unknown,
            visited = new WeakSet()
          ): unknown => {
            if (
              obj === null ||
              typeof obj !== 'object' ||
              visited.has(obj as object)
            ) {
              return obj;
            }

            visited.add(obj as object);

            if (Array.isArray(obj)) {
              return obj.map((item) => resolveCircularRefs(item, visited));
            }

            const objRecord = obj as Record<string, unknown>;
            if (
              '_circularRef' in objRecord &&
              typeof objRecord._circularRef === 'string'
            ) {
              const refId = objRecord._circularRef;
              return circularRefs.get(refId) || objRecord;
            }

            const resolved: Record<string, unknown> = {};
            for (const [key, value] of Object.entries(objRecord)) {
              resolved[key] = resolveCircularRefs(value, visited);
            }

            return resolved;
          };

          return resolveCircularRefs(deserialized);
        }),

      compress: (data: SerializedState) =>
        Effect.gen(function* () {
          // Only compress if data is above threshold
          if (data.data.length < COMPRESSION_THRESHOLD) {
            return {
              ...data,
              compressed: true,
              originalSize: data.data.length,
              compressedSize: data.data.length,
            } as CompressedState;
          }

          const compressed = yield* Effect.tryPromise({
            try: () => gzipAsync(Buffer.from(data.data, 'utf8')),
            catch: (error) =>
              new CompressionError({
                message: `Compression failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                operation: 'compress',
                cause: error,
              }),
          });

          const compressedData = compressed.toString('base64');

          return {
            ...data,
            data: compressedData,
            compressed: true,
            originalSize: data.data.length,
            compressedSize: compressedData.length,
          } as CompressedState;
        }),

      decompress: (data: CompressedState) =>
        Effect.gen(function* () {
          if (!data.compressed) {
            // Return as-is if not compressed
            const {
              compressed,
              originalSize,
              compressedSize,
              ...serializedData
            } = data;
            return serializedData;
          }

          // If size is below threshold, data wasn't actually compressed
          if (data.originalSize < COMPRESSION_THRESHOLD) {
            const {
              compressed,
              originalSize,
              compressedSize,
              ...serializedData
            } = data;
            return serializedData;
          }

          const compressedBuffer = Buffer.from(data.data, 'base64');

          const decompressed = yield* Effect.tryPromise({
            try: () => gunzipAsync(compressedBuffer),
            catch: (error) =>
              new CompressionError({
                message: `Decompression failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                operation: 'decompress',
                cause: error,
              }),
          });

          const {
            compressed,
            originalSize,
            compressedSize,
            ...serializedData
          } = data;

          return {
            ...serializedData,
            data: decompressed.toString('utf8'),
          };
        }),

      calculateChecksum: (data: string) =>
        Effect.gen(function* () {
          return createHash('sha256').update(data, 'utf8').digest('hex');
        }),

      isVersionCompatible: (version: string) =>
        Effect.gen(function* () {
          // Simple version compatibility check
          const supportedVersions = ['1.0.0'];
          return supportedVersions.includes(version);
        }),
    };

    return service;
  });

// ============= Layer Implementation =============

/**
 * Live implementation of SerializerService
 */
export const SerializerServiceLive = Layer.effect(
  SerializerService,
  makeSerializerService()
);

/**
 * Test implementation for testing
 */
export const SerializerServiceTest = Layer.effect(
  SerializerService,
  makeSerializerService()
);

// ============= Helper Functions =============

/**
 * Utility function to estimate compression ratio
 */
export const estimateCompressionRatio = (state: unknown) =>
  Effect.gen(function* () {
    const serializer = yield* SerializerService;
    const serialized = yield* serializer.serialize(state);

    if (serialized.data.length < COMPRESSION_THRESHOLD) {
      return 1; // No compression for small data
    }

    const compressed = yield* serializer.compress(serialized);

    return compressed.originalSize / compressed.compressedSize;
  });

/**
 * Utility function to validate state serializability
 */
export const validateStateSerializability = (state: unknown) =>
  Effect.gen(function* () {
    const serializer = yield* SerializerService;
    const serialized = yield* serializer.serialize(state);
    const deserialized = yield* serializer.deserialize(serialized);

    // Basic check - in practice, you might want more sophisticated comparison
    return typeof deserialized === typeof state;
  });

/**
 * Serialize and compress state in one operation
 */
export const serializeAndCompress = (state: unknown) =>
  Effect.gen(function* () {
    const serializer = yield* SerializerService;
    const serialized = yield* serializer.serialize(state);
    return yield* serializer.compress(serialized);
  });

/**
 * Decompress and deserialize state in one operation
 */
export const decompressAndDeserialize = (data: CompressedState) =>
  Effect.gen(function* () {
    const serializer = yield* SerializerService;
    const decompressed = yield* serializer.decompress(data);
    return yield* serializer.deserialize(decompressed);
  });

/**
 * Get serialization statistics
 */
export const getSerializationStats = (state: unknown) =>
  Effect.gen(function* () {
    const serializer = yield* SerializerService;
    const serialized = yield* serializer.serialize(state);
    const compressed = yield* serializer.compress(serialized);

    return {
      originalSize: serialized.data.length,
      compressedSize: compressed.compressedSize,
      compressionRatio: compressed.originalSize / compressed.compressedSize,
      checksum: serialized.metadata.checksum,
      version: serialized.version,
      serializedAt: serialized.metadata.serializedAt,
    };
  });

/**
 * KeyGeneratorService - Cryptographically secure key generation service
 *
 * Provides secure generation and validation of suspension keys with:
 * - Cryptographically secure random generation
 * - URL-safe encoding for web usage
 * - Configurable key length and format
 * - Collision resistance across distributed systems
 * - Key validation utilities
 */

import { Effect, Context, Layer, Ref } from 'effect';
import { randomBytes, createHash } from 'crypto';
import { KeyError } from '../errors';

// ============= Types =============

/**
 * Suspension key type
 */
export type SuspensionKey = string & { readonly _tag: 'SuspensionKey' };

/**
 * Key generation configuration
 */
export interface KeyGeneratorConfig {
  readonly length: number;
  readonly prefix: string;
  readonly includeTimestamp: boolean;
  readonly includeChecksum: boolean;
  readonly encoding: 'base64url' | 'base32' | 'hex';
}

/**
 * Key metadata extracted from suspension keys
 */
export interface KeyMetadata {
  readonly prefix?: string;
  readonly timestamp?: number;
  readonly generatedAt?: Date;
  readonly entropyBits: number;
  readonly hasChecksum?: boolean;
}

// ============= KeyGeneratorService Interface =============

export interface KeyGeneratorService {
  /**
   * Generate a cryptographically secure suspension key
   */
  readonly generate: () => Effect.Effect<SuspensionKey>;

  /**
   * Validate a suspension key format and integrity
   */
  readonly validate: (key: string) => Effect.Effect<SuspensionKey, KeyError>;

  /**
   * Extract metadata from a suspension key
   */
  readonly extractMetadata: (
    key: SuspensionKey
  ) => Effect.Effect<KeyMetadata, KeyError>;

  /**
   * Update configuration
   */
  readonly updateConfig: (
    config: Partial<KeyGeneratorConfig>
  ) => Effect.Effect<void>;

  /**
   * Get current configuration
   */
  readonly getConfig: () => Effect.Effect<KeyGeneratorConfig>;
}

// ============= Context Tag =============

export const KeyGeneratorService = Context.GenericTag<KeyGeneratorService>(
  '@services/KeyGenerator'
);

// ============= Constants =============

/**
 * Default key generator configuration
 */
const DEFAULT_CONFIG: KeyGeneratorConfig = {
  length: 32, // 256 bits of entropy
  prefix: 'df_susp',
  includeTimestamp: true,
  includeChecksum: true,
  encoding: 'base64url',
};

/**
 * Base64 URL-safe alphabet (RFC 4648)
 */
const BASE64URL_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * Base32 alphabet (RFC 4648)
 */
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

// ============= Helper Functions =============

const encodeBytes = (
  buffer: Buffer,
  encoding: KeyGeneratorConfig['encoding']
): string => {
  switch (encoding) {
    case 'base64url':
      return buffer
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=/g, '');

    case 'base32':
      return encodeBase32(buffer);

    case 'hex':
      return buffer.toString('hex');

    default:
      throw new Error(`Unsupported encoding: ${encoding}`);
  }
};

const encodeBase32 = (buffer: Buffer): string => {
  let result = '';
  let bits = 0;
  let value = 0;

  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | (buffer[i] ?? 0);
    bits += 8;

    while (bits >= 5) {
      result += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    result += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return result;
};

const calculateChecksum = (data: string): string => {
  return createHash('sha256')
    .update(data, 'utf8')
    .digest('hex')
    .substring(0, 6);
};

const isValidTimestamp = (timestamp: string): boolean => {
  try {
    const parsed = parseInt(timestamp, 36);
    // Check if it's a reasonable timestamp (after 2020, before 2050)
    const minTimestamp = new Date('2020-01-01').getTime();
    const maxTimestamp = new Date('2050-01-01').getTime();
    return parsed >= minTimestamp && parsed <= maxTimestamp;
  } catch {
    return false;
  }
};

const isValidEncodedData = (
  data: string,
  encoding: KeyGeneratorConfig['encoding']
): boolean => {
  switch (encoding) {
    case 'base64url':
      return /^[A-Za-z0-9\-_]+$/.test(data);

    case 'base32':
      return /^[A-Z2-7]+$/.test(data);

    case 'hex':
      return /^[0-9a-fA-F]+$/.test(data);

    default:
      return false;
  }
};

const calculateEntropyBits = (
  encodedData: string,
  encoding: KeyGeneratorConfig['encoding']
): number => {
  switch (encoding) {
    case 'base64url':
      // Each base64 character represents 6 bits
      return Math.floor(encodedData.length * 6);

    case 'base32':
      // Each base32 character represents 5 bits
      return Math.floor(encodedData.length * 5);

    case 'hex':
      // Each hex character represents 4 bits
      return Math.floor(encodedData.length * 4);

    default:
      return 0;
  }
};

// ============= Service Implementation =============

const makeKeyGeneratorService = (
  initialConfig?: Partial<KeyGeneratorConfig>
): Effect.Effect<KeyGeneratorService> =>
  Effect.gen(function* () {
    const configRef = yield* Ref.make({ ...DEFAULT_CONFIG, ...initialConfig });

    const service: KeyGeneratorService = {
      generate: () =>
        Effect.gen(function* () {
          const config = yield* Ref.get(configRef);

          // Generate random bytes for entropy
          const randomBuffer = randomBytes(config.length);

          // Create base key components
          const components: string[] = [];

          // Add prefix if configured
          if (config.prefix) {
            components.push(config.prefix);
          }

          // Add timestamp if configured (for ordering and uniqueness)
          if (config.includeTimestamp) {
            const timestamp = Date.now().toString(36); // Base36 for compactness
            components.push(timestamp);
          }

          // Encode the random bytes
          const encodedRandom = encodeBytes(randomBuffer, config.encoding);
          components.push(encodedRandom);

          // Add checksum if configured (for validation)
          if (config.includeChecksum) {
            const keyData = components.join('_');
            const checksum = calculateChecksum(keyData);
            components.push(checksum);
          }

          // Join components with underscores
          const key = components.join('_');

          return key as SuspensionKey;
        }),

      validate: (key: string) =>
        Effect.gen(function* () {
          const config = yield* Ref.get(configRef);

          // Basic format validation
          if (!key || typeof key !== 'string') {
            return yield* Effect.fail(
              new KeyError({
                message: 'Key must be a non-empty string',
                cause: { key, reason: 'invalid_format' },
              })
            );
          }

          // Split into components
          const components = key.split('_');

          // Check minimum components (at least random data)
          if (components.length < 2) {
            return yield* Effect.fail(
              new KeyError({
                message: 'Key format is invalid - insufficient components',
                cause: {
                  key,
                  reason: 'insufficient_components',
                  components: components.length,
                },
              })
            );
          }

          let componentIndex = 0;

          // Validate prefix if configured
          if (config.prefix) {
            if (components[componentIndex] !== config.prefix) {
              return yield* Effect.fail(
                new KeyError({
                  message: `Key prefix mismatch - expected '${config.prefix}'`,
                  cause: {
                    key,
                    reason: 'prefix_mismatch',
                    expected: config.prefix,
                    actual: components[componentIndex],
                  },
                })
              );
            }
            componentIndex++;
          }

          // Validate timestamp if configured
          if (config.includeTimestamp) {
            const timestampComponent = components[componentIndex];
            if (!timestampComponent || !isValidTimestamp(timestampComponent)) {
              return yield* Effect.fail(
                new KeyError({
                  message: 'Invalid timestamp component in key',
                  cause: {
                    key,
                    reason: 'invalid_timestamp',
                    timestamp: timestampComponent,
                  },
                })
              );
            }
            componentIndex++;
          }

          // Validate random component
          const randomComponent = components[componentIndex];
          if (
            !randomComponent ||
            !isValidEncodedData(randomComponent, config.encoding)
          ) {
            return yield* Effect.fail(
              new KeyError({
                message: 'Invalid random component in key',
                cause: { key, reason: 'invalid_random', randomComponent },
              })
            );
          }
          componentIndex++;

          // Validate checksum if configured
          if (config.includeChecksum) {
            if (componentIndex >= components.length) {
              return yield* Effect.fail(
                new KeyError({
                  message: 'Missing checksum component in key',
                  cause: { key, reason: 'missing_checksum' },
                })
              );
            }

            const providedChecksum = components[componentIndex];
            const keyDataForChecksum = components
              .slice(0, componentIndex)
              .join('_');
            const expectedChecksum = calculateChecksum(keyDataForChecksum);

            if (providedChecksum !== expectedChecksum) {
              return yield* Effect.fail(
                new KeyError({
                  message: 'Key checksum validation failed',
                  cause: {
                    key,
                    reason: 'checksum_mismatch',
                    expected: expectedChecksum,
                    actual: providedChecksum,
                  },
                })
              );
            }
          }

          return key as SuspensionKey;
        }),

      extractMetadata: (key: SuspensionKey) =>
        Effect.gen(function* () {
          const config = yield* Ref.get(configRef);

          // Validate the key first
          yield* service.validate(key);

          const components = key.split('_');
          let componentIndex = 0;
          const metadata: any = {};

          // Extract prefix
          if (config.prefix) {
            metadata.prefix = components[componentIndex];
            componentIndex++;
          }

          // Extract timestamp
          if (config.includeTimestamp) {
            const timestampComponent = components[componentIndex];
            metadata.timestamp = parseInt(timestampComponent || '0', 36);
            metadata.generatedAt = new Date(metadata.timestamp);
            componentIndex++;
          }

          // Extract entropy length
          const randomComponent = components[componentIndex];
          metadata.entropyBits = calculateEntropyBits(
            randomComponent || '',
            config.encoding
          );
          componentIndex++;

          // Note checksum presence
          if (config.includeChecksum) {
            metadata.hasChecksum = true;
          }

          return metadata as KeyMetadata;
        }),

      updateConfig: (newConfig: Partial<KeyGeneratorConfig>) =>
        Effect.gen(function* () {
          yield* Ref.update(configRef, (current) => ({
            ...current,
            ...newConfig,
          }));
        }),

      getConfig: () => Ref.get(configRef),
    };

    return service;
  });

// ============= Layer Implementations =============

/**
 * Live implementation of KeyGeneratorService
 */
export const KeyGeneratorServiceLive = Layer.effect(
  KeyGeneratorService,
  makeKeyGeneratorService()
);

/**
 * Secure implementation with custom configuration
 */
export const KeyGeneratorServiceSecure = (
  config?: Partial<KeyGeneratorConfig>
) => Layer.effect(KeyGeneratorService, makeKeyGeneratorService(config));

/**
 * Simple implementation for testing
 */
export const KeyGeneratorServiceTest = Layer.effect(
  KeyGeneratorService,
  Effect.gen(function* () {
    let counter = 0;

    return {
      generate: () =>
        Effect.gen(function* () {
          const timestamp = Date.now();
          counter++;
          return `simple_${timestamp}_${counter}` as SuspensionKey;
        }),

      validate: (key: string) =>
        Effect.gen(function* () {
          if (!key.startsWith('simple_')) {
            return yield* Effect.fail(
              new KeyError({
                message: 'Invalid simple key format',
                cause: { key },
              })
            );
          }
          return key as SuspensionKey;
        }),

      extractMetadata: (key: SuspensionKey) =>
        Effect.gen(function* () {
          const parts = key.split('_');
          const timestamp = parseInt(parts[1] || '0');

          return {
            prefix: 'simple',
            timestamp,
            generatedAt: new Date(timestamp),
            entropyBits: 64, // Approximation for simple keys
            hasChecksum: false,
          };
        }),

      updateConfig: () => Effect.void,
      getConfig: () => Effect.succeed(DEFAULT_CONFIG),
    };
  })
);

// ============= Helper Functions =============

/**
 * Generate a single key
 */
export const generateKey = () =>
  Effect.gen(function* () {
    const generator = yield* KeyGeneratorService;
    return yield* generator.generate();
  });

/**
 * Validate a key
 */
export const validateKey = (key: string) =>
  Effect.gen(function* () {
    const generator = yield* KeyGeneratorService;
    return yield* generator.validate(key);
  });

/**
 * Estimate key collision probability
 */
export const estimateCollisionProbability = (
  keyCount: number,
  entropyBits: number
): number => {
  // Birthday paradox approximation: P ≈ 1 - e^(-k²/2N)
  // where k = number of keys, N = 2^entropy_bits
  const totalPossible = Math.pow(2, entropyBits);
  const exponent = -(keyCount * keyCount) / (2 * totalPossible);
  return 1 - Math.exp(exponent);
};

/**
 * Recommend minimum entropy for given key count
 */
export const recommendMinimumEntropy = (
  expectedKeyCount: number,
  maxCollisionProbability: number = 1e-9 // 1 in a billion
): number => {
  // Solve for entropy: entropy = log2(k²/(-2*ln(1-P)))
  const ln1MinusP = Math.log(1 - maxCollisionProbability);
  const entropy = Math.log2(
    (expectedKeyCount * expectedKeyCount) / (-2 * ln1MinusP)
  );
  return Math.ceil(entropy);
};

/**
 * Check if a string is a valid suspension key
 */
export const isValidSuspensionKey = (key: unknown): key is SuspensionKey => {
  if (typeof key !== 'string' || !key) {
    return false;
  }

  // Check length (should be reasonable for encoded keys)
  if (key.length < 10 || key.length > 200) {
    return false;
  }

  // Check basic format (contains underscore separators)
  return key.includes('_');
};

/**
 * Generate multiple keys at once
 */
export const generateKeys = (count: number) =>
  Effect.gen(function* () {
    const generator = yield* KeyGeneratorService;
    const keys: SuspensionKey[] = [];

    for (let i = 0; i < count; i++) {
      const key = yield* generator.generate();
      keys.push(key);
    }

    return keys;
  });

/**
 * Get key statistics
 */
export const getKeyStatistics = (key: SuspensionKey) =>
  Effect.gen(function* () {
    const generator = yield* KeyGeneratorService;
    const metadata = yield* generator.extractMetadata(key);
    const config = yield* generator.getConfig();

    return {
      ...metadata,
      encoding: config.encoding,
      length: key.length,
      components: key.split('_').length,
      estimatedSecurityLevel:
        metadata.entropyBits > 128
          ? 'high'
          : metadata.entropyBits > 64
            ? 'medium'
            : 'low',
    };
  });

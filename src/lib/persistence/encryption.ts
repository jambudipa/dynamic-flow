/**
 * State Encryption - AES-256-GCM encryption for flow state data
 *
 * Provides secure encryption of sensitive flow state data at rest with:
 * - AES-256-GCM encryption/decryption
 * - Environment-based key management
 * - Key rotation support
 * - Optional encryption for development
 * - Secure IV generation for each encryption
 */

import { Effect, Context, Layer, Ref } from 'effect';
import { createCipher, createDecipher, randomBytes, createHash } from 'crypto';
import {
  type StateEncryptor,
  type SerializedState,
  EncryptionError,
} from './types';

/**
 * Encryption configuration
 */
interface EncryptionConfig {
  readonly enabled: boolean;
  readonly algorithm: string;
  readonly keyDerivationRounds: number;
  readonly ivLength: number;
  readonly tagLength: number;
}

/**
 * Default encryption configuration
 */
const DEFAULT_CONFIG: EncryptionConfig = {
  enabled: true,
  algorithm: 'aes-256-gcm',
  keyDerivationRounds: 100000,
  ivLength: 16,
  tagLength: 16,
};

/**
 * Environment variable names for encryption keys
 */
const ENV_KEYS = {
  ENCRYPTION_KEY: 'DYNAMICFLOW_ENCRYPTION_KEY',
  ENCRYPTION_ENABLED: 'DYNAMICFLOW_ENCRYPTION_ENABLED',
  ENCRYPTION_KEY_ROTATION: 'DYNAMICFLOW_ENCRYPTION_KEY_ROTATION',
} as const;

/**
 * Encrypted data structure
 */
interface EncryptedData {
  readonly encrypted: string;
  readonly iv: string;
  readonly tag: string;
  readonly algorithm: string;
  readonly keyVersion: string;
}

/**
 * AES State Encryptor service
 */
export const AESStateEncryptor = Context.GenericTag<StateEncryptor>(
  '@persistence/AESStateEncryptor'
);

/**
 * Create AES state encryptor service layer
 */
export const AESStateEncryptorLive = (config: Partial<EncryptionConfig> = {}) =>
  Layer.effect(
    AESStateEncryptor,
    Effect.gen(function* () {
      let finalConfig = { ...DEFAULT_CONFIG, ...config };

      // Check if encryption is enabled via environment
      const encryptionEnabled = process.env[ENV_KEYS.ENCRYPTION_ENABLED];
      if (encryptionEnabled !== undefined) {
        finalConfig = {
          ...finalConfig,
          enabled: encryptionEnabled.toLowerCase() === 'true',
        };
      }

      const loadMasterKey = (config: EncryptionConfig): Buffer | null => {
        // If encryption is disabled, return null
        if (!config.enabled) {
          return null;
        }

        // Try to load from environment
        const envKey = process.env[ENV_KEYS.ENCRYPTION_KEY];
        if (envKey) {
          // Key should be base64 encoded in environment
          try {
            return Buffer.from(envKey, 'base64');
          } catch (error) {
            console.warn(
              'Invalid encryption key in environment, encryption disabled'
            );
            return null;
          }
        }

        // In development/test, warn about missing key
        if (
          process.env.NODE_ENV === 'development' ||
          process.env.NODE_ENV === 'test'
        ) {
          console.warn(
            'No encryption key found, using development key (NOT SECURE)'
          );
          // Generate a consistent key for development
          return createHash('sha256').update('dynamicflow-dev-key').digest();
        }

        // In production, require explicit key
        console.warn(
          'No encryption key found in production, encryption disabled'
        );
        return null;
      };

      const determineKeyVersion = (): string => {
        const rotationInfo = process.env[ENV_KEYS.ENCRYPTION_KEY_ROTATION];
        if (rotationInfo) {
          try {
            const rotation = JSON.parse(rotationInfo);
            return rotation.version || '1';
          } catch (error) {
            console.warn(
              'Invalid key rotation configuration, using default version'
            );
          }
        }
        return '1';
      };

      const isKeyVersionCompatible = (version: string): boolean => {
        // For now, support all versions (backwards compatibility)
        // In the future, this could implement more sophisticated rotation logic
        return true;
      };

      // Load master key from environment
      const masterKey = loadMasterKey(finalConfig);
      const keyVersion = determineKeyVersion();

      const encryptData = (
        data: string,
        iv: Buffer
      ): Effect.Effect<{ encrypted: string; tag: string }, EncryptionError> =>
        Effect.gen(function* () {
          if (!masterKey) {
            return yield* Effect.fail(
              new EncryptionError({
                module: 'persistence',
                operation: 'encrypt',
                message: 'No master key available',
                cause: 'Master key not loaded',
              })
            );
          }

          const result = yield* Effect.try({
            try: () => {
              const crypto = require('crypto');
              const cipher = crypto.createCipherGCM(
                finalConfig.algorithm,
                masterKey,
                iv
              );

              let encrypted = cipher.update(data, 'utf8', 'base64');
              encrypted += cipher.final('base64');

              const tag = cipher.getAuthTag().toString('base64');

              return { encrypted, tag };
            },
            catch: (error) =>
              new EncryptionError({
                module: 'persistence',
                operation: 'encrypt',
                message: `Encryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                cause: error,
              }),
          });

          return result;
        });

      const decryptData = (
        encryptedData: string,
        iv: Buffer,
        tag: string
      ): Effect.Effect<string, EncryptionError> =>
        Effect.gen(function* () {
          if (!masterKey) {
            return yield* Effect.fail(
              new EncryptionError({
                module: 'persistence',
                operation: 'decrypt',
                message: 'No master key available',
                cause: 'Master key not loaded',
              })
            );
          }

          const decrypted = yield* Effect.try({
            try: () => {
              const crypto = require('crypto');
              const decipher = crypto.createDecipherGCM(
                finalConfig.algorithm,
                masterKey,
                iv
              );

              decipher.setAuthTag(Buffer.from(tag, 'base64'));

              let decrypted = decipher.update(encryptedData, 'base64', 'utf8');
              decrypted += decipher.final('utf8');

              return decrypted;
            },
            catch: (error) =>
              new EncryptionError({
                module: 'persistence',
                operation: 'decrypt',
                message: `Decryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
                cause: error,
              }),
          });

          return decrypted;
        });

      /**
       * Encrypt serialized state data
       */
      const encrypt = (
        data: SerializedState
      ): Effect.Effect<SerializedState, EncryptionError> =>
        Effect.gen(function* () {
          // If encryption is disabled, return data as-is
          if (!finalConfig.enabled || !masterKey) {
            return data;
          }

          // Generate random IV for this encryption
          const iv = yield* Effect.sync(() =>
            randomBytes(finalConfig.ivLength)
          );

          // Encrypt the data
          const encryptedData = yield* encryptData(data.data, iv);

          // Create encrypted payload
          const encryptedPayload: EncryptedData = {
            encrypted: encryptedData.encrypted,
            iv: iv.toString('base64'),
            tag: encryptedData.tag,
            algorithm: finalConfig.algorithm,
            keyVersion: keyVersion,
          };

          // Replace data with encrypted payload
          return {
            ...data,
            data: JSON.stringify(encryptedPayload),
            metadata: {
              ...data.metadata,
              encrypted: true,
              encryptionAlgorithm: finalConfig.algorithm,
              keyVersion: keyVersion,
            },
          };
        });

      /**
       * Decrypt serialized state data
       */
      const decrypt = (
        data: SerializedState
      ): Effect.Effect<SerializedState, EncryptionError> =>
        Effect.gen(function* () {
          // Check if data is encrypted
          if (!('encrypted' in data.metadata) || !data.metadata.encrypted) {
            return data;
          }

          if (!masterKey) {
            return yield* Effect.fail(
              new EncryptionError({
                module: 'persistence',
                operation: 'decrypt',
                message: 'No encryption key available for decryption',
                cause: 'Master key not loaded',
              })
            );
          }

          // Parse encrypted payload
          const encryptedPayload = yield* Effect.try({
            try: () => JSON.parse(data.data) as EncryptedData,
            catch: (error) =>
              new EncryptionError({
                module: 'persistence',
                operation: 'decrypt',
                message: 'Failed to parse encrypted payload',
                cause: error,
              }),
          });

          // Validate encryption algorithm
          if (encryptedPayload.algorithm !== finalConfig.algorithm) {
            return yield* Effect.fail(
              new EncryptionError({
                module: 'persistence',
                operation: 'decrypt',
                message: `Unsupported encryption algorithm: ${encryptedPayload.algorithm}`,
                cause: {
                  algorithm: encryptedPayload.algorithm,
                  supported: finalConfig.algorithm,
                },
              })
            );
          }

          // Check key version compatibility
          if (!isKeyVersionCompatible(encryptedPayload.keyVersion)) {
            return yield* Effect.fail(
              new EncryptionError({
                module: 'persistence',
                operation: 'decrypt',
                message: `Incompatible key version: ${encryptedPayload.keyVersion}`,
                cause: {
                  keyVersion: encryptedPayload.keyVersion,
                  currentVersion: keyVersion,
                },
              })
            );
          }

          // Decrypt the data
          const iv = Buffer.from(encryptedPayload.iv, 'base64');
          const decryptedData = yield* decryptData(
            encryptedPayload.encrypted,
            iv,
            encryptedPayload.tag
          );

          // Remove encryption metadata
          const metadata = data.metadata as any;
          const {
            encrypted,
            encryptionAlgorithm,
            keyVersion: _keyVersion,
            ...cleanMetadata
          } = metadata;

          return {
            ...data,
            data: decryptedData,
            metadata: cleanMetadata,
          };
        });

      // Return the service implementation
      return {
        encrypt,
        decrypt,
      };
    })
  );

/**
 * No-operation encryptor service
 */
export const NoOpEncryptor = Context.GenericTag<StateEncryptor>(
  '@persistence/NoOpEncryptor'
);

/**
 * Create no-op encryptor service layer
 */
export const NoOpEncryptorLive = Layer.succeed(NoOpEncryptor, {
  encrypt: (data: SerializedState) => Effect.succeed(data),
  decrypt: (data: SerializedState) => Effect.succeed(data),
});

/**
 * Create state encryptor based on configuration
 */
export const createStateEncryptor = (config?: Partial<EncryptionConfig>) => {
  // Check if encryption should be disabled
  const encryptionEnabled = process.env[ENV_KEYS.ENCRYPTION_ENABLED];
  if (encryptionEnabled === 'false') {
    return NoOpEncryptorLive;
  }

  return AESStateEncryptorLive(config);
};

/**
 * Utility function to generate a new encryption key
 */
export const generateEncryptionKey = (): Effect.Effect<string, never> => {
  return Effect.sync(() => {
    const key = randomBytes(32); // 256 bits for AES-256
    return key.toString('base64');
  });
};

/**
 * Utility function to validate encryption key format
 */
export const validateEncryptionKey = (
  key: string
): Effect.Effect<boolean, EncryptionError> => {
  return Effect.try({
    try: () => {
      const buffer = Buffer.from(key, 'base64');
      return buffer.length === 32; // 256 bits
    },
    catch: (error) =>
      new EncryptionError({
        module: 'persistence',
        operation: 'validate',
        message: 'Invalid encryption key format',
        cause: error,
      }),
  });
};

/**
 * Create AES state encryptor with environment-based key
 */
export const createAESStateEncryptor = () => {
  const key = process.env.DYNAMIC_FLOW_ENCRYPTION_KEY;
  if (!key) {
    throw new Error(
      'DYNAMIC_FLOW_ENCRYPTION_KEY environment variable is required for encryption'
    );
  }

  if (key.length !== 32) {
    throw new Error('Encryption key must be exactly 32 bytes long');
  }

  return AESStateEncryptorLive({ enabled: true });
};

/**
 * Create no-op state encryptor (pass-through)
 */
export const createNoOpStateEncryptor = () => NoOpEncryptorLive;

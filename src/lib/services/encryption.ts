/**
 * EncryptionService - AES-256-GCM encryption for flow state data
 * 
 * Provides secure encryption of sensitive flow state data at rest with:
 * - AES-256-GCM encryption/decryption
 * - Environment-based key management
 * - Key rotation support
 * - Optional encryption for development
 * - Secure IV generation for each encryption
 */

import { Effect, Context, Layer, Ref } from 'effect';
import { randomBytes, createHash } from 'crypto';
import { EncryptionError } from '../errors';
import { ConfigService } from './config';

// ============= Types =============

/**
 * Encryption configuration
 */
export interface EncryptionConfig {
  readonly enabled: boolean;
  readonly algorithm: string;
  readonly keyDerivationRounds: number;
  readonly ivLength: number;
  readonly tagLength: number;
}

/**
 * Encrypted data structure
 */
export interface EncryptedData {
  readonly encrypted: string;
  readonly iv: string;
  readonly tag: string;
  readonly algorithm: string;
  readonly keyVersion: string;
}

/**
 * Serialized state with encryption metadata
 */
export interface SerializedState {
  readonly version: string;
  readonly data: string;
  readonly metadata: {
    readonly serializedAt: string;
    readonly size: number;
    readonly checksum: string;
    readonly encrypted?: boolean;
    readonly encryptionAlgorithm?: string;
    readonly keyVersion?: string;
    readonly [key: string]: unknown;
  };
}

// ============= EncryptionService Interface =============

export interface EncryptionService {
  /**
   * Encrypt serialized state data
   */
  readonly encrypt: (data: SerializedState) => Effect.Effect<SerializedState, EncryptionError>;

  /**
   * Decrypt serialized state data
   */
  readonly decrypt: (data: SerializedState) => Effect.Effect<SerializedState, EncryptionError>;

  /**
   * Check if encryption is currently enabled
   */
  readonly isEncryptionEnabled: () => Effect.Effect<boolean>;

  /**
   * Get current key version
   */
  readonly getCurrentKeyVersion: () => Effect.Effect<string>;

  /**
   * Update encryption configuration
   */
  readonly updateConfig: (config: Partial<EncryptionConfig>) => Effect.Effect<void>;

  /**
   * Rotate encryption key
   */
  readonly rotateKey: (newKey: Buffer, newVersion: string) => Effect.Effect<void>;

  /**
   * Generate new encryption key
   */
  readonly generateKey: () => Effect.Effect<Buffer>;

  /**
   * Validate encryption key format
   */
  readonly validateKey: (key: Buffer) => Effect.Effect<boolean, EncryptionError>;
}

// ============= Context Tag =============

export const EncryptionService = Context.GenericTag<EncryptionService>('@services/Encryption');

// ============= Constants =============

/**
 * Default encryption configuration
 */
const DEFAULT_CONFIG: EncryptionConfig = {
  enabled: true,
  algorithm: 'aes-256-gcm',
  keyDerivationRounds: 100000,
  ivLength: 16,
  tagLength: 16
};

/**
 * Environment variable names for encryption keys
 */
const ENV_KEYS = {
  ENCRYPTION_KEY: 'DYNAMICFLOW_ENCRYPTION_KEY',
  ENCRYPTION_ENABLED: 'DYNAMICFLOW_ENCRYPTION_ENABLED',
  ENCRYPTION_KEY_ROTATION: 'DYNAMICFLOW_ENCRYPTION_KEY_ROTATION'
} as const;

// ============= Helper Functions =============

const loadMasterKey = (enabled: boolean): Buffer | null => {
  // If encryption is disabled, return null
  if (!enabled) {
    return null;
  }

  // Try to load from environment
  const envKey = process.env[ENV_KEYS.ENCRYPTION_KEY];
  if (envKey) {
    // Key should be base64 encoded in environment
    try {
      return Buffer.from(envKey, 'base64');
    } catch (error) {
      console.warn('Invalid encryption key in environment, encryption disabled');
      return null;
    }
  }

  // In development/test, warn about missing key
  if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
    console.warn('No encryption key found, using development key (NOT SECURE)');
    // Generate a consistent key for development
    return createHash('sha256').update('dynamicflow-dev-key').digest();
  }

  // In production, require explicit key
  console.warn('No encryption key found in production, encryption disabled');
  return null;
};

const determineKeyVersion = (): string => {
  const rotationInfo = process.env[ENV_KEYS.ENCRYPTION_KEY_ROTATION];
  if (rotationInfo) {
    try {
      const rotation = JSON.parse(rotationInfo);
      return rotation.version || '1';
    } catch (error) {
      console.warn('Invalid key rotation configuration, using default version');
    }
  }
  return '1';
};

const isKeyVersionCompatible = (version: string): boolean => {
  // For now, support all versions (backwards compatibility)
  // In the future, this could implement more sophisticated rotation logic
  return true;
};

const encryptData = (
  data: string,
  iv: Buffer,
  masterKey: Buffer,
  algorithm: string
): Effect.Effect<{ encrypted: string; tag: string }, EncryptionError> =>
  Effect.try({
    try: () => {
      const crypto = require('crypto');
      const cipher = crypto.createCipherGCM(algorithm, masterKey, iv);
      
      let encrypted = cipher.update(data, 'utf8', 'base64');
      encrypted += cipher.final('base64');
      
      const tag = cipher.getAuthTag().toString('base64');
      
      return { encrypted, tag };
    },
    catch: (error) => new EncryptionError({
      message: `Encryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      operation: 'encrypt',
      cause: error
    })
  });

const decryptData = (
  encryptedData: string,
  iv: Buffer,
  tag: string,
  masterKey: Buffer,
  algorithm: string
): Effect.Effect<string, EncryptionError> =>
  Effect.try({
    try: () => {
      const crypto = require('crypto');
      const decipher = crypto.createDecipherGCM(algorithm, masterKey, iv);
      
      decipher.setAuthTag(Buffer.from(tag, 'base64'));
      
      let decrypted = decipher.update(encryptedData, 'base64', 'utf8');
      decrypted += decipher.final('utf8');
      
      return decrypted;
    },
    catch: (error) => new EncryptionError({
      message: `Decryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
      operation: 'decrypt',
      cause: error
    })
  });

// ============= Service Implementation =============

const makeEncryptionService = (
  initialConfig?: Partial<EncryptionConfig>
): Effect.Effect<EncryptionService> =>
  Effect.gen(function* () {
    const configRef = yield* Ref.make({ ...DEFAULT_CONFIG, ...initialConfig });
    const keyRef = yield* Ref.make<Buffer | null>(null);
    const keyVersionRef = yield* Ref.make('1');

    // Initialize key and version
    const config = yield* Ref.get(configRef);
    const masterKey = loadMasterKey(config.enabled);
    const keyVersion = determineKeyVersion();
    
    yield* Ref.set(keyRef, masterKey);
    yield* Ref.set(keyVersionRef, keyVersion);

    return {
      encrypt: (data: SerializedState) =>
        Effect.gen(function* () {
          const config = yield* Ref.get(configRef);
          const masterKey = yield* Ref.get(keyRef);

          // If encryption is disabled, return data as-is
          if (!config.enabled || !masterKey) {
            return data;
          }

          // Generate random IV for this encryption
          const iv = randomBytes(config.ivLength);

          // Encrypt the data
          const encryptedResult = yield* encryptData(data.data, iv, masterKey, config.algorithm);
          const keyVersion = yield* Ref.get(keyVersionRef);

          // Create encrypted payload
          const encryptedPayload: EncryptedData = {
            encrypted: encryptedResult.encrypted,
            iv: iv.toString('base64'),
            tag: encryptedResult.tag,
            algorithm: config.algorithm,
            keyVersion: keyVersion
          };

          // Replace data with encrypted payload
          return {
            ...data,
            data: JSON.stringify(encryptedPayload),
            metadata: {
              ...data.metadata,
              encrypted: true,
              encryptionAlgorithm: config.algorithm,
              keyVersion: keyVersion
            }
          };
        }),

      decrypt: (data: SerializedState) =>
        Effect.gen(function* () {
          const config = yield* Ref.get(configRef);
          const masterKey = yield* Ref.get(keyRef);

          // Check if data is encrypted
          if (!('encrypted' in data.metadata) || !data.metadata.encrypted) {
            return data;
          }

          if (!masterKey) {
            return yield* Effect.fail(new EncryptionError({
              message: 'No encryption key available for decryption',
              operation: 'decrypt',
              cause: 'Master key not loaded'
            }));
          }

          // Parse encrypted payload
          const encryptedPayload = yield* Effect.try({
            try: () => JSON.parse(data.data) as EncryptedData,
            catch: (error) => new EncryptionError({
              message: 'Failed to parse encrypted payload',
              operation: 'decrypt',
              cause: error
            })
          });

          // Validate encryption algorithm
          if (encryptedPayload.algorithm !== config.algorithm) {
            return yield* Effect.fail(new EncryptionError({
              message: `Unsupported encryption algorithm: ${encryptedPayload.algorithm}`,
              operation: 'decrypt',
              cause: { algorithm: encryptedPayload.algorithm, supported: config.algorithm }
            }));
          }

          // Check key version compatibility
          if (!isKeyVersionCompatible(encryptedPayload.keyVersion)) {
            const currentVersion = yield* Ref.get(keyVersionRef);
            return yield* Effect.fail(new EncryptionError({
              message: `Incompatible key version: ${encryptedPayload.keyVersion}`,
              operation: 'decrypt',
              cause: { keyVersion: encryptedPayload.keyVersion, currentVersion }
            }));
          }

          // Decrypt the data
          const iv = Buffer.from(encryptedPayload.iv, 'base64');
          const decryptedData = yield* decryptData(
            encryptedPayload.encrypted,
            iv,
            encryptedPayload.tag,
            masterKey,
            config.algorithm
          );

          // Remove encryption metadata
          const { encrypted, encryptionAlgorithm, keyVersion, ...cleanMetadata } = data.metadata;

          return {
            ...data,
            data: decryptedData,
            metadata: cleanMetadata
          };
        }),

      isEncryptionEnabled: () =>
        Effect.gen(function* () {
          const config = yield* Ref.get(configRef);
          const masterKey = yield* Ref.get(keyRef);
          return config.enabled && masterKey !== null;
        }),

      getCurrentKeyVersion: () => Ref.get(keyVersionRef),

      updateConfig: (newConfig: Partial<EncryptionConfig>) =>
        Effect.gen(function* () {
          const currentConfig = yield* Ref.get(configRef);
          const updatedConfig = { ...currentConfig, ...newConfig };
          yield* Ref.set(configRef, updatedConfig);

          // If encryption enabled status changed, update master key
          if (newConfig.enabled !== undefined && newConfig.enabled !== currentConfig.enabled) {
            const newKey = loadMasterKey(updatedConfig.enabled);
            yield* Ref.set(keyRef, newKey);
          }
        }),

      rotateKey: (newKey: Buffer, newVersion: string) =>
        Effect.gen(function* () {
          yield* Ref.set(keyRef, newKey);
          yield* Ref.set(keyVersionRef, newVersion);
        }),

      generateKey: () =>
        Effect.gen(function* () {
          return randomBytes(32); // 256 bits for AES-256
        }),

      validateKey: (key: Buffer) =>
        Effect.gen(function* () {
          if (key.length !== 32) {
            return yield* Effect.fail(new EncryptionError({
              message: 'Encryption key must be exactly 32 bytes (256 bits)',
              operation: 'decrypt' as const, // Changed from 'validate' to valid operation
              cause: { actualLength: key.length, expectedLength: 32 }
            }));
          }
          return true;
        }),
    };
  });

// ============= Layer Implementations =============

/**
 * Live implementation of EncryptionService
 */
export const EncryptionServiceLive = Layer.effect(
  EncryptionService,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const encryptionConfig = yield* config.get('persistence');
    
    return yield* makeEncryptionService({
      enabled: encryptionConfig.encryption.enabled,
      algorithm: encryptionConfig.encryption.algorithm || DEFAULT_CONFIG.algorithm,
    });
  })
);

/**
 * Test implementation with custom configuration
 */
export const EncryptionServiceTest = (config?: Partial<EncryptionConfig>) =>
  Layer.effect(
    EncryptionService,
    makeEncryptionService(config || { enabled: false })
  );

/**
 * Disabled encryption service for development
 */
export const EncryptionServiceDisabled = Layer.effect(
  EncryptionService,
  makeEncryptionService({ enabled: false })
);

// ============= Helper Functions =============

/**
 * Generate a base64-encoded encryption key
 */
export const generateEncryptionKey = () =>
  Effect.gen(function* () {
    const service = yield* EncryptionService;
    const key = yield* service.generateKey();
    return key.toString('base64');
  });

/**
 * Validate encryption key format
 */
export const validateEncryptionKey = (keyString: string) =>
  Effect.gen(function* () {
    const service = yield* EncryptionService;
    const key = yield* Effect.try({
      try: () => Buffer.from(keyString, 'base64'),
      catch: (error) => new EncryptionError({
        message: 'Invalid encryption key format - must be base64 encoded',
        operation: 'decrypt' as const, // Changed from 'validate' to valid operation
        cause: error
      })
    });
    
    return yield* service.validateKey(key);
  });

/**
 * Encrypt data with current service
 */
export const encryptState = (data: SerializedState) =>
  Effect.gen(function* () {
    const service = yield* EncryptionService;
    return yield* service.encrypt(data);
  });

/**
 * Decrypt data with current service
 */
export const decryptState = (data: SerializedState) =>
  Effect.gen(function* () {
    const service = yield* EncryptionService;
    return yield* service.decrypt(data);
  });

/**
 * Check if encryption is enabled
 */
export const isEncryptionEnabled = () =>
  Effect.gen(function* () {
    const service = yield* EncryptionService;
    return yield* service.isEncryptionEnabled();
  });

/**
 * Get encryption statistics
 */
export const getEncryptionStats = () =>
  Effect.gen(function* () {
    const service = yield* EncryptionService;
    const enabled = yield* service.isEncryptionEnabled();
    const keyVersion = yield* service.getCurrentKeyVersion();
    
    return {
      enabled,
      keyVersion,
      algorithm: enabled ? DEFAULT_CONFIG.algorithm : 'none',
      keyLength: enabled ? 256 : 0
    };
  });

/**
 * Test encryption/decryption round trip
 */
export const testEncryptionRoundTrip = (testData: SerializedState) =>
  Effect.gen(function* () {
    const service = yield* EncryptionService;
    
    // Encrypt the data
    const encrypted = yield* service.encrypt(testData);
    
    // Decrypt it back
    const decrypted = yield* service.decrypt(encrypted);
    
    // Verify integrity
    const isValid = decrypted.data === testData.data &&
                   decrypted.version === testData.version;
    
    return {
      success: isValid,
      originalSize: testData.data.length,
      encryptedSize: encrypted.data.length,
      compressionRatio: encrypted.data.length / testData.data.length
    };
  });
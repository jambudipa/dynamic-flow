/**
 * Core Types and Interfaces for Persistence Module
 *
 * Defines the fundamental types, interfaces, and schemas needed for
 * flow suspension and resumption functionality.
 */

import { Schema, Data } from 'effect';
import type { Effect, Duration, Option } from 'effect';

// ============= Core Types =============

/**
 * Unique identifier for a suspended flow.
 * Cryptographically secure, URL-safe string.
 */
export type SuspensionKey = string & { readonly _brand: 'SuspensionKey' };

/**
 * Serialized representation of flow state
 */
export interface SerializedState {
  readonly version: string;
  readonly data: string;
  readonly metadata: {
    readonly serializedAt: string;
    readonly size: number;
    readonly checksum: string;
  };
  readonly expiresAt?: string;
  readonly ttl?: number;
  readonly compressed?: boolean;
  readonly originalSize?: number;
  readonly compressedSize?: number;
}

/**
 * Compressed version of serialized state
 */
export interface CompressedState extends SerializedState {
  readonly compressed: true;
  readonly originalSize: number;
  readonly compressedSize: number;
}

/**
 * Context information for flow suspension
 */
export interface SuspensionContext {
  readonly toolId: string;
  readonly awaitingInputSchema: Schema.Schema<unknown>;
  readonly timeout?: Duration.Duration;
  readonly defaultValue?: unknown;
  readonly metadata: Record<string, unknown>;
}

/**
 * Information about a suspended flow
 */
export interface SuspendedFlowInfo {
  readonly key: SuspensionKey;
  readonly createdAt: Date;
  readonly expiresAt?: Date;
  readonly metadata: Record<string, unknown>;
  readonly size: number;
  readonly toolId: string;
}

/**
 * Result of suspension operation
 */
export interface SuspensionResult {
  readonly key: SuspensionKey;
  readonly suspendedAt: Date;
  readonly expiresAt?: Date;
  readonly metadata: Record<string, unknown>;
}

/**
 * Result of resumption operation
 */
export interface ResumptionResult {
  readonly key: SuspensionKey;
  readonly resumedAt: Date;
  readonly flowInstance: unknown; // FlowInstance type from core
}

/**
 * Request for resumption operation
 */
export interface ResumptionRequest {
  readonly key: SuspensionKey;
  readonly input: unknown;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Result of cancellation operation
 */
export interface CancellationResult {
  readonly key: SuspensionKey;
  readonly cancelled: boolean;
  readonly reason?: string;
}

// ============= Query and Management Types =============

/**
 * Criteria for querying suspended flows
 */
export interface QueryCriteria {
  readonly limit?: number;
  readonly offset?: number;
  readonly createdAfter?: Date;
  readonly createdBefore?: Date;
  readonly expiresAfter?: Date;
  readonly expiresBefore?: Date;
  readonly toolId?: string;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Criteria for cleanup operations
 */
export interface CleanupCriteria {
  readonly expiredOnly?: boolean;
  readonly olderThan?: Date;
  readonly toolId?: string;
  readonly limit?: number;
}

/**
 * Result of cleanup operation
 */
export interface CleanupResult {
  readonly deletedCount: number;
  readonly errors: CleanupError[];
}

/**
 * Individual cleanup error
 */
export interface CleanupError {
  readonly key: SuspensionKey;
  readonly error: string;
}

// ============= Backend Types =============

/**
 * Health status of a storage backend
 */
export interface BackendHealth {
  readonly backend: string;
  readonly healthy: boolean;
  readonly latency?: number;
  readonly error?: string;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Storage entry for backend listing
 */
export interface StorageEntry {
  readonly key: SuspensionKey;
  readonly createdAt: Date;
  readonly expiresAt?: Date;
  readonly size: number;
  readonly metadata: Record<string, unknown>;
}

/**
 * Criteria for backend listing
 */
export interface ListCriteria {
  readonly limit?: number;
  readonly offset?: number;
  readonly prefix?: string;
  readonly pattern?: string;
}

// ============= Configuration Types =============

/**
 * Configuration for persistence backends
 */
export interface PersistenceConfig {
  readonly backend: BackendType;
  readonly encryptionEnabled: boolean;
  readonly compressionEnabled: boolean;
  readonly defaultTimeout: number;
  readonly cleanupInterval: number;
  readonly maxStateSize?: number;
  readonly backendConfig?: Record<string, unknown>;
}

/**
 * Supported backend types
 */
export type BackendType =
  | 'postgres'
  | 'redis'
  | 'mongodb'
  | 'neo4j'
  | 'filesystem';

/**
 * Configuration for retry operations
 */
export interface RetryConfig {
  readonly maxAttempts: number;
  readonly backoff: 'linear' | 'exponential';
  readonly initialDelay: Duration.Duration;
  readonly maxDelay?: Duration.Duration;
}

/**
 * Configuration for rate limiting
 */
export interface RateLimitConfig {
  readonly maxRequests: number;
  readonly windowMs: number;
}

// ============= Tool Configuration =============

/**
 * Configuration for AwaitInput tool
 */
export interface AwaitInputConfig<T> {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly schema: Schema.Schema<T>;
  readonly timeout?: Duration.Duration;
  readonly defaultValue?: T;
  readonly metadata?: Record<string, unknown>;
}

// ============= Interface Definitions =============

/**
 * Main persistence orchestrator interface
 */
export interface PersistenceHub {
  /**
   * Suspend a flow with the given context
   */
  suspend(
    flow: unknown,
    context: SuspensionContext
  ): Effect.Effect<SuspensionResult, PersistenceError>;

  /**
   * Resume a flow with the provided input
   */
  resume(
    key: SuspensionKey,
    input: unknown
  ): Effect.Effect<ResumptionResult, PersistenceError>;

  /**
   * Query suspended flows
   */
  query(
    criteria?: QueryCriteria
  ): Effect.Effect<SuspendedFlowInfo[], PersistenceError>;

  /**
   * Cleanup suspended flows
   */
  cleanup(
    criteria?: CleanupCriteria
  ): Effect.Effect<CleanupResult, PersistenceError>;

  /**
   * Cancel a suspended flow
   */
  cancel(key: SuspensionKey): Effect.Effect<void, PersistenceError>;

  /**
   * Get health status
   */
  health(): Effect.Effect<BackendHealth[], never>;
}

/**
 * Storage backend interface
 */
export interface StorageBackend {
  /**
   * Store serialized state
   */
  store(
    key: SuspensionKey,
    state: SerializedState
  ): Effect.Effect<void, StorageError>;

  /**
   * Retrieve serialized state
   */
  retrieve(
    key: SuspensionKey
  ): Effect.Effect<Option.Option<SerializedState>, StorageError>;

  /**
   * Delete stored state
   */
  delete(key: SuspensionKey): Effect.Effect<void, StorageError>;

  /**
   * List stored entries
   */
  list(criteria?: ListCriteria): Effect.Effect<StorageEntry[], StorageError>;

  /**
   * Health check
   */
  health(): Effect.Effect<BackendHealth, never>;

  /**
   * Cleanup expired entries
   */
  cleanup(criteria?: CleanupCriteria): Effect.Effect<number, StorageError>;
}

/**
 * State serializer interface
 */
export interface StateSerializer {
  /**
   * Serialize flow state
   */
  serialize(state: unknown): Effect.Effect<SerializedState, SerializationError>;

  /**
   * Deserialize flow state
   */
  deserialize(
    data: SerializedState
  ): Effect.Effect<unknown, SerializationError>;

  /**
   * Compress serialized state
   */
  compress(
    data: SerializedState
  ): Effect.Effect<CompressedState, CompressionError>;

  /**
   * Decompress state
   */
  decompress(
    data: CompressedState
  ): Effect.Effect<SerializedState, CompressionError>;
}

/**
 * State encryptor interface
 */
export interface StateEncryptor {
  /**
   * Encrypt serialized state
   */
  encrypt(
    data: SerializedState
  ): Effect.Effect<SerializedState, EncryptionError>;

  /**
   * Decrypt serialized state
   */
  decrypt(
    data: SerializedState
  ): Effect.Effect<SerializedState, EncryptionError>;
}

/**
 * Key generator interface
 */
export interface KeyGenerator {
  /**
   * Generate a unique suspension key
   */
  generate(): Effect.Effect<SuspensionKey, never>;

  /**
   * Validate a suspension key
   */
  validate(key: string): Effect.Effect<SuspensionKey, KeyValidationError>;
}

// ============= Error Types =============

/**
 * Base persistence error
 */
export class PersistenceError extends Data.TaggedError('PersistenceError')<{
  readonly module: string;
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}> {
  get displayMessage(): string {
    return `[${this.module}] ${this.operation}: ${this.message}`;
  }
}

/**
 * Storage backend error
 */
export class StorageError extends Data.TaggedError('StorageError')<{
  readonly module: string;
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
  readonly backend?: string;
  readonly retryable?: boolean;
}> {}

/**
 * Serialization error
 */
export class SerializationError extends Data.TaggedError('SerializationError')<{
  readonly module: string;
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * Compression error
 */
export class CompressionError extends Data.TaggedError('CompressionError')<{
  readonly module: string;
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * Encryption error
 */
export class EncryptionError extends Data.TaggedError('EncryptionError')<{
  readonly module: string;
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * Key validation error
 */
export class KeyValidationError extends Data.TaggedError('KeyValidationError')<{
  readonly module: string;
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/**
 * Suspension key not found
 */
export class SuspensionKeyNotFound extends Data.TaggedError(
  'SuspensionKeyNotFound'
)<{
  readonly key: SuspensionKey;
  readonly module: string;
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}> {
  static create(key: SuspensionKey) {
    return new SuspensionKeyNotFound({
      key,
      module: 'persistence',
      operation: 'resume',
      message: `Suspension key not found: ${key}`,
      cause: { key },
    });
  }
}

/**
 * Input validation error for resumption
 */
export class InputValidationError extends Data.TaggedError(
  'InputValidationError'
)<{
  readonly key: SuspensionKey;
  readonly expectedSchema: string;
  readonly providedInput: unknown;
  readonly validationErrors: unknown[];
  readonly module: string;
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}> {
  static create(config: {
    readonly key: SuspensionKey;
    readonly expectedSchema: string;
    readonly providedInput: unknown;
    readonly validationErrors: unknown[];
  }) {
    return new InputValidationError({
      ...config,
      module: 'persistence',
      operation: 'resume',
      message: `Input validation failed for key ${config.key}`,
      cause: config,
    });
  }
}

/**
 * Flow suspension signal (special error for triggering suspension)
 */
export class FlowSuspensionSignal extends Data.TaggedError(
  'FlowSuspensionSignal'
)<{
  readonly suspensionKey: SuspensionKey;
  readonly awaitingSchema: Schema.Schema<unknown>;
  readonly message: string;
  readonly module: string;
  readonly operation: string;
  readonly cause?: unknown;
}> {
  static create(config: {
    readonly suspensionKey: SuspensionKey;
    readonly awaitingSchema: Schema.Schema<unknown>;
    readonly message: string;
  }) {
    return new FlowSuspensionSignal({
      ...config,
      module: 'persistence',
      operation: 'suspend',
      cause: config,
    });
  }
}

// ============= Schema Definitions =============

/**
 * Schema for suspension key
 */
export const SuspensionKeySchema = Schema.String.pipe(
  Schema.brand('SuspensionKey')
);

/**
 * Schema for serialized state
 */
export const SerializedStateSchema = Schema.Struct({
  version: Schema.String,
  data: Schema.String,
  metadata: Schema.Struct({
    serializedAt: Schema.String,
    size: Schema.Number,
    checksum: Schema.String,
  }),
  expiresAt: Schema.optional(Schema.String),
  ttl: Schema.optional(Schema.Number),
  compressed: Schema.optional(Schema.Boolean),
  originalSize: Schema.optional(Schema.Number),
  compressedSize: Schema.optional(Schema.Number),
});

/**
 * Schema for suspension context
 */
export const SuspensionContextSchema = Schema.Struct({
  toolId: Schema.String,
  awaitingInputSchema: Schema.Any, // Schema schemas are complex
  timeout: Schema.optional(Schema.Any), // Duration is complex
  defaultValue: Schema.optional(Schema.Unknown),
  metadata: Schema.Record({ key: Schema.String, value: Schema.Unknown }),
});

/**
 * Schema for query criteria
 */
export const QueryCriteriaSchema = Schema.Struct({
  limit: Schema.optional(Schema.Number),
  offset: Schema.optional(Schema.Number),
  createdAfter: Schema.optional(Schema.Date),
  createdBefore: Schema.optional(Schema.Date),
  expiresAfter: Schema.optional(Schema.Date),
  expiresBefore: Schema.optional(Schema.Date),
  toolId: Schema.optional(Schema.String),
  metadata: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown })
  ),
});

/**
 * Schema for persistence configuration
 */
export const PersistenceConfigSchema = Schema.Struct({
  backend: Schema.Union(
    Schema.Literal('postgres'),
    Schema.Literal('redis'),
    Schema.Literal('mongodb'),
    Schema.Literal('neo4j'),
    Schema.Literal('filesystem')
  ),
  encryptionEnabled: Schema.Boolean,
  compressionEnabled: Schema.Boolean,
  defaultTimeout: Schema.Number,
  cleanupInterval: Schema.Number,
  maxStateSize: Schema.optional(Schema.Number),
  backendConfig: Schema.optional(
    Schema.Record({ key: Schema.String, value: Schema.Unknown })
  ),
});

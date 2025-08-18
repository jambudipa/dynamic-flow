/**
 * PersistenceService - Main orchestrator for flow suspension and resumption
 * 
 * The core service that coordinates:
 * - Flow state capture and restoration
 * - Storage backend operations  
 * - State serialization and encryption
 * - Error handling and recovery
 * - Query and management operations
 */

import { Effect, Context, Layer, Duration, Option, Schedule, pipe } from 'effect';
import { PersistenceError, ExecutionError, ValidationError } from '../errors';
import { SerializerService } from './serializer';
import { EncryptionService } from './encryption';
import { KeyGeneratorService, type SuspensionKey } from './key-generator';
import { LoggingService } from './logging';
import { ConfigService } from './config';

// ============= Types =============

/**
 * Suspension context for flow pause
 */
export interface SuspensionContext {
  readonly toolId: string;
  readonly timeout?: Duration.Duration;
  readonly awaitingInputSchema?: unknown;
  readonly defaultValue?: unknown;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Result of suspending a flow
 */
export interface SuspensionResult {
  readonly key: SuspensionKey;
  readonly suspendedAt: Date;
  readonly expiresAt?: Date;
  readonly metadata: Record<string, unknown>;
}

/**
 * Result of resuming a flow
 */
export interface ResumptionResult {
  readonly key: SuspensionKey;
  readonly resumedAt: Date;
  readonly flowInstance: unknown;
}

/**
 * Information about a suspended flow
 */
export interface SuspendedFlowInfo {
  readonly key: SuspensionKey;
  readonly createdAt: Date;
  readonly expiresAt?: Date;
  readonly toolId: string;
  readonly metadata: Record<string, unknown>;
  readonly size: number;
}

/**
 * Query criteria for suspended flows
 */
export interface QueryCriteria {
  readonly limit?: number;
  readonly offset?: number;
  readonly createdAfter?: Date;
  readonly createdBefore?: Date;
  readonly expiresAfter?: Date;
  readonly expiresBefore?: Date;
  readonly toolId?: string;
}

/**
 * Cleanup criteria for suspended flows
 */
export interface CleanupCriteria {
  readonly limit?: number;
  readonly expiredOnly?: boolean;
  readonly olderThan?: Date;
  readonly toolId?: string;
}

/**
 * Result of cleanup operation
 */
export interface CleanupResult {
  readonly deletedCount: number;
  readonly errors: Array<{ key: SuspensionKey; error: string }>;
}

/**
 * Backend health status
 */
export interface BackendHealth {
  readonly backend: string;
  readonly healthy: boolean;
  readonly latency?: number;
  readonly error?: string;
}

/**
 * Persistence configuration
 */
export interface PersistenceConfig {
  readonly defaultTimeout: Duration.Duration;
  readonly maxStateSize: number;
  readonly enableCompression: boolean;
  readonly enableEncryption: boolean;
  readonly retryAttempts: number;
  readonly retryDelay: Duration.Duration;
}

/**
 * Flow state capture for suspension
 */
export interface FlowStateCapture {
  readonly flowId: string;
  readonly executionPosition: unknown;
  readonly variables: Record<string, unknown>;
  readonly context: Record<string, unknown>;
  readonly metadata: Record<string, unknown>;
  readonly capturedAt: string;
  readonly suspensionContext: SuspensionContext;
}

/**
 * Storage backend interface
 */
export interface StorageBackend {
  readonly store: (key: SuspensionKey, data: any) => Effect.Effect<void>;
  readonly retrieve: (key: SuspensionKey) => Effect.Effect<Option.Option<any>>;
  readonly delete: (key: SuspensionKey) => Effect.Effect<void>;
  readonly list: (options?: { limit?: number; offset?: number }) => Effect.Effect<any[]>;
  readonly health: () => Effect.Effect<BackendHealth>;
  readonly cleanup?: (criteria?: CleanupCriteria) => Effect.Effect<number>;
}

// ============= PersistenceService Interface =============

export interface PersistenceService {
  /**
   * Suspend a flow and persist its complete state
   */
  readonly suspend: (
    flow: unknown,
    context: SuspensionContext
  ) => Effect.Effect<SuspensionResult, PersistenceError>;

  /**
   * Resume a flow from suspension with provided input
   */
  readonly resume: (
    key: SuspensionKey,
    input: unknown
  ) => Effect.Effect<ResumptionResult, PersistenceError>;

  /**
   * Query suspended flows with filtering
   */
  readonly query: (
    criteria?: QueryCriteria
  ) => Effect.Effect<SuspendedFlowInfo[], PersistenceError>;

  /**
   * Cleanup suspended flows based on criteria
   */
  readonly cleanup: (
    criteria?: CleanupCriteria
  ) => Effect.Effect<CleanupResult, PersistenceError>;

  /**
   * Cancel a suspended flow
   */
  readonly cancel: (key: SuspensionKey) => Effect.Effect<void, PersistenceError>;

  /**
   * Get health status of all components
   */
  readonly health: () => Effect.Effect<BackendHealth[]>;

  /**
   * Update configuration
   */
  readonly updateConfig: (config: Partial<PersistenceConfig>) => Effect.Effect<void>;
}

// ============= Context Tag =============

export const PersistenceService = Context.GenericTag<PersistenceService>('@services/Persistence');

// ============= Storage Backend Tag =============

export const StorageBackend = Context.GenericTag<StorageBackend>('@services/StorageBackend');

// ============= Default Configuration =============

const DEFAULT_CONFIG: PersistenceConfig = {
  defaultTimeout: Duration.hours(24),
  maxStateSize: 100 * 1024 * 1024, // 100MB
  enableCompression: true,
  enableEncryption: true,
  retryAttempts: 3,
  retryDelay: Duration.seconds(1)
};

// ============= Service Implementation =============

const makePersistenceService = (): Effect.Effect<PersistenceService, never, ConfigService | LoggingService | SerializerService | EncryptionService | KeyGeneratorService | StorageBackend> =>
  Effect.gen(function* () {
    // Get dependencies
    const config = yield* ConfigService;
    const logger = yield* LoggingService;
    const serializer = yield* SerializerService;
    const encryption = yield* EncryptionService;
    const keyGenerator = yield* KeyGeneratorService;
    const backend = yield* StorageBackend;

    // Get persistence configuration
    const persistenceConfig = yield* pipe(
      config.get('persistence'),
      Effect.orElse(() => Effect.succeed({ encryption: { enabled: false } }))
    );
    const serviceConfig: PersistenceConfig = {
      ...DEFAULT_CONFIG,
      enableCompression: true, // Always enable for now
      enableEncryption: persistenceConfig.encryption.enabled,
    };

    const mapToPersistenceError = (error: unknown): PersistenceError => {
      if (error instanceof PersistenceError) return error;
      
      return new PersistenceError({
        message: error instanceof Error ? error.message : 'Unknown persistence error',
        operation: 'suspend' as const,  // Default to suspend since this is used in suspension context
        cause: error
      });
    };

    const captureFlowState = (flow: unknown, context: SuspensionContext) =>
      Effect.gen(function* () {
        yield* logger.debug('Capturing flow state', { toolId: context.toolId });

        // Extract flow information
        const flowData = flow as any;
        const stateCapture: FlowStateCapture = {
          flowId: flowData?.flowId || flowData?.id || 'unknown',
          executionPosition: flowData?.executionPosition || flowData?.currentNode || null,
          variables: flowData?.variables || flowData?.context?.variables || {},
          context: {
            stepId: flowData?.stepId || flowData?.currentStep,
            sessionId: flowData?.sessionId,
            metadata: flowData?.metadata || {},
            ...flowData?.context
          },
          metadata: {
            suspendedBy: context.toolId,
            suspendedAt: new Date().toISOString(),
            version: '1.0.0',
            ...flowData?.metadata
          },
          capturedAt: new Date().toISOString(),
          suspensionContext: context
        };

        return stateCapture;
      });

    const validateStateSize = (state: FlowStateCapture) =>
      Effect.gen(function* () {
        const stateJson = JSON.stringify(state);
        const sizeBytes = Buffer.byteLength(stateJson, 'utf8');
        
        if (sizeBytes > serviceConfig.maxStateSize) {
          return yield* Effect.fail(new PersistenceError({
            message: `Flow state size ${sizeBytes} exceeds maximum allowed size ${serviceConfig.maxStateSize}`,
            operation: 'suspend',
            cause: { actualSize: sizeBytes, maxSize: serviceConfig.maxStateSize }
          }));
        }

        yield* logger.debug('State size validation passed', {
          sizeBytes,
          maxSize: serviceConfig.maxStateSize
        });
      });

    const restoreFlowInstance = (stateCapture: FlowStateCapture, input: unknown) =>
      Effect.gen(function* () {
        yield* logger.debug('Restoring flow instance', {
          flowId: stateCapture.flowId,
          hasInput: input !== undefined
        });

        const restoredFlow = {
          flowId: stateCapture.flowId,
          executionPosition: stateCapture.executionPosition,
          variables: stateCapture.variables,
          context: {
            ...stateCapture.context,
            awaitInputResult: input,
            resumedAt: new Date().toISOString()
          },
          metadata: {
            ...stateCapture.metadata,
            resumedFrom: stateCapture.suspensionContext.toolId,
            resumedAt: new Date().toISOString()
          }
        };

        return restoredFlow;
      });

    const validateInput = (context: SuspensionContext, input: unknown) =>
      Effect.gen(function* () {
        // Basic validation - real implementation would use Schema.decodeUnknown
        if (input === undefined && !context.defaultValue) {
          return yield* Effect.fail(new ValidationError({
            message: 'Input is required but not provided',
            field: 'input',
            cause: { expectedSchema: context.awaitingInputSchema }
          }));
        }

        yield* logger.debug('Input validation passed', {
          toolId: context.toolId,
          hasInput: input !== undefined,
          hasDefault: context.defaultValue !== undefined
        });
      });

    return {
      suspend: (flow: unknown, context: SuspensionContext) =>
        pipe(
          Effect.gen(function* () {
            yield* logger.info(`Starting flow suspension [toolId: ${context.toolId}]`, {
              flowId: (flow as any)?.flowId || 'unknown'
            });

            // Generate unique suspension key
            const key = yield* keyGenerator.generate();

            // Capture complete flow state
            const stateCapture = yield* captureFlowState(flow, context);

            // Validate state size
            yield* validateStateSize(stateCapture);

            // Serialize state
            const serialized = yield* serializer.serialize(stateCapture);

            // Compress if enabled
            const processedState = serviceConfig.enableCompression
              ? yield* serializer.compress(serialized)
              : serialized;

            // Encrypt if enabled
            const finalState = serviceConfig.enableEncryption
              ? yield* encryption.encrypt(processedState)
              : processedState;

            // Add expiration
            const expiresAt = context.timeout 
              ? new Date(Date.now() + Duration.toMillis(context.timeout))
              : new Date(Date.now() + Duration.toMillis(serviceConfig.defaultTimeout));

            // Store in backend with retry logic
            yield* pipe(
              backend.store(key, {
                ...finalState,
                expiresAt: expiresAt.toISOString(),
                ttl: Math.floor((expiresAt.getTime() - Date.now()) / 1000)
              }),
              Effect.retry(
                Schedule.exponential(serviceConfig.retryDelay, 2.0).pipe(
                  Schedule.compose(Schedule.recurs(serviceConfig.retryAttempts))
                )
              )
            );

            yield* logger.info(`Flow suspended successfully [key: ${key}]`, {
              flowId: stateCapture.flowId,
              size: finalState.data.length
            });

            return {
              key,
              suspendedAt: new Date(),
              expiresAt,
              metadata: {
                toolId: context.toolId,
                flowId: stateCapture.flowId,
                stateSize: finalState.data.length,
                compressed: serviceConfig.enableCompression,
                encrypted: serviceConfig.enableEncryption
              }
            };
          }),
          Effect.mapError(mapToPersistenceError)
        ),

      resume: (key: SuspensionKey, input: unknown) =>
        pipe(
          Effect.gen(function* () {
            yield* logger.info(`Starting flow resumption [key: ${key}]`);

            // Retrieve state from backend
            const storedState = yield* backend.retrieve(key);

            if (Option.isNone(storedState)) {
              return yield* Effect.fail(new ExecutionError({
                message: `Suspension key not found: ${key}`,
                node: key,
                phase: 'execution' as const
              }));
            }

            const state = storedState.value;

            // Decrypt if needed
            const decryptedState = serviceConfig.enableEncryption
              ? yield* encryption.decrypt(state)
              : state;

            // Decompress if needed
            const decompressedState = serviceConfig.enableCompression && 'compressed' in decryptedState && decryptedState.compressed
              ? yield* serializer.decompress(decryptedState as any)
              : decryptedState;

            // Deserialize state
            const stateCapture = (yield* serializer.deserialize(decompressedState)) as FlowStateCapture;

            // Validate input
            yield* validateInput(stateCapture.suspensionContext, input);

            // Restore flow instance
            const flowInstance = yield* restoreFlowInstance(stateCapture, input);

            // Clean up stored state
            yield* pipe(
              backend.delete(key),
              Effect.retry(
                Schedule.exponential(serviceConfig.retryDelay, 2.0).pipe(
                  Schedule.compose(Schedule.recurs(serviceConfig.retryAttempts))
                )
              ),
              Effect.catchAll((error) =>
                logger.error(`Failed to cleanup suspension state [key: ${key}]`, error)
              )
            );

            yield* logger.info(`Flow resumed successfully [key: ${key}]`, {
              flowId: stateCapture.flowId
            });

            return {
              key,
              resumedAt: new Date(),
              flowInstance
            };
          }),
          Effect.mapError(mapToPersistenceError)
        ),

      query: (criteria?: QueryCriteria) =>
        pipe(
          Effect.gen(function* () {
            yield* logger.debug('Querying suspended flows', { criteria });

            const entries = yield* backend.list({
              limit: criteria?.limit,
              offset: criteria?.offset
            });

            // Filter entries based on criteria
            const filteredEntries = entries.filter(entry => {
              if (criteria?.createdAfter && entry.createdAt < criteria.createdAfter) {
                return false;
              }
              if (criteria?.createdBefore && entry.createdAt > criteria.createdBefore) {
                return false;
              }
              if (criteria?.expiresAfter && (!entry.expiresAt || entry.expiresAt < criteria.expiresAfter)) {
                return false;
              }
              if (criteria?.expiresBefore && (!entry.expiresAt || entry.expiresAt > criteria.expiresBefore)) {
                return false;
              }
              if (criteria?.toolId && entry.metadata.toolId !== criteria.toolId) {
                return false;
              }
              return true;
            });

            // Transform to SuspendedFlowInfo
            const flowInfos: SuspendedFlowInfo[] = filteredEntries.map(entry => ({
              key: entry.key,
              createdAt: entry.createdAt,
              expiresAt: entry.expiresAt,
              metadata: entry.metadata,
              size: entry.size,
              toolId: entry.metadata.toolId as string || 'unknown'
            }));

            yield* logger.debug(`Query completed`, {
              totalFound: entries.length,
              filtered: flowInfos.length
            });

            return flowInfos;
          }),
          Effect.mapError(mapToPersistenceError)
        ),

      cleanup: (criteria?: CleanupCriteria) =>
        pipe(
          Effect.gen(function* () {
            yield* logger.info('Starting cleanup operation', { criteria });

            // Use backend cleanup if supported
            if ('cleanup' in backend && typeof backend.cleanup === 'function') {
              const deletedCount = yield* backend.cleanup(criteria);
              
              yield* logger.info('Cleanup completed via backend', { deletedCount });
              
              return {
                deletedCount,
                errors: []
              };
            }

            // Manual cleanup: query and delete
            const entries = yield* backend.list({ limit: criteria?.limit });
            let deletedCount = 0;
            const errors: Array<{ key: SuspensionKey; error: string }> = [];

            for (const entry of entries) {
              // Check cleanup criteria
              if (criteria?.expiredOnly && (!entry.expiresAt || entry.expiresAt > new Date())) {
                continue;
              }
              if (criteria?.olderThan && entry.createdAt > criteria.olderThan) {
                continue;
              }
              if (criteria?.toolId && entry.metadata.toolId !== criteria.toolId) {
                continue;
              }

              // Delete entry
              const deleteResult = yield* Effect.either(backend.delete(entry.key));
              
              if (deleteResult._tag === 'Left') {
                errors.push({
                  key: entry.key,
                  error: String(deleteResult.left) || 'Delete failed'
                });
              } else {
                deletedCount++;
              }
            }

            yield* logger.info(`Manual cleanup completed`, { deletedCount, errors: errors.length });

            return {
              deletedCount,
              errors
            };
          }),
          Effect.mapError(mapToPersistenceError)
        ),

      cancel: (key: SuspensionKey) =>
        pipe(
          Effect.gen(function* () {
            yield* logger.info('Cancelling suspended flow', { key });
            yield* backend.delete(key);
            yield* logger.info('Flow cancelled successfully', { key });
          }),
          Effect.mapError(mapToPersistenceError)
        ),

      health: () =>
        Effect.gen(function* () {
          // Check backend health
          const backendHealth = yield* Effect.either(backend.health());
          
          const healthStatuses: BackendHealth[] = [
            backendHealth._tag === 'Right' 
              ? backendHealth.right
              : {
                  backend: 'unknown',
                  healthy: false,
                  error: (backendHealth.left as any)?.message || 'Health check failed'
                }
          ];

          // Check serializer health
          const serializerHealth = yield* Effect.either(
            pipe(
              serializer.serialize({ test: 'data' }),
              Effect.flatMap(serialized => serializer.deserialize(serialized)),
              Effect.map(() => ({
                backend: 'serializer',
                healthy: true,
                latency: 0
              })),
              Effect.timeout(Duration.seconds(5))
            )
          );

          healthStatuses.push(
            serializerHealth._tag === 'Right'
              ? serializerHealth.right
              : {
                  backend: 'serializer',
                  healthy: false,
                  error: 'Serializer health check failed'
                }
          );

          return healthStatuses;
        }),

      updateConfig: (newConfig: Partial<PersistenceConfig>) =>
        Effect.gen(function* () {
          // Update the service configuration
          Object.assign(serviceConfig, newConfig);
          yield* logger.info('Persistence configuration updated', newConfig);
        }),
    };
  });

// ============= Layer Implementation =============

/**
 * Live implementation of PersistenceService
 */
export const PersistenceServiceLive = Layer.effect(
  PersistenceService,
  makePersistenceService()
);

/**
 * Test implementation with mock backend
 */
export const PersistenceServiceTest = Layer.effect(
  PersistenceService,
  Effect.gen(function* () {
    // Create a mock storage backend for testing
    const mockBackend: StorageBackend = {
      store: () => Effect.void,
      retrieve: () => Effect.succeed(Option.none()),
      delete: () => Effect.void,
      list: () => Effect.succeed([]),
      health: () => Effect.succeed({
        backend: 'mock',
        healthy: true,
        latency: 0
      })
    };

    return yield* makePersistenceService().pipe(
      Effect.provide(Layer.succeed(StorageBackend, mockBackend))
    );
  })
);

// ============= Helper Functions =============

/**
 * Suspend a flow with the current persistence service
 */
export const suspendFlow = (flow: unknown, context: SuspensionContext) =>
  Effect.gen(function* () {
    const persistence = yield* PersistenceService;
    return yield* persistence.suspend(flow, context);
  });

/**
 * Resume a flow with the current persistence service
 */
export const resumeFlow = (key: SuspensionKey, input: unknown) =>
  Effect.gen(function* () {
    const persistence = yield* PersistenceService;
    return yield* persistence.resume(key, input);
  });

/**
 * Query suspended flows
 */
export const querySuspendedFlows = (criteria?: QueryCriteria) =>
  Effect.gen(function* () {
    const persistence = yield* PersistenceService;
    return yield* persistence.query(criteria);
  });

/**
 * Cleanup suspended flows
 */
export const cleanupSuspendedFlows = (criteria?: CleanupCriteria) =>
  Effect.gen(function* () {
    const persistence = yield* PersistenceService;
    return yield* persistence.cleanup(criteria);
  });

/**
 * Cancel a suspended flow
 */
export const cancelSuspendedFlow = (key: SuspensionKey) =>
  Effect.gen(function* () {
    const persistence = yield* PersistenceService;
    return yield* persistence.cancel(key);
  });

/**
 * Check persistence service health
 */
export const checkPersistenceHealth = () =>
  Effect.gen(function* () {
    const persistence = yield* PersistenceService;
    return yield* persistence.health();
  });
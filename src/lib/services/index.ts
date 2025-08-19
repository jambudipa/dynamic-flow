/**
 * DynamicFlow Services - Centralized service exports
 *
 * All services use Effect's service pattern with Context.GenericTag
 * and Layer.effect for implementation.
 */

// Core Services
export * from './config';
export * from './logging';
export * from './state';
export * from './execution-context';

// Tool Services
export * from './tool-registry';

// Persistence Services
export {
  SerializerService,
  SerializerServiceLive,
  SerializerServiceTest,
  estimateCompressionRatio,
  validateStateSerializability,
  type SerializedState as SerializerSerializedState,
  type CompressedState,
} from './serializer';
export {
  EncryptionService,
  EncryptionServiceLive,
  EncryptionServiceTest,
  EncryptionServiceDisabled,
  type EncryptedData,
  type SerializedState,
  encryptState,
  decryptState,
} from './encryption';
export * from './key-generator';
export * from './persistence';

// Execution Services
export * from './ir-executor';
export * from './flow';

// Service Layer Combinations
import { Layer } from 'effect';
import { ConfigServiceLive } from './config';
import { LoggingServiceLive } from './logging';
import { StateServiceLive } from './state';
import { ExecutionContextServiceLive } from './execution-context';
import { ToolRegistryServiceLive } from './tool-registry';
import { SerializerServiceLive } from './serializer';
import { EncryptionServiceLive } from './encryption';
import { KeyGeneratorServiceLive } from './key-generator';
import { PersistenceServiceLive } from './persistence';
import { IRExecutorServiceLive } from './ir-executor';
import { FlowServiceLive } from './flow';

/**
 * Core services layer - config and logging
 */
export const CoreServicesLive = Layer.merge(
  ConfigServiceLive,
  LoggingServiceLive
);

/**
 * State management services layer
 */
export const StateServicesLive = Layer.mergeAll(
  StateServiceLive,
  ExecutionContextServiceLive
);

/**
 * Tool services layer
 */
export const ToolServicesLive = ToolRegistryServiceLive;

/**
 * Persistence services layer
 */
export const PersistenceServicesLive = Layer.mergeAll(
  SerializerServiceLive,
  EncryptionServiceLive,
  KeyGeneratorServiceLive,
  PersistenceServiceLive
);

/**
 * Execution services layer
 */
export const ExecutionServicesLive = Layer.mergeAll(
  IRExecutorServiceLive,
  FlowServiceLive
);

/**
 * All services combined - use this for full DynamicFlow functionality
 */
export const AllServicesLive = Layer.mergeAll(
  CoreServicesLive,
  StateServicesLive,
  ToolServicesLive,
  PersistenceServicesLive,
  ExecutionServicesLive
);

/**
 * Test services layer - use for testing with mock implementations
 */
export const TestServicesLive = Layer.mergeAll(
  ConfigServiceLive, // Use real config for tests
  LoggingServiceLive, // Use real logging for tests
  StateServiceLive,
  ExecutionContextServiceLive,
  ToolRegistryServiceLive,
  SerializerServiceLive,
  EncryptionServiceLive,
  KeyGeneratorServiceLive,
  PersistenceServiceLive, // This would need a test storage backend
  IRExecutorServiceLive,
  FlowServiceLive
);

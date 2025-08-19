/**
 * Persistence Module - Flow Suspension and Resumption
 *
 * This module provides comprehensive support for suspending flows at any point
 * during execution and resuming them later, potentially after extended periods.
 * Essential for human-in-the-loop workflows and long-running processes.
 *
 * @module persistence
 */

// Core types and interfaces
export * from './types';

// Main persistence orchestrator
export * from './hub';

// State management
export * from './serializer';
export * from './encryption';
export * from './key-generator';

// Storage backends
export * from './backends';

// Tools
export * from './tools';

// Flow engine integration
export * from './integration';

// Utilities
export * from './backend-factory';

/**
 * Default persistence configuration
 */
export const DEFAULT_PERSISTENCE_CONFIG = {
  backend: 'filesystem' as const,
  encryptionEnabled: false,
  compressionEnabled: true,
  defaultTimeout: 24 * 60 * 60 * 1000, // 24 hours
  cleanupInterval: 60 * 60 * 1000, // 1 hour
} as const;

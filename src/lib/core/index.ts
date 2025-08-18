/**
 * Core Module Export
 *
 * Minimal core exports - most functionality moved to other modules
 * @module core
 */

// Export context if it still exists
export * from './context';

// Note: validation removed - use Effect Schema directly
// Note: performance, pause, and workers have been moved to engine module

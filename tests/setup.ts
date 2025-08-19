/**
 * Global test setup file
 * 
 * This file is executed before all tests and sets up:
 * - Global test utilities
 * - Mock configurations
 * - Environment variables
 * - Test helpers
 */

import { expect } from 'vitest'
import * as matchers from '@vitest/expect'

// Extend expect with custom matchers
expect.extend(matchers)

// Set test environment variables
process.env.NODE_ENV = 'test'
process.env.LOG_LEVEL = 'error' // Reduce noise during tests

// Global test timeout
const TEST_TIMEOUT = 10000

// Export common test utilities
export { TEST_TIMEOUT }

// Setup global mocks if needed
globalThis.fetch = globalThis.fetch || (() => Promise.reject(new Error('Fetch not available in test environment')))

// Cleanup function that runs after all tests
if (typeof afterAll !== 'undefined') {
  afterAll(() => {
    // Cleanup any global resources
  })
}
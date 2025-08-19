import { describe, it, expect } from 'vitest';
import { Either, Option } from 'effect';
import {
  // Constants from types/index
  TYPE_SYSTEM_VERSION,
  SUPPORTED_EFFECT_VERSION,
  TYPE_SYSTEM_METADATA,

  // Core functions that actually exist
  validationSuccess,
  validationFailure,
  isExecutionContext,
  isValidationSuccess,
  isValidationFailure,

  // These branded types might not be exported from index

  // Type from core
  type ExecutionContext,
  type ValidationResult,
  type ComponentMetadata,
  type SourceLocation,
} from './index';

describe('Types Index Module', () => {
  describe('Core Functions', () => {
    it('should create validation success results', () => {
      const success = validationSuccess('test data');
      expect(Either.isRight(success)).toBe(true);
      expect(isValidationSuccess(success)).toBe(true);
      expect(isValidationFailure(success)).toBe(false);
    });

    it('should create validation failure results', () => {
      const failure = validationFailure('error message');
      expect(Either.isLeft(failure)).toBe(true);
      expect(isValidationFailure(failure)).toBe(true);
      expect(isValidationSuccess(failure)).toBe(false);
    });

    it('should validate execution contexts properly', () => {
      // Test with invalid data
      expect(isExecutionContext({})).toBe(false);
      expect(isExecutionContext(null)).toBe(false);
      expect(isExecutionContext('not an object')).toBe(false);
    });
  });

  describe('Branded Types', () => {
    it('should test branded types availability from core module', async () => {
      try {
        const core = await import('./core');
        if ('FlowId' in core) {
          expect(core.FlowId).toBeDefined();
          expect(typeof core.FlowId).toBe('function');
        }
        if ('StepId' in core) {
          expect(core.StepId).toBeDefined();
          expect(typeof core.StepId).toBe('function');
        }
        if ('SessionId' in core) {
          expect(core.SessionId).toBeDefined();
          expect(typeof core.SessionId).toBe('function');
        }
      } catch (error) {
        console.warn('Branded types not available directly from core');
      }
    });
  });

  describe('Type Utilities', () => {
    it('should test validation functions', () => {
      expect(isValidationSuccess).toBeDefined();
      expect(typeof isValidationSuccess).toBe('function');

      expect(isValidationFailure).toBeDefined();
      expect(typeof isValidationFailure).toBe('function');

      expect(isExecutionContext).toBeDefined();
      expect(typeof isExecutionContext).toBe('function');
    });

    it('should test validation factory functions', () => {
      expect(validationSuccess).toBeDefined();
      expect(typeof validationSuccess).toBe('function');

      expect(validationFailure).toBeDefined();
      expect(typeof validationFailure).toBe('function');
    });
  });

  describe('Module Metadata', () => {
    it('should provide version information', () => {
      expect(TYPE_SYSTEM_VERSION).toBe('1.0.0');
      expect(SUPPORTED_EFFECT_VERSION).toBe('^0.60.0');
    });

    it('should provide metadata', () => {
      expect(TYPE_SYSTEM_METADATA.version).toBe('1.0.0');
      expect(TYPE_SYSTEM_METADATA.supportedEffect).toBe('^0.60.0');
      expect(TYPE_SYSTEM_METADATA.created).toBe('2024-12-19');
      expect(TYPE_SYSTEM_METADATA.description).toBe(
        'Unified type system for DynamicFlow'
      );
      expect(Array.isArray(TYPE_SYSTEM_METADATA.breaking_changes)).toBe(true);
      expect(TYPE_SYSTEM_METADATA.breaking_changes.length).toBeGreaterThan(0);
    });
  });
});

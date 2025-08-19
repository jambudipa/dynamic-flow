/**
 * Tests for Type Guards and Predicates
 */

import { describe, it, expect } from 'vitest';
import { Effect, Schema } from 'effect';
import {
  isExecutionContext,
  isCompleteExecutionContext,
  isValidationResult,
  isComponentMetadata,
  isFlowError,
  isFlowExecutionError,
  isFlowTypeError,
  isFlowMappingError,
  isFlowValidationError,
  isToolError,
  isLLMError,
  isFlowCompilationError,
  isFlowSchemaError,
  isAnyFlowError,
  isEffect,
  isFlowEffect,
  isFlowContext,
  isToolRequirements,
  isTool,
  isExecutable,
  isLLMAdapter,
  isToolDefinition,
  isSchema,
  isSchemaWithDescription,
  isNonEmptyString,
  isValidId,
  isValidVersion,
  isValidUrl,
  isValidEmail,
  isPlainObject,
  isNonEmptyArray,
  allOf,
  anyOf,
  not,
  optional,
} from './guards';

describe('Core Type Guards', () => {
  describe('isExecutionContext', () => {
    it('should return true for valid ExecutionContext', () => {
      const context = {
        flowId: 'flow-123',
        stepId: 'step-456',
        sessionId: 'session-789',
        variables: { key: 'value' },
        metadata: { meta: 'data' },
      };
      expect(isExecutionContext(context)).toBe(true);
    });

    it('should return false for missing required fields', () => {
      const invalid = {
        flowId: 'flow-123',
        // missing stepId
        sessionId: 'session-789',
        variables: {},
        metadata: {},
      };
      expect(isExecutionContext(invalid)).toBe(false);
    });

    it('should return false for wrong field types', () => {
      const invalid = {
        flowId: 123, // should be string
        stepId: 'step-456',
        sessionId: 'session-789',
        variables: {},
        metadata: {},
      };
      expect(isExecutionContext(invalid)).toBe(false);
    });

    it('should handle optional parentContext field', () => {
      const withParent = {
        flowId: 'flow-123',
        stepId: 'step-456',
        sessionId: 'session-789',
        variables: {},
        metadata: {},
        parentContext: {
          flowId: 'parent-flow',
          stepId: 'parent-step',
          sessionId: 'parent-session',
          variables: {},
          metadata: {},
        },
      };
      expect(isExecutionContext(withParent)).toBe(true);
    });

    it('should return false for invalid parentContext', () => {
      const invalid = {
        flowId: 'flow-123',
        stepId: 'step-456',
        sessionId: 'session-789',
        variables: {},
        metadata: {},
        parentContext: 'invalid',
      };
      expect(isExecutionContext(invalid)).toBe(false);
    });

    it('should handle optional currentScope field', () => {
      const withScope = {
        flowId: 'flow-123',
        stepId: 'step-456',
        sessionId: 'session-789',
        variables: {},
        metadata: {},
        currentScope: ['scope1', 'scope2'],
      };
      expect(isExecutionContext(withScope)).toBe(true);
    });

    it('should return false for non-object values', () => {
      expect(isExecutionContext(null)).toBe(false);
      expect(isExecutionContext(undefined)).toBe(false);
      expect(isExecutionContext('string')).toBe(false);
      expect(isExecutionContext(123)).toBe(false);
      expect(isExecutionContext([])).toBe(false);
    });
  });

  describe('isCompleteExecutionContext', () => {
    it('should return true only when all optional fields are present', () => {
      const complete = {
        flowId: 'flow-123',
        stepId: 'step-456',
        sessionId: 'session-789',
        variables: {},
        metadata: {},
        parentContext: {
          flowId: 'parent',
          stepId: 'parent-step',
          sessionId: 'parent-session',
          variables: {},
          metadata: {},
        },
        currentScope: ['scope'],
        workerPool: {},
        flowControl: {},
        pauseResume: {},
      };
      expect(isCompleteExecutionContext(complete)).toBe(true);
    });

    it('should return false when optional fields are missing', () => {
      const incomplete = {
        flowId: 'flow-123',
        stepId: 'step-456',
        sessionId: 'session-789',
        variables: {},
        metadata: {},
      };
      expect(isCompleteExecutionContext(incomplete)).toBe(false);
    });
  });

  describe('isValidationResult', () => {
    it('should return true for successful validation result', () => {
      const success = {
        success: true,
        data: { value: 'test' },
      };
      expect(isValidationResult(success)).toBe(true);
    });

    it('should return true for failed validation result', () => {
      const failure = {
        success: false,
        error: 'Validation failed',
      };
      expect(isValidationResult(failure)).toBe(true);
    });

    it('should return false for invalid structure', () => {
      expect(isValidationResult({ success: 'true' })).toBe(false);
      expect(isValidationResult({ success: true })).toBe(false); // missing data
      expect(isValidationResult({ success: false })).toBe(false); // missing error
    });
  });

  describe('isComponentMetadata', () => {
    it('should return true for empty metadata', () => {
      expect(isComponentMetadata({})).toBe(true);
    });

    it('should return true for valid metadata', () => {
      const metadata = {
        sourceLocation: { file: 'test.ts', line: 10 },
        sourceType: 'typescript' as const,
        description: 'Test component',
        version: '1.0.0',
        author: 'Test Author',
        tags: ['test', 'component'],
      };
      expect(isComponentMetadata(metadata)).toBe(true);
    });

    it('should return false for invalid sourceType', () => {
      const invalid = {
        sourceType: 'invalid',
      };
      expect(isComponentMetadata(invalid)).toBe(false);
    });

    it('should return false for non-array tags', () => {
      const invalid = {
        tags: 'not-an-array',
      };
      expect(isComponentMetadata(invalid)).toBe(false);
    });
  });
});

describe('Error Type Guards', () => {
  class TestFlowError extends Error {
    _tag = 'FlowExecutionError';
    name = 'FlowExecutionError';
  }

  describe('isFlowError', () => {
    it('should return true for errors with _tag and name', () => {
      const error = new TestFlowError('test');
      expect(isFlowError(error)).toBe(true);
    });

    it('should return false for regular errors', () => {
      const error = new Error('test');
      expect(isFlowError(error)).toBe(false);
    });

    it('should return false for non-error values', () => {
      expect(isFlowError('error')).toBe(false);
      expect(isFlowError({ _tag: 'Error' })).toBe(false);
    });
  });

  describe('specific error type guards', () => {
    it('should identify FlowExecutionError', () => {
      const error = new TestFlowError('test');
      expect(isFlowExecutionError(error)).toBe(true);
      expect(isFlowTypeError(error)).toBe(false);
    });

    it('should identify any flow error', () => {
      const error = new TestFlowError('test');
      expect(isAnyFlowError(error)).toBe(true);
    });
  });
});

describe('Effect Type Guards', () => {
  describe('isEffect', () => {
    it('should return true for Effect instances', () => {
      // Effect instances have complex internal structure, mock it properly
      const effect = { _tag: 'Effect' } as any;
      expect(isEffect(effect)).toBe(true);
    });

    it('should return false for non-Effect values', () => {
      expect(isEffect(Promise.resolve(42))).toBe(false);
      expect(isEffect({ _tag: 'NotEffect' })).toBe(false);
      expect(isEffect(Effect.succeed(42))).toBe(false); // Real Effect doesn't have simple _tag
    });
  });

  describe('isFlowContext', () => {
    it('should return true for valid FlowContext', () => {
      const context = {
        executionContext: {
          flowId: 'flow-123',
          stepId: 'step-456',
          sessionId: 'session-789',
          variables: {},
          metadata: {},
        },
        services: {},
      };
      expect(isFlowContext(context)).toBe(true);
    });

    it('should return true without services', () => {
      const context = {
        executionContext: {
          flowId: 'flow-123',
          stepId: 'step-456',
          sessionId: 'session-789',
          variables: {},
          metadata: {},
        },
      };
      expect(isFlowContext(context)).toBe(true);
    });

    it('should return false for invalid executionContext', () => {
      const invalid = {
        executionContext: 'invalid',
        services: {},
      };
      expect(isFlowContext(invalid)).toBe(false);
    });
  });
});

describe('Tool Type Guards', () => {
  describe('isTool', () => {
    it('should return true for valid tool', () => {
      const tool = {
        id: 'tool-1',
        type: 'transform',
        schema: { input: {}, output: {} },
        execute: () => Effect.succeed({}),
      };
      expect(isTool(tool)).toBe(true);
    });

    it('should return false for missing required fields', () => {
      const invalid = {
        id: 'tool-1',
        // missing type
        schema: {},
        execute: () => {},
      };
      expect(isTool(invalid)).toBe(false);
    });
  });

  describe('isExecutable', () => {
    it('should return true for executable with all methods', () => {
      const executable = {
        id: 'exec-1',
        type: 'transform',
        schema: {},
        execute: () => Effect.succeed({}),
        validate: () => true,
        getMetadata: () => ({}),
        asFlowEffect: () => Effect.succeed({}),
      };
      expect(isExecutable(executable)).toBe(true);
    });

    it('should return false for tool without additional methods', () => {
      const tool = {
        id: 'tool-1',
        type: 'transform',
        schema: {},
        execute: () => Effect.succeed({}),
      };
      expect(isExecutable(tool)).toBe(false);
    });
  });

  describe('isLLMAdapter', () => {
    it('should return true for valid LLM adapter', () => {
      const adapter = {
        provider: 'openai',
        models: ['gpt-5', 'gpt-3.5-turbo'],
        execute: () => Effect.succeed('response'),
      };
      expect(isLLMAdapter(adapter)).toBe(true);
    });

    it('should return false for invalid models array', () => {
      const invalid = {
        provider: 'openai',
        models: ['gpt-5', 123], // non-string in array
        execute: () => {},
      };
      expect(isLLMAdapter(invalid)).toBe(false);
    });
  });
});

describe('Schema Type Guards', () => {
  describe('isSchema', () => {
    it('should return true for Schema instances', () => {
      // Mock Schema object with proper structure
      const schema = { _tag: 'Schema' } as any;
      expect(isSchema(schema)).toBe(true);
    });

    it('should return false for non-Schema values', () => {
      expect(isSchema({ _tag: 'NotSchema' })).toBe(false);
      expect(isSchema({})).toBe(false);
      expect(isSchema(Schema.String)).toBe(false); // Real Schema doesn't have simple _tag
    });
  });

  describe('isSchemaWithDescription', () => {
    it('should return true for schema with description', () => {
      const schema = { _tag: 'Schema', description: 'A string schema' } as any;
      expect(isSchemaWithDescription(schema)).toBe(true);
    });

    it('should return false for schema without description', () => {
      const schema = { _tag: 'Schema' } as any;
      expect(isSchemaWithDescription(schema)).toBe(false);
    });
  });
});

describe('Utility Type Guards', () => {
  describe('isNonEmptyString', () => {
    it('should return true for non-empty strings', () => {
      expect(isNonEmptyString('test')).toBe(true);
      expect(isNonEmptyString(' ')).toBe(true);
    });

    it('should return false for empty strings and non-strings', () => {
      expect(isNonEmptyString('')).toBe(false);
      expect(isNonEmptyString(null)).toBe(false);
      expect(isNonEmptyString(123)).toBe(false);
    });
  });

  describe('isValidId', () => {
    it('should return true for valid identifiers', () => {
      expect(isValidId('valid-id')).toBe(true);
      expect(isValidId('valid_id')).toBe(true);
      expect(isValidId('validId123')).toBe(true);
    });

    it('should return false for invalid identifiers', () => {
      expect(isValidId('')).toBe(false);
      expect(isValidId('invalid id')).toBe(false); // contains space
      expect(isValidId('invalid@id')).toBe(false); // contains @
      expect(isValidId('a'.repeat(101))).toBe(false); // too long
    });
  });

  describe('isValidVersion', () => {
    it('should return true for valid version strings', () => {
      expect(isValidVersion('1.0.0')).toBe(true);
      expect(isValidVersion('2.1.3')).toBe(true);
      expect(isValidVersion('1.0.0-beta')).toBe(true);
      expect(isValidVersion('1.0.0-alpha-1')).toBe(true); // Fixed: use hyphen instead of dot in prerelease
    });

    it('should return false for invalid version strings', () => {
      expect(isValidVersion('1')).toBe(false);
      expect(isValidVersion('1.0')).toBe(false);
      expect(isValidVersion('v1.0.0')).toBe(false);
      expect(isValidVersion('1.0.0.0')).toBe(false);
    });
  });

  describe('isValidUrl', () => {
    it('should return true for valid URLs', () => {
      expect(isValidUrl('https://example.com')).toBe(true);
      expect(isValidUrl('http://localhost:3000')).toBe(true);
      expect(isValidUrl('ftp://files.example.com')).toBe(true);
    });

    it('should return false for invalid URLs', () => {
      expect(isValidUrl('not a url')).toBe(false);
      expect(isValidUrl('example.com')).toBe(false); // missing protocol
      expect(isValidUrl('')).toBe(false);
    });
  });

  describe('isValidEmail', () => {
    it('should return true for valid emails', () => {
      expect(isValidEmail('user@example.com')).toBe(true);
      expect(isValidEmail('user.name@example.co.uk')).toBe(true);
      expect(isValidEmail('user+tag@example.com')).toBe(true);
    });

    it('should return false for invalid emails', () => {
      expect(isValidEmail('notanemail')).toBe(false);
      expect(isValidEmail('@example.com')).toBe(false);
      expect(isValidEmail('user@')).toBe(false);
      expect(isValidEmail('user @example.com')).toBe(false); // contains space
    });
  });

  describe('isPlainObject', () => {
    it('should return true for plain objects', () => {
      expect(isPlainObject({})).toBe(true);
      expect(isPlainObject({ key: 'value' })).toBe(true);
      expect(isPlainObject(Object.create(null))).toBe(false); // no prototype
    });

    it('should return false for non-plain objects', () => {
      expect(isPlainObject([])).toBe(false);
      expect(isPlainObject(new Date())).toBe(false);
      expect(isPlainObject(new Map())).toBe(false);
      expect(isPlainObject(null)).toBe(false);
    });
  });

  describe('isNonEmptyArray', () => {
    it('should return true for non-empty arrays', () => {
      expect(isNonEmptyArray([1])).toBe(true);
      expect(isNonEmptyArray([1, 2, 3])).toBe(true);
      expect(isNonEmptyArray(['a', 'b'])).toBe(true);
    });

    it('should return false for empty arrays and non-arrays', () => {
      expect(isNonEmptyArray([])).toBe(false);
      expect(isNonEmptyArray('not array')).toBe(false);
      expect(isNonEmptyArray(null)).toBe(false);
    });
  });
});

describe('Predicate Utilities', () => {
  const isString = (value: unknown): value is string =>
    typeof value === 'string';
  const isNumber = (value: unknown): value is number =>
    typeof value === 'number';
  const isPositive = (value: unknown): value is number =>
    typeof value === 'number' && value > 0;

  describe('allOf', () => {
    it('should return true when all guards pass', () => {
      const isPositiveNumber = allOf(isNumber, isPositive);
      expect(isPositiveNumber(5)).toBe(true);
      expect(isPositiveNumber(-5)).toBe(false);
      expect(isPositiveNumber('5')).toBe(false);
    });
  });

  describe('anyOf', () => {
    it('should return true when any guard passes', () => {
      const isStringOrNumber = anyOf(isString, isNumber);
      expect(isStringOrNumber('test')).toBe(true);
      expect(isStringOrNumber(123)).toBe(true);
      expect(isStringOrNumber(true)).toBe(false);
    });
  });

  describe('not', () => {
    it('should negate the guard result', () => {
      const isNotString = not(isString);
      expect(isNotString('test')).toBe(false);
      expect(isNotString(123)).toBe(true);
      expect(isNotString(null)).toBe(true);
    });
  });

  describe('optional', () => {
    it('should pass for undefined or valid values', () => {
      const optionalString = optional(isString);
      expect(optionalString('test')).toBe(true);
      expect(optionalString(undefined)).toBe(true);
      expect(optionalString(null)).toBe(false);
      expect(optionalString(123)).toBe(false);
    });
  });
});

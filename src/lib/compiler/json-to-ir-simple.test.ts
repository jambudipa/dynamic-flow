/**
 * Simplified Tests for JSON to IR Compiler
 *
 * Focus on testing the core compilation functionality
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Effect, Exit, HashMap, Option } from 'effect';
import { ToolId } from '@/lib/ir/core-types';
import { JSONToIRCompiler } from './json-to-ir';
import type { DynamicFlowType } from '@/lib/schema/flow-schema';
import type { Tool } from '@/lib/tools/types';
import { Schema } from 'effect';

describe('JSONToIRCompiler - Core Functionality', () => {
  let compiler: JSONToIRCompiler;

  beforeEach(() => {
    compiler = new JSONToIRCompiler();
  });

  describe('Basic Compilation', () => {
    it('should compile a simple tool flow', async () => {
      const flow: DynamicFlowType = {
        metadata: {
          name: 'Simple Tool Flow',
          description: 'Single tool execution',
        },
        flow: [
          {
            type: 'tool' as const,
            tool: 'test-tool',
            input: { data: 'test' },
          },
        ],
      };

      const tools: Tool<any, any>[] = [
        {
          id: 'test-tool',
          name: 'Test Tool',
          description: 'A test tool',
          inputSchema: Schema.Any,
          outputSchema: Schema.Any,
          execute: (input) => Effect.succeed(input),
        },
      ];

      const result = await Effect.runPromise(compiler.compile(flow, tools));

      expect(result).toBeDefined();
      expect(result.version).toBe('1.0');
      expect(result.metadata).toBeDefined();
      expect(result.metadata.source).toBe('dynamic');
      expect(result.graph).toBeDefined();
      expect(result.graph.nodes).toBeDefined();
      expect(HashMap.size(result.graph.nodes)).toBeGreaterThan(0);
      expect(result.graph.entryPoint).toBeDefined();
    });

    it('should handle sequential tool execution', async () => {
      const flow: DynamicFlowType = {
        metadata: {
          name: 'Sequential Flow',
          description: 'Two tools in sequence',
        },
        flow: [
          {
            type: 'tool' as const,
            tool: 'tool-1',
            input: { step: 1 },
          },
          {
            type: 'tool' as const,
            tool: 'tool-2',
            input: { step: 2 },
          },
        ],
      };

      const tools: Tool<any, any>[] = [
        {
          id: 'tool-1',
          name: 'Tool 1',
          description: 'First tool',
          inputSchema: Schema.Any,
          outputSchema: Schema.Any,
          execute: (input) => Effect.succeed(input),
        },
        {
          id: 'tool-2',
          name: 'Tool 2',
          description: 'Second tool',
          inputSchema: Schema.Any,
          outputSchema: Schema.Any,
          execute: (input) => Effect.succeed(input),
        },
      ];

      const result = await Effect.runPromise(
        compiler.compile(flow, tools, undefined, { validateConnections: false })
      );

      expect(HashMap.size(result.graph.nodes)).toBe(2);
      const nodeArray = Array.from(HashMap.values(result.graph.nodes));
      expect(nodeArray.every((n: any) => n.type === 'tool')).toBe(true);
    });
  });

  describe('Error Handling', () => {
    it('should fail when tool is not found and validation is enabled', async () => {
      const flow: DynamicFlowType = {
        metadata: {
          name: 'Invalid Flow',
          description: 'References non-existent tool',
        },
        flow: [
          {
            type: 'tool' as const,
            tool: 'non-existent',
            input: {},
          },
        ],
      };

      const exit = await Effect.runPromiseExit(
        compiler.compile(flow, [], undefined, { validateConnections: true })
      );

      expect(Exit.isFailure(exit)).toBe(true);
    });

    it('should allow missing tools when validation is disabled', async () => {
      const flow: DynamicFlowType = {
        metadata: {
          name: 'Unvalidated Flow',
          description: 'Skip validation',
        },
        flow: [
          {
            type: 'tool' as const,
            tool: 'any-tool',
            input: {},
          },
        ],
      };

      const result = await Effect.runPromise(
        compiler.compile(flow, [], undefined, { validateConnections: false })
      );

      expect(result).toBeDefined();
      expect(HashMap.size(result.graph.nodes)).toBeGreaterThan(0);
    });
  });

  describe('Complex Operators', () => {
    it('should compile conditional operators', async () => {
      const flow: DynamicFlowType = {
        metadata: {
          name: 'Conditional Flow',
          description: 'Flow with conditional',
        },
        flow: [
          {
            type: 'conditional' as const,
            condition: 'true',
            then: [
              {
                type: 'tool' as const,
                tool: 'then-tool',
                input: {},
              },
            ],
            else: [
              {
                type: 'tool' as const,
                tool: 'else-tool',
                input: {},
              },
            ],
          },
        ],
      };

      const tools: Tool<any, any>[] = [
        {
          id: 'then-tool',
          name: 'Then Tool',
          description: 'Then branch',
          inputSchema: Schema.Any,
          outputSchema: Schema.Any,
          execute: (input) => Effect.succeed(input),
        },
        {
          id: 'else-tool',
          name: 'Else Tool',
          description: 'Else branch',
          inputSchema: Schema.Any,
          outputSchema: Schema.Any,
          execute: (input) => Effect.succeed(input),
        },
      ];

      const result = await Effect.runPromise(
        compiler.compile(flow, tools, undefined, { validateConnections: false })
      );

      expect(result).toBeDefined();
      expect(HashMap.size(result.graph.nodes)).toBeGreaterThan(0);

      // Check for conditional node
      const hasConditional = Array.from(
        HashMap.values(result.graph.nodes)
      ).some((n: any) => n.type === 'conditional');
      expect(hasConditional).toBe(true);
    });

    it('should compile parallel operators', async () => {
      const flow: DynamicFlowType = {
        metadata: {
          name: 'Parallel Flow',
          description: 'Parallel execution',
        },
        flow: [
          {
            type: 'parallel' as const,
            branches: [
              [
                {
                  type: 'tool' as const,
                  tool: 'branch-1',
                  input: {},
                },
              ],
              [
                {
                  type: 'tool' as const,
                  tool: 'branch-2',
                  input: {},
                },
              ],
            ],
          },
        ],
      };

      const tools: Tool<any, any>[] = [
        {
          id: 'branch-1',
          name: 'Branch 1',
          description: 'First branch',
          inputSchema: Schema.Any,
          outputSchema: Schema.Any,
          execute: (input) => Effect.succeed(input),
        },
        {
          id: 'branch-2',
          name: 'Branch 2',
          description: 'Second branch',
          inputSchema: Schema.Any,
          outputSchema: Schema.Any,
          execute: (input) => Effect.succeed(input),
        },
      ];

      const result = await Effect.runPromise(
        compiler.compile(flow, tools, undefined, { validateConnections: false })
      );

      expect(result).toBeDefined();
      expect(HashMap.size(result.graph.nodes)).toBeGreaterThan(0);

      // Check for parallel node
      const hasParallel = Array.from(HashMap.values(result.graph.nodes)).some(
        (n: any) => n.type === 'parallel'
      );
      expect(hasParallel).toBe(true);
    });
  });

  describe('Metadata and Registry', () => {
    it('should include flow metadata in IR', async () => {
      const flow: DynamicFlowType = {
        metadata: {
          name: 'Metadata Test Flow',
          description: 'Testing metadata inclusion',
        },
        flow: [
          {
            type: 'tool' as const,
            tool: 'meta-tool',
            input: {},
          },
        ],
      };

      const tools: Tool<any, any>[] = [
        {
          id: 'meta-tool',
          name: 'Meta Tool',
          description: 'Tool for metadata test',
          inputSchema: Schema.Any,
          outputSchema: Schema.Any,
          execute: (input) => Effect.succeed(input),
        },
      ];

      const result = await Effect.runPromise(
        compiler.compile(flow, tools, undefined, { validateConnections: false })
      );

      expect(result.metadata).toBeDefined();
      expect(Option.getOrNull(result.metadata.name)).toBe('Metadata Test Flow');
      expect(Option.getOrNull(result.metadata.description)).toBe(
        'Testing metadata inclusion'
      );
      expect(result.metadata.source).toBe('dynamic');
      expect(result.metadata.created).toBeDefined();
    });

    it('should include tools in registry', async () => {
      const flow: DynamicFlowType = {
        metadata: {
          name: 'Registry Test',
          description: 'Testing tool registry',
        },
        flow: [
          {
            type: 'tool' as const,
            tool: 'registry-tool',
            input: {},
          },
        ],
      };

      const tool: Tool<any, any> = {
        id: 'registry-tool',
        name: 'Registry Tool',
        description: 'Tool for registry test',
        inputSchema: Schema.Any,
        outputSchema: Schema.Any,
        execute: (input) => Effect.succeed(input),
      };

      const result = await Effect.runPromise(
        compiler.compile(flow, [tool], undefined, {
          validateConnections: false,
        })
      );

      expect(result.registry).toBeDefined();
      expect(result.registry.tools).toBeDefined();
      expect(HashMap.size(result.registry.tools)).toBe(1);
      expect(HashMap.has(result.registry.tools, ToolId('registry-tool'))).toBe(
        true
      );
    });
  });
});

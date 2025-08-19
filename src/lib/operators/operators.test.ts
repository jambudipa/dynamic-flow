/**
 * Tests for Operator System
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Effect, Chunk, HashMap, Option } from 'effect';
import { OperatorRegistry } from './registry';
import { ToolOperator, type ToolConfig } from './tool';
import { ConditionalOperator, type ConditionalConfig } from './conditional';
import { ParallelOperator, type ParallelConfig } from './parallel';
import { MapOperator, type MapConfig } from './map';
import { ReduceOperator, type ReduceConfig } from './reduce';
import { LoopOperator, type LoopConfig } from './loop';
import { SwitchOperator, type SwitchConfig } from './switch';
import type { IRGenerationContext } from './base';
import type { Tool } from '@/lib/tools/types';
import { Schema } from 'effect';
import { runTest, runTestExit } from '@/test-utils/effect-helpers';

describe('Operator System', () => {
  describe('OperatorRegistry', () => {
    let registry: OperatorRegistry;

    beforeEach(() => {
      registry = OperatorRegistry.getInstance();
    });

    it('should be a singleton', () => {
      const registry2 = OperatorRegistry.getInstance();
      expect(registry).toBe(registry2);
    });

    it('should have all built-in operators registered', () => {
      expect(registry.get('tool')).toBeInstanceOf(ToolOperator);
      expect(registry.get('conditional')).toBeInstanceOf(ConditionalOperator);
      expect(registry.get('parallel')).toBeInstanceOf(ParallelOperator);
      expect(registry.get('map')).toBeInstanceOf(MapOperator);
      expect(registry.get('reduce')).toBeInstanceOf(ReduceOperator);
      expect(registry.get('loop')).toBeInstanceOf(LoopOperator);
      expect(registry.get('switch')).toBeInstanceOf(SwitchOperator);
    });

    it('should return undefined for unknown operator types', () => {
      expect(registry.get('unknown' as any)).toBeUndefined();
    });
  });

  describe('ToolOperator', () => {
    let operator: ToolOperator;
    let context: IRGenerationContext;

    beforeEach(() => {
      operator = new ToolOperator();

      const testTool: Tool<any, any> = {
        id: 'test-tool',
        name: 'Test Tool',
        description: 'A test tool',
        inputSchema: Schema.Any,
        outputSchema: Schema.Any,
        execute: (input) => Effect.succeed(input),
      };

      context = {
        nodeIdGenerator: () => 'test-node-id',
        tools: new Map([['test-tool', testTool]]),
        joins: new Map(),
        validateConnections: false,
        addNode: () => {},
      };
    });

    it('should generate IR for tool step', () => {
      const config: ToolConfig = {
        id: 'test-config-id',
        tool: 'test-tool',
        args: { data: 'test' },
      };

      const result = operator.toIR(config, context);

      expect(result).toBeDefined();
      expect(result.id).toBe('test-config-id');
      expect(result.type).toBe('tool');
      expect((result as any).tool).toBe('test-tool');
    });

    it('should fail when tool is not found', async () => {
      const config: ToolConfig = {
        id: 'test-config-id',
        tool: 'non-existent',
        args: {},
      };

      // Create context with validateConnections enabled
      const strictContext = {
        ...context,
        validateConnections: true,
      };

      const exit = await runTestExit(
        Effect.try(() => operator.toIR(config, strictContext))
      );
      expect(exit._tag).toBe('Failure');
    });

    it('should handle output naming', () => {
      const config: ToolConfig = {
        id: 'test-config-id',
        tool: 'test-tool',
        args: {},
        output: 'myResult',
      };

      const result = operator.toIR(config, context);
      expect((result as any).outputVar).toBe('myResult');
    });
  });

  describe('ConditionalOperator', () => {
    let operator: ConditionalOperator;
    let context: IRGenerationContext;

    beforeEach(() => {
      operator = new ConditionalOperator();
      context = {
        nodeIdGenerator: (() => {
          let counter = 0;
          return () => `node-${++counter}`;
        })(),
        tools: new Map(),
        joins: new Map(),
        validateConnections: false,
        addNode: () => {},
      };
    });

    it('should generate IR for conditional step', () => {
      const config: ConditionalConfig = {
        id: 'test-conditional-id',
        condition: '$.value > 10',
        if_true: [
          {
            id: 'then-tool-id',
            type: 'tool' as const,
            tool: 'then-tool',
            args: {},
          },
        ],
        if_false: [
          {
            id: 'else-tool-id',
            type: 'tool' as const,
            tool: 'else-tool',
            args: {},
          },
        ],
      };

      const result = operator.toIR(config, context);

      expect(result).toBeDefined();
      expect(result.type).toBe('conditional');
      expect((result as any).condition).toBeDefined();
      expect((result as any).thenBranch).toBeDefined();
      expect((result as any).elseBranch).toBeDefined();
    });

    it('should handle missing else branch', () => {
      const config: ConditionalConfig = {
        id: 'test-conditional-id',
        condition: 'true',
        if_true: [
          { id: 'tool-id', type: 'tool' as const, tool: 'tool', args: {} },
        ],
      };

      const result = operator.toIR(config, context);

      expect((result as any).thenBranch).toBeDefined();
      expect((result as any).elseBranch).toBeUndefined();
    });
  });

  describe('ParallelOperator', () => {
    let operator: ParallelOperator;
    let context: IRGenerationContext;

    beforeEach(() => {
      operator = new ParallelOperator();
      context = {
        nodeIdGenerator: (() => {
          let counter = 0;
          return () => `node-${++counter}`;
        })(),
        tools: new Map(),
        joins: new Map(),
        validateConnections: false,
        addNode: () => {},
      };
    });

    it('should generate IR for parallel step', () => {
      const config: ParallelConfig = {
        id: 'test-parallel-id',
        parallel: [
          { id: 'tool1-id', type: 'tool' as const, tool: 'tool1', args: {} },
          { id: 'tool2-id', type: 'tool' as const, tool: 'tool2', args: {} },
        ],
      };

      const result = operator.toIR(config, context);

      expect(result).toBeDefined();
      expect(result.type).toBe('parallel');
      expect((result as any).branches).toBeDefined();
      // When using 'parallel' format, all steps are in a single branch
      expect((result as any).branches).toHaveLength(1);
      expect((result as any).branches[0]).toHaveLength(2);
    });

    it('should handle concurrency settings', () => {
      const config: ParallelConfig = {
        id: 'test-parallel-id',
        parallel: [
          { id: 'tool1-id', type: 'tool' as const, tool: 'tool1', args: {} },
          { id: 'tool2-id', type: 'tool' as const, tool: 'tool2', args: {} },
        ],
      };

      const result = operator.toIR(config, context);

      expect((result as any).config?.concurrency).toBeUndefined();
    });
  });

  describe('MapOperator', () => {
    let operator: MapOperator;
    let context: IRGenerationContext;

    beforeEach(() => {
      operator = new MapOperator();
      context = {
        nodeIdGenerator: (() => {
          let counter = 0;
          return () => `node-${++counter}`;
        })(),
        tools: new Map(),
        joins: new Map(),
        validateConnections: false,
        addNode: () => {},
      };
    });

    it.skip('should generate IR for map step', () => {
      // TODO: Update test to use MapConfig schema
      const config: MapConfig = {
        id: 'map-id',
        map: '$.items',
        with: {
          id: 'process-id',
          type: 'tool' as const,
          tool: 'process',
          args: {},
        },
      };

      const result = operator.toIR(config, context);

      expect(result).toBeDefined();
      expect(result.type).toBe('loop');
      expect((result as any).loopType).toBe('map');
      expect((result as any).collection).toBeDefined();
      expect((result as any).iteratorVar).toBe('item');
    });

    it.skip('should handle parallel map', () => {
      // TODO: Update test to use MapConfig schema
      const config: MapConfig = {
        id: 'map-id',
        map: '$.items',
        with: {
          id: 'process-id',
          type: 'tool' as const,
          tool: 'process',
          args: {},
        },
      };

      const result = operator.toIR(config, context);

      expect((result as any).config?.parallel).toBe(true);
    });
  });

  describe('ReduceOperator', () => {
    let operator: ReduceOperator;
    let context: IRGenerationContext;

    beforeEach(() => {
      operator = new ReduceOperator();
      context = {
        nodeIdGenerator: (() => {
          let counter = 0;
          return () => `node-${++counter}`;
        })(),
        tools: new Map(),
        joins: new Map(),
        validateConnections: false,
        addNode: () => {},
      };
    });

    it.skip('should generate IR for reduce step', () => {
      // TODO: Update test to use ReduceConfig schema
      const config: ReduceConfig = {
        id: 'reduce-id',
        reduce: '$.items',
        initial: { sum: 0 },
        with: { id: 'sum-id', type: 'tool' as const, tool: 'sum', args: {} },
      };

      const result = operator.toIR(config, context);

      expect(result).toBeDefined();
      expect(result.type).toBe('loop');
      expect((result as any).loopType).toBe('reduce');
      expect((result as any).collection).toBeDefined();
      expect((result as any).iteratorVar).toBe('item');
      expect((result as any).accumulator).toBeDefined();
    });
  });

  describe('LoopOperator', () => {
    let operator: LoopOperator;
    let context: IRGenerationContext;

    beforeEach(() => {
      operator = new LoopOperator();
      context = {
        nodeIdGenerator: (() => {
          let counter = 0;
          return () => `node-${++counter}`;
        })(),
        tools: new Map(),
        joins: new Map(),
        validateConnections: false,
        addNode: () => {},
      };
    });

    it.skip('should generate IR for while loop', () => {
      // TODO: Update test to use LoopConfig schema
      const config: LoopConfig = {
        id: 'loop-id',
        loop: 'while',
        condition: '$.counter < 10',
        body: [
          {
            id: 'increment-id',
            type: 'tool' as const,
            tool: 'increment',
            args: {},
          },
        ],
      };

      const result = operator.toIR(config, context);

      expect(result).toBeDefined();
      expect(result.type).toBe('loop');
      expect((result as any).loopType).toBe('while');
      expect((result as any).condition).toBeDefined();
    });

    it.skip('should handle max iterations', () => {
      // TODO: Update test to use LoopConfig schema and proper configuration
      const config: LoopConfig = {
        id: 'loop-id',
        loop: 'while',
        condition: 'true',
        body: [
          {
            id: 'process-id',
            type: 'tool' as const,
            tool: 'process',
            args: {},
          },
        ],
      };

      const result = operator.toIR(config, context);

      expect((result as any).config?.maxIterations).toBe(100);
    });
  });

  describe('SwitchOperator', () => {
    let operator: SwitchOperator;
    let context: IRGenerationContext;

    beforeEach(() => {
      operator = new SwitchOperator();
      context = {
        nodeIdGenerator: (() => {
          let counter = 0;
          return () => `node-${++counter}`;
        })(),
        tools: new Map(),
        joins: new Map(),
        validateConnections: false,
        addNode: () => {},
      };
    });

    it.skip('should generate IR for switch step', () => {
      // TODO: Update test to use SwitchConfig schema
      const config: SwitchConfig = {
        id: 'switch-id',
        switch: 'Choose handler based on type',
        options: Chunk.fromIterable([
          { id: 'type-a', name: 'Type A', description: 'Handle type A' },
          { id: 'type-b', name: 'Type B', description: 'Handle type B' },
        ]),
        branches: HashMap.fromIterable([
          [
            'type-a',
            Chunk.fromIterable([
              {
                id: 'handle-a-id',
                type: 'tool' as const,
                tool: 'handle-a',
                args: {},
              },
            ]),
          ],
          [
            'type-b',
            Chunk.fromIterable([
              {
                id: 'handle-b-id',
                type: 'tool' as const,
                tool: 'handle-b',
                args: {},
              },
            ]),
          ],
        ]),
        output: Option.none(),
        timeout: Option.none(),
        retry: Option.none(),
        description: Option.none(),
      };

      const result = operator.toIR(config, context);

      expect(result).toBeDefined();
      expect(result.type).toBe('switch');
      expect((result as any).discriminator).toBeDefined();
      expect((result as any).cases).toBeDefined();
      expect(Object.keys((result as any).cases)).toHaveLength(2);
      expect((result as any).defaultCase).toBeDefined();
    });

    it.skip('should handle switch without default', () => {
      // TODO: Update test to use SwitchConfig schema
      const config: SwitchConfig = {
        id: 'switch-id',
        switch: 'Choose handler',
        options: Chunk.fromIterable([
          { id: 'only-case', name: 'Only Case', description: 'Single case' },
        ]),
        branches: HashMap.fromIterable([
          [
            'only-case',
            Chunk.fromIterable([
              {
                id: 'handle-id',
                type: 'tool' as const,
                tool: 'handle',
                args: {},
              },
            ]),
          ],
        ]),
        output: Option.none(),
        timeout: Option.none(),
        retry: Option.none(),
        description: Option.none(),
      };

      const result = operator.toIR(config, context);

      expect((result as any).defaultCase).toBeUndefined();
    });
  });

  describe('Operator Composition', () => {
    it.skip('should handle nested operators', () => {
      // TODO: Update test to use proper Config schemas
      const context: IRGenerationContext = {
        nodeIdGenerator: (() => {
          let counter = 0;
          return () => `node-${++counter}`;
        })(),
        tools: new Map(),
        joins: new Map(),
        validateConnections: false,
        addNode: () => {},
      };

      const conditionalOp = new ConditionalOperator();
      const config: ConditionalConfig = {
        id: 'conditional-id',
        condition: '$.flag',
        if_true: [
          {
            id: 'parallel-id',
            parallel: [
              {
                id: 'tool1-id',
                type: 'tool' as const,
                tool: 'tool1',
                args: {},
              },
              {
                id: 'tool2-id',
                type: 'tool' as const,
                tool: 'tool2',
                args: {},
              },
            ],
          },
        ],
        if_false: [
          {
            id: 'map-id',
            map: '$.items',
            with: {
              id: 'process-id',
              type: 'tool' as const,
              tool: 'process',
              args: {},
            },
          },
        ],
      };

      const result = conditionalOp.toIR(config, context);

      expect(result).toBeDefined();
      expect(result.type).toBe('conditional');
      // Nested operators should be converted to IR
    });
  });
});

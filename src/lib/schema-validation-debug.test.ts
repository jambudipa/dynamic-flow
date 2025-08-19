/**
 * Test to reproduce and fix the schema validation error
 * Using captured JSON from the Buddhist example
 */

import { describe, it, expect } from 'vitest';
import { Schema } from 'effect';
import { OperatorRegistry } from './operators';
import {
  FlatDynamicFlow,
  type FlatDynamicFlowType,
} from './schema/flow-schema';

// This is the actual JSON that was captured from the LLM that's failing validation
const capturedFailingJSON: FlatDynamicFlowType = {
  version: '1.0',
  metadata: {
    name: 'Compare gross vs subtle selflessness of persons',
    description:
      'Search corpus, retrieve relevant book sections and audio, compare descriptions, clarify if unclear/overlapping, summarise distinction, and check for contradictions.',
    author: 'flow-generator',
    created: '2025-08-19',
  },
  steps: [
    {
      id: 's1',
      description:
        "Search the library for mentions of 'gross selflessness of persons' and 'subtle selflessness of persons', including related sections and audio.",
      type: 'tool',
      tool: 'corpus:search',
      args: {},
    },
    {
      id: 'p1',
      description:
        'In parallel, retrieve top relevant book sections and any related audio transcripts from the search results ($s1.output).',
      type: 'parallel',
      parallelIds: ['s2', 's3', 's4'],
    },
    {
      id: 's2',
      description:
        'Get a relevant book section discussing gross selflessness of persons from the search results ($s1.output).',
      type: 'tool',
      tool: 'book:get-section',
      args: {},
    },
    {
      id: 's3',
      description:
        'Get a relevant book section discussing subtle selflessness of persons from the search results ($s1.output).',
      type: 'tool',
      tool: 'book:get-section',
      args: {},
    },
    {
      id: 's4',
      description:
        'Get a related audio teaching transcript that discusses gross/subtle selflessness of persons from the search results ($s1.output).',
      type: 'tool',
      tool: 'audio:get-transcript',
      args: {},
    },
    {
      id: 's5',
      description:
        "Compare how 'gross selflessness of persons' and 'subtle selflessness of persons' are described across the retrieved book sections and audio transcript.",
      type: 'tool',
      tool: 'llm:compare',
      args: {},
    },
  ],
  rootIds: ['s1', 'p1', 's5'],
};

describe('Schema Validation Debug', () => {
  it('should validate the complete flat dynamic flow JSON', () => {
    console.log('Testing complete flat dynamic flow validation...');

    try {
      const decoded =
        Schema.decodeUnknownSync(FlatDynamicFlow)(capturedFailingJSON);
      console.log('Complete JSON is valid according to FlatDynamicFlow schema');
    } catch (error: unknown) {
      console.error(
        'Complete JSON failed FlatDynamicFlow validation:',
        (error as any).message
      );
      throw error;
    }
  });

  it('should identify what is wrong with flatToRecursive', () => {
    const registry = OperatorRegistry.getInstance();

    console.log('Testing flatToRecursive with captured JSON...');

    try {
      const result = registry.flatToRecursive(
        capturedFailingJSON as FlatDynamicFlowType
      );
      console.log('Transformation succeeded:', result);
    } catch (error) {
      console.error('flatToRecursive failed:', (error as any).message);
      throw error;
    }
  });

  it('should validate the flat schema structure', () => {
    const registry = OperatorRegistry.getInstance();
    const flatSchema = registry.generateFlatStepSchema();

    // Test each step individually to see which ones fail
    capturedFailingJSON.steps.forEach((step, index) => {
      console.log(`Testing step ${index}: ${step.id} (type: ${step.type})`);

      try {
        const decoded = Schema.decodeUnknownSync(flatSchema)(step); // DO NOT CAST TO ANY, POINTLESS OTHERWISE
        console.log(`Step ${step.id} is valid`);
      } catch (error: any) {
        console.error(`Step ${step.id} failed validation:`, error.message);
        throw error;
      }
    });
  });

  it('should test the specific failing step types', () => {
    const registry = OperatorRegistry.getInstance();

    // Check if parallel operator exists and what it expects
    const parallelOp = registry.get('parallel');
    console.log('Parallel operator:', parallelOp ? 'exists' : 'missing');

    if (parallelOp) {
      console.log('Parallel operator schema:', parallelOp);
    }

    // Test the parallel step specifically since that seems to be a new pattern
    const parallelStep = capturedFailingJSON.steps.find(
      (s) => s.type === 'parallel'
    );
    if (parallelStep) {
      console.log('Found parallel step:', parallelStep);

      // Check what the parallel operator expects vs what we have
      if (parallelOp) {
        try {
          const result = parallelOp.fromFlat(parallelStep, {
            resolve: (id: string) =>
              capturedFailingJSON.steps.find((s) => s.id === id),
            resolveMany: (ids: string[]) =>
              ids
                .map((id) => capturedFailingJSON.steps.find((s) => s.id === id))
                .filter(Boolean),
          });
          console.log('Parallel transformation result:', result);
        } catch (error) {
          console.error('Parallel transformation failed:', error);
          throw error;
        }
      }
    }
  });
});

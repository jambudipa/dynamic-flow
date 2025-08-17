/**
 * DynamicFlow JSON Schema Definition
 *
 * Purpose: Declarative schema (Effect Schema) describing flow steps and their
 * shapes in JSON form. Now delegates to unified operators for single source of truth.
 *
 * How it fits in:
 * - Authoring layer: users or tools produce JSON conforming to this schema.
 * - Compilation: `compiler/json-to-ir.ts` translates these steps into IR.
 * - Execution: `engine/executor.ts` runs the IR.
 */

import { Schema } from 'effect';
import { OperatorRegistry } from '@/operators';

// ============= Get schemas from unified operators =============

// Get the registry instance
const registry = OperatorRegistry.getInstance();

// Generate the recursive Step schema from all registered operators
// This is a union of all operator schemas - the single source of truth
export const Step = registry
  .generateRecursiveStepSchema()
  .annotations({ identifier: 'Step' });

// For backwards compatibility - export ArgumentValue
export const ArgumentValue = Schema.Unknown;

// Helper functions for variable references
export function isVariableReference(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith('$');
}

export function extractVariableName(value: string): string {
  return value.startsWith('$') ? value.slice(1) : value;
}

// ============= Flow Schema =============

/** Metadata fields for the flow. */
const MetadataFields = Schema.Struct({
  name: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
  author: Schema.optional(Schema.String),
  created: Schema.optional(Schema.String),
});

/** The top-level flow structure. */
export const DynamicFlow = Schema.Struct({
  version: Schema.optional(Schema.Literal('1.0')),
  metadata: Schema.optional(MetadataFields),
  flow: Schema.Array(Step),
});

// Type exports
export type StepType = Schema.Schema.Type<typeof Step>;
export type DynamicFlowType = Schema.Schema.Type<typeof DynamicFlow>;

// For flat schema generation (used by LLM generation)
export const FlatStep = registry
  .generateFlatStepSchema()
  .annotations({ identifier: 'FlatStep' });

export const FlatDynamicFlow = Schema.Struct({
  version: Schema.optional(Schema.Literal('1.0')),
  metadata: Schema.optional(MetadataFields),
  steps: Schema.Array(FlatStep),
  rootIds: Schema.Array(Schema.String),
});

export type FlatStepType = Schema.Schema.Type<typeof FlatStep>;
export type FlatDynamicFlowType = Schema.Schema.Type<typeof FlatDynamicFlow>;

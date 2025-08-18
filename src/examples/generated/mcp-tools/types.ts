/**
 * Shared types for generated MCP tools
 * This file contains the essential types needed by MCP tools to avoid import issues
 * Generated on: 2025-08-18T20:04:14.636Z
 */

import { Data, Effect, Schema } from 'effect';

// ============= Execution Context =============

/**
 * Execution context for tool execution
 */
export interface ExecutionContext {
  /** Unique identifier for the current flow */
  readonly flowId: string;
  /** Unique identifier for the current step */
  readonly stepId: string;
  /** Session identifier for tracking execution sessions */
  readonly sessionId: string;
  /** Variables available in the current execution context */
  readonly variables: Record<string, unknown>;
  /** Metadata for the current execution */
  readonly metadata: Record<string, unknown>;

  // Optional enhanced fields
  /** Parent execution context for nested flows */
  readonly parentContext?: ExecutionContext;
  /** Current scope information for variable resolution */
  readonly currentScope?: string[];
}

// ============= Tool Types =============

/**
 * Tool requirements for dependency injection
 */
export type ToolRequirements = never;

/**
 * Tool error class for error handling
 */
export class ToolError extends Data.TaggedError('ToolError')<{
  toolId: string;
  phase: 'validation' | 'execution' | 'cleanup';
  details?: Record<string, unknown>;
  cause?: unknown;
}> {
  get message(): string {
    return `Tool '${this.toolId}' failed during ${this.phase}${this.cause ? `: ${String(this.cause)}` : ''}`;
  }
}

/**
 * Base tool interface
 */
export interface Tool<TInput, TOutput> {
  id: string;
  name: string;
  description: string;
  inputSchema: Schema.Schema<TInput>;
  outputSchema: Schema.Schema<TOutput>;
  execute: (
    input: TInput,
    context: ExecutionContext
  ) => Effect.Effect<TOutput, ToolError, ToolRequirements>;
}

/**
 * AI Types - Definitions for AI/LLM interfaces
 */

import type { Effect } from 'effect';
import { Stream } from 'effect';

/**
 * AI namespace with required types
 */
export namespace Ai {
  /**
   * Base model interface
   */
  export interface Model {
    completion(
      prompt: string,
      options?: CompletionOptions
    ): Effect.Effect<CompletionResult, ModelError>;

    stream(
      prompt: string,
      options?: StreamOptions
    ): Stream.Stream<StreamChunk, ModelError>;
  }

  /**
   * Completion options
   */
  export interface CompletionOptions {
    temperature?: number;
    maxTokens?: number;
    stopSequences?: string[];
    systemPrompt?: string;
  }

  /**
   * Stream options
   */
  export interface StreamOptions extends CompletionOptions {
    onToken?: (token: string) => void;
  }

  /**
   * Completion result
   */
  export interface CompletionResult {
    content: string;
    usage?: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
  }

  /**
   * Stream chunk
   */
  export interface StreamChunk {
    delta: string;
    finishReason?: 'stop' | 'length' | 'error';
  }

  /**
   * Model error
   */
  export class ModelError extends Error {
    readonly _tag = 'ModelError';

    constructor(
      message: string,
      public readonly cause?: unknown
    ) {
      super(message);
    }
  }

  /**
   * Stream type for AI responses
   */
  export type Stream = Stream.Stream<StreamChunk, ModelError>;
}

/**
 * Type alias for AI Model
 */
export type AiModel = Ai.Model;

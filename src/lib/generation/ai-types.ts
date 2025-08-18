/**
 * AI Types - Definitions for AI/LLM interfaces
 */

import type { Effect } from 'effect';
import { Data, Stream } from 'effect';

/**
 * AI namespace with required types
 */
// eslint-disable-next-line @typescript-eslint/no-namespace
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
  export class ModelError extends Data.TaggedError('ModelError')<{
    readonly message: string;
    readonly cause?: unknown;
    readonly modelId?: string;
    readonly operation?: string;
  }> {
    get displayMessage(): string {
      const model =
        this.modelId !== null &&
        this.modelId !== undefined &&
        this.modelId !== ''
          ? ` for model '${this.modelId}'`
          : '';
      const operation =
        this.operation !== null &&
        this.operation !== undefined &&
        this.operation !== ''
          ? ` during ${this.operation}`
          : '';
      const cause =
        this.cause !== null && this.cause !== undefined
          ? ` (caused by: ${String(this.cause)})`
          : '';
      return `Model error${model}${operation}${cause}: ${this.message}`;
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

import type { LLMTool } from '../../tools/types';
import { LLMService } from '../service';
import { Effect, Schema } from 'effect';
import { ToolError } from '../../types';

/**
 * Factory to create an OpenAI-backed LLM tool using the central LLM service.
 * This is the general-purpose tool for generating text with OpenAI (gpt-5).
 */
export function createOpenAiCompletionTool(
  id: string,
  name: string,
  description: string,
  _options?: { model?: string; temperature?: number; maxTokens?: number }
): LLMTool<{ prompt: string }, { response: string }> {
  return {
    id,
    name,
    description,
    llmConfig: { model: 'gpt-5', maxTokens: 4000 }, // Removed temperature - not supported by all models
    inputSchema: Schema.Struct({ prompt: Schema.String }) as any,
    outputSchema: Schema.Struct({ response: Schema.String }) as any,
    execute: (input: { prompt: string }) =>
      (LLMService as any).pipe(
        Effect.flatMap((svc: any) => svc.completion(input.prompt)),
        Effect.map((r: { content: string }) => ({ response: r.content })),
        Effect.mapError(
          (e: any) =>
            new ToolError({
              toolId: id,
              phase: 'execution',
              cause: `OpenAI tool failed: ${String(e)}`,
            })
        )
      ),
  };
}

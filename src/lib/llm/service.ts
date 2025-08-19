import {
  Context,
  Effect,
  JSONSchema,
  Layer,
  Redacted,
  Schema,
  Stream,
} from 'effect';
import * as NodeHttpClient from '@effect/platform-node/NodeHttpClient';
import { OpenAiClient, OpenAiLanguageModel } from '@effect/ai-openai/index';
import * as AiLanguageModel from '@effect/ai/AiLanguageModel';
import type { AiModel } from '../generation/types';

const DEFAULT_MODEL = 'gpt-5';

function makeLayers(
  apiKey: string
): readonly [
  typeof NodeHttpClient.layer,
  ReturnType<typeof OpenAiClient.layer>,
  ReturnType<typeof OpenAiLanguageModel.layer>,
] {
  return [
    NodeHttpClient.layer,
    OpenAiClient.layer({ apiKey: Redacted.make(apiKey) }),
    OpenAiLanguageModel.layer({ model: DEFAULT_MODEL }),
  ] as const;
}

export class LLMCoreService {
  static completion(prompt: string): Effect.Effect<{ content: string }, never> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey)
      return Effect.succeed({ content: '{"error":"missing_api_key"}' });
    const layers = makeLayers(apiKey);
    const layer = Layer.mergeAll(...layers);
    return AiLanguageModel.generateText({ prompt }).pipe(
      Effect.provide(layer),
      Effect.map((resp: any) => ({ content: resp.text })),
      Effect.catchAllCause(() =>
        Effect.tryPromise({
          try: async () => {
            const response = await fetch(
              'https://api.openai.com/v1/chat/completions',
              {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${apiKey}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  model: DEFAULT_MODEL,
                  messages: [{ role: 'user', content: prompt }],
                  // temperature: 0.2, // Removed - not supported by all models
                  // max_completion_tokens: 400, // This might be causing empty responses
                }),
              }
            );
            const data = (await response.json()) as any;
            const content = data?.choices?.[0]?.message?.content;
            if (typeof content === 'string' && content.length > 0) {
              return { content };
            }
            const errMsg = data?.error?.message || JSON.stringify(data);
            return { content: `OpenAI error: ${errMsg}` };
          },
          catch: () => ({ content: '{"error":"openai_failure"}' }),
        })
      )
    ) as unknown as Effect.Effect<{ content: string }, never, never>;
  }

  static stream(prompt: string): Stream.Stream<{ content: string }, never> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return Stream.fromIterable([]);
    const base = AiLanguageModel.streamText({ prompt }) as any;
    const layer = Layer.mergeAll(...makeLayers(apiKey));
    const provided = Stream.provideLayer(base, layer) as any;
    const mapped = Stream.map(provided, (resp: any) => ({
      content: resp.text,
    })) as any;
    return Stream.catchAllCause(
      mapped,
      () => Stream.empty
    ) as unknown as Stream.Stream<{ content: string }, never>;
  }

  /**
   * Request a structured JSON output using OpenAI's structured outputs (json_schema) if possible.
   * Falls back to a best-effort JSON parse of a normal completion if the provider fails.
   */
  static structured<T = unknown>(
    prompt: string,
    effectSchema: Schema.Schema<T>,
    options?: { model?: string }
  ): Effect.Effect<{ json: T; text: string }, never> {
    const apiKey = process.env.OPENAI_API_KEY;
    const jsonSchema = JSONSchema.make(effectSchema) as unknown as Record<
      string,
      unknown
    >;
    const strictSchema = (() => {
      const js: any = jsonSchema || {};
      if (
        js &&
        typeof js === 'object' &&
        js.type === 'object' &&
        js.properties &&
        typeof js.properties === 'object'
      ) {
        const props = js.properties as Record<string, unknown>;
        const required = Object.keys(props);
        return {
          type: 'object',
          properties: props,
          required,
          additionalProperties: false,
        } as Record<string, unknown>;
      }
      return { ...(jsonSchema as any), additionalProperties: false } as Record<
        string,
        unknown
      >;
    })();

    // Direct fetch approach using Chat Completions API with response_format
    const viaFetch = Effect.tryPromise({
      try: async () => {
        if (!apiKey) throw new Error('missing_api_key');
        const body = {
          model: options?.model || DEFAULT_MODEL,
          messages: [
            {
              role: 'user',
              content: `Return only valid JSON according to the schema. ${prompt}`,
            },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'structured_output',
              schema: strictSchema,
              strict: false, // Must be false for optional fields
            },
          },
        };
        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });
        const data = (await res.json()) as any;
        // Extract JSON from the chat completion response
        const text = data?.choices?.[0]?.message?.content || '{}';
        return text;
      },
      catch: (e) => e as Error,
    });

    // Use fetch API directly (SDK approach disabled for now)
    const textEff = viaFetch.pipe(
      Effect.catchAll(() =>
        LLMCoreService.completion(prompt).pipe(Effect.map((r) => r.content))
      )
    );

    // Decode with Effect Schema
    const decoded = Effect.flatMap(textEff, (text) =>
      Effect.try({
        try: () => JSON.parse(text),
        catch: (e) => {
          console.error('Failed to parse JSON:', text, e);
          return {} as unknown;
        },
      }).pipe(
        Effect.flatMap((obj) => Schema.decodeUnknown(effectSchema)(obj)),
        Effect.match({
          onFailure: (error) => {
            console.error('Schema decode failed:', error);
            console.error('Raw text was:', text);
            return { json: {} as T, text: String(text) };
          },
          onSuccess: (value) => ({ json: value, text: String(text) }),
        })
      )
    );
    return decoded as unknown as Effect.Effect<
      { json: T; text: string },
      never,
      never
    >;
  }
}

// AiModel wrapper that delegates to the core service
export class OpenAiEffectModel implements AiModel {
  completion(prompt: unknown): Effect.Effect<{ content: string }, never> {
    const text = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);
    return LLMCoreService.completion(text);
  }

  stream(prompt: unknown): Stream.Stream<any, never> {
    const text = typeof prompt === 'string' ? prompt : JSON.stringify(prompt);
    return LLMCoreService.stream(text);
  }
}

export { DEFAULT_MODEL };

// ============= Effect Service (DI) =============

/**
 * Configuration for LLM service
 */
export interface LLMConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly timeout: number;
  readonly retries: number;
}

/**
 * LLM errors using tagged errors
 */
export class LLMError extends Schema.TaggedError<LLMError>()("LLMError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Unknown)
}) {}

export class LLMConfigError extends Schema.TaggedError<LLMConfigError>()("LLMConfigError", {
  message: Schema.String
}) {}

/**
 * LLM Service interface with proper error types
 */
export interface LLMRuntime {
  completion(prompt: string): Effect.Effect<{ content: string }, LLMError>;

  stream(prompt: string): Stream.Stream<{ content: string }, LLMError>;

  structured<T = unknown>(
    prompt: string,
    effectSchema: Schema.Schema<T>
  ): Effect.Effect<{ json: T; text: string }, LLMError>;
}

/**
 * Service tags for dependency injection
 */
export const LLMService = Context.GenericTag<LLMRuntime>('LLMService');
export const LLMConfigService = Context.GenericTag<LLMConfig>('LLMConfig');

/**
 * Live implementation that requires configuration
 */
export const LLMLive = Layer.effect(
  LLMService,
  Effect.gen(function* () {
    const config = yield* LLMConfigService;

    return {
      completion: (prompt: string) =>
        Effect.gen(function* () {
          const result = yield* LLMCoreService.completion(prompt);
          return result;
        }).pipe(
          Effect.catchAllCause(() =>
            Effect.fail(new LLMError({ message: 'Completion failed' }))
          )
        ),

      stream: (prompt: string) =>
        LLMCoreService.stream(prompt).pipe(
          Stream.catchAllCause(() =>
            Stream.fail(new LLMError({ message: 'Stream failed' }))
          )
        ),

      structured: <T>(prompt: string, schema: Schema.Schema<T>) =>
        Effect.gen(function* () {
          const result = yield* LLMCoreService.structured<T>(prompt, schema);
          return result;
        }).pipe(
          Effect.catchAllCause(() =>
            Effect.fail(new LLMError({ message: 'Structured output failed' }))
          )
        )
    } satisfies LLMRuntime;
  })
);

/**
 * Configuration layer from environment
 */
export const LLMConfigLive = Layer.effect(
  LLMConfigService,
  Effect.gen(function* () {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      yield* Effect.fail(new LLMConfigError({
        message: 'OPENAI_API_KEY environment variable is required'
      }));
    }

    return {
      apiKey: apiKey!,
      model: process.env.OPENAI_MODEL || DEFAULT_MODEL,
      timeout: parseInt(process.env.OPENAI_TIMEOUT || '30000'),
      retries: parseInt(process.env.OPENAI_RETRIES || '3')
    } satisfies LLMConfig;
  })
);

/**
 * Complete layer stack
 */
export const LLMServiceLive = LLMLive.pipe(
  Layer.provide(LLMConfigLive)
);

/**
 * Helper functions for working with the service
 */
export const completion = (prompt: string) =>
  Effect.gen(function* () {
    const service = yield* LLMService;
    return yield* service.completion(prompt);
  });

export const streamCompletion = (prompt: string) =>
  Effect.gen(function* () {
    const service = yield* LLMService;
    return service.stream(prompt);
  }).pipe(Effect.map(s => Stream.flatMap(s, (x) => Stream.succeed(x))));

export const structuredCompletion = <T>(
  prompt: string,
  schema: Schema.Schema<T>
) =>
  Effect.gen(function* () {
    const service = yield* LLMService;
    return yield* service.structured(prompt, schema);
  });

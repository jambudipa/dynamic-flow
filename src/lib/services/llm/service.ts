import { Effect, Context, Stream, Schema, Layer } from 'effect';
import { LLMError, ValidationError } from '../../errors';
import { ConfigService } from '../config/service';
import { ModelPoolService } from '../model-pool/service';

/**
 * LLM Options for completion requests
 */
export interface LLMOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  topK?: number;
  stopSequences?: string[];
  systemPrompt?: string;
  model?: string;
  stream?: boolean;
}

/**
 * Structured output schema type
 */
export type SchemaType<T> = Schema.Schema<T, any, any>;

/**
 * LLM completion response
 */
export interface LLMResponse {
  text: string;
  model: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  metadata?: Record<string, any>;
}

/**
 * LLM Service Interface
 * Uses Context.Tag for multiple provider implementations
 */
export interface LLMService {
  /**
   * Generate text completion
   */
  readonly generateCompletion: (
    prompt: string,
    options?: LLMOptions
  ) => Effect.Effect<LLMResponse, LLMError>;

  /**
   * Generate structured output matching a schema
   */
  readonly generateStructured: <T>(
    prompt: string,
    schema: SchemaType<T>,
    options?: LLMOptions
  ) => Effect.Effect<T, LLMError | ValidationError>;

  /**
   * Stream text completion
   */
  readonly streamCompletion: (
    prompt: string,
    options?: LLMOptions
  ) => Stream.Stream<string, LLMError>;

  /**
   * Get provider name
   */
  readonly getProvider: () => string;

  /**
   * Get available models
   */
  readonly getAvailableModels: () => Effect.Effect<string[], never>;
}

/**
 * LLM Service Tag
 */
export const LLMService = Context.GenericTag<LLMService>('LLMService');

/**
 * OpenAI LLM Service Implementation
 */
export const OpenAILLMService = Layer.effect(
  LLMService,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const modelPool = yield* ModelPoolService;

    const service: LLMService = {
      generateCompletion: (prompt: any, options: any) =>
        Effect.gen(function* () {
          const model = options?.model || 'gpt-5';

          // Get model from pool
          const llmModel = yield* modelPool.acquire(model);

          // Generate completion
          const response = yield* Effect.tryPromise({
            try: async () => {
              // This would call the actual OpenAI API
              // For now, returning mock response
              return {
                text: `OpenAI response to: ${prompt}`,
                model,
                usage: {
                  promptTokens: 100,
                  completionTokens: 50,
                  totalTokens: 150,
                },
              };
            },
            catch: (error) =>
              new LLMError({
                toolId: 'llm',
                provider: 'openai',
                model,
                details: { error, prompt, options },
              }),
          });

          return response;
        }) as Effect.Effect<LLMResponse, LLMError, never>,

      generateStructured: <T>(
        prompt: string,
        schema: SchemaType<T>,
        options?: LLMOptions
      ) =>
        Effect.gen(function* () {
          // Generate with JSON mode
          const jsonOptions = {
            ...options,
            systemPrompt:
              'You must respond with valid JSON matching the provided schema.',
          };

          const response = yield* service.generateCompletion(
            prompt,
            jsonOptions
          );

          // Parse and validate response
          const parsed = yield* Effect.try(() =>
            JSON.parse(response.text)
          ).pipe(
            Effect.mapError(
              (error) =>
                new ValidationError({
                  field: 'response',
                  message: `Failed to parse JSON response: ${error}`,
                })
            )
          );

          // Validate against schema
          const validated = yield* Schema.decodeUnknown(schema)(parsed).pipe(
            Effect.mapError(
              (error) =>
                new ValidationError({
                  field: 'response',
                  message: `Response does not match schema: ${error}`,
                })
            )
          );

          return validated;
        }) as Effect.Effect<T, LLMError | ValidationError, never>,

      streamCompletion: (prompt: any, options: any) =>
        Stream.async<string, LLMError>((emit) => {
          // Simulate streaming
          const words = prompt.split(' ');
          let index = 0;

          const interval = setInterval(() => {
            if (index < words.length) {
              emit.single(`Response to ${words[index]} `);
              index++;
            } else {
              emit.end();
              clearInterval(interval);
            }
          }, 100);

          return Effect.sync(() => clearInterval(interval));
        }),

      getProvider: () => 'openai',

      getAvailableModels: () => Effect.succeed(['gpt-5']),
    };

    return service;
  })
);

/**
 * Anthropic LLM Service Implementation
 */
export const AnthropicLLMService = Layer.effect(
  LLMService,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const modelPool = yield* ModelPoolService;

    const service: LLMService = {
      generateCompletion: (prompt: any, options: any) =>
        Effect.gen(function* () {
          const model = options?.model || 'claude-3-opus';

          // Get model from pool
          const llmModel = yield* modelPool.acquire(model);

          // Generate completion
          const response = yield* Effect.tryPromise({
            try: async () => {
              // This would call the actual Anthropic API
              return {
                text: `Claude response to: ${prompt}`,
                model,
                usage: {
                  promptTokens: 100,
                  completionTokens: 50,
                  totalTokens: 150,
                },
              };
            },
            catch: (error) =>
              new LLMError({
                toolId: 'llm',
                provider: 'anthropic',
                model,
                details: { error },
              }),
          });

          return response;
        }) as Effect.Effect<LLMResponse, LLMError, never>,

      generateStructured: <T>(
        prompt: string,
        schema: SchemaType<T>,
        options?: LLMOptions
      ) =>
        Effect.gen(function* () {
          const response = yield* service.generateCompletion(prompt, {
            ...options,
            systemPrompt:
              'Respond only with valid JSON matching the requested schema.',
          });

          const parsed = yield* Effect.try(() =>
            JSON.parse(response.text)
          ).pipe(
            Effect.mapError(
              (error) =>
                new ValidationError({
                  field: 'response',
                  message: `Failed to parse JSON: ${error}`,
                })
            )
          );

          return yield* Schema.decodeUnknown(schema)(parsed).pipe(
            Effect.mapError(
              (error) =>
                new ValidationError({
                  field: 'response',
                  message: `Invalid schema: ${error}`,
                })
            )
          );
        }) as Effect.Effect<T, LLMError | ValidationError, never>,

      streamCompletion: (prompt: any, options: any) =>
        Stream.async<string, LLMError>((emit) => {
          // Simulate Anthropic streaming
          emit.single('Claude is thinking...');
          setTimeout(() => {
            emit.single(`Response to: ${prompt}`);
            emit.end();
          }, 500);

          return Effect.void;
        }),

      getProvider: () => 'anthropic',

      getAvailableModels: () =>
        Effect.succeed(['claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku']),
    };

    return service;
  })
);

/**
 * Local LLM Service Implementation (for testing or local models)
 */
export const LocalLLMService = Layer.effect(
  LLMService,
  Effect.gen(function* () {
    return LLMService.of({
      generateCompletion: (prompt: any, options: any) =>
        Effect.succeed({
          text: `Local model response to: ${prompt}`,
          model: options?.model || 'local-model',
          usage: {
            promptTokens: 10,
            completionTokens: 10,
            totalTokens: 20,
          },
        }),

      generateStructured: <T>(
        prompt: string,
        schema: SchemaType<T>,
        options?: LLMOptions
      ) =>
        Effect.gen(function* () {
          // Return a default/mock structured response
          const mockData = {} as T;
          return yield* Schema.decodeUnknown(schema)(mockData).pipe(
            Effect.orElse(() => Effect.succeed(mockData))
          );
        }) as unknown as Effect.Effect<T, LLMError | ValidationError, never>,

      streamCompletion: (prompt) =>
        Stream.fromIterable(['Local', ' response', ' to:', ` ${prompt}`]),

      getProvider: () => 'local',

      getAvailableModels: () => Effect.succeed(['local-model']),
    });
  })
);

/**
 * Test LLM Service Implementation
 */
export const TestLLMService = Layer.succeed(
  LLMService,
  LLMService.of({
    generateCompletion: (prompt) =>
      Effect.succeed({
        text: 'test response',
        model: 'test-model',
        usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
      }),

    generateStructured: (prompt: any, schema: any) => Effect.succeed({} as any),

    streamCompletion: () => Stream.fromIterable(['test', ' stream']),

    getProvider: () => 'test',

    getAvailableModels: () => Effect.succeed(['test-model']),
  })
);

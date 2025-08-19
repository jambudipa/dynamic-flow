import { Effect, Schema, Schedule } from 'effect';
import {
  ToolError as ErrorsToolError,
  ValidationError,
  LLMError,
} from '../../errors';
import type {
  Tool,
  ToolMetadata,
  ExecutionContext,
  ToolRequirements,
} from '../../tools/types';
import { ToolError as TypesToolError } from '../../types/errors';
import { ToolRegistryService } from './registry';
import { LLMService } from '../llm/service';

/**
 * Tool configuration for building
 */
export interface ToolConfig<TInput = any, TOutput = any> {
  id: string;
  name: string;
  description: string;
  version?: string;
  inputSchema?: Schema.Schema<TInput>;
  outputSchema?: Schema.Schema<TOutput>;
  execute: (
    input: TInput
  ) => Effect.Effect<TOutput, any> | Promise<TOutput> | TOutput;
  validate?: (
    input: TInput
  ) => Effect.Effect<boolean, ValidationError> | boolean;
  metadata?: ToolMetadata;
}

/**
 * LLM Tool configuration
 */
export interface LLMToolConfig {
  id: string;
  name: string;
  description: string;
  systemPrompt?: string;
  inputSchema?: Schema.Schema<any>;
  outputSchema?: Schema.Schema<any>;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Tool Builder Service
 * Provides utilities for creating and composing tools
 */
export class ToolBuilderService extends Effect.Service<ToolBuilderService>()(
  'ToolBuilderService',
  {
    effect: Effect.gen(function* () {
      const registry = yield* ToolRegistryService;
      const llmService = yield* LLMService;

      return {
        /**
         * Create a tool from configuration
         */
        createTool: <TInput, TOutput>(config: ToolConfig<TInput, TOutput>) =>
          Effect.gen(function* () {
            // Validate configuration
            if (!config.id || !config.name) {
              return yield* Effect.fail(
                new ErrorsToolError({
                  tool: config.id || 'unknown',
                  message: 'Tool ID and name are required',
                  operation: 'createTool',
                })
              );
            }

            // Create tool object
            const tool: Tool<TInput, TOutput> = {
              id: config.id,
              name: config.name,
              description: config.description,
              version: config.version || '1.0.0',

              execute: (
                input: TInput,
                context: ExecutionContext
              ): Effect.Effect<TOutput, TypesToolError, ToolRequirements> => {
                // Wrap execute function in Effect if needed
                const result = config.execute(input);

                if (Effect.isEffect(result)) {
                  return Effect.mapError(
                    result as Effect.Effect<TOutput, any, ToolRequirements>,
                    (error) =>
                      new TypesToolError({
                        toolId: config.id,
                        phase: 'execution',
                        cause: error,
                      })
                  );
                } else if (result instanceof Promise) {
                  return Effect.tryPromise({
                    try: () => result as Promise<TOutput>,
                    catch: (error) =>
                      new TypesToolError({
                        toolId: config.id,
                        phase: 'execution',
                        cause: error,
                      }),
                  });
                } else {
                  return Effect.succeed(result as TOutput);
                }
              },

              inputSchema:
                config.inputSchema || (Schema.Unknown as Schema.Schema<TInput>),
              outputSchema:
                config.outputSchema ||
                (Schema.Unknown as Schema.Schema<TOutput>),
            };

            // Register the tool
            yield* registry.register(tool as Tool<unknown, unknown>);

            return tool;
          }),

        /**
         * Create an LLM-powered tool
         */
        createLLMTool: (config: LLMToolConfig) =>
          Effect.gen(function* () {
            // Validate configuration
            if (!config.id || !config.name) {
              return yield* Effect.fail(
                new ErrorsToolError({
                  tool: config.id || 'unknown',
                  operation: 'llm-tool',
                  message: 'LLM Tool ID and name are required',
                  cause: { config },
                })
              );
            }

            // Create LLM-powered tool
            const tool: Tool<unknown, unknown> = {
              id: config.id,
              name: config.name,
              description: config.description,
              version: '1.0.0',

              execute: (
                input: any,
                context: ExecutionContext
              ): Effect.Effect<any, TypesToolError, ToolRequirements> =>
                Effect.gen(function* () {
                  // Build prompt from input
                  const prompt =
                    typeof input === 'string'
                      ? input
                      : JSON.stringify(input, null, 2);

                  // Generate completion
                  const response = yield* llmService
                    .generateCompletion(prompt, {
                      systemPrompt: config.systemPrompt,
                      model: config.model,
                      temperature: config.temperature,
                      maxTokens: config.maxTokens,
                    })
                    .pipe(
                      Effect.mapError(
                        (error) =>
                          new TypesToolError({
                            toolId: config.id,
                            phase: 'execution',
                            cause: error,
                          })
                      )
                    );

                  // If output schema is defined, parse structured output
                  if (config.outputSchema) {
                    const parsed = yield* Effect.try(() =>
                      JSON.parse(response.text)
                    ).pipe(
                      Effect.mapError(
                        (error) =>
                          new TypesToolError({
                            toolId: config.id,
                            phase: 'cleanup',
                            cause: error,
                            details: {
                              reason: 'Failed to parse LLM response as JSON',
                            },
                          })
                      )
                    );

                    return yield* Schema.decodeUnknown(config.outputSchema)(
                      parsed
                    ).pipe(
                      Effect.mapError(
                        (error) =>
                          new TypesToolError({
                            toolId: config.id,
                            phase: 'cleanup',
                            cause: error,
                            details: {
                              reason:
                                'LLM response does not match output schema',
                            },
                          })
                      )
                    );
                  }

                  return response.text;
                }),

              inputSchema: config.inputSchema || Schema.Unknown,
              outputSchema: config.outputSchema || Schema.Unknown,
            };

            // Register the tool
            yield* registry.register(tool as Tool<unknown, unknown>);

            return tool;
          }),

        /**
         * Create a tool from a simple function
         */
        fromFunction: <T, R>(
          fn: (input: T) => R,
          metadata: ToolMetadata & {
            id: string;
            name: string;
            description?: string;
          }
        ) =>
          Effect.gen(function* () {
            const tool: Tool<unknown, unknown> = {
              id: metadata.id,
              name: metadata.name,
              description:
                metadata.description || `Function tool: ${metadata.name}`,
              version: '1.0.0',

              execute: (
                input: unknown,
                context: ExecutionContext
              ): Effect.Effect<unknown, TypesToolError, ToolRequirements> =>
                Effect.sync(() => fn(input as T)),

              inputSchema: Schema.Unknown,
              outputSchema: Schema.Unknown,
            };

            yield* registry.register(tool);

            return tool;
          }),

        /**
         * Compose multiple tools into a pipeline
         */
        compose: (
          tools: Tool[],
          metadata?: { id: string; name: string; description?: string }
        ) =>
          Effect.gen(function* () {
            if (tools.length === 0) {
              return yield* Effect.fail(
                new ErrorsToolError({
                  tool: metadata?.id || 'unknown',
                  operation: 'tool-composition',
                  message: 'Cannot compose empty tool array',
                  cause: {},
                })
              );
            }

            const composedTool: Tool<unknown, unknown> = {
              id: metadata?.id || `composed-${Date.now()}`,
              name: metadata?.name || 'Composed Tool',
              description:
                metadata?.description || `Composition of ${tools.length} tools`,
              version: '1.0.0',

              execute: (input: any, context: ExecutionContext) =>
                Effect.reduce(tools, input, (currentInput, tool) =>
                  tool.execute(currentInput, context)
                ),

              inputSchema: Schema.Unknown,
              outputSchema: Schema.Unknown,
            };

            yield* registry.register(composedTool);

            return composedTool;
          }),

        /**
         * Create a tool with retry logic
         */
        withRetry: <T extends Tool>(
          tool: T,
          maxRetries: number = 3,
          backoff: number = 1000
        ) =>
          Effect.gen(function* () {
            const retryTool: Tool<unknown, unknown> = {
              ...tool,
              id: `${tool.id}-retry`,
              name: `${tool.name} (with retry)`,

              execute: (input: any, context: ExecutionContext) =>
                Effect.retry(
                  tool.execute(input, context),
                  Schedule.recurs(maxRetries).pipe(
                    Schedule.addDelay(() => backoff)
                  )
                ),
            };

            yield* registry.register(retryTool);

            return retryTool;
          }),

        /**
         * Create a tool with caching
         */
        withCache: <T extends Tool>(tool: T, ttl: number = 60000) =>
          Effect.gen(function* () {
            const cache = new Map<string, { value: any; expiry: number }>();

            const cachedTool: Tool<unknown, unknown> = {
              ...tool,
              id: `${tool.id}-cached`,
              name: `${tool.name} (cached)`,

              execute: (input: any, context: ExecutionContext) =>
                Effect.gen(function* () {
                  const key = JSON.stringify(input);
                  const cached = cache.get(key);

                  if (cached && cached.expiry > Date.now()) {
                    return cached.value;
                  }

                  const result = yield* tool.execute(input, context);
                  cache.set(key, {
                    value: result,
                    expiry: Date.now() + ttl,
                  });

                  return result;
                }),
            };

            yield* registry.register(cachedTool);

            return cachedTool;
          }),
      };
    }),
  }
) {}

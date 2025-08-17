/**
 * LLM Tool Adapter
 * Wraps LLM calls as standard DynamicFlow tools
 */

import { Data, Duration, Effect, pipe, Schema } from 'effect';
import type { ExecutionContext } from '@/types';
import type {
  LLMConfig,
  LLMTool,
  Tool,
  ToolConfig,
  ToolError,
  ToolRequirements,
} from './types';
import { ParseError, ToolSchemas } from './types';
import { ToolError as ToolErrorClass } from '../types/errors';

// ============= LLM Provider Interface =============

/**
 * Abstract LLM provider interface
 */
export interface LLMProvider {
  readonly name: string;

  complete(
    prompt: string,
    config: LLMConfig
  ): Effect.Effect<LLMResponse, LLMProviderError>;

  stream(
    prompt: string,
    config: LLMConfig
  ): Effect.Effect<AsyncIterable<string>, LLMProviderError>;
}

/**
 * LLM response structure
 */
export interface LLMResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model?: string;
  finishReason?: string;
}

/**
 * LLM provider error
 */
export class LLMProviderError extends Data.TaggedError('LLMProviderError')<{
  readonly message: string;
  readonly provider: string;
  readonly cause?: unknown;
  readonly model?: string;
  readonly requestId?: string;
}> {
  get displayMessage(): string {
    const model = this.model ? ` (model: ${this.model})` : '';
    const requestId = this.requestId ? ` [${this.requestId}]` : '';
    const cause = this.cause ? ` (caused by: ${this.cause})` : '';
    return `LLM provider '${this.provider}' error${model}${requestId}${cause}: ${this.message}`;
  }
}

// ============= LLM Tool Builder =============

/**
 * Builder for creating LLM tools
 */
export class LLMToolBuilder<TInput = unknown, TOutput = unknown> {
  private tool: Partial<LLMTool<TInput, TOutput>> = {};
  private provider?: LLMProvider;

  constructor(id: string) {
    this.tool.id = id;
    this.tool.category = 'llm';
  }

  name(name: string): this {
    this.tool.name = name;
    return this;
  }

  description(description: string): this {
    this.tool.description = description;
    return this;
  }

  model(model: string): this {
    if (!this.tool.llmConfig) {
      this.tool.llmConfig = { model };
    } else {
      this.tool.llmConfig.model = model;
    }
    return this;
  }

  temperature(temperature: number): this {
    if (!this.tool.llmConfig) {
      this.tool.llmConfig = { model: 'gpt-5', temperature };
    } else {
      this.tool.llmConfig.temperature = temperature;
    }
    return this;
  }

  maxTokens(maxTokens: number): this {
    if (!this.tool.llmConfig) {
      this.tool.llmConfig = { model: 'gpt-5', maxTokens };
    } else {
      this.tool.llmConfig.maxTokens = maxTokens;
    }
    return this;
  }

  systemPrompt(prompt: string): this {
    if (!this.tool.llmConfig) {
      this.tool.llmConfig = { model: 'gpt-5', systemPrompt: prompt };
    } else {
      this.tool.llmConfig.systemPrompt = prompt;
    }
    return this;
  }

  llmConfig(config: LLMConfig): this {
    this.tool.llmConfig = config;
    return this;
  }

  input<T>(schema: Schema.Schema<T>): LLMToolBuilder<T, TOutput> {
    (this.tool as Partial<LLMTool<any, any>>).inputSchema =
      schema as Schema.Schema<any>;
    return this as unknown as LLMToolBuilder<T, TOutput>;
  }

  output<T>(schema: Schema.Schema<T>): LLMToolBuilder<TInput, T> {
    (this.tool as Partial<LLMTool<any, any>>).outputSchema =
      schema as Schema.Schema<any>;
    return this as unknown as LLMToolBuilder<TInput, T>;
  }

  promptTemplate(template: (input: TInput) => string): this {
    this.tool.promptTemplate = template;
    return this;
  }

  parseResponse(
    parser: (response: string) => Effect.Effect<TOutput, ParseError>
  ): this {
    this.tool.parseResponse = parser;
    return this;
  }

  config(config: ToolConfig): this {
    this.tool.config = config;
    return this;
  }

  withProvider(provider: LLMProvider): this {
    this.provider = provider;
    return this;
  }

  build(): LLMTool<TInput, TOutput> {
    if (!this.tool.id || !this.tool.name || !this.tool.llmConfig) {
      throw new Error('Incomplete LLM tool definition');
    }

    // Set defaults
    if (!this.tool.inputSchema) {
      this.tool.inputSchema =
        ToolSchemas.PromptInput as unknown as Schema.Schema<TInput>;
    }
    if (!this.tool.outputSchema) {
      this.tool.outputSchema =
        ToolSchemas.LLMOutput as unknown as Schema.Schema<TOutput>;
    }
    if (!this.tool.promptTemplate) {
      this.tool.promptTemplate = (input: TInput) =>
        typeof (input as unknown) === 'string'
          ? (input as unknown as string)
          : (input as any).prompt || JSON.stringify(input);
    }
    if (!this.tool.parseResponse) {
      this.tool.parseResponse = (response: string) =>
        Effect.succeed({ response } as unknown as TOutput);
    }

    // Create execute function
    const provider = this.provider;
    const llmConfig = this.tool.llmConfig;
    const promptTemplate = this.tool.promptTemplate;
    const parseResponse = this.tool.parseResponse;

    this.tool.execute = (input: TInput, _context: ExecutionContext) => {
      if (!provider) {
        return Effect.fail(
          new ToolErrorClass({
            toolId: this.tool.id!,
            phase: 'execution' as const,
            cause: 'No LLM provider configured',
          })
        ) as unknown as Effect.Effect<TOutput, ToolError, ToolRequirements>;
      }

      return pipe(
        Effect.succeed(promptTemplate(input)),
        Effect.flatMap((prompt) => provider.complete(prompt, llmConfig)),
        Effect.flatMap((response) => parseResponse(response.content)),
        Effect.mapError(
          (error) =>
            new ToolErrorClass({
              toolId: this.tool.id!,
              phase: 'execution' as const,
              cause: error,
            })
        )
      ) as Effect.Effect<TOutput, ToolError, ToolRequirements>;
    };

    return this.tool as LLMTool<TInput, TOutput>;
  }
}

/**
 * Create a new LLM tool builder
 */
export const llmTool = (id: string): LLMToolBuilder => new LLMToolBuilder(id);

// ============= Common LLM Tools =============

/**
 * Create a simple text completion tool
 */
export const createCompletionTool = (
  id: string,
  provider: LLMProvider,
  config?: Partial<LLMConfig>
): LLMTool<{ prompt: string }, { response: string }> => {
  return llmTool(id)
    .name(`${id}_completion`)
    .description('Generate text completion using LLM')
    .llmConfig({
      model: config?.model || 'gpt-5',
      temperature: config?.temperature || 0.7,
      maxTokens: config?.maxTokens || 1000,
      ...config,
    })
    .input(Schema.Struct({ prompt: Schema.String }))
    .output(Schema.Struct({ response: Schema.String }))
    .promptTemplate((input) => input.prompt)
    .parseResponse((response) => Effect.succeed({ response }))
    .withProvider(provider)
    .build();
};

/**
 * Create a JSON extraction tool
 */
export const createJSONExtractionTool = <T>(
  id: string,
  provider: LLMProvider,
  outputSchema: Schema.Schema<T>,
  config?: Partial<LLMConfig>
): LLMTool<
  { readonly text: string; readonly schema?: string | undefined },
  T
> => {
  return llmTool(id)
    .name(`${id}_json_extraction`)
    .description('Extract structured JSON from text using LLM')
    .llmConfig({
      model: config?.model || 'gpt-5',
      temperature: 0,
      responseFormat: 'json',
      ...config,
    })
    .input(
      Schema.Struct({
        text: Schema.String,
        schema: Schema.optional(Schema.String),
      })
    )
    .output(outputSchema)
    .promptTemplate(
      (input) =>
        `Extract structured data from the following text according to the schema.
      ${input.schema ? `Schema: ${input.schema}` : ''}
      Text: ${input.text}
      Return only valid JSON.`
    )
    .parseResponse((response) =>
      Effect.try({
        try: () => JSON.parse(response) as T,
        catch: (error) =>
          new ParseError({
            response: response,
            message: `Failed to parse JSON response: ${String(error)}`,
          }),
      }).pipe(
        Effect.flatMap((data) => Schema.decodeUnknown(outputSchema)(data)),
        Effect.mapError(
          (error) =>
            new ParseError({
              response: response,
              message: `Response doesn't match schema: ${String(error)}`,
            })
        )
      )
    )
    .withProvider(provider)
    .build();
};

/**
 * Create a classification tool
 */
export const createClassificationTool = (
  id: string,
  provider: LLMProvider,
  categories: string[],
  config?: Partial<LLMConfig>
): LLMTool<{ text: string }, { category: string; confidence: number }> => {
  return llmTool(id)
    .name(`${id}_classification`)
    .description('Classify text into predefined categories')
    .llmConfig({
      model: config?.model || 'gpt-5',
      temperature: 0,
      ...config,
    })
    .input(Schema.Struct({ text: Schema.String }))
    .output(
      Schema.Struct({
        category: Schema.String,
        confidence: Schema.Number,
      })
    )
    .promptTemplate(
      (input) =>
        `Classify the following text into one of these categories: ${categories.join(', ')}
      Text: ${input.text}
      Return a JSON object with "category" and "confidence" (0-1) fields.`
    )
    .parseResponse((response) =>
      Effect.try({
        try: () => {
          const data = JSON.parse(response);
          if (!categories.includes(data.category)) {
            throw new Error(`Invalid category: ${data.category}`);
          }
          return data;
        },
        catch: (error) =>
          new ParseError({
            response: response,
            message: `Failed to parse classification: ${error}`,
          }),
      })
    )
    .withProvider(provider)
    .build();
};

/**
 * Create a summarization tool
 */
export const createSummarizationTool = (
  id: string,
  provider: LLMProvider,
  config?: Partial<LLMConfig> & { maxLength?: number }
): LLMTool<
  { readonly text: string; readonly style?: string | undefined },
  { readonly summary: string }
> => {
  return llmTool(id)
    .name(`${id}_summarization`)
    .description('Summarize text content')
    .llmConfig({
      model: config?.model || 'gpt-5',
      temperature: 0.3,
      maxTokens: config?.maxLength || 500,
      ...config,
    })
    .input(
      Schema.Struct({
        text: Schema.String,
        style: Schema.optional(Schema.String),
      })
    )
    .output(Schema.Struct({ summary: Schema.String }))
    .promptTemplate(
      (input) =>
        `Summarize the following text${input.style ? ` in a ${input.style} style` : ''}:
      ${input.text}`
    )
    .parseResponse((response) => Effect.succeed({ summary: response }))
    .withProvider(provider)
    .build();
};

/**
 * Create a comparison tool
 */
export const createComparisonTool = (
  id: string,
  provider: LLMProvider,
  config?: Partial<LLMConfig>
): LLMTool<
  {
    readonly a: string;
    readonly b: string;
    readonly criteria?: string | undefined;
  },
  {
    readonly comparison: string;
    readonly similarities: ReadonlyArray<string>;
    readonly differences: ReadonlyArray<string>;
  }
> => {
  return llmTool(id)
    .name(`${id}_comparison`)
    .description('Compare two texts or concepts')
    .llmConfig({
      model: config?.model || 'gpt-5',
      temperature: 0.5,
      ...config,
    })
    .input(
      Schema.Struct({
        a: Schema.String,
        b: Schema.String,
        criteria: Schema.optional(Schema.String),
      })
    )
    .output(
      Schema.Struct({
        comparison: Schema.String,
        similarities: Schema.Array(Schema.String),
        differences: Schema.Array(Schema.String),
      })
    )
    .promptTemplate(
      (input) =>
        `Compare the following two items${input.criteria ? ` based on: ${input.criteria}` : ''}:
      
      Item A: ${input.a}
      Item B: ${input.b}
      
      Return a JSON object with:
      - "comparison": overall comparison summary
      - "similarities": array of key similarities
      - "differences": array of key differences`
    )
    .parseResponse((response) =>
      Effect.try({
        try: () => JSON.parse(response),
        catch: (error) =>
          new ParseError({
            response: response,
            message: `Failed to parse comparison: ${error}`,
          }),
      })
    )
    .withProvider(provider)
    .build();
};

// ============= LLM Tool Wrapper =============

/**
 * Wrap any function as an LLM-powered tool
 */
export const wrapWithLLM = <TInput, TOutput>(
  baseTool: Tool<TInput, TOutput>,
  provider: LLMProvider,
  config?: {
    preProcess?: (input: TInput) => string;
    postProcess?: (
      llmOutput: string,
      originalInput: TInput
    ) => Effect.Effect<TOutput, ParseError>;
    llmConfig?: LLMConfig;
  }
): LLMTool<TInput, TOutput> => {
  const llmConfig = config?.llmConfig || { model: 'gpt-5' };

  return {
    ...baseTool,
    id: `${baseTool.id}_llm`,
    name: `${baseTool.name} (LLM-enhanced)`,
    description: `${baseTool.description} with LLM processing`,
    category: 'llm',
    llmConfig,
    promptTemplate:
      config?.preProcess || ((input: TInput) => JSON.stringify(input)),
    parseResponse: config?.postProcess
      ? (response: string) => config.postProcess!(response, {} as TInput)
      : (response: string) => Effect.succeed(JSON.parse(response) as TOutput),
    execute: (input: TInput, _context: ExecutionContext) => {
      const prompt = config?.preProcess
        ? config.preProcess(input)
        : JSON.stringify(input);

      return pipe(
        provider.complete(prompt, llmConfig),
        Effect.flatMap((response) =>
          config?.postProcess
            ? config.postProcess(response.content, input)
            : Effect.succeed(JSON.parse(response.content) as TOutput)
        ),
        Effect.mapError(
          (error) =>
            new ToolErrorClass({
              toolId: baseTool.id,
              phase: 'execution' as const,
              cause: error,
            })
        )
      );
    },
  };
};

// ============= Tool Chain Builder =============

/**
 * Chain multiple LLM tools together
 */
export const chainLLMTools = <A, B, C>(
  first: LLMTool<A, B>,
  second: LLMTool<B, C>
): LLMTool<A, C> => ({
  id: `${first.id}_chain_${second.id}`,
  name: `${first.name} → ${second.name}`,
  description: `Chain of ${first.name} and ${second.name}`,
  category: 'llm',
  inputSchema: first.inputSchema,
  outputSchema: second.outputSchema,
  llmConfig: second.llmConfig, // Use second tool's config
  promptTemplate: first.promptTemplate,
  parseResponse: second.parseResponse,
  config: {
    timeout: Duration.sum(
      first.config?.timeout || Duration.seconds(30),
      second.config?.timeout || Duration.seconds(30)
    ),
  },
  execute: (input: A, _context: ExecutionContext) =>
    Effect.gen(function* () {
      const firstResult = yield* first.execute(input, _context);
      return yield* second.execute(firstResult, _context);
    }),
});

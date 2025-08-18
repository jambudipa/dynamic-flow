/**
 * Tool System Types
 *
 * Purpose: Define the canonical shapes and behaviors for tools, including
 * runtime configuration (timeouts, retries, rate limits), metadata, and
 * LLM-specific extension points.
 *
 * How it fits in:
 * - The `ToolRegistry` stores and validates `Tool`/`LLMTool` instances.
 * - The execution engine calls `execute()` with an `ExecutionContext`.
 * - Generators and validators use schemas to ensure type-safe composition.
 */

import { Data, Duration, Effect, Schema } from 'effect';
import type { ExecutionContext, ToolError, ToolRequirements } from '@/lib/types';

// Re-export for backwards compatibility
export type { ToolError, ToolRequirements, ExecutionContext } from '@/lib/types';

// ============= Type Constraints =============

/**
 * Base constraint for tool input/output types.
 * Must be serializable for schema validation and JSON transport.
 * More flexible than strict JsonValue to allow optional properties and unknown types.
 */
export type ToolDataType = unknown;

/**
 * Untyped tool for when specific input/output types are not known at compile time.
 * Commonly used in registries and dynamic contexts.
 */
export type UntypedTool = Tool<any, any>;

/**
 * Array of untyped tools - accepts any tool types
 */
export type UntypedToolArray = ReadonlyArray<Tool<any, any>>;

/**
 * Tool map for registries and contexts
 */
export type ToolMap = Map<string, Tool<any, any>>;

// ============= Tool Configuration =============

/** Configuration for retry/backoff policies during tool execution. */
export interface RetryConfig {
  maxAttempts: number;
  backoff: 'exponential' | 'linear' | 'fixed';
  initialDelay: Duration.Duration;
  maxDelay?: Duration.Duration | undefined;
  jitter?: boolean | undefined;
}

/** Rate-limiting configuration for tools that call external services. */
export interface RateLimitConfig {
  maxCalls: number;
  windowMs: number;
  strategy: 'sliding' | 'fixed';
}

/**
 * Tool execution configuration (timeouts, caching, approvals, concurrency).
 * @remarks Most fields are optional; sensible defaults can be provided by
 * registry or runner.
 */
export interface ToolConfig {
  timeout?: Duration.Duration | undefined;
  retry?: RetryConfig | undefined;
  rateLimit?: RateLimitConfig | undefined;
  requiresApproval?: boolean | undefined;
  cacheable?: boolean | undefined;
  cacheTTL?: Duration.Duration | undefined;
  concurrencyLimit?: number | undefined;
}

// ============= Tool Definition =============

/**
 * Tool definition: a typed command with input/output schemas and runtime
 * behavior under `execute()`.
 * @template TInput Tool input type validated by `inputSchema`. Must be serializable.
 * @template TOutput Tool output type validated by `outputSchema`. Must be serializable.
 * @remarks The `execute()` implementation should be pure-Effect (no thrown
 * errors) and surface failures via the error channel.
 */
export interface Tool<
  TInput extends ToolDataType = ToolDataType,
  TOutput extends ToolDataType = ToolDataType,
> {
  id: string;
  name: string;
  description: string;
  category?: string | undefined;
  version?: string | undefined;
  inputSchema: Schema.Schema<TInput>;
  outputSchema: Schema.Schema<TOutput>;
  config?: ToolConfig | undefined;
  execute: (
    input: TInput,
    context: ExecutionContext
  ) => Effect.Effect<TOutput, ToolError, ToolRequirements>;
}

// Note: ToolRequirements is now imported from @/types to avoid duplication

// ============= LLM Tool Specific =============

/**
 * LLM-specific tool configuration (model, temperature, streaming, etc.).
 */
export interface LLMConfig {
  model: string;
  temperature?: number | undefined;
  maxTokens?: number | undefined;
  topP?: number | undefined;
  frequencyPenalty?: number | undefined;
  presencePenalty?: number | undefined;
  systemPrompt?: string | undefined;
  responseFormat?: 'text' | 'json' | undefined;
  stream?: boolean | undefined;
}

/**
 * LLM tool extends base `Tool` with LLM-specific config and optional
 * prompt/parse helpers.
 */
export interface LLMTool<
  TInput extends ToolDataType = ToolDataType,
  TOutput extends ToolDataType = ToolDataType,
> extends Tool<TInput, TOutput> {
  llmConfig: LLMConfig;
  promptTemplate?: ((input: TInput) => string) | undefined;
  parseResponse?:
    | ((response: string) => Effect.Effect<TOutput, ParseError>)
    | undefined;
}

// ============= Tool Metadata =============

/**
 * Execution metadata collected around each tool invocation.
 */
export interface ToolMetadata {
  executionId: string;
  startTime: Date;
  endTime?: Date | undefined;
  duration?: number | undefined;
  retryCount?: number | undefined;
  cacheHit?: boolean | undefined;
  error?: ToolError | undefined;
}

/**
 * Result wrapper around the tool’s output value including metadata and
 * optional telemetry.
 */
export interface ToolResult<T = unknown> {
  value: T;
  metadata: ToolMetadata;
  logs?: string[] | undefined;
  metrics?: Record<string, number> | undefined;
}

// ============= Tool Registry Interface =============

/**
 * Registry interface: what a registry must implement to store, validate,
 * and retrieve tools for execution.
 */
export interface ToolRegistry {
  /** Register a new tool */
  register<TInput, TOutput>(
    tool: Tool<TInput, TOutput>
  ): Effect.Effect<void, RegistrationError>;

  /** Register an LLM tool */
  registerLLM<TInput, TOutput>(
    tool: LLMTool<TInput, TOutput>
  ): Effect.Effect<void, RegistrationError>;

  /** Get a tool by ID */
  get(id: string): Effect.Effect<Tool<unknown, unknown>, ToolNotFoundError>;

  /** Get an LLM tool by ID */
  getLLM(
    id: string
  ): Effect.Effect<LLMTool<unknown, unknown>, ToolNotFoundError>;

  /** Check if a tool exists */
  has(id: string): Effect.Effect<boolean>;

  /** List all registered tools */
  list(): Effect.Effect<Tool<unknown, unknown>[]>;

  /** List tools by category */
  listByCategory(category: string): Effect.Effect<Tool<unknown, unknown>[]>;

  /** Unregister a tool */
  unregister(id: string): Effect.Effect<void, ToolNotFoundError>;

  /** Clear all registered tools */
  clear(): Effect.Effect<void>;

  /** Validate tool input */
  validateInput(
    toolId: string,
    input: unknown
  ): Effect.Effect<void, ValidationError>;

  /** Validate tool output */
  validateOutput(
    toolId: string,
    output: unknown
  ): Effect.Effect<void, ValidationError>;
}

// ============= Tool Executor Interface =============

/**
 * Tool executor abstraction: a runner capable of executing tools according
 * to policies (timeouts, parallelism) and returning rich `ToolResult`s.
 */
export interface ToolExecutor {
  /** Execute a tool with the given input */
  execute<TInput, TOutput>(
    tool: Tool<TInput, TOutput>,
    input: TInput,
    context: ExecutionContext
  ): Effect.Effect<ToolResult<TOutput>, ToolError>;

  /** Execute an LLM tool */
  executeLLM<TInput, TOutput>(
    tool: LLMTool<TInput, TOutput>,
    input: TInput,
    context: ExecutionContext
  ): Effect.Effect<ToolResult<TOutput>, ToolError>;

  /** Execute multiple tools in parallel */
  executeParallel(
    executions: Array<{
      tool: Tool<unknown, unknown>;
      input: unknown;
    }>,
    context: ExecutionContext
  ): Effect.Effect<ToolResult<unknown>[], ToolError>;

  /** Execute with timeout */
  executeWithTimeout<TInput, TOutput>(
    tool: Tool<TInput, TOutput>,
    input: TInput,
    context: ExecutionContext,
    timeout: Duration.Duration
  ): Effect.Effect<ToolResult<TOutput>, ToolError | TimeoutError>;
}

// ============= Error Types =============
// Note: ToolError is imported from @/types to avoid duplication

export class RegistrationError extends Data.TaggedError('RegistrationError')<{
  readonly message: string;
  readonly toolId: string;
  readonly reason?: string;
}> {
  get displayMessage(): string {
    const reason = this.reason ? ` (${this.reason})` : '';
    return `Tool registration failed for '${this.toolId}'${reason}: ${this.message}`;
  }
}

export class ToolNotFoundError extends Data.TaggedError('ToolNotFoundError')<{
  readonly toolId: string;
  readonly context?: string;
}> {
  get displayMessage(): string {
    const context = this.context ? ` in ${this.context}` : '';
    return `Tool '${this.toolId}' not found${context}`;
  }
}

export class ValidationError extends Data.TaggedError('ValidationError')<{
  readonly message: string;
  readonly toolId: string;
  readonly field?: string;
  readonly value?: unknown;
  readonly expected?: string;
}> {
  get displayMessage(): string {
    const field = this.field ? ` for field '${this.field}'` : '';
    const expected = this.expected ? ` (expected: ${this.expected})` : '';
    return `Validation failed for tool '${this.toolId}'${field}${expected}: ${this.message}`;
  }
}

export class ParseError extends Data.TaggedError('ParseError')<{
  readonly message: string;
  readonly response: string;
  readonly expectedFormat?: string;
  readonly toolId?: string;
}> {
  get displayMessage(): string {
    const tool = this.toolId ? ` in tool '${this.toolId}'` : '';
    const format = this.expectedFormat
      ? ` (expected: ${this.expectedFormat})`
      : '';
    return `Parse error${tool}${format}: ${this.message}`;
  }
}

export class TimeoutError extends Data.TaggedError('TimeoutError')<{
  readonly toolId: string;
  readonly duration: Duration.Duration;
  readonly operation?: string;
}> {
  get displayMessage(): string {
    const operation = this.operation ? ` during ${this.operation}` : '';
    return `Tool '${this.toolId}' timed out${operation} after ${Duration.toMillis(this.duration)}ms`;
  }
}

export class ApprovalRequiredError extends Data.TaggedError(
  'ApprovalRequiredError'
)<{
  readonly toolId: string;
  readonly input: unknown;
  readonly reason?: string;
}> {
  get displayMessage(): string {
    const reason = this.reason ? ` (${this.reason})` : '';
    return `Tool '${this.toolId}' requires approval${reason}`;
  }
}

// ============= Tool Join Types =============

/**
 * Join definition to transform output of one tool into input for another
 * using `Schema.transform`.
 */
export interface ToolJoin<From, To, R = never> {
  fromTool: string;
  toTool: string;
  transform: Schema.Schema<To, From, R>;
}

// ============= Tool Builder Helpers =============

/**
 * Fluent builder to define a `Tool` instance with a readable, chainable API.
 * @remarks Encourages explicit naming, categorization, schemas, and a pure
 * `execute` function for consistent behavior.
 */
export class ToolBuilder<TInput = unknown, TOutput = unknown> {
  private tool: Partial<Tool<any, any>> = {};

  constructor(id: string) {
    this.tool.id = id;
  }

  name(name: string): this {
    this.tool.name = name;
    return this;
  }

  description(description: string): this {
    this.tool.description = description;
    return this;
  }

  category(category: string): this {
    this.tool.category = category;
    return this;
  }

  input<TNew extends ToolDataType>(
    schema: Schema.Schema<TNew>
  ): ToolBuilder<TNew, TOutput> {
    this.tool.inputSchema = schema;
    return this as unknown as ToolBuilder<TNew, TOutput>;
  }

  output<TNew extends ToolDataType>(
    schema: Schema.Schema<TNew>
  ): ToolBuilder<TInput, TNew> {
    this.tool.outputSchema = schema;
    return this as unknown as ToolBuilder<TInput, TNew>;
  }

  config(config: ToolConfig): this {
    this.tool.config = config;
    return this;
  }

  execute(
    fn: (
      input: TInput,
      context: ExecutionContext
    ) => Effect.Effect<TOutput, ToolError, ToolRequirements>
  ): this {
    this.tool.execute = fn as unknown as Tool<any, any>['execute'];
    return this;
  }

  build(): Tool<TInput, TOutput> {
    if (
      !this.tool.id ||
      !this.tool.name ||
      !this.tool.inputSchema ||
      !this.tool.outputSchema ||
      !this.tool.execute
    ) {
      throw new Error('Incomplete tool definition');
    }
    return this.tool as unknown as Tool<TInput, TOutput>;
  }
}

/** Create an untyped tool builder (use when inferring types is desirable). */
export const tool = (id: string): ToolBuilder => new ToolBuilder(id);
/** Create a typed tool builder (enforce TInput/TOutput on the chain). */
export const typedTool = <TInput = unknown, TOutput = unknown>(
  id: string
): ToolBuilder<TInput, TOutput> => new ToolBuilder<TInput, TOutput>(id);

// ============= Common Tool Schemas =============

/**
 * Frequently used schemas for building small tools quickly.
 */
export namespace ToolSchemas {
  export const StringInput = Schema.Struct({
    value: Schema.String,
  });

  export const StringOutput = Schema.Struct({
    result: Schema.String,
  });

  export const JSONInput = Schema.Struct({
    data: Schema.Unknown,
  });

  export const JSONOutput = Schema.Struct({
    result: Schema.Unknown,
  });

  export const PromptInput = Schema.Struct({
    prompt: Schema.String,
    context: Schema.optional(Schema.Unknown), // Use Unknown for flexible context
  });

  export const LLMOutput = Schema.Struct({
    response: Schema.String,
    usage: Schema.optional(
      Schema.Struct({
        promptTokens: Schema.Number,
        completionTokens: Schema.Number,
        totalTokens: Schema.Number,
      })
    ),
  });
}

// ============= Tool Composition =============

/** Compose two tools sequentially; output of the first becomes input of the second. */
export const composeTool = <A, B, C>(
  first: Tool<A, B>,
  second: Tool<B, C>
): Tool<A, C> => ({
  id: `${first.id}_then_${second.id}`,
  name: `${first.name} → ${second.name}`,
  description: `Composition of ${first.name} and ${second.name}`,
  inputSchema: first.inputSchema,
  outputSchema: second.outputSchema,
  config: {
    timeout: Duration.sum(
      first.config?.timeout || Duration.seconds(30),
      second.config?.timeout || Duration.seconds(30)
    ),
  },
  execute: (input: A, context: ExecutionContext) =>
    Effect.gen(function* () {
      const firstResult = yield* first.execute(input, context);
      const secondResult = yield* second.execute(firstResult, context);
      return secondResult;
    }),
});

/** Create a composite tool that executes multiple tools in parallel. */
export const parallelTool = <T>(
  tools: Tool<T, unknown>[]
): Tool<T, ReadonlyArray<unknown>> => ({
  id: `parallel_${tools.map((t) => t.id).join('_')}`,
  name: `Parallel execution of ${tools.length} tools`,
  description: `Executes ${tools.map((t) => t.name).join(', ')} in parallel`,
  inputSchema: tools[0]!.inputSchema,
  outputSchema: Schema.Array(Schema.Unknown),
  config: {
    timeout: tools
      .map((t) => t.config?.timeout || Duration.seconds(30))
      .reduce(
        (max, current) => (Duration.greaterThan(current, max) ? current : max),
        Duration.seconds(30)
      ),
  },
  execute: (input: T, context: ExecutionContext) =>
    Effect.all(tools.map((tool) => tool.execute(input, context))),
});

// ============= Extended Tool Types (from types/tools.ts) =============

/**
 * ExecutableType: categories of executables supported by the system.
 */
export enum ExecutableType {
  TOOL = 'tool',
  FLOW_EFFECT = 'flow_effect',
  LLM_TOOL = 'llm_tool',
  USER_INPUT_TOOL = 'user_input_tool',
  FLOW = 'flow', // Added for compatibility
}

/**
 * Executable: richer tool contract enabling validation, metadata and
 * conversion to FlowEffect.
 */
export interface Executable<TInput = unknown, TOutput = unknown>
  extends Tool<TInput, TOutput> {
  /** Tool type for categorization */
  readonly type?: ExecutableType;

  /**
   * Validate input data against the schema
   */
  validate(input: TInput): import('@/lib/types').ValidationResult<TInput>;

  /**
   * Get metadata about this executable
   */
  getMetadata(): ExecutableMetadata;

  /**
   * Convert this Executable to a FlowEffect for seamless integration
   */
  asFlowEffect(
    input?: TInput
  ): import('@/lib/types').FlowEffect<
    TOutput,
    import('@/lib/types').FlowError,
    import('@/lib/types').FlowContext
  >;
}

/**
 * Metadata about an executable entity
 */
export interface ExecutableMetadata {
  /** Human-readable name */
  readonly name: string;
  /** Detailed description */
  readonly description: string;
  /** Version identifier */
  readonly version: string;
  /** Optional author information */
  readonly author?: string;
  /** Tags for categorisation */
  readonly tags: string[];
  /** Estimated execution duration in milliseconds */
  readonly estimatedDuration?: number;
  /** Resource requirements for execution */
  readonly resourceRequirements?: import('@/lib/types').ResourceRequirements;
}

/** Type guard to detect an `Executable` at runtime. */
export const isExecutable = <TInput, TOutput>(
  value: unknown
): value is Executable<TInput, TOutput> => {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof (v as { execute?: unknown }).execute === 'function' &&
    typeof (v as { validate?: unknown }).validate === 'function' &&
    typeof (v as { getMetadata?: unknown }).getMetadata === 'function' &&
    typeof (v as { asFlowEffect?: unknown }).asFlowEffect === 'function'
  );
};

/**
 * LegacyTool: pre-v2 tool shape retained for migration purposes.
 * @deprecated Use Tool instead.
 */
export interface LegacyTool<TInput = unknown, TOutput = unknown> {
  id: string;
  schema?: {
    input?: Schema.Schema<TInput>;
    output?: Schema.Schema<TOutput>;
    description?: string;
  };

  execute(input: TInput, context?: Partial<ExecutionContext>): Promise<TOutput>;
}

/**
 * Type guard for legacy tools
 */
export const isLegacyTool = (value: unknown): value is LegacyTool => {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === 'string' &&
    typeof (v as { execute?: unknown }).execute === 'function' &&
    !('validate' in v) &&
    !('getMetadata' in v) &&
    !('asFlowEffect' in v)
  );
};

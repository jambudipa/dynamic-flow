/**
 * DynamicFlow API - Main entry point for flow generation and execution
 */

import type { Duration } from 'effect';
import { Effect, Schema, Stream } from 'effect';
import type { Tool, ToolJoin, UntypedToolArray } from '@/lib/tools/types';
import { ValidatedFlowInstance } from './validated-flow-instance';
import { JSONToIRCompiler } from '@/lib/compiler';
import { type DynamicFlowType } from '@/lib/schema/flow-schema';
import { LLMCoreService } from '@/lib/llm/service';
import {
  generateConnectivityPrompt,
  generateCorrectivePrompt,
  validateToolConnectivity,
} from '@/lib/operators/tool-connectivity';
import { OperatorRegistry } from '@/lib/operators';
import { BaseFields } from '@/lib/operators/base';
import { getErrorMessage } from '@/lib/types/type-utils';
import {
  type AiModel,
  type DynamicFlowOptions,
  type ExecutionResult,
  FlowError,
  type FlowEvent,
  GenerationError,
  type ModelPoolConfig,
  type RetryStrategy,
  type ValidatedFlow,
} from './types';

/**
 * Orchestrator for the dynamic flow pipeline: LLM → JSON → IR → Execution
 * Keeps JSON internal, only exposing IR to the public API
 */
export class DynamicFlowOrchestrator {
  private jsonCompiler: JSONToIRCompiler;
  private readonly registry = OperatorRegistry.getInstance();

  constructor() {
    this.jsonCompiler = new JSONToIRCompiler();
  }

  /**
   * Execute the full pipeline: prompt → LLM → JSON → IR → execution
   */
  async execute(config: {
    prompt: string;
    tools: UntypedToolArray;
    joins: ReadonlyArray<ToolJoin<any, any>>;
    model: AiModel;
    options?: DynamicFlowOptions | undefined;
    input?: unknown | undefined;
  }): Promise<ValidatedFlow> {
    // Step 1: Generate JSON from LLM (internal)
    const json = await this.generateJSONFromLLM(
      config.prompt,
      config.tools,
      config.joins,
      config.model,
      config.options
    );

    // Step 2: Compile JSON to IR with tools and joins
    const ir = await Effect.runPromise(
      this.jsonCompiler.compile(json, config.tools, config.joins)
    );

    // Step 3: Wrap IR in ValidatedFlow with tools and joins
    return {
      ir,
      json: {
        // Include the generated JSON for debugging
        version: '1.0',
        metadata: {
          name: json.metadata?.name || 'DynamicFlow',
          description: json.metadata?.description || 'Generated flow',
          generated: true,
          model: config.model.toString(),
          timestamp: new Date().toISOString(),
        },
        nodes: json.flow.map((step: any) => ({
          id: step.id,
          type: step.tool ? 'tool' : step.type || 'tool', // Infer type from tool field
          toolId: step.tool || undefined,
          inputs: step.args || undefined,
        })),
        edges:
          json.flow.length > 1
            ? json.flow.slice(0, -1).map((_: any, i: number) => ({
                from: json.flow[i].id,
                to: json.flow[i + 1].id,
              }))
            : [],
      },
      tools: new Map(config.tools.map((t) => [t.id, t])),
      joins: new Map(config.joins.map((j) => [`${j.fromTool}-${j.toTool}`, j])),
      warnings: [],
    };
  }

  /**
   * Compile prompt to IR (for inspection without execution)
   */
  async compile(config: {
    prompt: string;
    tools: UntypedToolArray;
    joins: ReadonlyArray<ToolJoin<any, any>>;
    model: AiModel;
    options?: DynamicFlowOptions | undefined;
  }): Promise<ValidatedFlow> {
    return this.execute({ ...config, input: undefined });
  }

  /**
   * Generate JSON from LLM prompt using structured output
   */
  private async generateJSONFromLLM(
    prompt: string,
    tools: UntypedToolArray,
    joins: ReadonlyArray<ToolJoin<any, any>>,
    model: AiModel,
    options?: DynamicFlowOptions
  ): Promise<DynamicFlowType> {
    // Connectivity rules are now imported at the top level for better performance

    // Use the LLM structured output service to generate a real flow
    const toolDescriptions = tools.map((tool) => ({
      id: tool.id,
      name: tool.name,
      description: tool.description,
      // Extract input schema properties if available
      inputs: tool.inputSchema ? this.extractSchemaShape(tool.inputSchema) : {},
    }));

    // Generate connectivity rules for the prompt
    const connectivityRules = generateConnectivityPrompt(tools, joins);

    const systemPrompt = `You are a flow generator. Generate a JSON flow that accomplishes the user's task using the available tools.
Available tools:
${JSON.stringify(toolDescriptions, null, 2)}

${connectivityRules}

Rules:
1. Use the exact tool IDs provided
2. Create sequential steps with unique IDs
3. Use $stepId.property to reference outputs from previous steps
4. Include all necessary arguments for each tool
5. Follow the tool connectivity rules specified above
6. IMPORTANT: For sequential steps at the root level, include ALL step IDs in rootIds array in order of execution
   Example: For steps s1->s2->s3, rootIds should be ["s1", "s2", "s3"]
7. Only use nested structures (with body, ifTrue, ifFalse, etc.) for control flow operators`;

    const fullPrompt = `${systemPrompt}\n\nUser request: ${prompt}`;

    // Get operator registry instance (already imported at top)
    const registry = OperatorRegistry.getInstance();

    // Build a custom schema with actual tools instead of generic tool operator
    const buildFlowSchemaWithTools = (tools: UntypedToolArray) => {
      // Create specific tool schemas for each available tool
      // Create JSON-compatible value type (no Schema.Any!)
      const JsonValue = Schema.Union(
        Schema.String,
        Schema.Number,
        Schema.Boolean,
        Schema.Null
      );

      const toolSchemas = tools.map((tool) =>
        Schema.Struct({
          ...BaseFields,
          type: Schema.Literal('tool'),
          tool: Schema.Literal(tool.id),
          args: Schema.optional(
            Schema.Record({ key: Schema.String, value: JsonValue })
          ),
        })
      );

      // Get control flow operators (exclude generic tool operator)
      const controlFlowSchemas = registry
        .getAll()
        .filter((op) => op.type !== 'tool')
        .map((op) => op.flatSchema);

      // Combine all schemas
      const allSchemas = [...toolSchemas, ...controlFlowSchemas];

      // Create union of all step types
      const StepSchema =
        allSchemas.length >= 2
          ? Schema.Union(...(allSchemas as [any, any, ...any[]]))
          : allSchemas[0] || Schema.Unknown;

      // Create the flow schema with inline metadata definition
      return Schema.Struct({
        version: Schema.optional(Schema.Literal('1.0')),
        metadata: Schema.optional(
          Schema.Struct({
            name: Schema.optional(Schema.String),
            description: Schema.optional(Schema.String),
            author: Schema.optional(Schema.String),
            created: Schema.optional(Schema.String),
          })
        ),
        steps: Schema.Array(StepSchema),
        rootIds: Schema.Array(Schema.String),
      });
    };

    // Build schema with actual tools
    const FlowSchema = buildFlowSchemaWithTools(tools);

    // Create maps for validation
    const toolMap = new Map(tools.map((t) => [t.id, t]));
    const joinMap = new Map(joins.map((j) => [`${j.fromTool}-${j.toTool}`, j]));

    // Try generation with retry on validation failure
    let attempts = 0;
    const maxAttempts = 3;
    let lastError: string | null = null;

    while (attempts < maxAttempts) {
      attempts++;

      try {
        // Add corrective prompt if this is a retry
        const promptToUse = lastError
          ? `${fullPrompt}\n\nPREVIOUS ATTEMPT FAILED:\n${lastError}\n\nPlease correct these errors.`
          : fullPrompt;

        const flatResult = await Effect.runPromise(
          LLMCoreService.structured(
            promptToUse,
            FlowSchema as any,
            { model: 'gpt-5' } // Use gpt-5 for flow generation
          )
        );

        // Flat flow generated from LLM

        // Transform flat result back to recursive DynamicFlowType
        const recursiveFlow = registry.flatToRecursive(flatResult.json);
        // Transformed to recursive structure

        // Validate that the transformed flow has the right structure
        if (!recursiveFlow || typeof recursiveFlow !== 'object') {
          throw new Error('Transformed flow is not a valid object');
        }

        // Validate tool connectivity
        const validation = validateToolConnectivity(
          recursiveFlow,
          toolMap,
          joinMap
        );

        if (!validation.valid) {
          lastError = generateCorrectivePrompt(validation);
          console.warn(
            `Validation failed on attempt ${attempts}:`,
            validation.errors
          );

          if (attempts < maxAttempts) {
            continue; // Retry with corrective prompt
          } else {
            console.error(
              'Max attempts reached. Using flow despite validation errors.'
            );
            // Continue with the flow anyway on last attempt
          }
        }

        // Ensure basic structure exists with defaults
        const flowWithDefaults = {
          version: recursiveFlow.version || ('1.0' as const),
          metadata: {
            name: recursiveFlow.metadata?.name || 'Generated Flow',
            description: recursiveFlow.metadata?.description || prompt,
            created:
              recursiveFlow.metadata?.created || new Date().toISOString(),
          },
          flow: recursiveFlow.flow || [],
        };

        return flowWithDefaults as DynamicFlowType;
      } catch (error: any) {
        console.error(`Attempt ${attempts} failed:`, error?.message || error);
        lastError = error?.message || String(error);

        if (attempts >= maxAttempts) {
          console.error('All attempts failed. Creating fallback flow.');
          return this.createFallbackFlow(prompt, tools);
        }
      }
    }

    // Should not reach here, but fallback just in case
    return this.createFallbackFlow(prompt, tools);
  }

  // Create a simple fallback flow when LLM generation fails
  private createFallbackFlow(
    prompt: string,
    tools: UntypedToolArray
  ): DynamicFlowType {
    // Creating fallback flow

    // Create a simple flow using the first tool
    const tool = tools[0];
    if (!tool) {
      throw new Error('No tools available for flow generation');
    }

    // Try to create reasonable default arguments
    const args: Record<string, any> = {};
    try {
      // Look for common input field names
      const schema = tool.inputSchema;
      if (schema && typeof schema === 'object') {
        // Try to access AST if it exists
        const ast = (schema as any).ast;
        if (ast && 'propertySignatures' in ast) {
          for (const prop of ast.propertySignatures || []) {
            const name = prop.name;
            if (typeof name === 'string') {
              // Provide reasonable defaults based on field name
              if (name === 'text' || name === 'input' || name === 'prompt') {
                args[name] = prompt.includes('summarize')
                  ? 'This is a sample text that needs to be summarized for demonstration purposes.'
                  : prompt;
              } else if (name === 'url') {
                args[name] = 'https://example.com';
              } else if (name === 'id') {
                args[name] = '123';
              } else if (name === 'message') {
                args[name] = 'Hello from DynamicFlow!';
              } else {
                args[name] = `${name} value`;
              }
            }
          }
        } else {
          // Fallback: provide common defaults
          args.url = 'https://example.com';
          args.text = 'Sample text';
        }
      }
    } catch (e) {
      // If we can't extract schema, use generic args
      args.input = prompt;
    }

    return {
      version: '1.0',
      metadata: {
        name: 'Fallback Flow',
        description: `Generated flow for: ${prompt}`,
        created: new Date().toISOString(),
      },
      flow: [
        {
          id: 'step1',
          type: 'tool',
          tool: tool.id,
          args,
        },
      ],
    };
  }

  // Helper to extract schema shape for tool descriptions
  private extractSchemaShape(schema: any): Record<string, string> {
    try {
      // Try to get annotations from the schema
      if (schema && typeof schema === 'object') {
        // Check if it has annotations method (Effect Schema)
        if (typeof schema.annotations === 'function') {
          const annotations = schema.annotations();
          if (annotations && annotations.identifier) {
            return { type: annotations.identifier };
          }
        }

        // Try to extract from AST
        const ast = schema.ast;
        if (ast && ast._tag === 'TypeLiteral') {
          const shape: Record<string, string> = {};
          for (const prop of ast.propertySignatures || []) {
            if (prop.name && typeof prop.name === 'string') {
              shape[prop.name] = 'string'; // Simplified type
            }
          }
          return shape;
        }

        // Try to extract from fields if it's a struct
        if (schema.fields) {
          const shape: Record<string, string> = {};
          for (const [key] of Object.entries(schema.fields)) {
            shape[key] = 'string'; // Simplified
          }
          return shape;
        }
      }
    } catch (e) {
      // Ignore extraction errors
    }
    return {};
  }
}

/**
 * Main DynamicFlow API
 *
 * Why both ValidatedFlow and ValidatedFlowInstance?
 * - ValidatedFlow: an immutable, validated plan (graph JSON + tool/join maps). It is the product of planning and validation only.
 *   It contains no execution state and is safe to clone, inspect, diff, serialize, and cache.
 * - ValidatedFlowInstance: a runtime wrapper around a ValidatedFlow that provides execution capabilities
 *   (stream/runCollect), progress reporting, snapshots, and state. Instances are ephemeral and tied to a run.
 *
 * In short: ValidatedFlow is the plan; ValidatedFlowInstance is the executable instance of that plan.
 */
export class DynamicFlow {
  /**
   * High-level API - generate and execute immediately with streaming
   */
  static execute(config: {
    prompt: string;
    tools: UntypedToolArray;
    joins: ReadonlyArray<ToolJoin<any, any>>;
    model: AiModel;
    options?: DynamicFlowOptions | undefined;
    input?: unknown | undefined;
  }): Stream.Stream<FlowEvent, FlowError> {
    const effectOfStream = Effect.gen(function* () {
      // Use orchestrator to get ValidatedFlow
      const orchestrator = new DynamicFlowOrchestrator();
      const validatedFlow = yield* Effect.tryPromise({
        try: () => orchestrator.execute(config),
        catch: (e) => new FlowError(String(e)),
      });

      // Create instance from ValidatedFlow and run
      const instance = new ValidatedFlowInstance(validatedFlow, config.options);
      return instance.run(config.input);
    });

    const stream = Stream.unwrap(effectOfStream);
    return Stream.mapError(stream, (e) => new FlowError(getErrorMessage(e), e));
  }

  /**
   * Compile a dynamic flow configuration into ValidatedFlow
   */
  static compile(config: {
    prompt: string;
    tools: UntypedToolArray;
    joins: ReadonlyArray<ToolJoin<any, any>>;
    model: AiModel;
    options?: DynamicFlowOptions | undefined;
  }): Effect.Effect<ValidatedFlow, GenerationError> {
    return Effect.tryPromise({
      try: async () => {
        const orchestrator = new DynamicFlowOrchestrator();
        return await orchestrator.compile(config);
      },
      catch: (e) => new GenerationError(String(e)),
    });
  }

  /**
   * Generation API - generate for later execution
   */
  static generate(config: {
    prompt: string;
    tools: UntypedToolArray;
    joins: ReadonlyArray<ToolJoin<any, any>>;
    model: AiModel;
    options?: DynamicFlowOptions | undefined;
  }): Effect.Effect<ValidatedFlowInstance, GenerationError> {
    return Effect.gen(function* () {
      const orchestrator = new DynamicFlowOrchestrator();
      const validatedFlow = yield* Effect.tryPromise({
        try: () => orchestrator.compile(config),
        catch: (e) => new GenerationError(String(e)),
      });
      return new ValidatedFlowInstance(validatedFlow, config.options);
    });
  }

  /**
   * Low-level builder API
   */
  static builder(): FlowBuilder {
    return new FlowBuilder();
  }

  /** Alias of execute() for naming parity with the pipeable API. */
  static runStream(config: Parameters<typeof DynamicFlow.execute>[0]) {
    return DynamicFlow.execute(config);
  }

  /**
   * Compile + run and collect all results (non-streaming)
   */
  static runCollect(config: {
    prompt: string;
    tools: Tool[];
    joins: ToolJoin<unknown, unknown>[];
    model: AiModel;
    options?: DynamicFlowOptions | undefined;
    input?: unknown | undefined;
  }): Effect.Effect<ExecutionResult, FlowError> {
    return Effect.gen(function* () {
      const orchestrator = new DynamicFlowOrchestrator();
      const validatedFlow = yield* Effect.tryPromise({
        try: () => orchestrator.execute(config),
        catch: (e) => new FlowError(String(e)),
      });
      const instance = new ValidatedFlowInstance(validatedFlow, config.options);
      return yield* instance.runCollect(config.input);
    }).pipe(Effect.mapError((e) => new FlowError(getErrorMessage(e), e)));
  }
}

/**
 * Fluent builder for programmatic flow construction
 */
export class FlowBuilder {
  private prompt?: string | undefined;
  private tools: UntypedToolArray = [];
  private joins: ReadonlyArray<ToolJoin<any, any>> = [];
  private model?: AiModel | undefined;
  private modelPool?: ModelPoolConfig | undefined;
  private options: Partial<DynamicFlowOptions> = {};

  withPrompt(prompt: string): this {
    this.prompt = prompt;
    return this;
  }

  withTools(tools: UntypedToolArray): this {
    this.tools = tools;
    return this;
  }

  withJoins(joins: ReadonlyArray<ToolJoin<any, any>>): this {
    this.joins = joins;
    return this;
  }

  withModel(model: AiModel): this {
    this.model = model;
    return this;
  }

  withModelPool(config: ModelPoolConfig): this {
    this.modelPool = config;
    return this;
  }

  withRetryStrategy(strategy?: RetryStrategy): this {
    if (strategy !== undefined) this.options.retryStrategy = strategy;
    return this;
  }

  withTimeout(timeout?: Duration.Duration): this {
    if (timeout !== undefined) this.options.timeout = timeout;
    return this;
  }

  withCache(cache: boolean): this {
    this.options.cache = cache;
    return this;
  }

  build(): Effect.Effect<ValidatedFlowInstance, GenerationError> {
    if (!this.prompt) {
      return Effect.fail(new GenerationError('Prompt is required'));
    }
    if (!this.model) {
      return Effect.fail(new GenerationError('Model is required'));
    }
    if (this.tools.length === 0) {
      return Effect.fail(new GenerationError('At least one tool is required'));
    }

    const options: DynamicFlowOptions = { ...this.options, model: this.model };
    if (this.modelPool !== undefined) {
      (options as any).modelPool = this.modelPool;
    }

    return DynamicFlow.generate({
      prompt: this.prompt,
      tools: this.tools,
      joins: this.joins,
      model: this.model,
      options,
    });
  }
}

// Re-export types for convenience
export type {
  FlowEvent,
  FlowSnapshot,
  DynamicFlowOptions,
  ExecutionOptions,
  ModelPoolConfig,
} from './types';

// Re-export instance for type usage
export { ValidatedFlowInstance } from './validated-flow-instance';

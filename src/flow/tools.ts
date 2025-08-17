/**
 * Pipeable Tool Wrappers
 *
 * This module provides pipeable wrappers for tools that integrate seamlessly
 * with the Flow namespace and Effect system.
 */

import { Duration, Effect, pipe } from 'effect';
import type { ExecutionContext, LLMTool, Tool, ToolError } from '../tools/types';
import { getGlobalRegistry } from '@/tools/registry';
import type { FlowContext, FlowEffect } from '@/types';

// ============= Core Tool Functions =============

/**
 * Create a pipeable tool function from a Tool definition
 *
 * @example
 * ```typescript
 * const processText = createTool(textProcessorTool)
 *
 * pipe(
 *   Effect.succeed({ text: "hello world" }),
 *   Flow.andThen(processText)
 * )
 * ```
 */
export const createTool =
  <TInput, TOutput>(tool: Tool<TInput, TOutput>) =>
  (input: TInput): Effect.Effect<TOutput, ToolError, any> => {
    // Compilation mode removed - always execute
    /*if (FlowCompiler.isActive()) {
        // Capture step during compilation instead of executing
        FlowCompiler.record(tool as unknown as Tool, input);
        // Return a dummy success value to allow chaining; type-cast as needed
        return Effect.succeed({} as unknown as TOutput) as unknown as FlowEffect<
          TOutput,
          ToolError,
          FlowContext
        >;
      }*/
    // Normal execution - return the actual effect from tool.execute
    return tool.execute(input, {} as ExecutionContext);
  };

/**
 * Create a pipeable LLM tool function
 *
 * @example
 * ```typescript
 * const generateText = createLLMTool(textGeneratorTool)
 *
 * pipe(
 *   Effect.succeed({ prompt: "Write a story" }),
 *   Flow.andThen(generateText)
 * )
 * ```
 */
export const createLLMTool =
  <TInput, TOutput>(tool: LLMTool<TInput, TOutput>) =>
  (input: TInput): Effect.Effect<TOutput, ToolError, any> => {
    return createTool(tool)(input);
  };

// ============= Tool Registry Integration =============

/**
 * Create a pipeable tool from a registry by ID
 *
 * @example
 * ```typescript
 * const processingTool = fromRegistry("text-processor")
 *
 * pipe(
 *   Effect.succeed(inputData),
 *   Flow.andThen(processingTool)
 * )
 * ```
 */
export const fromRegistry =
  <TInput = unknown, TOutput = unknown>(toolId: string) =>
  (input: TInput): Effect.Effect<TOutput, any, any> => {
    return Effect.flatMap(
      getGlobalRegistry().get(toolId),
      (tool) =>
        tool.execute(
          input as unknown as any,
          {
            flowId: 'inline-flow',
            stepId: toolId,
            variables: {},
            metadata: {},
          } as ExecutionContext
        ) as Effect.Effect<TOutput, any, any>
    );
  };

// ============= Tool Composition Helpers =============

/**
 * Compose multiple tools in sequence
 *
 * @example
 * ```typescript
 * const pipeline = sequence([
 *   createTool(preprocessTool),
 *   createTool(processTool),
 *   createTool(postprocessTool)
 * ])
 *
 * pipe(
 *   Effect.succeed(input),
 *   Flow.andThen(pipeline)
 * )
 * ```
 */
export const sequence =
  <TInput, TOutput>(
    tools: Array<(input: unknown) => FlowEffect<any, ToolError, FlowContext>>
  ) =>
  (input: TInput): FlowEffect<TOutput, ToolError, FlowContext> => {
    const initial = Effect.succeed(input) as unknown as FlowEffect<
      unknown,
      ToolError,
      FlowContext
    >;
    return tools.reduce(
      (flow, tool) => pipe(flow, Effect.flatMap(tool)),
      initial
    ) as unknown as FlowEffect<TOutput, ToolError, FlowContext>;
  };

/**
 * Execute multiple tools in parallel on the same input
 *
 * @example
 * ```typescript
 * const parallelAnalysis = parallel({
 *   sentiment: createTool(sentimentTool),
 *   entities: createTool(entityTool),
 *   summary: createTool(summaryTool)
 * })
 *
 * pipe(
 *   Effect.succeed({ text: "analyze this" }),
 *   Flow.andThen(parallelAnalysis)
 * )
 * ```
 */
export const parallel =
  <
    T extends Record<
      string,
      (input: unknown) => FlowEffect<any, ToolError, FlowContext>
    >,
  >(
    tools: T
  ) =>
  <TInput>(
    input: TInput
  ): FlowEffect<
    {
      [K in keyof T]: T[K] extends (
        input: unknown
      ) => FlowEffect<infer R, any, any>
        ? R
        : never;
    },
    ToolError,
    FlowContext
  > => {
    const toolEffects = Object.fromEntries(
      Object.entries(tools).map(([key, tool]) => [key, tool(input)])
    ) as Record<string, Effect.Effect<any, any, any>>;

    return Effect.all(toolEffects) as unknown as FlowEffect<
      {
        [K in keyof T]: T[K] extends (
          input: unknown
        ) => FlowEffect<infer R, any, any>
          ? R
          : never;
      },
      ToolError,
      FlowContext
    >;
  };

// ============= Conditional Tool Execution =============

/**
 * Execute a tool conditionally based on input
 *
 * @example
 * ```typescript
 * const conditionalProcessor = conditional(
 *   (input) => input.type === "text",
 *   {
 *     onTrue: createTool(textTool),
 *     onFalse: createTool(imageTool)
 *   }
 * )
 * ```
 */
export const conditional =
  <TInput, TOutput>(
    predicate: (input: TInput) => boolean,
    options: {
      onTrue: (input: TInput) => FlowEffect<TOutput, ToolError, FlowContext>;
      onFalse: (input: TInput) => FlowEffect<TOutput, ToolError, FlowContext>;
    }
  ) =>
  (input: TInput): FlowEffect<TOutput, ToolError, FlowContext> => {
    return predicate(input) ? options.onTrue(input) : options.onFalse(input);
  };

// ============= Tool with Retry Logic =============

/**
 * Add retry logic to a tool
 *
 * @example
 * ```typescript
 * const reliableTool = withRetry(
 *   createTool(unreliableTool),
 *   { times: 3, delay: Duration.seconds(1) }
 * )
 * ```
 */
export const withRetry =
  <TInput, TOutput>(
    tool: (input: TInput) => FlowEffect<TOutput, ToolError, FlowContext>,
    options: { times: number; delay?: Duration.DurationInput | undefined }
  ) =>
  (input: TInput): FlowEffect<TOutput, ToolError, FlowContext> => {
    const toolEffect = tool(input);
    // Simple retry by times; delay handling omitted for brevity
    return Effect.retry(toolEffect, {
      times: options.times,
    }) as unknown as FlowEffect<TOutput, ToolError, FlowContext>;
  };

// ============= Tool with Timeout =============

/**
 * Add timeout to a tool
 *
 * @example
 * ```typescript
 * const timeoutTool = withTimeout(
 *   createTool(slowTool),
 *   Duration.seconds(30)
 * )
 * ```
 */
export const withTimeout =
  <TInput, TOutput>(
    tool: (input: TInput) => FlowEffect<TOutput, ToolError, FlowContext>,
    duration: Duration.DurationInput
  ) =>
  (input: TInput): FlowEffect<TOutput, ToolError, FlowContext> => {
    return Effect.timeout(tool(input), duration) as unknown as FlowEffect<
      TOutput,
      ToolError,
      FlowContext
    >;
  };

// ============= Export all functions =============

export const Tools = {
  createTool,
  createLLMTool,
  fromRegistry,
  sequence,
  parallel,
  conditional,
  withRetry,
  withTimeout,
} as const;

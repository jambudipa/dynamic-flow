/**
 * ToolRegistryService - Tool registration and lookup service
 *
 * Central source of truth for tool definitions. Handles registration,
 * lookup, category indexing, and schema validation.
 */

import {
  Effect,
  Context,
  Layer,
  Ref,
  HashMap,
  Option,
  pipe,
  Schema,
} from 'effect';
import type { LLMTool, Tool } from '../tools/types';
import {
  RegistrationError,
  ToolNotFoundError,
  ValidationError,
} from '../errors';

// ============= ToolRegistryService Interface =============

export interface ToolRegistryService {
  /**
   * Register a new tool.
   */
  readonly register: <TInput, TOutput>(
    tool: Tool<TInput, TOutput>
  ) => Effect.Effect<void, RegistrationError>;

  /**
   * Register an LLM tool (also registers as a regular tool).
   */
  readonly registerLLM: <TInput, TOutput>(
    tool: LLMTool<TInput, TOutput>
  ) => Effect.Effect<void, RegistrationError>;

  /**
   * Retrieve a tool by ID.
   */
  readonly get: (
    id: string
  ) => Effect.Effect<Tool<unknown, unknown>, ToolNotFoundError>;

  /**
   * Retrieve an LLM tool by ID.
   */
  readonly getLLM: (
    id: string
  ) => Effect.Effect<LLMTool<unknown, unknown>, ToolNotFoundError>;

  /**
   * Return whether a tool is registered.
   */
  readonly has: (id: string) => Effect.Effect<boolean>;

  /**
   * List all registered tools.
   */
  readonly list: () => Effect.Effect<Array<Tool<unknown, unknown>>>;

  /**
   * List all tools in a category.
   */
  readonly listByCategory: (
    category: string
  ) => Effect.Effect<Array<Tool<unknown, unknown>>>;

  /**
   * Unregister a tool by ID.
   */
  readonly unregister: (id: string) => Effect.Effect<void, ToolNotFoundError>;

  /**
   * Clear the entire registry.
   */
  readonly clear: () => Effect.Effect<void>;

  /**
   * Validate input against a tool's input schema.
   */
  readonly validateInput: (
    toolId: string,
    input: unknown
  ) => Effect.Effect<void, ValidationError>;

  /**
   * Validate output against a tool's output schema.
   */
  readonly validateOutput: (
    toolId: string,
    output: unknown
  ) => Effect.Effect<void, ValidationError>;
}

// ============= Context Tag =============

export const ToolRegistryService = Context.GenericTag<ToolRegistryService>(
  '@services/ToolRegistry'
);

// ============= Service Implementation =============

const makeToolRegistryService = (): Effect.Effect<ToolRegistryService> =>
  Effect.gen(function* () {
    const toolsRef = yield* Ref.make(
      HashMap.empty<string, Tool<unknown, unknown>>()
    );
    const llmToolsRef = yield* Ref.make(
      HashMap.empty<string, LLMTool<unknown, unknown>>()
    );
    const categoriesRef = yield* Ref.make(HashMap.empty<string, Set<string>>());

    const addToCategory = (toolId: string, category: string) =>
      Effect.gen(function* () {
        const categories = yield* Ref.get(categoriesRef);
        const existing = HashMap.get(categories, category);
        const toolSet = Option.match(existing, {
          onNone: () => new Set<string>(),
          onSome: (set) => set,
        });
        toolSet.add(toolId);
        yield* Ref.update(categoriesRef, (current) =>
          HashMap.set(current, category, toolSet)
        );
      });

    const removeFromCategory = (toolId: string, category: string) =>
      Effect.gen(function* () {
        const categories = yield* Ref.get(categoriesRef);
        const existing = HashMap.get(categories, category);
        if (Option.isSome(existing)) {
          const toolSet = existing.value;
          toolSet.delete(toolId);
          if (toolSet.size === 0) {
            yield* Ref.update(categoriesRef, (current) =>
              HashMap.remove(current, category)
            );
          } else {
            yield* Ref.update(categoriesRef, (current) =>
              HashMap.set(current, category, toolSet)
            );
          }
        }
      });

    const service: ToolRegistryService = {
      register: <TInput, TOutput>(tool: Tool<TInput, TOutput>) =>
        Effect.gen(function* () {
          const tools = yield* Ref.get(toolsRef);

          // Check if tool already exists
          if (HashMap.has(tools, tool.id)) {
            return yield* Effect.fail(
              new RegistrationError({
                message: `Tool ${tool.id} is already registered`,
                item: tool.id,
              })
            );
          }

          // Validate tool definition
          if (!tool.id || !tool.name || !tool.execute) {
            return yield* Effect.fail(
              new RegistrationError({
                message: `Invalid tool definition for ${tool.id}`,
                item: tool.id,
              })
            );
          }

          // Add to registry
          yield* Ref.update(toolsRef, (current) =>
            HashMap.set(
              current,
              tool.id,
              tool as unknown as Tool<unknown, unknown>
            )
          );

          // Add to category index if specified
          if (tool.category) {
            yield* addToCategory(tool.id, tool.category);
          }
        }),

      registerLLM: <TInput, TOutput>(tool: LLMTool<TInput, TOutput>) =>
        Effect.gen(function* () {
          // Register as regular tool first
          yield* service.register(tool);
          // Add to LLM tool map
          yield* Ref.update(llmToolsRef, (current) =>
            HashMap.set(
              current,
              tool.id,
              tool as unknown as LLMTool<unknown, unknown>
            )
          );
        }),

      get: (id: string) =>
        Effect.gen(function* () {
          const tools = yield* Ref.get(toolsRef);
          return yield* pipe(
            HashMap.get(tools, id),
            Option.match({
              onNone: () => Effect.fail(new ToolNotFoundError({ toolId: id })),
              onSome: (tool) => Effect.succeed(tool),
            })
          );
        }),

      getLLM: (id: string) =>
        Effect.gen(function* () {
          const llmTools = yield* Ref.get(llmToolsRef);
          return yield* pipe(
            HashMap.get(llmTools, id),
            Option.match({
              onNone: () => Effect.fail(new ToolNotFoundError({ toolId: id })),
              onSome: (tool) => Effect.succeed(tool),
            })
          );
        }),

      has: (id: string) =>
        Effect.gen(function* () {
          const tools = yield* Ref.get(toolsRef);
          return HashMap.has(tools, id);
        }),

      list: () =>
        Effect.gen(function* () {
          const tools = yield* Ref.get(toolsRef);
          return Array.from(HashMap.values(tools));
        }),

      listByCategory: (category: string) =>
        Effect.gen(function* () {
          const categories = yield* Ref.get(categoriesRef);
          const tools = yield* Ref.get(toolsRef);

          const categoryTools = HashMap.get(categories, category);
          if (Option.isNone(categoryTools)) {
            return [] as Array<Tool<unknown, unknown>>;
          }

          const toolIds = Array.from(
            Option.getOrElse(categoryTools, () => new Set<string>())
          );

          const result: Array<Tool<unknown, unknown>> = [];
          for (const id of toolIds) {
            const maybeTool = HashMap.get(tools, id);
            if (Option.isSome(maybeTool)) {
              result.push(maybeTool.value);
            }
          }
          return result;
        }),

      unregister: (id: string) =>
        Effect.gen(function* () {
          const tools = yield* Ref.get(toolsRef);

          if (!HashMap.has(tools, id)) {
            return yield* Effect.fail(new ToolNotFoundError({ toolId: id }));
          }

          // Get tool to check category
          const tool = yield* service.get(id);

          // Remove from registries
          yield* Ref.update(toolsRef, (current) => HashMap.remove(current, id));
          yield* Ref.update(llmToolsRef, (current) =>
            HashMap.remove(current, id)
          );

          // Remove from category index
          if (tool.category) {
            yield* removeFromCategory(id, tool.category);
          }
        }),

      clear: () =>
        Effect.gen(function* () {
          yield* Ref.set(toolsRef, HashMap.empty());
          yield* Ref.set(llmToolsRef, HashMap.empty());
          yield* Ref.set(categoriesRef, HashMap.empty());
        }),

      validateInput: (toolId: string, input: unknown) =>
        Effect.gen(function* () {
          const tool = yield* pipe(
            service.get(toolId),
            Effect.mapError(
              () =>
                new ValidationError({
                  message: `Tool ${toolId} not found`,
                  field: 'toolId',
                  value: toolId,
                })
            )
          );

          yield* pipe(
            Schema.decodeUnknown(tool.inputSchema)(input),
            Effect.mapError(
              (error) =>
                new ValidationError({
                  message: `Input validation failed for tool ${toolId}: ${String(error)}`,
                  field: 'input',
                  value: toolId,
                })
            ),
            Effect.map(() => undefined)
          );
        }),

      validateOutput: (toolId: string, output: unknown) =>
        Effect.gen(function* () {
          const tool = yield* pipe(
            service.get(toolId),
            Effect.mapError(
              () =>
                new ValidationError({
                  message: `Tool ${toolId} not found`,
                  field: 'toolId',
                  value: toolId,
                })
            )
          );

          yield* pipe(
            Schema.decodeUnknown(tool.outputSchema)(output),
            Effect.mapError(
              (error) =>
                new ValidationError({
                  message: `Output validation failed for tool ${toolId}: ${String(error)}`,
                  field: 'output',
                  value: toolId,
                })
            ),
            Effect.map(() => undefined)
          );
        }),
    };

    return service;
  });

// ============= Layer Implementations =============

/**
 * Live implementation of ToolRegistryService
 */
export const ToolRegistryServiceLive = Layer.effect(
  ToolRegistryService,
  makeToolRegistryService()
);

/**
 * Test implementation with pre-registered tools
 */
export const ToolRegistryServiceTest = (
  tools?: Array<Tool<unknown, unknown>>
) =>
  Layer.effect(
    ToolRegistryService,
    Effect.gen(function* () {
      const service = yield* makeToolRegistryService();
      if (tools) {
        for (const tool of tools) {
          yield* service.register(tool);
        }
      }
      return service;
    })
  );

// ============= Helper Functions =============

/**
 * Register multiple tools sequentially
 */
export const registerMany = (tools: Array<Tool<unknown, unknown>>) =>
  Effect.gen(function* () {
    const registry = yield* ToolRegistryService;
    for (const tool of tools) {
      yield* registry.register(tool);
    }
  });

/**
 * Find all tools matching a predicate
 */
export const findTools = (predicate: (t: Tool<unknown, unknown>) => boolean) =>
  Effect.gen(function* () {
    const registry = yield* ToolRegistryService;
    const allTools = yield* registry.list();
    return allTools.filter(predicate);
  });

/**
 * Get multiple tools by IDs
 */
export const getMany = (ids: string[]) =>
  Effect.gen(function* () {
    const registry = yield* ToolRegistryService;
    const tools: Array<Tool<unknown, unknown>> = [];
    for (const id of ids) {
      const tool = yield* registry.get(id);
      tools.push(tool);
    }
    return tools;
  });

/**
 * Export registry as JSON for serialization
 */
export const exportRegistry = () =>
  Effect.gen(function* () {
    const registry = yield* ToolRegistryService;
    const tools = yield* registry.list();
    const exportData = tools.map((tool) => ({
      id: tool.id,
      name: tool.name,
      description: tool.description,
      category: tool.category,
      version: tool.version,
      config: tool.config,
    }));
    return JSON.stringify(exportData, null, 2);
  });

/**
 * Validate all tools in registry
 */
export const validateRegistry = () =>
  Effect.gen(function* () {
    const registry = yield* ToolRegistryService;
    const tools = yield* registry.list();

    for (const tool of tools) {
      // Basic validation
      if (!tool.id || !tool.name || !tool.execute) {
        return yield* Effect.fail(
          new ValidationError({
            message: `Invalid tool definition for ${tool.id}`,
            field: 'tool',
            value: tool.id,
          })
        );
      }
      // Ensure schemas are present
      if (!tool.inputSchema || !tool.outputSchema) {
        return yield* Effect.fail(
          new ValidationError({
            message: `Missing schema for tool ${tool.id}`,
            field: 'schema',
            value: tool.id,
          })
        );
      }
    }
    return true;
  });

/**
 * Get tools by category
 */
export const getToolsByCategory = (category: string) =>
  Effect.gen(function* () {
    const registry = yield* ToolRegistryService;
    return yield* registry.listByCategory(category);
  });

/**
 * Check if a tool exists
 */
export const toolExists = (id: string) =>
  Effect.gen(function* () {
    const registry = yield* ToolRegistryService;
    return yield* registry.has(id);
  });

/**
 * Get tool with safe fallback
 */
export const getToolSafe = (id: string) =>
  Effect.gen(function* () {
    const registry = yield* ToolRegistryService;
    return yield* pipe(registry.get(id), Effect.option);
  });

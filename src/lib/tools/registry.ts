/**
 * Tool Registry Implementation - DEPRECATED
 *
 * @deprecated Use ToolRegistryService from '../services/tool-registry' instead
 * This file is kept for backward compatibility only.
 */

export * from '../services/tool-registry';

// Legacy imports for backward compatibility
import { Context, Effect, HashMap, Layer, Option, pipe, Schema } from 'effect';
import type { LLMTool, Tool, ToolRegistry } from './types';
import { ValidationError, RegistrationError, ToolNotFoundError } from './types';

// ============= Registry Implementation =============

export class ToolRegistryImpl implements ToolRegistry {
  tools = HashMap.empty<string, Tool<unknown, unknown>>();
  llmTools = HashMap.empty<string, LLMTool<unknown, unknown>>();
  categories = HashMap.empty<string, Set<string>>();

  /**
   * Register a new tool.
   * @param tool Tool descriptor with schemas and execute function.
   * @throws RegistrationError If the ID already exists or definition is invalid.
   */
  register<TInput, TOutput>(tool: Tool<TInput, TOutput>) {
    const self = this;
    return Effect.gen(function* () {
      // Check if tool already exists
      if (HashMap.has(self.tools, tool.id)) {
        return yield* Effect.fail(
          new RegistrationError({
            message: `Tool ${tool.id} is already registered`,
            toolId: tool.id,
          })
        );
      }

      // Validate tool definition
      if (!tool.id || !tool.name || !tool.execute) {
        return yield* Effect.fail(
          new RegistrationError({
            message: `Invalid tool definition for ${tool.id}`,
            toolId: tool.id,
          })
        );
      }

      // Add to registry
      self.tools = HashMap.set(
        self.tools,
        tool.id,
        tool as unknown as Tool<unknown, unknown>
      );

      // Add to category index if specified
      if (tool.category) {
        self.addToCategory(tool.id, tool.category);
      }

      return;
    });
  }

  /**
   * Register an LLM tool (also registers as a regular tool).
   * @param tool LLM tool descriptor with LLM-specific config.
   */
  registerLLM<TInput, TOutput>(tool: LLMTool<TInput, TOutput>) {
    const self = this;
    return Effect.gen(function* () {
      // Register as regular tool first
      yield* self.register(tool);
      // Add to LLM tool map
      self.llmTools = HashMap.set(
        self.llmTools,
        tool.id,
        tool as unknown as LLMTool<unknown, unknown>
      );
      return;
    });
  }

  /**
   * Retrieve a tool by ID.
   * @param id Tool identifier.
   * @throws ToolNotFoundError if not present.
   */
  get(id: string) {
    return pipe(
      HashMap.get(this.tools, id),
      Option.match({
        onNone: () => Effect.fail(new ToolNotFoundError({ toolId: id })),
        onSome: (tool) => Effect.succeed(tool),
      })
    );
  }

  /**
   * Retrieve an LLM tool by ID.
   * @param id Tool identifier.
   */
  getLLM(id: string) {
    return pipe(
      HashMap.get(this.llmTools, id),
      Option.match({
        onNone: () => Effect.fail(new ToolNotFoundError({ toolId: id })),
        onSome: (tool) => Effect.succeed(tool),
      })
    );
  }

  /**
   * Return whether a tool is registered.
   * @param id Tool identifier.
   */
  has(id: string) {
    return Effect.succeed(HashMap.has(this.tools, id));
  }

  /**
   * List all registered tools.
   */
  list() {
    return Effect.succeed(Array.from(HashMap.values(this.tools)));
  }

  /**
   * List all tools in a category.
   * @param category Category name used during registration.
   */
  listByCategory(category: string) {
    const self = this;
    return Effect.gen(function* () {
      const categoryTools = HashMap.get(self.categories, category);
      if (Option.isNone(categoryTools)) {
        return [] as Array<Tool<unknown, unknown>>;
      }
      const toolIds = Array.from(
        Option.getOrElse(categoryTools, () => new Set<string>())
      );
      const tools: Array<Tool<unknown, unknown>> = [];
      for (const id of toolIds) {
        const maybeTool = HashMap.get(self.tools, id);
        if (Option.isSome(maybeTool)) {
          tools.push(maybeTool.value);
        }
      }
      return tools;
    });
  }

  /**
   * Unregister a tool by ID, removing all category/LLM references.
   * @param id Tool identifier.
   */
  unregister(id: string) {
    const self = this;
    return Effect.gen(function* () {
      if (!HashMap.has(self.tools, id)) {
        return yield* Effect.fail(new ToolNotFoundError({ toolId: id }));
      }

      // Get tool to check category
      const tool = yield* self.get(id);

      // Remove from registries
      self.tools = HashMap.remove(self.tools, id);
      self.llmTools = HashMap.remove(self.llmTools, id);

      // Remove from category index
      if (tool.category) {
        self.removeFromCategory(id, tool.category);
      }

      return;
    });
  }

  /**
   * Clear the entire registry (tools, LLM tools, categories).
   */
  clear() {
    return Effect.sync(() => {
      this.tools = HashMap.empty();
      this.llmTools = HashMap.empty();
      this.categories = HashMap.empty();
    });
  }

  /**
   * Validate input against a tool’s input schema.
   * @param toolId Tool identifier.
   * @param input Unknown value to validate.
   * @throws ValidationError If the tool is missing or the schema fails.
   */
  validateInput(toolId: string, input: unknown) {
    const fetched = Effect.mapError(
      this.get(toolId),
      () => new ValidationError({ message: `Tool ${toolId} not found`, toolId })
    );
    return Effect.flatMap(fetched, (tool) => {
      const decoded = Schema.decodeUnknown(tool.inputSchema)(input);
      const mapped = Effect.mapError(
        decoded,
        (error) =>
          new ValidationError({
            message: `Input validation failed for tool ${toolId}: ${String(error)}`,
            toolId,
            field: 'input',
          })
      );
      return Effect.map(mapped, () => {});
    });
  }

  /**
   * Validate output against a tool's output schema.
   * @param toolId Tool identifier.
   * @param output Unknown value to validate.
   */
  validateOutput(toolId: string, output: unknown) {
    const fetched = Effect.mapError(
      this.get(toolId),
      () => new ValidationError({ message: `Tool ${toolId} not found`, toolId })
    );
    return Effect.flatMap(fetched, (tool) => {
      const decoded = Schema.decodeUnknown(tool.outputSchema)(output);
      const mapped = Effect.mapError(
        decoded,
        (error) =>
          new ValidationError({
            message: `Output validation failed for tool ${toolId}: ${String(error)}`,
            toolId,
            field: 'output',
          })
      );
      return Effect.map(mapped, () => {});
    });
  }

  // ============= Private Helpers =============
  /**
   * Private: add a tool ID to a category index, creating the set if absent.
   * @param toolId ID to add.
   * @param category Category key.
   */
  private addToCategory(toolId: string, category: string) {
    const existing = HashMap.get(this.categories, category);
    const toolSet = Option.match(existing, {
      onNone: () => new Set<string>(),
      onSome: (set) => set,
    });
    toolSet.add(toolId);
    this.categories = HashMap.set(this.categories, category, toolSet);
  }

  /**
   * Private: remove a tool ID from a category index (and delete the category
   * if the set becomes empty).
   */
  private removeFromCategory(toolId: string, category: string) {
    const existing = HashMap.get(this.categories, category);
    if (Option.isSome(existing)) {
      const toolSet = existing.value;
      toolSet.delete(toolId);
      if (toolSet.size === 0) {
        this.categories = HashMap.remove(this.categories, category);
      } else {
        this.categories = HashMap.set(this.categories, category, toolSet);
      }
    }
  }
}

// ============= Factory Functions =============

/**
 * Create a new, empty tool registry instance.
 */
export const createRegistry = (): ToolRegistryImpl => new ToolRegistryImpl();

/**
 * Create a new registry and pre-register a set of tools.
 * @param tools Tools to register in order.
 */
export const createRegistryWithTools = (
  tools: Array<Tool<unknown, unknown>>
): Effect.Effect<ToolRegistryImpl, RegistrationError> =>
  Effect.gen(function* () {
    const registry = createRegistry();
    for (const tool of tools) {
      yield* registry.register(tool);
    }
    return registry;
  });

// ============= Global Registry Instance =============

let globalRegistry: ToolRegistryImpl | null = null;

/**
 * Get or create a process-wide global tool registry.
 * @remarks Useful for small apps and tests; larger apps should inject a registry.
 */
export const getGlobalRegistry = (): ToolRegistryImpl => {
  if (!globalRegistry) {
    globalRegistry = createRegistry();
  }
  return globalRegistry;
};

/**
 * Reset the global registry (test helper).
 */
export const resetGlobalRegistry = (): Effect.Effect<void> =>
  Effect.sync(() => {
    globalRegistry = null;
  });

// ============= Registry Layer =============

/**
 * Create an Effect Layer that provides a registry instance via Context.
 */
export const RegistryService = Context.GenericTag<ToolRegistry>('ToolRegistry');

/** Create a Layer that provides a registry. */
export const RegistryLive = Layer.succeed(RegistryService, createRegistry());

/**
 * Create a Layer that provides a registry preloaded with specific tools.
 */
export const RegistryWithTools = (
  tools: Array<Tool<unknown, unknown>>
): Layer.Layer<ToolRegistry, RegistrationError> =>
  Layer.effect(RegistryService, createRegistryWithTools(tools));

// ============= Utility Functions =============

/**
 * Utility: register multiple tools sequentially.
 */
export const registerMany = (
  registry: ToolRegistry,
  tools: Array<Tool<unknown, unknown>>
): Effect.Effect<void, RegistrationError> =>
  Effect.gen(function* () {
    for (const tool of tools) {
      yield* registry.register(tool);
    }
  });

/**
 * Utility: find all tools matching a predicate.
 */
export const findTools = (
  registry: ToolRegistry,
  predicate: (t: Tool<unknown, unknown>) => boolean
): Effect.Effect<Array<Tool<unknown, unknown>>> =>
  Effect.gen(function* () {
    const allTools = yield* registry.list();
    return allTools.filter(predicate);
  });

/**
 * Utility: get multiple tools by IDs, failing if any is missing.
 */
export const getMany = (
  registry: ToolRegistry,
  ids: string[]
): Effect.Effect<Array<Tool<unknown, unknown>>, ToolNotFoundError> =>
  Effect.gen(function* () {
    const tools: Array<Tool<unknown, unknown>> = [];
    for (const id of ids) {
      const tool = yield* registry.get(id);
      tools.push(tool);
    }
    return tools;
  });

/** Export registry as JSON for serialization */
export const exportRegistry = (registry: ToolRegistry): Effect.Effect<string> =>
  Effect.gen(function* () {
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

/** Validate all tools in registry */
export const validateRegistry = (
  registry: ToolRegistry
): Effect.Effect<boolean, ValidationError> =>
  Effect.gen(function* () {
    const tools = yield* registry.list();
    for (const tool of tools) {
      // Basic validation
      if (!tool.id || !tool.name || !tool.execute) {
        return yield* Effect.fail(
          new ValidationError({
            message: `Invalid tool definition for ${tool.id}`,
            toolId: tool.id,
          })
        );
      }
      // Ensure schemas are present
      if (!tool.inputSchema || !tool.outputSchema) {
        return yield* Effect.fail(
          new ValidationError({
            message: `Missing schema for tool ${tool.id}`,
            toolId: tool.id,
          })
        );
      }
    }
    return true;
  });

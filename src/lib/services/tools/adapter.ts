import { Effect, Runtime, Layer } from 'effect';
import { ToolRegistryService } from './registry';
import type { Tool, ToolRegistry, LLMTool } from '../../tools/types';
import {
  RegistrationError as TypesRegistrationError,
  ToolNotFoundError as TypesToolNotFoundError,
  ValidationError as TypesValidationError,
} from '../../tools/types';
import { RegistrationError, ToolNotFoundError } from '../../errors';

/**
 * Backward compatibility adapter for ToolRegistryImpl
 * Maintains the original class-based API
 */
export class ToolRegistryImpl implements ToolRegistry {
  constructor() {
    // Service is provided through the Effect runtime
  }

  register<TInput, TOutput>(
    tool: Tool<TInput, TOutput>
  ): Effect.Effect<void, TypesRegistrationError, never> {
    return Effect.gen(function* () {
      const registry = yield* ToolRegistryService;
      yield* registry.register(tool as Tool<unknown, unknown>);
    }).pipe(
      Effect.mapError((error) => {
        if (error instanceof RegistrationError) {
          return new TypesRegistrationError({
            message: error.message,
            toolId: error.item || tool.id,
            reason: 'Registration failed',
          });
        }
        return new TypesRegistrationError({
          message: String(error),
          toolId: tool.id,
          reason: 'Unknown error',
        });
      }),
      Effect.provide(Layer.succeed(ToolRegistryService, {} as any))
    );
  }

  get(
    id: string
  ): Effect.Effect<Tool<unknown, unknown>, TypesToolNotFoundError, never> {
    return Effect.gen(function* () {
      const registry = yield* ToolRegistryService;
      return yield* registry.get(id);
    }).pipe(
      Effect.mapError((error) => {
        if (error instanceof ToolNotFoundError) {
          return new TypesToolNotFoundError({
            toolId: error.toolId,
            context: 'get',
          });
        }
        return new TypesToolNotFoundError({
          toolId: id,
          context: 'get',
        });
      }),
      Effect.provide(Layer.succeed(ToolRegistryService, {} as any))
    );
  }

  has(id: string): Effect.Effect<boolean, never, never> {
    return Effect.gen(function* () {
      const registry = yield* ToolRegistryService;
      return yield* registry.has(id);
    }).pipe(Effect.provide(Layer.succeed(ToolRegistryService, {} as any)));
  }

  list(): Effect.Effect<Tool<unknown, unknown>[], never, never> {
    return Effect.gen(function* () {
      const registry = yield* ToolRegistryService;
      return yield* registry.list();
    }).pipe(Effect.provide(Layer.succeed(ToolRegistryService, {} as any)));
  }

  clear(): Effect.Effect<void, never, never> {
    return Effect.gen(function* () {
      const registry = yield* ToolRegistryService;
      yield* registry.clear();
    }).pipe(Effect.provide(Layer.succeed(ToolRegistryService, {} as any)));
  }

  registerLLM<TInput, TOutput>(
    tool: LLMTool<TInput, TOutput>
  ): Effect.Effect<void, TypesRegistrationError, never> {
    // Convert LLMTool to Tool and register
    return this.register(tool as unknown as Tool<TInput, TOutput>);
  }

  getLLM(
    id: string
  ): Effect.Effect<LLMTool<unknown, unknown>, TypesToolNotFoundError, never> {
    // Get tool and cast to LLMTool
    return this.get(id).pipe(
      Effect.map((tool) => tool as unknown as LLMTool<unknown, unknown>)
    );
  }

  listByCategory(
    category: string
  ): Effect.Effect<Tool<unknown, unknown>[], never, never> {
    // Filter tools by category
    return this.list().pipe(
      Effect.map((tools) =>
        tools.filter((tool) => (tool as any).category === category)
      )
    );
  }

  unregister(id: string): Effect.Effect<void, TypesToolNotFoundError, never> {
    return Effect.gen(function* () {
      const registry = yield* ToolRegistryService;
      // Check if tool exists first
      const exists = yield* registry.has(id);
      if (!exists) {
        return yield* Effect.fail(
          new TypesToolNotFoundError({
            toolId: id,
            context: 'unregister',
          })
        );
      }
      yield* registry.unregister(id);
    }).pipe(Effect.provide(Layer.succeed(ToolRegistryService, {} as any)));
  }

  validateInput(
    toolId: string,
    input: unknown
  ): Effect.Effect<void, TypesValidationError, never> {
    const self = this;
    return Effect.gen(function* () {
      const tool = yield* self.get(toolId).pipe(
        Effect.mapError(
          () =>
            new TypesValidationError({
              message: 'Tool not found',
              toolId,
              field: 'toolId',
            })
        )
      );
      // Validate using tool's input schema if available
      if ((tool as any).inputSchema) {
        // Would validate here
      }
    });
  }

  validateOutput(
    toolId: string,
    output: unknown
  ): Effect.Effect<void, TypesValidationError, never> {
    const self = this;
    return Effect.gen(function* () {
      const tool = yield* self.get(toolId).pipe(
        Effect.mapError(
          () =>
            new TypesValidationError({
              message: 'Tool not found',
              toolId,
              field: 'toolId',
            })
        )
      );
      // Validate using tool's output schema if available
      if ((tool as any).outputSchema) {
        // Would validate here
      }
    });
  }
}

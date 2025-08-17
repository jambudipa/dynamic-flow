/**
 * Flow Generator - Main orchestrator for flow generation
 */

import { Effect, pipe } from 'effect';
import { LLMService } from './llm-service';
import { FlowValidator } from './flow-validator';
import { ErrorRecoverySystem } from './error-recovery';
import { createToolContext } from './tool-context';
import { CacheManager } from './cache-manager';
import type { Ai } from './ai-types';
import type {
  FlowJSON,
  GenerateFlowRequest,
  GenerationContext,
  ToolContext,
  ValidatedFlow,
  ValidationError
} from './types';
import { GenerationError } from './types';
import type { Tool, ToolJoin } from '@/tools/types';

/**
 * Main flow generator orchestrator
 */
export class FlowGenerator {
  private llmService: LLMService;
  private validator: FlowValidator;
  private errorRecovery: ErrorRecoverySystem;
  private cacheManager?: CacheManager;

  constructor(options?: { cache?: boolean }) {
    this.llmService = new LLMService();
    this.validator = new FlowValidator();
    this.errorRecovery = new ErrorRecoverySystem();

    if (options?.cache) {
      this.cacheManager = new CacheManager();
    }
  }

  /**
   * Generate a flow from request
   */
  generateFlow(
    request: GenerateFlowRequest
  ): Effect.Effect<ValidatedFlow, GenerationError> {
    // Check cache first
    if (this.cacheManager) {
      const cached = this.cacheManager.getCached(request);
      if (cached) {
        return Effect.succeed(cached);
      }
    }

    const context: GenerationContext = {
      prompt: request.prompt,
      tools: request.tools,
      joins: request.joins,
      currentModel: request.model,
      attemptCount: 0,
      errors: [],
    };

    return pipe(
      // Prepare tool context
      Effect.succeed(
        createToolContext(
          request.tools,
          request.joins,
          request.options?.constraints
        )
      ),
      // Attempt generation
      Effect.flatMap((toolContext) =>
        this.attemptGeneration(toolContext, context)
      ),
      // Cache successful result
      Effect.tap((result) => {
        if (this.cacheManager) {
          return Effect.sync(() => this.cacheManager!.store(request, result));
        }
        return Effect.void;
      })
    );
  }

  /**
   * Generate flow with streaming feedback
   */
  generateFlowStreaming(
    request: GenerateFlowRequest
  ): Effect.Effect<Ai.Stream, GenerationError> {
    const toolContext = createToolContext(
      request.tools,
      request.joins,
      request.options?.constraints
    );

    return Effect.succeed(
      this.llmService.streamGeneration(
        request.prompt,
        toolContext,
        request.model
      )
    );
  }

  /**
   * Validate an existing flow JSON
   */
  validateFlowJSON(
    json: FlowJSON,
    tools: ReadonlyArray<Tool<any, any>>,
    joins: ReadonlyArray<ToolJoin<any, any>>
  ): Effect.Effect<ValidatedFlow, ValidationError[]> {
    return this.validator.validate(json, tools, joins);
  }

  /**
   * Clear cache if enabled
   */
  clearCache(): Effect.Effect<void, never> {
    if (this.cacheManager) {
      return Effect.sync(() => this.cacheManager!.clear());
    }
    return Effect.void;
  }

  /**
   * Attempt generation with retry and escalation
   */
  private attemptGeneration(
    toolContext: ToolContext,
    context: GenerationContext
  ): Effect.Effect<ValidatedFlow, GenerationError> {
    return pipe(
      // Generate flow JSON
      this.llmService.generateFlow(
        context.prompt,
        toolContext,
        context.currentModel
      ),
      // Normalise LLM errors to GenerationError
      Effect.mapError((e) => new GenerationError(e.message, e, false)),
      // Validate the generated flow and catch only validation errors
      Effect.flatMap((json) =>
        pipe(
          this.validator.validate(json, context.tools, context.joins),
          Effect.catchAll((validationErrors: ValidationError[]) => {
            const updatedContext: GenerationContext = {
              ...context,
              attemptCount: context.attemptCount + 1,
              errors: [...context.errors, ...validationErrors],
            };
            const retryConfig = context.options?.retryStrategy || {
              maxAttempts: 3,
              maxEscalations: 2,
              backoffStrategy: 'exponential' as const,
            };
            return pipe(
              this.errorRecovery.handleGenerationFailure(
                validationErrors,
                updatedContext,
                retryConfig
              ),
              Effect.flatMap(() => {
                const enhancedContext: ToolContext = {
                  ...toolContext,
                  errorContext: validationErrors,
                };
                return this.attemptGeneration(enhancedContext, updatedContext);
              })
            );
          })
        )
      )
    );
  }
}

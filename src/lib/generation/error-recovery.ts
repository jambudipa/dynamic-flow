/**
 * Error Recovery System - Retry and model escalation logic
 */

import { Duration, Effect } from 'effect';
// Use local AiModel type instead of Ai namespace
import {
  type AiModel,
  type GenerationContext,
  GenerationError,
  type RetryStrategy,
  type ValidationError,
} from './types';

/**
 * Handles generation failures with retry and escalation
 */
export class ErrorRecoverySystem {
  /**
   * Handle generation failure with retry/escalation
   */
  handleGenerationFailure(
    errors: ValidationError[],
    context: GenerationContext,
    config: RetryStrategy
  ): Effect.Effect<void, GenerationError> {
    // Check if we should retry with same model
    if (this.shouldRetry(context.attemptCount, config.maxAttempts)) {
      return this.retryWithBackoff(
        context.attemptCount,
        config.backoffStrategy
      );
    }

    // Check if we should escalate to a better model
    if (this.shouldEscalate(context, config)) {
      const escalationPath =
        context.options?.escalationPath || this.getDefaultEscalationPath();
      const nextModel: AiModel | null = this.selectNextModel(
        context.currentModel,
        escalationPath
      );

      if (nextModel) {
        // Reset attempt count for new model
        context.currentModel = nextModel;
        context.attemptCount = 0;
        return Effect.void;
      }
    }

    // No more retries or escalations
    return Effect.fail(
      new GenerationError(
        `Flow generation failed after ${context.attemptCount} attempts: ${this.formatErrors(errors)}`,
        undefined,
        false
      )
    );
  }

  /**
   * Enhance prompt with error context
   */
  enhancePromptWithErrors(
    originalPrompt: string,
    errors: ValidationError[]
  ): string {
    const errorSummary = this.summariseErrors(errors);

    return `${originalPrompt}

IMPORTANT: Previous generation attempt failed with the following errors:
${errorSummary}

Please address these issues in the new generation:
${this.generateSuggestions(errors).join('\n')}`;
  }

  /**
   * Create error context for LLM
   */
  createErrorContext(errors: ValidationError[]): Record<string, unknown> {
    return {
      errorCount: errors.length,
      errorTypes: this.categoriseErrors(errors),
      specificErrors: errors.map((e) => ({
        code: e.code,
        message: e.message,
        path: e.path,
        suggestion: e.suggestion,
      })),
      suggestions: this.generateSuggestions(errors),
    };
  }

  /**
   * Track retry metrics
   */
  getRetryMetrics(context: GenerationContext): RetryMetrics {
    return {
      attemptCount: context.attemptCount,
      currentModel: context.currentModel.toString(),
      totalErrors: context.errors.length,
      errorTypes: Object.keys(this.categoriseErrors(context.errors)),
    };
  }

  /**
   * Check if we should retry with same model
   */
  private shouldRetry(attemptCount: number, maxAttempts: number): boolean {
    return attemptCount < maxAttempts;
  }

  /**
   * Check if we should escalate to a better model
   */
  private shouldEscalate(
    context: GenerationContext,
    config: RetryStrategy
  ): boolean {
    // Escalate if we've exhausted retries for current model
    const exhaustedRetries = context.attemptCount >= config.maxAttempts;

    // Check if we have escalation attempts left
    const escalationCount = this.getEscalationCount(context);
    const canEscalate = escalationCount < config.maxEscalations;

    return exhaustedRetries && canEscalate;
  }

  /**
   * Select next model in escalation path
   */
  private selectNextModel(
    currentModel: AiModel,
    escalationPath: AiModel[]
  ): AiModel | null {
    // Find current model in path
    const currentIndex = escalationPath.findIndex((m) =>
      this.modelsEqual(m, currentModel)
    );

    // If not in path, start from beginning
    if (currentIndex === -1) {
      return escalationPath.length > 0 ? escalationPath[0]! : null;
    }

    // Return next model if available
    if (currentIndex < escalationPath.length - 1) {
      return escalationPath[currentIndex + 1]!;
    }

    return null;
  }

  // Helper methods

  /**
   * Apply backoff before retry
   */
  private retryWithBackoff(
    attemptCount: number,
    strategy: 'exponential' | 'linear'
  ): Effect.Effect<void, never> {
    const baseDelay = 1000; // 1 second

    const delay =
      strategy === 'exponential'
        ? baseDelay * Math.pow(2, attemptCount)
        : baseDelay * (attemptCount + 1);

    return Effect.sleep(Duration.millis(delay));
  }

  private getEscalationCount(_context: GenerationContext): number {
    // Track how many times we've escalated
    // In real implementation, would track this properly
    return 0;
  }

  private modelsEqual(a: AiModel, b: AiModel): boolean {
    // Compare model identities
    // This is simplified - real implementation would properly compare
    return a === b;
  }

  private getDefaultEscalationPath(): AiModel[] {
    // Return default escalation path
    // In real implementation, would import actual models
    return [];
  }

  private formatErrors(errors: ValidationError[]): string {
    return errors.map((e) => `- ${e.message}`).join('\n');
  }

  private summariseErrors(errors: ValidationError[]): string {
    const byType = this.categoriseErrors(errors);

    return Object.entries(byType)
      .map(([type, errors]) => `${type}: ${errors.length} error(s)`)
      .join(', ');
  }

  private categoriseErrors(
    errors: ValidationError[]
  ): Record<string, ValidationError[]> {
    const categories: Record<string, ValidationError[]> = {};

    errors.forEach((error) => {
      if (!categories[error.type]) {
        categories[error.type] = [];
      }
      categories[error.type]!.push(error);
    });

    return categories;
  }

  private generateSuggestions(errors: ValidationError[]): string[] {
    const suggestions = new Set<string>();

    errors.forEach((error) => {
      if (error.suggestion) {
        suggestions.add(error.suggestion);
      } else {
        // Generate default suggestions based on error type
        switch (error.type) {
          case 'tool':
            suggestions.add(
              'Ensure all tools referenced exist in the provided tool list'
            );
            break;
          case 'connection':
            suggestions.add(
              'Verify data types are compatible between connected nodes'
            );
            break;
          case 'schema':
            suggestions.add('Follow the exact JSON schema structure');
            break;
          case 'operation':
            suggestions.add(
              'Ensure functional operations have all required fields'
            );
            break;
        }
      }
    });

    return Array.from(suggestions);
  }
}

interface RetryMetrics {
  attemptCount: number;
  currentModel: string;
  totalErrors: number;
  errorTypes: string[];
}

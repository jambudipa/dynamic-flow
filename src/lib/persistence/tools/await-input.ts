/**
 * AwaitInput Tool - Triggers flow suspension for external input
 *
 * This tool causes a flow to suspend when encountered, storing its complete
 * state and generating a resumption key. The flow can later be resumed with
 * the required input data.
 */

import { Effect, Schema, Duration, pipe } from 'effect';
import type { Tool, ToolRequirements } from '../../tools/types';
import type { ExecutionContext } from '../../types/core';
import { ToolError } from '../../types/errors';
import {
  type AwaitInputConfig,
  type PersistenceHub,
  type SuspensionContext,
  FlowSuspensionSignal,
  type SuspensionKey,
} from '../types';
import { logInfo, logDebug } from '../../utils/logging';

/**
 * AwaitInput tool implementation that triggers flow suspension
 */
export class AwaitInputTool<T> implements Tool<void, T> {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly category = 'persistence';
  readonly version = '1.0.0';
  readonly inputSchema = Schema.Void;
  readonly outputSchema: Schema.Schema<T>;
  readonly config?: undefined; // Tool interface optional config

  constructor(
    private readonly awaitConfig: AwaitInputConfig<T>,
    private readonly persistenceHub: PersistenceHub
  ) {
    this.id = `awaitInput_${awaitConfig.id}`;
    this.name = `Await Input: ${awaitConfig.name}`;
    this.description = awaitConfig.description;
    this.outputSchema = awaitConfig.schema;
  }

  /**
   * Execute the tool - this triggers flow suspension
   */
  execute(
    input: void,
    context: ExecutionContext
  ): Effect.Effect<T, ToolError, ToolRequirements> {
    const self = this;
    return Effect.gen(function* () {
      yield* logInfo('AwaitInput tool triggered', {
        toolName: self.id,
        flowId: context.flowId,
        stepId: context.stepId,
        metadata: { configId: self.awaitConfig.id },
      });

      // Create suspension context with all necessary information
      const suspensionContext: SuspensionContext = {
        toolId: self.id,
        awaitingInputSchema: self.awaitConfig.schema as Schema.Schema<
          unknown,
          unknown,
          never
        >,
        timeout: self.awaitConfig.timeout,
        defaultValue: self.awaitConfig.defaultValue,
        metadata: {
          ...self.awaitConfig.metadata,
          suspendedAt: new Date().toISOString(),
          awaitingToolId: self.awaitConfig.id,
          awaitingToolName: self.awaitConfig.name,
          awaitingDescription: self.awaitConfig.description,
          flowId: context.flowId,
          stepId: context.stepId,
          sessionId: context.sessionId,
        },
      };

      yield* logDebug('Created suspension context', {
        metadata: {
          suspensionContext,
          hasTimeout: !!self.awaitConfig.timeout,
          hasDefaultValue: self.awaitConfig.defaultValue !== undefined,
        },
      });

      // This is the key mechanism: throw a FlowSuspensionSignal
      // The flow engine will catch this and trigger the suspension process
      const suspensionSignal = new FlowSuspensionSignal({
        suspensionKey: 'pending' as SuspensionKey, // Will be set by persistence hub
        awaitingSchema: self.awaitConfig.schema as Schema.Schema<
          unknown,
          unknown,
          never
        >,
        message: `Flow suspended awaiting input for: ${self.awaitConfig.name}`,
        module: 'persistence',
        operation: 'awaitInput',
        cause: undefined,
      });

      // Create a ToolError using the proper constructor
      const toolError = new ToolError({
        toolId: self.id,
        phase: 'execution' as const,
        details: {
          suspensionSignal,
          suspensionContext,
          flowSuspended: true,
        },
        cause: suspensionSignal,
      });

      return yield* Effect.fail(toolError);
    });
  }

  /**
   * Get the expected input schema for this tool
   */
  getInputSchema(): Schema.Schema<T> {
    return this.awaitConfig.schema;
  }

  /**
   * Get timeout configuration
   */
  getTimeout(): Duration.Duration | undefined {
    return this.awaitConfig.timeout;
  }

  /**
   * Get default value if configured
   */
  getDefaultValue(): T | undefined {
    return this.awaitConfig.defaultValue;
  }

  /**
   * Check if this tool has a default value
   */
  hasDefaultValue(): boolean {
    return this.awaitConfig.defaultValue !== undefined;
  }

  /**
   * Get tool metadata
   */
  getMetadata(): Record<string, unknown> {
    return {
      ...this.awaitConfig.metadata,
      awaitingInputType: 'external',
      suspensionTrigger: true,
      requiresInput: !this.hasDefaultValue(),
    };
  }
}

/**
 * Create an AwaitInput tool with the given configuration
 */
export const createAwaitInputTool = <T>(
  config: AwaitInputConfig<T>,
  persistenceHub: PersistenceHub
): AwaitInputTool<T> => {
  return new AwaitInputTool(config, persistenceHub);
};

/**
 * Type-safe builder for AwaitInput tools
 */
export class AwaitInputBuilder<T = unknown> {
  private config: Partial<AwaitInputConfig<T>> = {};

  /**
   * Set the tool ID and name
   */
  withId(id: string, name: string): this {
    this.config = { ...this.config, id, name };
    return this;
  }

  /**
   * Set the description
   */
  withDescription(description: string): this {
    this.config = { ...this.config, description };
    return this;
  }

  /**
   * Set the input schema
   */
  withSchema<U>(schema: Schema.Schema<U>): AwaitInputBuilder<U> {
    const newBuilder = new AwaitInputBuilder<U>();
    newBuilder.config = { ...this.config, schema } as any;
    return newBuilder;
  }

  /**
   * Set a timeout for waiting
   */
  withTimeout(timeout: Duration.Duration): this {
    this.config = { ...this.config, timeout };
    return this;
  }

  /**
   * Set a default value if no input is provided
   */
  withDefaultValue(defaultValue: T): this {
    this.config = { ...this.config, defaultValue };
    return this;
  }

  /**
   * Set metadata
   */
  withMetadata(metadata: Record<string, unknown>): this {
    this.config = {
      ...this.config,
      metadata: { ...this.config.metadata, ...metadata },
    };
    return this;
  }

  /**
   * Build the AwaitInput tool
   */
  build(persistenceHub: PersistenceHub): AwaitInputTool<T> {
    // Validate required fields
    if (!this.config.id) {
      throw new Error('AwaitInput tool requires an ID');
    }
    if (!this.config.name) {
      throw new Error('AwaitInput tool requires a name');
    }
    if (!this.config.description) {
      throw new Error('AwaitInput tool requires a description');
    }
    if (!this.config.schema) {
      throw new Error('AwaitInput tool requires a schema');
    }

    return createAwaitInputTool(
      this.config as AwaitInputConfig<T>,
      persistenceHub
    );
  }
}

/**
 * Start building an AwaitInput tool
 */
export const awaitInput = (): AwaitInputBuilder => {
  return new AwaitInputBuilder();
};

/**
 * Predefined AwaitInput configurations for common use cases
 */
export const AwaitInputPresets = {
  /**
   * Wait for a simple text response
   */
  text: (id: string, name: string, description: string) =>
    awaitInput()
      .withId(id, name)
      .withDescription(description)
      .withSchema(Schema.String),

  /**
   * Wait for a yes/no decision
   */
  confirmation: (id: string, name: string, description: string) =>
    awaitInput()
      .withId(id, name)
      .withDescription(description)
      .withSchema(Schema.Boolean),

  /**
   * Wait for a number input
   */
  number: (id: string, name: string, description: string) =>
    awaitInput()
      .withId(id, name)
      .withDescription(description)
      .withSchema(Schema.Number),

  /**
   * Wait for file upload
   */
  file: (id: string, name: string, description: string) =>
    awaitInput()
      .withId(id, name)
      .withDescription(description)
      .withSchema(
        Schema.Struct({
          filename: Schema.String,
          contentType: Schema.String,
          size: Schema.Number,
          data: Schema.String, // base64 encoded
        })
      ),

  /**
   * Wait for approval with optional comments
   */
  approval: (id: string, name: string, description: string) =>
    awaitInput()
      .withId(id, name)
      .withDescription(description)
      .withSchema(
        Schema.Struct({
          approved: Schema.Boolean,
          comments: Schema.optional(Schema.String),
          approvedBy: Schema.optional(Schema.String),
          approvedAt: Schema.optional(Schema.String),
        })
      ),

  /**
   * Wait for form data
   */
  form: <T>(
    id: string,
    name: string,
    description: string,
    schema: Schema.Schema<T>
  ) =>
    awaitInput()
      .withId(id, name)
      .withDescription(description)
      .withSchema(schema),
};

/**
 * Utility to create timeout-based AwaitInput
 */
export const createTimedAwaitInput = <T>(
  config: Omit<AwaitInputConfig<T>, 'timeout'> & { timeoutMinutes: number },
  persistenceHub: PersistenceHub
): AwaitInputTool<T> => {
  return createAwaitInputTool(
    {
      ...config,
      timeout: Duration.minutes(config.timeoutMinutes),
    },
    persistenceHub
  );
};

/**
 * Utility to create AwaitInput with exponential timeout
 */
export const createExponentialTimeoutAwaitInput = <T>(
  config: Omit<AwaitInputConfig<T>, 'timeout'> & {
    baseTimeoutMinutes: number;
    attemptNumber: number;
  },
  persistenceHub: PersistenceHub
): AwaitInputTool<T> => {
  const timeoutMinutes =
    config.baseTimeoutMinutes * Math.pow(2, config.attemptNumber - 1);

  return createAwaitInputTool(
    {
      ...config,
      timeout: Duration.minutes(timeoutMinutes),
      metadata: {
        ...config.metadata,
        timeoutStrategy: 'exponential',
        baseTimeoutMinutes: config.baseTimeoutMinutes,
        attemptNumber: config.attemptNumber,
        calculatedTimeoutMinutes: timeoutMinutes,
      },
    },
    persistenceHub
  );
};

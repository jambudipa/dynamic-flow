/**
 * Tool Factory - Convenience functions for creating AwaitInput tools
 *
 * Provides pre-built configurations and factory functions for common
 * human-in-the-loop scenarios and input patterns.
 */

import { Schema, Duration } from 'effect';
import type { PersistenceHub } from '../types';
import {
  AwaitInputTool,
  createAwaitInputTool,
  AwaitInputPresets,
} from './await-input';

/**
 * Human-in-the-loop workflow tools
 */
export class HumanInTheLoopTools {
  constructor(private readonly persistenceHub: PersistenceHub) {}

  /**
   * Create approval workflow tool
   */
  approval(options: {
    id: string;
    name: string;
    description: string;
    timeoutHours?: number;
    requireComments?: boolean;
    allowDelegation?: boolean;
  }): AwaitInputTool<{
    approved: boolean;
    comments?: string;
    approvedBy?: string;
    approvedAt?: string;
    delegatedTo?: string;
  }> {
    const fields: any = {
      approved: Schema.Boolean,
      comments: options.requireComments
        ? Schema.String
        : Schema.optional(Schema.String),
      approvedBy: Schema.optional(Schema.String),
      approvedAt: Schema.optional(Schema.String),
    };
    if (options.allowDelegation) {
      fields.delegatedTo = Schema.optional(Schema.String);
    }
    const schema = Schema.Struct(fields);

    return createAwaitInputTool(
      {
        id: options.id,
        name: options.name,
        description: options.description,
        schema: schema as any,
        timeout: options.timeoutHours
          ? Duration.hours(options.timeoutHours)
          : undefined,
        metadata: {
          workflowType: 'approval',
          requireComments: options.requireComments || false,
          allowDelegation: options.allowDelegation || false,
        },
      },
      this.persistenceHub
    ) as any;
  }

  /**
   * Create document review tool
   */
  documentReview(options: {
    id: string;
    name: string;
    description: string;
    documentUrl: string;
    timeoutDays?: number;
  }): AwaitInputTool<{
    status: 'approved' | 'rejected' | 'needs_changes';
    feedback: string;
    reviewedBy: string;
    reviewedAt: string;
    changes?: Array<{
      section: string;
      comment: string;
      priority: 'high' | 'medium' | 'low';
    }>;
  }> {
    return createAwaitInputTool(
      {
        id: options.id,
        name: options.name,
        description: options.description,
        schema: Schema.Struct({
          status: Schema.Union(
            Schema.Literal('approved'),
            Schema.Literal('rejected'),
            Schema.Literal('needs_changes')
          ),
          feedback: Schema.String,
          reviewedBy: Schema.String,
          reviewedAt: Schema.String,
          changes: Schema.optional(
            Schema.Array(
              Schema.Struct({
                section: Schema.String,
                comment: Schema.String,
                priority: Schema.Union(
                  Schema.Literal('high'),
                  Schema.Literal('medium'),
                  Schema.Literal('low')
                ),
              })
            )
          ),
        }),
        timeout: options.timeoutDays
          ? Duration.days(options.timeoutDays)
          : undefined,
        metadata: {
          workflowType: 'document_review',
          documentUrl: options.documentUrl,
        },
      },
      this.persistenceHub
    ) as any;
  }

  /**
   * Create data entry tool
   */
  dataEntry<T>(options: {
    id: string;
    name: string;
    description: string;
    schema: Schema.Schema<T>;
    timeoutMinutes?: number;
    validation?: {
      required: boolean;
      customValidation?: string;
    };
  }): AwaitInputTool<T> {
    return createAwaitInputTool(
      {
        id: options.id,
        name: options.name,
        description: options.description,
        schema: options.schema,
        timeout: options.timeoutMinutes
          ? Duration.minutes(options.timeoutMinutes)
          : undefined,
        metadata: {
          workflowType: 'data_entry',
          validation: options.validation,
        },
      },
      this.persistenceHub
    ) as any;
  }

  /**
   * Create escalation tool
   */
  escalation(options: {
    id: string;
    name: string;
    description: string;
    escalationLevel: number;
    timeoutHours?: number;
  }): AwaitInputTool<any> {
    return createAwaitInputTool(
      {
        id: options.id,
        name: options.name,
        description: options.description,
        schema: Schema.Struct({
          action: Schema.Union(
            Schema.Literal('resolve'),
            Schema.Literal('escalate_further'),
            Schema.Literal('delegate'),
            Schema.Literal('abort')
          ),
          resolution: Schema.optional(Schema.String),
          escalatedTo: Schema.optional(Schema.String),
          notes: Schema.String,
          resolvedBy: Schema.String,
          resolvedAt: Schema.String,
        }),
        timeout: options.timeoutHours
          ? Duration.hours(options.timeoutHours)
          : undefined,
        metadata: {
          workflowType: 'escalation',
          escalationLevel: options.escalationLevel,
        },
      },
      this.persistenceHub
    ) as any;
  }

  /**
   * Create quality assurance check tool
   */
  qualityCheck(options: {
    id: string;
    name: string;
    description: string;
    checklistItems: string[];
    timeoutHours?: number;
  }): AwaitInputTool<any> {
    return createAwaitInputTool(
      {
        id: options.id,
        name: options.name,
        description: options.description,
        schema: Schema.Struct({
          overallStatus: Schema.Union(
            Schema.Literal('pass'),
            Schema.Literal('fail'),
            Schema.Literal('needs_review')
          ),
          checklist: Schema.Array(
            Schema.Struct({
              item: Schema.String,
              status: Schema.Union(
                Schema.Literal('pass'),
                Schema.Literal('fail'),
                Schema.Literal('n/a')
              ),
              notes: Schema.optional(Schema.String),
            })
          ),
          reviewedBy: Schema.String,
          reviewedAt: Schema.String,
          overallNotes: Schema.optional(Schema.String),
        }),
        timeout: options.timeoutHours
          ? Duration.hours(options.timeoutHours)
          : undefined,
        metadata: {
          workflowType: 'quality_check',
          checklistItems: options.checklistItems,
        },
      },
      this.persistenceHub
    ) as any;
  }
}

/**
 * Customer interaction workflow tools
 */
export class CustomerInteractionTools {
  constructor(private readonly persistenceHub: PersistenceHub) {}

  /**
   * Create customer feedback tool
   */
  feedback(options: {
    id: string;
    name: string;
    description: string;
    customerId: string;
    timeoutDays?: number;
  }): AwaitInputTool<any> {
    return createAwaitInputTool(
      {
        id: options.id,
        name: options.name,
        description: options.description,
        schema: Schema.Struct({
          rating: Schema.Number.pipe(Schema.int(), Schema.between(1, 5)),
          feedback: Schema.String,
          category: Schema.String,
          followUpRequired: Schema.Boolean,
          submittedAt: Schema.String,
        }),
        timeout: options.timeoutDays
          ? Duration.days(options.timeoutDays)
          : undefined,
        metadata: {
          workflowType: 'customer_feedback',
          customerId: options.customerId,
        },
      },
      this.persistenceHub
    ) as any;
  }

  /**
   * Create customer decision tool
   */
  decision(options: {
    id: string;
    name: string;
    description: string;
    choices: string[];
    customerId: string;
    timeoutDays?: number;
  }): AwaitInputTool<{
    choice: string;
    reason?: string;
    decisionMadeAt: string;
  }> {
    // Create union type from choices
    const choiceSchema =
      options.choices.length === 0
        ? Schema.String
        : options.choices.length === 1
          ? Schema.Literal(options.choices[0]!)
          : options.choices.length === 2
            ? Schema.Union(
                Schema.Literal(options.choices[0]!),
                Schema.Literal(options.choices[1]!)
              )
            : Schema.Union(
                Schema.Literal(options.choices[0]!),
                Schema.Literal(options.choices[1]!),
                ...options.choices.slice(2).map((c) => Schema.Literal(c))
              );

    return createAwaitInputTool(
      {
        id: options.id,
        name: options.name,
        description: options.description,
        schema: Schema.Struct({
          choice: choiceSchema as any,
          reason: Schema.optional(Schema.String),
          decisionMadeAt: Schema.String,
        }) as any,
        timeout: options.timeoutDays
          ? Duration.days(options.timeoutDays)
          : undefined,
        metadata: {
          workflowType: 'customer_decision',
          customerId: options.customerId,
          availableChoices: options.choices,
        },
      },
      this.persistenceHub
    ) as any;
  }

  /**
   * Create payment confirmation tool
   */
  paymentConfirmation(options: {
    id: string;
    name: string;
    description: string;
    amount: number;
    currency: string;
    customerId: string;
    timeoutHours?: number;
  }): AwaitInputTool<{
    confirmed: boolean;
    paymentMethod?: string;
    transactionId?: string;
    confirmedAt: string;
    notes?: string;
  }> {
    return createAwaitInputTool(
      {
        id: options.id,
        name: options.name,
        description: options.description,
        schema: Schema.Struct({
          confirmed: Schema.Boolean,
          paymentMethod: Schema.optional(Schema.String),
          transactionId: Schema.optional(Schema.String),
          confirmedAt: Schema.String,
          notes: Schema.optional(Schema.String),
        }),
        timeout: options.timeoutHours
          ? Duration.hours(options.timeoutHours)
          : undefined,
        metadata: {
          workflowType: 'payment_confirmation',
          customerId: options.customerId,
          amount: options.amount,
          currency: options.currency,
        },
      },
      this.persistenceHub
    ) as any;
  }
}

/**
 * Development and testing tools
 */
export class DevelopmentTools {
  constructor(private readonly persistenceHub: PersistenceHub) {}

  /**
   * Create manual testing checkpoint
   */
  manualTest(options: {
    id: string;
    name: string;
    description: string;
    testSteps: string[];
    timeoutMinutes?: number;
  }): AwaitInputTool<{
    testPassed: boolean;
    stepResults: Array<{
      step: string;
      result: 'pass' | 'fail' | 'skip';
      notes?: string;
    }>;
    testerName: string;
    testedAt: string;
    overallNotes?: string;
  }> {
    return createAwaitInputTool(
      {
        id: options.id,
        name: options.name,
        description: options.description,
        schema: Schema.Struct({
          testPassed: Schema.Boolean,
          stepResults: Schema.Array(
            Schema.Struct({
              step: Schema.String,
              result: Schema.Union(
                Schema.Literal('pass'),
                Schema.Literal('fail'),
                Schema.Literal('skip')
              ),
              notes: Schema.optional(Schema.String),
            })
          ),
          testerName: Schema.String,
          testedAt: Schema.String,
          overallNotes: Schema.optional(Schema.String),
        }),
        timeout: options.timeoutMinutes
          ? Duration.minutes(options.timeoutMinutes)
          : undefined,
        metadata: {
          workflowType: 'manual_test',
          testSteps: options.testSteps,
        },
      },
      this.persistenceHub
    ) as any;
  }

  /**
   * Create debugging checkpoint
   */
  debugCheckpoint(options: {
    id: string;
    name: string;
    description: string;
    debugInfo: Record<string, unknown>;
    timeoutMinutes?: number;
  }): AwaitInputTool<{
    action: 'continue' | 'step_through' | 'abort' | 'modify_state';
    notes: string;
    stateModifications?: Record<string, unknown>;
    debuggedBy: string;
    debuggedAt: string;
  }> {
    return createAwaitInputTool(
      {
        id: options.id,
        name: options.name,
        description: options.description,
        schema: Schema.Struct({
          action: Schema.Union(
            Schema.Literal('continue'),
            Schema.Literal('step_through'),
            Schema.Literal('abort'),
            Schema.Literal('modify_state')
          ),
          notes: Schema.String,
          stateModifications: Schema.optional(
            Schema.Record({
              key: Schema.String,
              value: Schema.Unknown,
            })
          ),
          debuggedBy: Schema.String,
          debuggedAt: Schema.String,
        }) as any,
        timeout: options.timeoutMinutes
          ? Duration.minutes(options.timeoutMinutes)
          : undefined,
        metadata: {
          workflowType: 'debug_checkpoint',
          debugInfo: options.debugInfo,
        },
      },
      this.persistenceHub
    ) as any;
  }
}

/**
 * Factory for creating tool factory instances
 */
export class ToolsFactory {
  readonly humanInTheLoop: HumanInTheLoopTools;
  readonly customerInteraction: CustomerInteractionTools;
  readonly development: DevelopmentTools;

  constructor(persistenceHub: PersistenceHub) {
    this.humanInTheLoop = new HumanInTheLoopTools(persistenceHub);
    this.customerInteraction = new CustomerInteractionTools(persistenceHub);
    this.development = new DevelopmentTools(persistenceHub);
  }

  /**
   * Create custom AwaitInput tool with full configuration
   */
  custom<T>(config: {
    id: string;
    name: string;
    description: string;
    schema: Schema.Schema<T>;
    timeout?: Duration.Duration;
    defaultValue?: T;
    metadata?: Record<string, unknown>;
  }): AwaitInputTool<T> {
    return createAwaitInputTool(config, this.humanInTheLoop['persistenceHub']);
  }

  /**
   * Create simple text input tool
   */
  textInput(
    id: string,
    name: string,
    description: string,
    timeoutMinutes?: number
  ): AwaitInputTool<string> {
    return AwaitInputPresets.text(id, name, description)
      .withTimeout(
        timeoutMinutes ? Duration.minutes(timeoutMinutes) : Duration.hours(1)
      )
      .build(this.humanInTheLoop['persistenceHub']);
  }

  /**
   * Create confirmation tool
   */
  confirmation(
    id: string,
    name: string,
    description: string,
    timeoutMinutes?: number
  ): AwaitInputTool<boolean> {
    return AwaitInputPresets.confirmation(id, name, description)
      .withTimeout(
        timeoutMinutes ? Duration.minutes(timeoutMinutes) : Duration.hours(1)
      )
      .build(this.humanInTheLoop['persistenceHub']);
  }

  /**
   * Create choice selection tool
   */
  choice<T extends string>(
    id: string,
    name: string,
    description: string,
    choices: T[],
    timeoutMinutes?: number
  ): AwaitInputTool<T> {
    // Create union schema from choices
    const choiceSchema =
      choices.length === 0
        ? Schema.String
        : choices.length === 1
          ? Schema.Literal(choices[0]!)
          : choices.length === 2
            ? Schema.Union(
                Schema.Literal(choices[0]!),
                Schema.Literal(choices[1]!)
              )
            : Schema.Union(
                Schema.Literal(choices[0]!),
                Schema.Literal(choices[1]!),
                ...choices.slice(2).map((c) => Schema.Literal(c))
              );

    return this.custom({
      id,
      name,
      description,
      schema: choiceSchema as Schema.Schema<T>,
      timeout: timeoutMinutes
        ? Duration.minutes(timeoutMinutes)
        : Duration.hours(1),
      metadata: {
        availableChoices: choices,
      },
    });
  }
}

/**
 * Create tools factory with persistence hub
 */
export const createToolsFactory = (
  persistenceHub: PersistenceHub
): ToolsFactory => {
  return new ToolsFactory(persistenceHub);
};

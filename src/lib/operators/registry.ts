/**
 * Operator Registry - Manages all unified operators
 */

import { Schema } from 'effect';
import type { OperatorType, UnifiedOperator } from './base';
import { ToolOperator } from './tool';
import { FilterOperator } from './filter';
import { ConditionalOperator } from './conditional';
import { LoopOperator } from './loop';
import { MapOperator } from './map';
import { ReduceOperator } from './reduce';
import { ParallelOperator } from './parallel';
import { SwitchOperator } from './switch';

/**
 * Singleton registry for all operators
 */
export class OperatorRegistry {
  private static instance: OperatorRegistry;
  private operators = new Map<OperatorType, UnifiedOperator>();

  private constructor() {
    // Register all built-in operators
    this.register(new ToolOperator());
    this.register(new FilterOperator());
    this.register(new ConditionalOperator());
    this.register(new LoopOperator());
    this.register(new MapOperator());
    this.register(new ReduceOperator());
    this.register(new ParallelOperator());
    this.register(new SwitchOperator());
  }

  static getInstance(): OperatorRegistry {
    if (!this.instance) {
      this.instance = new OperatorRegistry();
    }
    return this.instance;
  }

  register(operator: UnifiedOperator) {
    this.operators.set(operator.type as OperatorType, operator);
  }

  get(type: string): UnifiedOperator | undefined {
    return this.operators.get(type as OperatorType);
  }

  getAll(): UnifiedOperator[] {
    return Array.from(this.operators.values());
  }

  /**
   * Generate the recursive Step schema (union of all operator schemas)
   */
  generateRecursiveStepSchema(): Schema.Schema<any, any, any> {
    const schemas = this.getAll().map((op) => op.recursiveSchema);

    // Need at least 2 schemas for Union
    if (schemas.length < 2) {
      return schemas[0] || Schema.Unknown;
    }

    return Schema.Union(...(schemas as [any, any, ...any[]])) as Schema.Schema<
      any,
      any,
      any
    >;
  }

  /**
   * Generate the flat Step schema (union of all flat schemas)
   */
  generateFlatStepSchema(): Schema.Schema<any, any, never> {
    // Each operator provides a "flatSchema" that is discriminated by a
    // literal `type` field (e.g. 'tool', 'filter', ...). The flat Step schema
    // is simply the union of all of these operator-specific flat schemas.
    const schemas = this.getAll().map((op) => op.flatSchema);

    if (schemas.length === 0) {
      return Schema.Unknown as unknown as Schema.Schema<any, any, never>;
    }
    if (schemas.length === 1) {
      return schemas[0] as unknown as Schema.Schema<any, any, never>;
    }

    const union = Schema.Union(
      ...(schemas as unknown as [
        Schema.Schema<any, any, never>,
        Schema.Schema<any, any, never>,
        ...Schema.Schema<any, any, never>[],
      ])
    );
    return union as Schema.Schema<any, any, never>;
  }

  /**
   * Transform a recursive workflow to flat representation
   */
  recursiveToFlat(workflow: any): any {
    const steps: any[] = [];
    const rootIds: string[] = [];

    const processStep = (step: any): string => {
      const operator = this.get(step.type || this.inferType(step));
      if (!operator) {
        throw new Error(
          `Unknown operator type for step: ${JSON.stringify(step)}`
        );
      }

      const flatStep = operator.toFlat(step);
      steps.push(flatStep);

      // Process nested steps recursively
      if (step.body) {
        flatStep.bodyIds = step.body.map((s: any) => processStep(s));
      }
      if (step.if_true) {
        flatStep.ifTrueIds = step.if_true.map((s: any) => processStep(s));
      }
      if (step.if_false) {
        flatStep.ifFalseIds = step.if_false.map((s: any) => processStep(s));
      }
      if (step.with) {
        flatStep.withId = processStep(step.with);
      }
      if (step.parallel) {
        flatStep.parallelIds = step.parallel.map((s: any) => processStep(s));
      }
      if (step.branches) {
        flatStep.branchIds = {};
        for (const [key, branch] of Object.entries(step.branches)) {
          flatStep.branchIds[key] = (branch as any[]).map((s: any) =>
            processStep(s)
          );
        }
      }

      return step.id;
    };

    if (workflow.flow) {
      workflow.flow.forEach((step: any) => {
        rootIds.push(processStep(step));
      });
    }

    return {
      version: workflow.version,
      metadata: workflow.metadata,
      steps,
      rootIds,
    };
  }

  /**
   * Transform a flat workflow back to recursive representation
   */
  flatToRecursive(flat: any): any {
    const stepMap = new Map<string, any>();

    // First pass: create all steps without nested references
    flat.steps.forEach((flatStep: any) => {
      const operator = this.get(flatStep.type);
      if (!operator) {
        throw new Error(`Unknown operator type: ${flatStep.type}`);
      }

      // Create basic step without references
      const basicStep: any = {
        id: flatStep.id,
        output: flatStep.output,
        timeout: flatStep.timeout,
        retry: flatStep.retry,
        description: flatStep.description,
      };

      // Add type-specific fields (but not nested references)
      switch (flatStep.type) {
        case 'tool':
          basicStep.tool = flatStep.tool;
          basicStep.args = flatStep.args;
          break;
        case 'filter':
          basicStep.filter = flatStep.filter;
          basicStep.condition = flatStep.condition;
          break;
        case 'conditional':
          basicStep.condition = flatStep.condition;
          break;
        case 'loop':
          basicStep.loop = flatStep.loop;
          basicStep.over = flatStep.over;
          basicStep.condition = flatStep.condition;
          break;
        case 'map':
          basicStep.map = flatStep.map;
          break;
        case 'reduce':
          basicStep.reduce = flatStep.reduce;
          basicStep.initial = flatStep.initial;
          break;
        case 'switch':
          basicStep.switch = flatStep.switch;
          basicStep.options = flatStep.options;
          break;
      }

      stepMap.set(flatStep.id, basicStep);
    });

    // Create resolver
    const resolver = {
      resolve: (id: string) => stepMap.get(id),
      resolveMany: (ids: string[]) =>
        ids.map((id) => stepMap.get(id)).filter(Boolean),
    };

    // Second pass: resolve all references
    flat.steps.forEach((flatStep: any) => {
      const step = stepMap.get(flatStep.id);
      if (!step) return;

      const operator = this.get(flatStep.type);
      if (operator) {
        const resolved = operator.fromFlat(flatStep, resolver);
        Object.assign(step, resolved);
      }
    });

    // Build the flow from root IDs
    const flow = flat.rootIds
      .map((id: string) => stepMap.get(id))
      .filter(Boolean);

    return {
      version: flat.version,
      metadata: flat.metadata,
      flow,
    };
  }

  private inferType(step: any): OperatorType {
    if (step.tool) return 'tool';
    if (step.filter) return 'filter';
    if ('if_true' in step || 'if_false' in step) return 'conditional';
    if (step.loop) return 'loop';
    if (step.map) return 'map';
    if (step.reduce) return 'reduce';
    if (step.parallel) return 'parallel';
    if (step.switch || step.branches) return 'switch';
    return 'tool';
  }
}

/**
 * Utility functions for operators
 */

import type { OperatorType } from './base';

/**
 * Infer the operator type from a step configuration
 */
export function inferType(step: any): OperatorType {
  if (step.tool) return 'tool';
  if (step.filter) return 'filter';
  if ('if_true' in step || 'if_false' in step) return 'conditional';
  if (step.loop) return 'loop';
  if (step.map) return 'map';
  if (step.reduce) return 'reduce';
  if (step.parallel) return 'parallel';
  if (step.switch || step.branches) return 'switch';
  return 'tool'; // Default
}

/**
 * Resolve variable references in values
 * Handles $varName and $step.property syntax
 */
export function resolveVariables(value: any, variables: Map<string, any>): any {
  if (typeof value === 'string' && value.startsWith('$')) {
    const varPath = value.slice(1);

    // Handle property paths like "step1.output"
    const parts = varPath.split('.');
    const firstPart = parts[0];
    if (!firstPart) return value;

    let resolved = variables.get(firstPart);

    if (resolved != null && parts.length > 1) {
      for (let i = 1; i < parts.length && resolved != null; i++) {
        const part = parts[i];
        if (part) {
          resolved = resolved[part];
        }
      }
    }

    return resolved !== undefined ? resolved : value;
  }

  if (typeof value === 'object' && value !== null) {
    const resolved: any = Array.isArray(value) ? [] : {};
    for (const [key, val] of Object.entries(value)) {
      resolved[key] = resolveVariables(val, variables);
    }
    return resolved;
  }

  return value;
}

/**
 * Simple condition evaluation
 * Supports: varName == value, varName > value, etc.
 */
export function evaluateCondition(
  condition: string,
  variables: Map<string, any> | Record<string, any>
): boolean {
  const vars =
    variables instanceof Map ? variables : new Map(Object.entries(variables));

  // Parse simple conditions like "x > 5" or "$count == 10"
  const parts = condition.split(/\s+/);
  if (parts.length !== 3) {
    // Try to evaluate as boolean variable
    const value = resolveVariables(condition, vars);
    return Boolean(value);
  }

  const [left, op, right] = parts;
  const leftVal = resolveVariables(left, vars);
  const rightVal = resolveVariables(right, vars);

  switch (op) {
    case '==':
    case '===':
      return leftVal == rightVal;
    case '!=':
    case '!==':
      return leftVal != rightVal;
    case '>':
      return Number(leftVal) > Number(rightVal);
    case '<':
      return Number(leftVal) < Number(rightVal);
    case '>=':
      return Number(leftVal) >= Number(rightVal);
    case '<=':
      return Number(leftVal) <= Number(rightVal);
    default:
      return false;
  }
}

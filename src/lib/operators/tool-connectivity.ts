/**
 * Tool Connectivity Rules for LLM Generation
 *
 * This module defines which tools can connect to each other,
 * helping LLMs generate valid flows and validating their output.
 */

import type { Tool, ToolJoin } from '@/lib/tools/types';

export interface ToolConnectivityRule {
  from: string | string[]; // Tool ID(s) or wildcard
  to: string | string[]; // Tool ID(s) or wildcard
  description?: string; // Human-readable explanation
  required?: boolean; // Whether this connection must have a join
}

export interface ToolCapabilities {
  inputs: string[]; // Types of data this tool accepts
  outputs: string[]; // Types of data this tool produces
  allowedBefore?: string[]; // Tools that can come before
  allowedAfter?: string[]; // Tools that can come after
  forbidden?: string[]; // Tools that must not connect
}

/**
 * Generate connectivity rules from tools and joins
 */
export function generateConnectivityRules(
  tools: ReadonlyArray<Tool<any, any>>,
  joins: ReadonlyArray<ToolJoin<any, any>>
): ToolConnectivityRule[] {
  const rules: ToolConnectivityRule[] = [];

  // Generate rules from explicit joins
  for (const join of joins) {
    rules.push({
      from: join.fromTool,
      to: join.toTool,
      description: `Join from ${join.fromTool} to ${join.toTool}`,
      required: true,
    });
  }

  // Add tool-specific constraints if they exist
  for (const tool of tools) {
    const metadata = (tool as any).metadata;
    if (metadata?.connectivity) {
      const conn = metadata.connectivity as ToolCapabilities;

      if (conn.allowedBefore) {
        for (const beforeTool of conn.allowedBefore) {
          rules.push({
            from: beforeTool,
            to: tool.id,
            description: `${beforeTool} can precede ${tool.id}`,
          });
        }
      }

      if (conn.allowedAfter) {
        for (const afterTool of conn.allowedAfter) {
          rules.push({
            from: tool.id,
            to: afterTool,
            description: `${tool.id} can precede ${afterTool}`,
          });
        }
      }

      if (conn.forbidden) {
        // These will be used for validation, not included in prompt
      }
    }
  }

  return rules;
}

/**
 * Generate LLM prompt section for tool connectivity
 */
export function generateConnectivityPrompt(
  tools: ReadonlyArray<Tool<any, any>>,
  joins: ReadonlyArray<ToolJoin<any, any>>
): string {
  const rules = generateConnectivityRules(tools, joins);

  let prompt = '\nTool Connectivity Rules:\n';
  prompt += 'The following tools can be connected in sequence:\n';

  // Group by source tool for clarity
  const rulesBySource = new Map<string, string[]>();
  for (const rule of rules) {
    const sources = Array.isArray(rule.from) ? rule.from : [rule.from];
    const targets = Array.isArray(rule.to) ? rule.to : [rule.to];

    for (const source of sources) {
      if (!rulesBySource.has(source)) {
        rulesBySource.set(source, []);
      }
      rulesBySource.get(source)!.push(...targets);
    }
  }

  for (const [source, targets] of rulesBySource.entries()) {
    prompt += `- ${source} → [${[...new Set(targets)].join(', ')}]\n`;
  }

  // Add general rules
  prompt += '\nIMPORTANT:\n';
  prompt += '- Only connect tools as specified above\n';
  prompt += '- Tools not listed as connected should not appear in sequence\n';
  prompt +=
    '- Use conditional or parallel operators to branch flow when needed\n';
  prompt +=
    '- Ensure variable references ($step.output) point to previous steps\n';

  return prompt;
}

/**
 * Validate tool connectivity in a flow
 */
export interface ConnectivityValidation {
  valid: boolean;
  errors: Array<{
    from: string;
    to: string;
    message: string;
  }>;
}

export function validateToolConnectivity(
  flow: any,
  tools: Map<string, Tool<any, any>>,
  joins: Map<string, ToolJoin<any, any>>
): ConnectivityValidation {
  const errors: ConnectivityValidation['errors'] = [];

  // Extract tool sequence from flow
  const toolSequence = extractToolSequence(flow.flow || flow);

  // Check each consecutive pair
  for (let i = 0; i < toolSequence.length - 1; i++) {
    const fromTool = toolSequence[i];
    const toTool = toolSequence[i + 1];

    // Check if tools exist
    if (!fromTool || !tools.has(fromTool)) {
      errors.push({
        from: fromTool || 'undefined',
        to: toTool || 'undefined',
        message: `Tool '${fromTool}' not found in registry`,
      });
      continue;
    }

    if (!toTool || !tools.has(toTool)) {
      errors.push({
        from: fromTool || 'undefined',
        to: toTool || 'undefined',
        message: `Tool '${toTool}' not found in registry`,
      });
      continue;
    }

    // Check if join exists
    const joinKey = `${fromTool}-${toTool}`;
    const join = joins.get(joinKey);

    if (!join) {
      // Check if tools have compatible types (via metadata)
      const fromToolObj = fromTool ? tools.get(fromTool) : undefined;
      const toToolObj = toTool ? tools.get(toTool) : undefined;
      const fromMeta = (fromToolObj as any)?.metadata;
      const toMeta = (toToolObj as any)?.metadata;

      // Check forbidden connections
      if (fromMeta?.connectivity?.forbidden?.includes(toTool)) {
        errors.push({
          from: fromTool || 'undefined',
          to: toTool || 'undefined',
          message: `Tool '${fromTool}' cannot connect to '${toTool}' (forbidden)`,
        });
      } else if (toMeta?.connectivity?.forbidden?.includes(fromTool)) {
        errors.push({
          from: fromTool || 'undefined',
          to: toTool || 'undefined',
          message: `Tool '${toTool}' cannot accept input from '${fromTool}' (forbidden)`,
        });
      } else {
        // Just a warning - might still work
        console.warn(`No explicit join from '${fromTool}' to '${toTool}'`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Extract linear sequence of tools from a flow
 */
function extractToolSequence(steps: any[]): string[] {
  const sequence: string[] = [];

  function visit(step: any): void {
    if (step.type === 'tool' && step.tool) {
      sequence.push(step.tool);
    } else if (step.type === 'conditional') {
      // For conditionals, we check both branches
      if (step.if_true) step.if_true.forEach(visit);
      if (step.if_false) step.if_false.forEach(visit);
    } else if (step.type === 'loop' && step.body) {
      step.body.forEach(visit);
    } else if (step.type === 'parallel' && step.parallel) {
      step.parallel.forEach(visit);
    }
  }

  steps.forEach(visit);
  return sequence;
}

/**
 * Generate corrective prompt for LLM when validation fails
 */
export function generateCorrectivePrompt(
  validation: ConnectivityValidation
): string {
  let prompt = 'The generated flow has connectivity errors:\n\n';

  for (const error of validation.errors) {
    prompt += `❌ ${error.message}\n`;
    prompt += `   Cannot connect '${error.from}' → '${error.to}'\n\n`;
  }

  prompt += '\nPlease regenerate the flow with the following corrections:\n';
  prompt += '1. Only connect tools that have defined joins\n';
  prompt += '2. Check that all tool IDs match exactly\n';
  prompt +=
    '3. Consider using parallel or conditional operators to avoid invalid sequences\n';
  prompt += '4. Ensure each tool exists in the registry\n';

  return prompt;
}

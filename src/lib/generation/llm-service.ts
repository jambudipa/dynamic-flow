/**
 * LLM Service - Integration with Effect AI for flow generation
 */

import type { Stream } from 'effect';
import { Effect, pipe } from 'effect';
import type { AiModel } from './types';
import { type FlowJSON, LLMGenerationError, type ToolContext } from './types';
import {
  formatToolCapabilities,
  formatToolJoins,
  summariseOperations,
} from './tool-context';
import { safeOp } from '../utils/effect-patterns';
import { logDebug } from '../utils/logging';
import { ParseError } from '../errors/base';

/**
 * Service for generating flows using LLM
 */
export class LLMService {
  /**
   * Generate flow JSON using LLM
   */
  generateFlow(
    prompt: string,
    toolContext: ToolContext,
    model: AiModel
  ): Effect.Effect<FlowJSON, LLMGenerationError> {
    const systemPrompt = this.createSystemPrompt(toolContext);
    const userPrompt = this.createUserPrompt(prompt);
    const debug = process.env.DYNAMIC_FLOW_DEBUG === '1';

    return pipe(
      // Create completion request
      this.createCompletion(model, systemPrompt, userPrompt),
      // Optional debug: raw LLM content
      Effect.tap((completion) =>
        debug
          ? pipe(
              logDebug('[DynamicFlow][LLM][raw]', { module: 'LLM' }),
              Effect.flatMap(() =>
                logDebug(completion.content, { module: 'LLM' })
              )
            )
          : Effect.void
      ),
      // Parse response to JSON
      Effect.flatMap((completion) => this.parseResponse(completion)),
      // Optional debug: parsed JSON (pre-validation)
      Effect.tap((json) =>
        debug
          ? pipe(
              safeOp(
                () => JSON.stringify(json, null, 2),
                () =>
                  new ParseError({
                    input: String(json),
                    expected: 'JSON',
                    message: 'Failed to stringify JSON for debug output',
                  })
              ),
              Effect.flatMap((jsonStr) =>
                pipe(
                  logDebug('[DynamicFlow][LLM][parsed-json]', {
                    module: 'LLM',
                  }),
                  Effect.flatMap(() => logDebug(jsonStr, { module: 'LLM' }))
                )
              ),
              Effect.catchAll(() =>
                pipe(
                  logDebug('[DynamicFlow][LLM][parsed-json]', {
                    module: 'LLM',
                  }),
                  Effect.flatMap(() =>
                    logDebug(String(json), { module: 'LLM' })
                  )
                )
              )
            )
          : Effect.void
      ),
      // Validate basic structure
      Effect.flatMap((json) => this.validateBasicStructure(json))
    );
  }

  /**
   * Stream tokens from LLM (for real-time feedback)
   */
  streamGeneration(
    prompt: string,
    toolContext: ToolContext,
    model: AiModel
  ): Stream.Stream<any, never> {
    const systemPrompt = this.createSystemPrompt(toolContext);
    const userPrompt = this.createUserPrompt(prompt);

    const aiPrompt = `${systemPrompt}\n\n${userPrompt}`;

    return model.stream(aiPrompt);
  }

  /**
   * Create completion using Effect AI
   */
  private createCompletion(
    model: AiModel,
    systemPrompt: string,
    userPrompt: string
  ): Effect.Effect<{ content: string }, never> {
    const prompt = `${systemPrompt}\n\n${userPrompt}`;
    // Use the model to generate completion
    return model.completion(prompt, {
      temperature: 0.3,
      maxTokens: 4000,
    });
  }

  /**
   * Create system prompt with tool context
   */
  private createSystemPrompt(context: ToolContext): string {
    const toolsDesc = formatToolCapabilities(context.tools);
    const joinsDesc = formatToolJoins(context.joins);
    const opsDesc = summariseOperations(context.constraints ?? {});

    return `You are a flow generator that creates executable workflows in JSON format.

${toolsDesc}

${joinsDesc}

${opsDesc}

Flow JSON Structure:
{
  "version": "1.0",
  "metadata": {
    "name": "string",
    "description": "string",
    "generated": true
  },
  "nodes": [
    {
      "id": "unique-id",
      "type": "tool|if-then|map|filter|reduce|parallel|sequence",
      "toolId": "tool-id (for tool nodes)",
      "operation": { /* for functional nodes */ },
      "inputs": { /* input mappings */ }
    }
  ],
  "edges": [
    {
      "from": "node-id",
      "to": "node-id",
      "condition": "optional condition"
    }
  ]
}

For functional operations (_map, _filter, _reduce):
- Use "operation" field to specify the operation
- Set "operation.over" to reference the collection
- Use "operation.operation.prompt" for LLM-based operations
- Use "operation.operation.tool" for tool-based operations
- Set "operation.concurrency" for parallel execution

For conditionals (if-then):
- Set "condition.type" to "llm", "expression", or "tool"
- Provide "then" array with node IDs for true branch
- Optionally provide "else" array for false branch

Rules:
1. Only use tools that are provided
2. Ensure data flows correctly between nodes
3. Use tool joins when specified
4. Create efficient flows with minimal steps
5. Use parallel execution where possible
6. Include error handling considerations
${
  context.errorContext !== null && context.errorContext !== undefined
    ? '\n7. Address the following errors from previous attempt:\n' +
      context.errorContext.map((e) => `- ${e.message}`).join('\n')
    : ''
}`;
  }

  /**
   * Create user prompt
   */
  private createUserPrompt(prompt: string): string {
    return `Generate a flow for the following task:

${prompt}

Requirements:
- Use the available tools efficiently
- Ensure type compatibility between connections
- Maximise parallelism where appropriate
- Return ONLY raw JSON matching the flow schema
- Do NOT include explanations, markdown, or code fences
- Do NOT include comments in JSON
- Include meaningful node IDs and metadata`;
  }

  /**
   * Parse LLM response to FlowJSON
   */
  private parseResponse(completion: {
    content: string;
  }): Effect.Effect<FlowJSON, LLMGenerationError> {
    const debug = process.env.DYNAMIC_FLOW_DEBUG === '1';

    const sanitize = (raw: string): string => {
      let text = raw.trim();
      // Extract fenced ```json ... ``` block if present
      const fenceMatch =
        text.match(/```json\s*([\s\S]*?)```/i) ??
        text.match(/```\s*([\s\S]*?)```/i);
      if (
        fenceMatch !== null &&
        fenceMatch[1] !== null &&
        fenceMatch[1] !== undefined
      ) {
        text = fenceMatch[1].trim();
      }
      // If still surrounded by prose, try to isolate first JSON object by braces
      if (!(text.startsWith('{') && text.endsWith('}'))) {
        const start = text.indexOf('{');
        if (start >= 0) {
          let depth = 0;
          let end = -1;
          for (let i = start; i < text.length; i++) {
            const c = text[i];
            if (c === undefined) break;
            if (c === '{') depth++;
            if (c === '}') {
              depth--;
              if (depth === 0) {
                end = i;
                break;
              }
            }
          }
          if (end > start) text = text.slice(start, end + 1);
        }
      }
      // Strip /* */ and // comments
      text = text
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/([^:])\/\/.*$/gm, '$1')
        .trim();
      return text;
    };

    const postProcess = (
      obj: Record<string, unknown>
    ): Effect.Effect<Record<string, unknown>, never> =>
      Effect.try(() => {
        if (obj !== null && obj !== undefined && Array.isArray(obj.nodes)) {
          for (const node of obj.nodes as Array<{
            inputs?: Record<string, unknown>;
          }>) {
            if (
              node !== null &&
              node !== undefined &&
              node.inputs !== null &&
              node.inputs !== undefined &&
              typeof node.inputs === 'object'
            ) {
              for (const [k, v] of Object.entries(node.inputs)) {
                if (
                  v !== null &&
                  v !== undefined &&
                  typeof v === 'object' &&
                  'source' in v &&
                  typeof (v as { source?: unknown | undefined }).source === 'string'
                ) {
                  const src = (v as { source: string }).source;
                  const base = src.split('.')[0] ?? src;
                  node.inputs[k] = `$${base}`;
                }
              }
            }
          }
        }
        return obj;
      }).pipe(Effect.catchAll(() => Effect.succeed(obj)));

    return pipe(
      Effect.sync(() => completion.content),
      Effect.map((content) => sanitize(content)),
      Effect.flatMap((text) =>
        safeOp(
          () => JSON.parse(text) as Record<string, unknown>,
          (error) =>
            new LLMGenerationError(
              `Failed to parse LLM response as JSON: ${error}`,
              error instanceof Error ? error : new Error(String(error))
            )
        )
      ),
      Effect.flatMap((parsed) => postProcess(parsed)),
      Effect.tap((fixed) =>
        debug
          ? pipe(
              safeOp(
                () => JSON.stringify(fixed, null, 2),
                () =>
                  new ParseError({
                    input: String(fixed),
                    expected: 'JSON',
                    message:
                      'Failed to stringify sanitized JSON for debug output',
                  })
              ),
              Effect.flatMap((jsonStr) =>
                pipe(
                  logDebug('[DynamicFlow][LLM][sanitized-json]', {
                    module: 'LLM',
                  }),
                  Effect.flatMap(() => logDebug(jsonStr, { module: 'LLM' }))
                )
              ),
              Effect.catchAll(() => Effect.void)
            )
          : Effect.void
      ),
      Effect.map((fixed) => fixed as unknown as FlowJSON)
    );
  }

  /**
   * Validate basic JSON structure
   */
  private validateBasicStructure(
    json: FlowJSON
  ): Effect.Effect<FlowJSON, LLMGenerationError> {
    const errors: string[] = [];

    // Check required fields
    if (!json.version) {
      errors.push("Missing 'version' field");
    }
    if (!Array.isArray(json.nodes)) {
      errors.push("'nodes' must be an array");
    }
    if (!Array.isArray(json.edges)) {
      errors.push("'edges' must be an array");
    }

    // Check nodes have required fields
    if (Array.isArray(json.nodes)) {
      json.nodes.forEach((node, i) => {
        if (!node.id) {
          errors.push(`Node at index ${i} missing 'id'`);
        }
        if (!node.type) {
          errors.push(`Node at index ${i} missing 'type'`);
        }
        if (
          node.type === 'tool' &&
          (node.toolId === null ||
            node.toolId === undefined ||
            node.toolId === '')
        ) {
          errors.push(`Tool node '${node.id}' missing 'toolId'`);
        }
      });
    }

    // Check edges have required fields
    if (Array.isArray(json.edges)) {
      json.edges.forEach((edge, i) => {
        if (edge.from === null || edge.from === undefined || edge.from === '') {
          errors.push(`Edge at index ${i} missing 'from'`);
        }
        if (edge.to === null || edge.to === undefined || edge.to === '') {
          errors.push(`Edge at index ${i} missing 'to'`);
        }
      });
    }

    if (errors.length > 0) {
      return Effect.fail(
        new LLMGenerationError(`Invalid flow structure: ${errors.join(', ')}`)
      );
    }

    // Set defaults
    if (json.metadata === null || json.metadata === undefined) {
      json.metadata = {};
    }
    json.metadata.generated = true;
    json.metadata.timestamp = new Date().toISOString();

    return Effect.succeed(json);
  }
}

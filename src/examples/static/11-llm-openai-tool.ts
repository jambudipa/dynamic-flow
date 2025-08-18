/**
 * LLM Tool Example (OpenAI)
 *
 * Demonstrates the OpenAI completion tool integration with Flow.run
 * for straightforward LLM interactions using the central service.
 *
 * Features demonstrated:
 * - OpenAI tool creation and configuration
 * - Direct Flow.run execution pattern
 * - Environment validation for API keys
 * - Simple prompt-response workflows
 * - Error handling for missing credentials
 *
 * Performance characteristics:
 * - Direct execution: Minimal overhead with Flow.run
 * - Single request: One API call per execution
 * - Model efficiency: Uses gpt-5 for cost optimization
 *
 * Expected console output:
 * ```
 * Validating OpenAI credentials...
 * Executing LLM tool with prompt...
 * LLM response: "DynamicFlow refers to a system or process..."
 * ```
 *
 * Return value: Promise<{ response: string }>
 * Note: Requires OPENAI_API_KEY environment variable
 *
 * Run: npx tsx examples/static/11-llm-openai-tool.ts
 */

import { loadEnv } from '../env';
import { Effect, pipe } from 'effect';
import { Flow, Tools as ToolFns } from '../../lib/flow/flow';
import { createOpenAiCompletionTool } from '../../lib/llm/providers/effect-openai-tool';
import { LLMServiceLive } from '../../lib/llm/service';

/**
 * Programmatic example runner for testing and integration
 */
export async function runExample(): Promise<{ response: string }> {
  console.log('=== LLM OpenAI Tool Example ===\n');

  loadEnv();

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required to run this example');
  }

  console.log('Validating OpenAI credentials...');

  try {
    // Create an OpenAI-backed tool (gpt-5)
    const echoTool = createOpenAiCompletionTool(
      'llm:echo',
      'LLM Echo',
      'Generates a response from a prompt'
    );

    const run = ToolFns.createTool(echoTool);

    console.log('Executing LLM tool with prompt...');
    const program = pipe(
      Effect.succeed({ prompt: 'Respond succinctly: What is DynamicFlow?' }),
      Flow.andThen(run)
    );

    const programWithLLM = pipe(program, Effect.provide(LLMServiceLive));
    const output = (await Flow.run(programWithLLM)) as { response: string };

    let response: string;
    if ('response' in output) {
      console.log('LLM response:', output.response);
      response = output.response;
    } else {
      console.log('LLM output:', output);
      response = JSON.stringify(output);
    }

    console.log('\n✅ OpenAI tool execution completed successfully!');
    return { response };
  } catch (error) {
    console.error('❌ OpenAI tool execution failed:', error);
    throw error;
  }
}

// Run the example when executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runExample().catch((e) => {
    console.error('Example failed:', e);
    process.exit(1);
  });
}

/**
 * Expected Output:
 * ===============
 *
 * === LLM OpenAI Tool Example ===
 *
 * Validating OpenAI credentials...
 * Executing LLM tool with prompt...
 * LLM response: Dynamic flow = any flow that varies over time rather than being steady-state. In networks/algorithms it means time-dependent flow (flows with travel/delay times, time-varying capacities and arrivals); in fluid mechanics it's called unsteady flow (velocity/pressure change with time). Common applications: traffic/transport modeling, communications and supply chains, and transient fluid problems.
 *
 * ✅ OpenAI tool execution completed successfully!
 *
 * Note: Requires OPENAI_API_KEY environment variable
 */

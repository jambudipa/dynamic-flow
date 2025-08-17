/**
 * Example: Raw OpenAI Responses API
 *
 * Demonstrates direct usage of OpenAI's responses API with structured output,
 * showing low-level API integration without abstraction layers.
 *
 * Features demonstrated:
 * - Direct OpenAI API calls using fetch
 * - JSON schema validation with strict mode
 * - Raw response handling and error checking
 * - Environment variable security practices
 * - HTTP status code handling
 *
 * Performance characteristics:
 * - Direct API access: Minimal overhead
 * - Schema validation: Server-side enforcement
 * - Single request: One HTTP call per execution
 *
 * Expected console output:
 * ```
 * Making raw OpenAI API request...
 * Request payload: { model: "gpt-5", input: "..." }
 * Response status: 200
 * Raw response: { id: "...", choice: "prep:prompt1", reason: "..." }
 * ```
 *
 * Return value: Promise<{ choice: string; reason: string }>
 * Note: Requires OPENAI_API_KEY environment variable
 *
 * Run: npx tsx examples/static/14-responses-raw.ts
 */

import { loadEnv } from '../env';

interface ChoiceResponse {
  choice: string;
  reason: string;
}

/**
 * Programmatic example runner for testing and integration
 */
export async function runExample(): Promise<ChoiceResponse> {
  console.log('=== Raw OpenAI Responses API Example ===\n');

  loadEnv();

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY is required for raw API access');
  }

  console.log('Making raw OpenAI API request...');

  try {
    const body = {
      model: 'gpt-5',  // Updated to current model
      input: 'Return only valid JSON according to the schema. Choose the best id for a topic about Buddhist selflessness of persons: prep:prompt1, prep:prompt2, prep:prompt3.',
      text: {
        format: {
          type: 'json_schema',
          name: 'choice',
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              choice: { type: 'string', enum: ['prep:prompt1', 'prep:prompt2', 'prep:prompt3'] },
              reason: { type: 'string' }
            },
            required: ['choice', 'reason']
          },
          strict: true
        }
      }
    };

    console.log('Request payload:', JSON.stringify(body, null, 2));

    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    const data = await res.json();

    console.log('Response status:', res.status);
    console.log('Raw response:', JSON.stringify(data, null, 2));

    if (!res.ok) {
      throw new Error(`API request failed with status ${res.status}: ${JSON.stringify(data)}`);
    }

    // Extract choice data from response structure
    // The data is in: data.output[1].content[0].text (message content)
    let choiceText = '{}';
    if (data?.output && Array.isArray(data.output)) {
      // Find the message output (type: "message")
      const messageOutput = data.output.find((item: any) => item.type === 'message');
      if (messageOutput?.content && Array.isArray(messageOutput.content)) {
        // Find the output_text content
        const textContent = messageOutput.content.find((item: any) => item.type === 'output_text');
        if (textContent?.text) {
          choiceText = textContent.text;
        }
      }
    }
    
    const choice = JSON.parse(choiceText);

    console.log('\n✅ Raw API request completed successfully!');
    return choice as ChoiceResponse;
  } catch (error) {
    console.error('❌ Raw API request failed:', error);
    throw error;
  }
}

// Run the example when executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runExample().catch(e => {
    console.error('Example failed:', e);
    process.exit(1);
  });
}

/**
 * Expected Output:
 * ===============
 * 
 * === Raw OpenAI Responses API Example ===
 * 
 * Making raw OpenAI API request...
 * Request payload: {
 *   "model": "gpt-5",
 *   "input": "Return only valid JSON according to the schema. Choose the best id for a topic about Buddhist selflessness of persons: prep:prompt1, prep:prompt2, prep:prompt3.",
 *   "text": {
 *     "format": {
 *       "type": "json_schema",
 *       "name": "choice",
 *       "schema": {
 *         "type": "object",
 *         "additionalProperties": false,
 *         "properties": {
 *           "choice": {
 *             "type": "string",
 *             "enum": ["prep:prompt1", "prep:prompt2", "prep:prompt3"]
 *           },
 *           "reason": { "type": "string" }
 *         },
 *         "required": ["choice", "reason"]
 *       },
 *       "strict": true
 *     }
 *   }
 * }
 * Response status: 200
 * Raw response: {
 *   "id": "resp_...",
 *   "object": "response",
 *   "status": "completed",
 *   "output": [
 *     { "type": "reasoning", ... },
 *     {
 *       "type": "message",
 *       "content": [
 *         {
 *           "type": "output_text",
 *           "text": "{\"choice\":\"prep:prompt2\",\"reason\":\"Prompt 2 most directly targets the Buddhist doctrine of non-self (anattā/anātman), addressing doctrine, texts, examples, and philosophical implications about the selflessness of persons.\"}"
 *         }
 *       ]
 *     }
 *   ],
 *   ...
 * }
 * 
 * ✅ Raw API request completed successfully!
 * 
 * Note: Requires OPENAI_API_KEY environment variable
 */

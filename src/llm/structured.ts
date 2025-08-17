import { Effect, Schema } from 'effect';
import { LLMService } from './service';

export interface ChoiceOption {
  id: string;
  name: string;
  description: string;
}

export interface ChoiceResult {
  choice: string;
  reason?: string | undefined;
}

/**
 * Ask an LLM to select one option by id using a strict JSON schema, with retries.
 * Falls back to simple parsing and validation when provider lacks native structured output.
 */
export const structuredChoice = (
  userPrompt: string,
  options: ReadonlyArray<ChoiceOption>,
  config?: { retries?: number }
): Effect.Effect<ChoiceResult, Error, any> => {
  const retries = Math.max(0, config?.retries ?? 2);

  const allowedIds = options.map((o) => o.id);
  const ChoiceUnion = (() => {
    const lits = allowedIds.map((id) => Schema.Literal(id));
    return (lits.length === 1
      ? lits[0]
      : (Schema.Union as any)(...lits)) as unknown as Schema.Schema<string>;
  })();
  const ResultSchema = Schema.Struct({
    choice: ChoiceUnion,
    reason: Schema.optional(Schema.String),
  });

  const baseInstruction = `You are a router. Choose one option id based on the task and options. Provide a short reason.`;

  const attempt = (
    n: number,
    lastError?: string
  ): Effect.Effect<ChoiceResult, Error, any> =>
    Effect.gen(function* () {
      const prompt = lastError
        ? `${baseInstruction}\n\nPrevious output was invalid: ${lastError}\nRespond again with ONLY valid JSON.`
        : baseInstruction;

      const svc = yield* LLMService;
      const { json: decoded } = yield* svc.structured<ChoiceResult>(
        `${prompt}\n\nUser Task:\n${userPrompt}\nOptions: ${options.map((o) => `${o.id} - ${o.name}: ${o.description}`).join('; ')}`,
        ResultSchema as Schema.Schema<ChoiceResult>
      );

      if (!allowedIds.includes(decoded.choice)) {
        const msg = `Invalid choice '${decoded.choice}'. Allowed: ${allowedIds.join(', ')}`;
        if (n < retries) return yield* attempt(n + 1, msg);
        return yield* Effect.fail(new Error(msg));
      }

      return decoded;
    });

  return attempt(0);
};

function extractJson(text: string): string {
  // Try to find the first JSON object in the text
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) return text.slice(start, end + 1);
  return text; // best effort
}

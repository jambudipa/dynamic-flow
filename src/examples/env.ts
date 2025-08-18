import { config } from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Effect } from 'effect';

// Load environment variables
config();

// If in examples directory, also try parent directory
if (!process.env.OPENAI_API_KEY) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const rootEnv = path.resolve(__dirname, '../.env');
  config({ path: rootEnv });
}

export const exampleConfig = {
  // API Keys (optional for examples)
  openaiApiKey: process.env.OPENAI_API_KEY,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,

  // Example configuration
  timeout: 30000,
  retries: 3,
  enableLogging: true,

  // Mock configuration for examples that don't need real APIs
  useMockLLM: !process.env.OPENAI_API_KEY,

  // Performance settings
  maxConcurrency: 5,
  enableMetrics: true,
};

// Validation
export const validateEnvironment = () => {
  const warnings: string[] = [];

  if (!exampleConfig.openaiApiKey) {
    warnings.push('OPENAI_API_KEY not set - using mock LLM responses');
  }

  if (warnings.length > 0) {
    Effect.runSync(Effect.log('Environment warnings:'));
    warnings.forEach((warning) => Effect.runSync(Effect.log(`  - ${warning}`)));
  }

  return { valid: true, warnings };
};

// Legacy export for backward compatibility
export function loadEnv() {
  validateEnvironment();
}

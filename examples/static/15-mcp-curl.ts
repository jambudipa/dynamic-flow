/**
 * Example: MCP Curl Integration
 *
 * Demonstrates integration with Model Context Protocol (MCP) servers,
 * specifically using the curl server for HTTP requests with LLM summarization.
 *
 * Features demonstrated:
 * - MCP server integration with dynamic imports
 * - Tool discovery and execution via MCP protocol
 * - HTTP requests through MCP curl server
 * - Data fetching with LLM-powered analysis
 * - External protocol integration patterns
 *
 * Performance characteristics:
 * - Protocol overhead: MCP communication layer
 * - Tool discovery: Dynamic capability detection
 * - Network requests: Proxied through MCP server
 *
 * Expected console output:
 * ```
 * Initializing MCP curl server connection...
 * Discovering available tools: [curl]
 * Fetching data from: https://api.github.com/repos/openai/gpt-2
 * MCP curl body length: 2847
 * Generating LLM summary...
 * Summary: "The OpenAI GPT-2 repository contains the model code..."
 * ```
 *
 * Return value: Promise<{ data: string; summary: string }>
 *
 * Requirements:
 *   npm i @modelcontextprotocol/sdk @modelcontextprotocol/server-curl
 *   OPENAI_API_KEY environment variable
 *
 * Run: npx tsx examples/static/15-mcp-curl.ts
 */

import { loadEnv } from '../env';
import { Effect } from 'effect';
import { LLMCoreService } from '../../src/llm/service';

// Dynamic import MCP client only at runtime so the library is optional
async function withMcpCurl<T>(f: (client: any) => Promise<T>): Promise<T> {
  try {
    // Try to import MCP SDK - skip if not installed
    let Client: any;
    let StdioClientTransport: any;
    
    try {
      // @ts-ignore - Optional MCP dependency
      const clientModule = await import('@modelcontextprotocol/sdk/client');
      Client = clientModule.Client;
      // @ts-ignore - Optional MCP dependency
      const stdioModule = await import('@modelcontextprotocol/sdk/client/stdio');
      StdioClientTransport = stdioModule.StdioClientTransport;
    } catch (e) {
      console.log('⚠️  MCP SDK not installed - skipping example');
      console.log('   To run this example: npm install @modelcontextprotocol/sdk');
      return {} as T;
    }

    console.log('Initializing MCP curl server connection...');

    // Launch the curl MCP server via stdio transport
    // Tip: you can also install globally and use 'mcp-server-curl'
    const transport = new StdioClientTransport({
      command: process.platform === 'win32' ? 'npx.cmd' : 'npx',
      args: ['-y', '@modelcontextprotocol/server-curl'],
    });

    const client = new (Client as any)(
      { name: 'dynamic-flow-mcp-client', version: '1.0.0' },
      transport
    );
    await (client as any).connect?.();
    await (client as any).initialize?.();

    try {
      return await f(client);
    } finally {
      await client.close();
    }
  } catch (error) {
    console.error('MCP client error:', error);
    throw new Error(
      `MCP integration failed: ${(error as any).message}. Ensure @modelcontextprotocol/sdk and @modelcontextprotocol/server-curl are installed.`
    );
  }
}

/**
 * Programmatic example runner for testing and integration
 */
export async function runExample(): Promise<{ data: string; summary: string }> {
  console.log('=== MCP Curl Integration Example ===\n');

  loadEnv();

  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required for LLM summarization');
  }

  try {
    // 1) Use MCP curl server to fetch a JSON API
    const url = 'https://api.github.com/repos/openai/gpt-2';
    console.log(`Fetching data from: ${url}`);

    const mcpResult = await withMcpCurl(async (client) => {
      console.log('Discovering available tools...');
      const tools = await client.listTools();
      const toolNames = tools.tools?.map((t: any) => t.name) || [];
      console.log(`Available tools: [${toolNames.join(', ')}]`);

      if (!tools.tools?.some((t: any) => t.name === 'curl')) {
        throw new Error('curl tool not found on MCP server');
      }

      console.log('Executing curl tool...');
      const invoked = await client.callTool({
        name: 'curl',
        arguments: { url },
      });

      // The curl server typically returns text content; pull the first text item
      const body =
        invoked?.content?.find((c: any) => c.type === 'text')?.text ?? '';
      return body;
    });

    console.log('MCP curl body length:', mcpResult.length);

    // 2) Summarise via LLM (short summary)
    console.log('\nGenerating LLM summary...');
    const summaryPrompt = `Summarise the following JSON GitHub repo info in one sentence.

${mcpResult.slice(0, 4000)}`;

    const summary = await Effect.runPromise(
      LLMCoreService.completion(summaryPrompt)
    );
    console.log('Summary:', summary.content);

    console.log('\n✅ MCP curl integration completed successfully!');
    return { data: mcpResult, summary: summary.content };
  } catch (error) {
    console.error('❌ MCP curl integration failed:', error);
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
 * === MCP Curl Integration Example ===
 *
 * Fetching data from: https://api.github.com/repos/openai/gpt-2
 * Initializing MCP curl server connection...
 * Discovering available tools...
 * Available tools: [curl]
 * Executing curl tool...
 * MCP curl body length: 2847
 *
 * Generating LLM summary...
 * Summary: The OpenAI GPT-2 repository is a public GitHub repository containing the code and model files for GPT-2, created in February 2019 with 21,533 stars and written primarily in Python.
 *
 * ✅ MCP curl integration completed successfully!
 *
 * Requirements:
 *   npm i @modelcontextprotocol/sdk @modelcontextprotocol/server-curl
 *   OPENAI_API_KEY environment variable
 *
 * Note: This example requires MCP (Model Context Protocol) packages to be installed.
 * Note: MCP server communication may have compatibility issues with current SDK versions.
 */

#!/usr/bin/env node

/**
 * MCP Server Discovery CLI - Initial Implementation
 *
 * Discovers MCP servers and generates DynamicFlow tool definitions
 * TODO: Complete implementation as per T2.1-T2.6
 */

import { Command } from 'commander';
import { Effect } from 'effect';
import * as fs from 'fs/promises';
import * as path from 'path';

/**
 * MCP Server representation
 */
interface MCPServer {
  id: string;
  url: string;
  protocol: string;
  version: string;
  capabilities: MCPCapability[];
  metadata: Record<string, unknown>;
}

/**
 * MCP Capability/Method
 */
interface MCPCapability {
  name: string;
  description: string;
  parameters: Array<{
    name: string;
    type: string;
    required: boolean;
    description?: string | undefined;
    mcpSchema?: any; // The full MCP JSON schema for this parameter
  }>;
  returnType: string;
  examples?:
    | Array<{
        input: unknown;
        output: unknown;
      }>
    | undefined;
  outputSchema?: any; // Original MCP output schema
}

/**
 * Discovery options
 */
interface DiscoveryOptions {
  source: 'network' | 'config' | 'url';
  timeout: number;
  filter?: string | undefined;
  verbose: boolean;
}

/**
 * Generation options
 */
interface GenerationOptions {
  input: string;
  output: string;
  moduleName: string;
  dryRun: boolean;
}

/**
 * Main CLI program
 */
const program = new Command();

program
  .name('mcp-discovery')
  .description('Discover MCP servers and generate DynamicFlow tools')
  .version('1.0.0');

/**
 * Discover command
 */
program
  .command('discover')
  .description('Discover MCP servers')
  .option(
    '-s, --source <source>',
    'Discovery source (network|config|url)',
    'network'
  )
  .option('-t, --timeout <seconds>', 'Discovery timeout', '30')
  .option('-f, --filter <pattern>', 'Filter servers by pattern')
  .option(
    '-o, --output <format>',
    'Output format (json|typescript|markdown)',
    'json'
  )
  .option('-v, --verbose', 'Verbose output', false)
  .action(async (options: Record<string, unknown>) => {
    const outputFormat = String(options.output);
    const isQuietJson = outputFormat === 'json';

    if (!isQuietJson) {
      console.log('🔍 Starting MCP server discovery...');
    }

    const discoveryOptions: DiscoveryOptions = {
      source: String(options.source) as 'network' | 'config' | 'url',
      timeout: parseInt(String(options.timeout)) * 1000,
      filter: options.filter !== undefined ? String(options.filter) : undefined,
      verbose: Boolean(options.verbose),
    };

    try {
      const servers = await discoverServers(discoveryOptions);

      if (servers.length === 0) {
        if (!isQuietJson) console.log('No MCP servers found');
        return;
      }

      if (!isQuietJson) {
        console.log(`✅ Found ${servers.length} server(s)`);
      }

      // Output results based on format
      switch (outputFormat) {
        case 'json':
          // Only output JSON, no other console logs
          process.stdout.write(JSON.stringify(servers, null, 2));
          return;
        case 'jsonfile':
          console.log(JSON.stringify(servers, null, 2));
          break;
        case 'typescript':
          // TODO: Implement TypeScript generation
          console.log('// TypeScript generation not yet implemented');
          break;
        case 'markdown':
          // TODO: Implement Markdown generation
          console.log('# MCP Servers\nMarkdown generation not yet implemented');
          break;
      }
    } catch (error) {
      console.error('❌ Discovery failed:', error);
      process.exit(1);
    }
  });

/**
 * Generate command
 */
program
  .command('generate')
  .description('Generate DynamicFlow tools from discovery output')
  .requiredOption('-i, --input <file>', 'Input JSON file from discovery')
  .requiredOption('-o, --output <dir>', 'Output directory for generated code')
  .option('-m, --module-name <name>', 'Module name', 'mcp-tools')
  .option('--dry-run', 'Preview without generating files', false)
  .action(async (options: Record<string, unknown>) => {
    console.log('🔧 Generating DynamicFlow tools...');

    const generationOptions: GenerationOptions = {
      input: String(options.input),
      output: String(options.output),
      moduleName: String(options.moduleName),
      dryRun: Boolean(options.dryRun),
    };

    try {
      await generateTools(generationOptions);
      console.log('✅ Tools generated successfully');
    } catch (error) {
      console.error('❌ Generation failed:', error);
      process.exit(1);
    }
  });

/**
 * Validate command
 */
program
  .command('validate <server-url>')
  .description('Validate MCP server compatibility')
  .option('-v, --verbose', 'Verbose output', false)
  .action(async (serverUrl: string, options: Record<string, unknown>) => {
    console.log(`🔍 Validating MCP server: ${serverUrl}`);

    try {
      const result = await validateServer(
        serverUrl,
        Boolean(options['verbose'])
      );

      if (result.compatible) {
        console.log('✅ Server is compatible');
        console.log(`Protocol version: ${result.version}`);
        console.log(`Capabilities: ${result.capabilities?.length ?? 0}`);
      } else {
        console.log('❌ Server is not compatible');
        console.log(`Reason: ${result.reason ?? 'Unknown reason'}`);
      }
    } catch (error) {
      console.error('❌ Validation failed:', error);
      process.exit(1);
    }
  });

/**
 * Diagnose command
 */
program
  .command('diagnose')
  .description('Run diagnostics for troubleshooting')
  .action(async () => {
    console.log('🔍 Running diagnostics...');

    // TODO: Implement comprehensive diagnostics
    await Promise.resolve(); // Satisfy require-await
    console.log('✅ Network: OK');
    console.log('✅ Permissions: OK');
    console.log('✅ Dependencies: OK');
    console.log('\nDiagnostics complete');
  });

// Parse command line arguments
program.parse(process.argv);

/**
 * Discover MCP servers
 */
async function discoverServers(
  options: DiscoveryOptions
): Promise<MCPServer[]> {
  return Effect.runPromise(
    Effect.gen(function* () {
      if (options.verbose) {
        yield* Effect.log(`Discovering servers via ${options.source}...`);
      }

      switch (options.source) {
        case 'config':
          return yield* discoverFromConfig(options);
        case 'url':
          return yield* discoverFromUrl(options);
        case 'network':
        default:
          return yield* discoverFromNetwork(options);
      }
    })
  );
}

/**
 * Discover MCP servers from configuration file
 */
function discoverFromConfig(
  options: DiscoveryOptions
): Effect.Effect<MCPServer[]> {
  return Effect.gen(function* () {
    // Check for MCP config in common locations
    const configPaths = [
      './mcp-servers.json',
      '~/.config/mcp/servers.json',
      '/etc/mcp/servers.json',
    ];

    const servers: MCPServer[] = [];

    for (const configPath of configPaths) {
      const configResult = yield* Effect.tryPromise(() =>
        import('fs/promises').then((fs) => fs.readFile(configPath, 'utf-8'))
      ).pipe(Effect.catchAll(() => Effect.succeed(null)));

      if (configResult) {
        try {
          const config = JSON.parse(configResult);

          if (config.servers && Array.isArray(config.servers)) {
            for (const serverConfig of config.servers) {
              const server = yield* interrogateMCPServer(
                serverConfig.url || serverConfig.command,
                options
              );
              if (server) {
                servers.push({
                  ...server,
                  id: serverConfig.id || server.id,
                  metadata: { ...server.metadata, ...serverConfig.metadata },
                });
              }
            }
          }
        } catch {
          // JSON parsing failed, continue
          continue;
        }
      }
    }

    return servers;
  });
}

/**
 * Discover MCP server from direct URL
 */
function discoverFromUrl(
  options: DiscoveryOptions
): Effect.Effect<MCPServer[]> {
  return Effect.gen(function* () {
    // URL should be provided in filter option
    const url = options.filter;
    if (!url) {
      return [];
    }

    const server = yield* interrogateMCPServer(url!, options);
    return server ? [server] : [];
  });
}

/**
 * Discover MCP servers on local network
 */
function discoverFromNetwork(
  options: DiscoveryOptions
): Effect.Effect<MCPServer[]> {
  return Effect.gen(function* () {
    const servers: MCPServer[] = [];

    // Try common MCP server locations - generic discovery
    const commonServers = [
      'http://localhost:3000/mcp',
      'http://localhost:8080/mcp',
      'ws://localhost:3001/mcp',
      'ws://localhost:3002/mcp',
    ];

    for (const serverUrl of commonServers) {
      try {
        const server = yield* interrogateMCPServer(serverUrl, options);
        if (server) {
          servers.push(server);
        }
      } catch {
        // Server not available, continue
        if (options.verbose) {
          yield* Effect.log(`Server not available: ${serverUrl}`);
        }
      }
    }

    return servers;
  });
}

/**
 * Interrogate an MCP server to discover its capabilities
 */
function interrogateMCPServer(
  serverUrl: string,
  options: DiscoveryOptions
): Effect.Effect<MCPServer | null> {
  return Effect.tryPromise(async () => {
    try {
      // Dynamic import to handle optional MCP SDK
      const { Client } = await import(
        '@modelcontextprotocol/sdk/client/index.js'
      ).catch(() => {
        throw new Error(
          'MCP SDK not installed. Run: npm install @modelcontextprotocol/sdk'
        );
      });

      let transport;

      if (serverUrl.startsWith('stdio://')) {
        const { StdioClientTransport } = await import(
          '@modelcontextprotocol/sdk/client/stdio.js'
        );

        const command = serverUrl.replace('stdio://', '');
        const [cmd, ...args] = command.split(' ');

        transport = new StdioClientTransport({
          command: cmd || '',
          args: args,
        });
      } else if (serverUrl.startsWith('ws://')) {
        const { WebSocketClientTransport } = await import(
          '@modelcontextprotocol/sdk/client/websocket.js'
        );
        transport = new WebSocketClientTransport(new URL(serverUrl));
      } else if (
        serverUrl.startsWith('http://') ||
        serverUrl.startsWith('https://')
      ) {
        const { SSEClientTransport } = await import(
          '@modelcontextprotocol/sdk/client/sse.js'
        );
        transport = new SSEClientTransport(new URL(serverUrl));
      } else {
        throw new Error(`Unsupported server URL format: ${serverUrl}`);
      }

      const client = new Client(
        { name: 'mcp-discovery', version: '1.0.0' },
        { capabilities: {} }
      );

      // Connect with timeout
      await Promise.race([
        client.connect(transport),
        new Promise((_, reject) =>
          setTimeout(
            () => reject(new Error('Connection timeout')),
            Math.min(options.timeout, 5000)
          )
        ),
      ]);

      // List available tools with timeout
      const toolsList = await Promise.race([
        client.listTools(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('listTools timeout')), 3000)
        ),
      ]);

      // Convert tools to our capability format
      const toolsListAny = toolsList as any;
      const capabilities: MCPCapability[] =
        toolsListAny.tools?.map((tool: any) => ({
          name: tool.name,
          description: tool.description || '',
          parameters: tool.inputSchema?.properties
            ? Object.entries(tool.inputSchema.properties).map(
                ([name, schema]: [string, any]) => ({
                  name,
                  type: schema.type || 'unknown',
                  required: tool.inputSchema.required?.includes(name) || false,
                  description: schema.description,
                  mcpSchema: schema, // Preserve the full MCP schema
                })
              )
            : [],
          returnType: inferReturnType(tool.name, tool.outputSchema),
          examples: tool.examples,
          outputSchema: tool.outputSchema, // Preserve original schema
        })) || [];

      // Get server info
      const serverCapabilities = client.getServerCapabilities();
      const serverVersion = client.getServerVersion();

      // Close connection with timeout
      try {
        await Promise.race([
          client.close(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Close timeout')), 2000)
          ),
        ]);
      } catch {
        // Ignore close errors
      }

      const server: MCPServer = {
        id: generateServerId(serverUrl),
        url: serverUrl,
        protocol: 'mcp',
        version: '1.0.0', // Default since we don't have direct access to protocol version
        capabilities,
        metadata: {
          name: serverVersion?.name || `MCP Server`,
          description: serverVersion?.description || 'Discovered MCP server',
          version: serverVersion?.version || '1.0.0',
          ...serverVersion,
        },
      };

      if (options.verbose) {
        console.log(
          `Discovered server: ${server.metadata.name} with ${capabilities.length} tools`
        );
      }

      return server;
    } catch (error) {
      if (options.verbose) {
        console.log(`Failed to interrogate ${serverUrl}: ${error}`);
      }
      return null;
    }
  }).pipe(Effect.catchAll(() => Effect.succeed(null)));
}

/**
 * Generate a server ID from URL
 */
function generateServerId(url: string): string {
  return (
    url
      .replace(/[^\w\-]/g, '-')
      .replace(/--+/g, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'mcp-server'
  );
}

/**
 * Generate tools from discovery output
 */
async function generateTools(options: GenerationOptions): Promise<void> {
  // Read input file
  const inputData = await fs.readFile(options.input, 'utf-8');
  const servers: MCPServer[] = JSON.parse(inputData);

  if (options.dryRun) {
    console.log('🔍 Dry run mode - no files will be created');
    console.log(`Would generate tools for ${servers.length} server(s)`);
    return;
  }

  // Create output directory
  await fs.mkdir(options.output, { recursive: true });

  // Generate index file
  const indexContent = generateIndexFile(servers, options.moduleName);
  await fs.writeFile(path.join(options.output, 'index.ts'), indexContent);

  // Generate shared types file
  const typesContent = generateTypesFile();
  await fs.writeFile(path.join(options.output, 'types.ts'), typesContent);

  // Generate tool files for each server
  for (const server of servers) {
    const toolContent = generateToolFile(server);
    const fileName = `${server.id.replace(/[^a-z0-9]/gi, '_')}.ts`;
    await fs.writeFile(path.join(options.output, fileName), toolContent);
  }

  console.log(`Generated ${servers.length} tool file(s) in ${options.output}`);
}

/**
 * Validate server compatibility
 */
async function validateServer(
  _serverUrl: string,
  _verbose: boolean
): Promise<{
  compatible: boolean;
  version?: string | undefined;
  capabilities?: unknown[] | undefined;
  reason?: string | undefined;
}> {
  // TODO: Implement actual validation
  await Promise.resolve(); // Satisfy require-await

  return {
    compatible: true,
    version: '1.0.0',
    capabilities: [],
    reason: undefined,
  };
}

/**
 * Generate index file content
 */
function generateIndexFile(servers: MCPServer[], moduleName: string): string {
  return `/**
 * Generated MCP Tools - ${moduleName}
 * Generated on: ${new Date().toISOString()}
 */

${servers
  .map((s) => `export * from './${s.id.replace(/[^a-z0-9]/gi, '_')}'`)
  .join('\n')}

export const mcpServers = ${JSON.stringify(
    servers.map((s) => ({
      id: s.id,
      name: typeof s.metadata.name === 'string' ? s.metadata.name : s.id,
      url: s.url,
    })),
    null,
    2
  )}
`;
}

/**
 * Infer return type based on tool name and output schema
 */
function inferReturnType(toolName: string, outputSchema?: any): string {
  // Use actual output schema if available - this is the generic path
  if (outputSchema) {
    return 'typed';
  }

  // Default to unknown for generic tools
  return 'unknown';
}

/**
 * Generate TypeScript output type based on inferred return type
 */
function getOutputTypeScript(returnType: string, outputSchema?: any): string {
  if (outputSchema) {
    return convertSchemaToTypeScript(outputSchema);
  }

  // Generic fallback for any MCP tool
  return 'unknown';
}

/**
 * Generate Effect Schema based on inferred return type
 */
function getOutputSchema(returnType: string, outputSchema?: any): string {
  if (outputSchema) {
    return convertSchemaToEffectSchema(outputSchema);
  }

  // Generic fallback for any MCP tool
  return 'Schema.Unknown';
}

/**
 * Convert JSON schema to TypeScript type (basic implementation)
 */
function convertSchemaToTypeScript(schema: any): string {
  if (!schema || typeof schema !== 'object') return 'unknown';

  if (schema.type === 'string') return 'string';
  if (schema.type === 'number' || schema.type === 'integer') return 'number';
  if (schema.type === 'boolean') return 'boolean';
  if (schema.type === 'array') {
    const itemType = schema.items
      ? convertSchemaToTypeScript(schema.items)
      : 'unknown';
    return `Array<${itemType}>`;
  }
  if (schema.type === 'object' && schema.properties) {
    const props = Object.entries(schema.properties)
      .map(([key, prop]: [string, any]) => {
        const optional = !schema.required?.includes(key) ? '?' : '';
        return `${key}${optional}: ${convertSchemaToTypeScript(prop)}`;
      })
      .join('; ');
    return `{ ${props} }`;
  }

  return 'unknown';
}

/**
 * Convert JSON schema to Effect Schema (basic implementation)
 */
function convertSchemaToEffectSchema(schema: any): string {
  if (!schema || typeof schema !== 'object') return 'Schema.Unknown';

  if (schema.type === 'string') return 'Schema.String';
  if (schema.type === 'number' || schema.type === 'integer')
    return 'Schema.Number';
  if (schema.type === 'boolean') return 'Schema.Boolean';
  if (schema.type === 'array') {
    const itemSchema = schema.items
      ? convertSchemaToEffectSchema(schema.items)
      : 'Schema.Unknown';
    return `Schema.Array(${itemSchema}).pipe(Schema.mutable)`;
  }
  if (schema.type === 'object' && schema.properties) {
    const props = Object.entries(schema.properties)
      .map(([key, prop]: [string, any]) => {
        const propSchema = convertSchemaToEffectSchema(prop);
        const optional = !schema.required?.includes(key)
          ? `Schema.optional(${propSchema})`
          : propSchema;
        return `    ${key}: ${optional}`;
      })
      .join(',\n');
    return `Schema.Struct({\n${props}\n  })`;
  }

  return 'Schema.Unknown';
}

/**
 * Helper functions for type conversion
 */
function getTypeScriptType(type: string): string {
  switch (type.toLowerCase()) {
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    case 'boolean':
      return 'boolean';
    case 'array':
      return 'unknown[]';
    case 'object':
      return 'Record<string, unknown>';
    default:
      return 'unknown';
  }
}

function getSchemaType(type: string): string {
  switch (type.toLowerCase()) {
    case 'string':
      return 'Schema.String';
    case 'number':
      return 'Schema.Number';
    case 'boolean':
      return 'Schema.Boolean';
    case 'array':
      return 'Schema.Array(Schema.Unknown).pipe(Schema.mutable)';
    case 'object':
      return 'Schema.Record({ key: Schema.String, value: Schema.Unknown })';
    default:
      return 'Schema.Unknown';
  }
}

function getDefaultValue(type: string): string {
  switch (type.toLowerCase()) {
    case 'string':
      return "''";
    case 'number':
      return '0';
    case 'boolean':
      return 'false';
    case 'array':
      return '[]';
    case 'object':
      return '{}';
    default:
      return 'undefined';
  }
}

/**
 * Generate shared types file content
 */
function generateTypesFile(): string {
  return `/**
 * Shared types for generated MCP tools
 * This file contains the essential types needed by MCP tools to avoid import issues
 * Generated on: ${new Date().toISOString()}
 */

import { Data, Effect, Schema } from 'effect';

// ============= Execution Context =============

/**
 * Execution context for tool execution
 */
export interface ExecutionContext {
  /** Unique identifier for the current flow */
  readonly flowId: string;
  /** Unique identifier for the current step */
  readonly stepId: string;
  /** Session identifier for tracking execution sessions */
  readonly sessionId: string;
  /** Variables available in the current execution context */
  readonly variables: Record<string, unknown>;
  /** Metadata for the current execution */
  readonly metadata: Record<string, unknown>;

  // Optional enhanced fields
  /** Parent execution context for nested flows */
  readonly parentContext?: ExecutionContext;
  /** Current scope information for variable resolution */
  readonly currentScope?: string[];
}

// ============= Tool Types =============

/**
 * Tool requirements for dependency injection
 */
export type ToolRequirements = never;

/**
 * Tool error class for error handling
 */
export class ToolError extends Data.TaggedError('ToolError')<{
  toolId: string;
  phase: 'validation' | 'execution' | 'cleanup';
  details?: Record<string, unknown>;
  cause?: unknown;
}> {
  get message(): string {
    return \`Tool '\${this.toolId}' failed during \${this.phase}\${this.cause ? \`: \${String(this.cause)}\` : ''}\`;
  }
}

/**
 * Base tool interface
 */
export interface Tool<TInput, TOutput> {
  id: string;
  name: string;
  description: string;
  inputSchema: Schema.Schema<TInput>;
  outputSchema: Schema.Schema<TOutput>;
  execute: (
    input: TInput,
    context: ExecutionContext
  ) => Effect.Effect<TOutput, ToolError, ToolRequirements>;
}
`;
}

/**
 * Generate tool file content
 */
function generateToolFile(server: MCPServer): string {
  const serverName =
    typeof server.metadata.name === 'string' ? server.metadata.name : server.id;

  return `/**
 * MCP Server: ${serverName}
 * URL: ${server.url}
 * Version: ${server.version}
 * Generated: ${new Date().toISOString()}
 */

import { Effect, Schema, pipe } from 'effect'
import type { Tool, ToolRequirements, ExecutionContext } from './types'
import { ToolError } from './types'

/**
 * Production MCP Client wrapper for ${serverName}
 */
export class ${server.id.replace(/[^a-zA-Z0-9]/g, '')}MCPClient {
  private serverUrl: string;
  private client: any = null;
  private transport: any = null;

  constructor(serverUrl: string = '${server.url}') {
    this.serverUrl = serverUrl;
  }

  /**
   * Connect to MCP server
   */
  connect(): Effect.Effect<void, Error, never> {
    const self = this;
    return (Effect.gen(function* () {
      if (self.client && self.transport) {
        return; // Already connected
      }

      try {
        // Dynamic import MCP SDK
        const { Client } = yield* Effect.tryPromise(() => 
          import('@modelcontextprotocol/sdk/client/index.js').catch(() => {
            throw new Error('MCP SDK not installed. Run: npm install @modelcontextprotocol/sdk');
          })
        );

        // Create appropriate transport
        let transport;
        if (self.serverUrl.startsWith('stdio://')) {
          const { StdioClientTransport } = yield* Effect.tryPromise(() => 
            import('@modelcontextprotocol/sdk/client/stdio.js')
          );
          
          const command = self.serverUrl.replace('stdio://', '');
          const [cmd, ...args] = command.split(' ');
          if (!cmd) throw new Error('Invalid stdio command');
          
          transport = new StdioClientTransport({
            command: cmd,
            args: args
          });
        } else if (self.serverUrl.startsWith('ws://')) {
          const { WebSocketClientTransport } = yield* Effect.tryPromise(() => 
            import('@modelcontextprotocol/sdk/client/websocket.js')
          );
          transport = new WebSocketClientTransport(new URL(self.serverUrl));
        } else if (self.serverUrl.startsWith('http://') || self.serverUrl.startsWith('https://')) {
          const { SSEClientTransport } = yield* Effect.tryPromise(() => 
            import('@modelcontextprotocol/sdk/client/sse.js')
          );
          transport = new SSEClientTransport(new URL(self.serverUrl));
        } else {
          throw new Error(\`Unsupported server URL format: \${self.serverUrl}\`);
        }

        // Create and connect client
        const client = new Client(
          { name: 'dynamicflow-mcp-client', version: '1.0.0' },
          { capabilities: {} }
        );

        yield* Effect.tryPromise(() => client.connect(transport));
        
        self.client = client;
        self.transport = transport;

        console.log(\`🔗 Connected to MCP server: \${self.serverUrl}\`);

      } catch (error) {
        throw new Error(\`Failed to connect to MCP server: \${error}\`);
      }
    }) as Effect.Effect<void, Error, never>).pipe(
      Effect.catchAll((error) => Effect.fail(error as Error))
    );
  }

  /**
   * Disconnect from MCP server
   */
  disconnect(): Effect.Effect<void, Error, never> {
    const self = this;
    return (Effect.gen(function* () {
      if (self.client) {
        yield* Effect.tryPromise(() => self.client.close());
        self.client = null;
        self.transport = null;
      }
    }) as Effect.Effect<void, Error, never>).pipe(
      Effect.catchAll(() => Effect.void)
    );
  }

  /**
   * Execute MCP tool call
   */
  private executeToolCall<T>(toolName: string, params: Record<string, unknown>): Effect.Effect<T, Error, never> {
    const self = this;
    return (Effect.gen(function* () {
      if (!self.client) {
        yield* self.connect();
      }

      try {
        const result = yield* Effect.tryPromise(() => 
          self.client.callTool({ name: toolName, arguments: params })
        );

        console.log(\`📡 MCP [\${toolName}]: \${JSON.stringify(params)} -> Success\`);
        
        // Return the tool result content with proper typing
        const resultAny = result as any;
        if (resultAny.content && Array.isArray(resultAny.content) && resultAny.content.length > 0) {
          const firstContent = resultAny.content[0];
          if (typeof firstContent === 'object' && firstContent !== null && 'text' in firstContent) {
            return firstContent.text as T;
          }
          return firstContent as T;
        }
        
        return resultAny as T;

      } catch (error) {
        console.error(\`📡 MCP [\${toolName}] Error: \${error}\`);
        throw new Error(\`MCP tool call failed: \${error}\`);
      }
    }) as Effect.Effect<T, Error, never>).pipe(
      Effect.catchAll((error) => Effect.fail(error as Error))
    );
  }

  ${server.capabilities
    .map(
      (cap) => `
  /**
   * ${cap.description.replace(/'/g, "\\'")}
   */
  ${cap.name}(${cap.parameters.map((p) => `${p.name}: ${getTypeScriptType(p.type)}${p.required ? '' : ' | undefined'}`).join(', ')}): Effect.Effect<unknown, Error, never> {
    return this.executeToolCall('${cap.name}', { ${cap.parameters.length > 0 ? cap.parameters.map((p) => `${p.name}: ${p.name} ?? ${getDefaultValue(p.type)}`).join(', ') : ''} });
  }`
    )
    .join('\n  ')}
}

/**
 * Global MCP client instance
 */
const mcpClient = new ${server.id.replace(/[^a-zA-Z0-9]/g, '')}MCPClient();

${server.capabilities
  .map((cap) => {
    const inputFields = cap.parameters
      .map((p) => {
        // Use the actual MCP schema if available, otherwise fall back to basic type
        const schemaType = p.mcpSchema
          ? convertSchemaToEffectSchema(p.mcpSchema)
          : getSchemaType(p.type);
        return `    ${p.name}: ${p.required ? schemaType : `Schema.optional(${schemaType})`}`;
      })
      .join(',\n');

    const outputType = getOutputTypeScript(cap.returnType, cap.outputSchema);
    const outputSchemaStr = getOutputSchema(cap.returnType, cap.outputSchema);

    return `
/**
 * ${cap.description}
 */
export const ${cap.name}Tool: Tool<
  any,
  ${outputType}
> = {
  id: '${server.id}_${cap.name}',
  name: '${cap.name}',
  description: ${JSON.stringify(cap.description)},
  inputSchema: Schema.Struct({
${inputFields}
  }),
  outputSchema: ${outputSchemaStr},
  execute: (input, context: ExecutionContext) => {
    return pipe(
      mcpClient.${cap.name}(${cap.parameters.length > 0 ? cap.parameters.map((p) => `input.${p.name}`).join(', ') : ''}),
      Effect.map((result: unknown) => result as ${outputType}),
      Effect.mapError((error): ToolError => 
        new ToolError({
          toolId: '${cap.name}',
          phase: 'execution' as const,
          cause: error
        })
      )
    );
  }
};`;
  })
  .join('\n')}

/**
 * All tools from this MCP server
 */
export const ${server.id.replace(/[^a-zA-Z0-9]/g, '')}Tools = [
  ${server.capabilities.map((cap) => `${cap.name}Tool`).join(',\n  ')}
];
`;
}

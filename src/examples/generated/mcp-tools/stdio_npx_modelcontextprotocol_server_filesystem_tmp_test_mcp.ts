/**
 * MCP Server: secure-filesystem-server
 * URL: stdio://npx @modelcontextprotocol/server-filesystem /tmp/test-mcp
 * Version: 1.0.0
 * Generated: 2025-08-18T20:04:14.636Z
 */

import { Effect, Schema, pipe } from 'effect';
import type { Tool, ToolRequirements, ExecutionContext } from './types';
import { ToolError } from './types';

/**
 * Production MCP Client wrapper for secure-filesystem-server
 */
export class stdionpxmodelcontextprotocolserverfilesystemtmptestmcpMCPClient {
  private serverUrl: string;
  private client: any = null;
  private transport: any = null;

  constructor(
    serverUrl: string = 'stdio://npx @modelcontextprotocol/server-filesystem /tmp/test-mcp'
  ) {
    this.serverUrl = serverUrl;
  }

  /**
   * Connect to MCP server
   */
  connect(): Effect.Effect<void, Error, never> {
    const self = this;
    return (
      Effect.gen(function* () {
        if (self.client && self.transport) {
          return; // Already connected
        }

        try {
          // Dynamic import MCP SDK
          const { Client } = yield* Effect.tryPromise(() =>
            import('@modelcontextprotocol/sdk/client/index.js').catch(() => {
              throw new Error(
                'MCP SDK not installed. Run: npm install @modelcontextprotocol/sdk'
              );
            })
          );

          // Create appropriate transport
          let transport;
          if (self.serverUrl.startsWith('stdio://')) {
            const { StdioClientTransport } = yield* Effect.tryPromise(
              () => import('@modelcontextprotocol/sdk/client/stdio.js')
            );

            const command = self.serverUrl.replace('stdio://', '');
            const [cmd, ...args] = command.split(' ');
            if (!cmd) throw new Error('Invalid stdio command');

            transport = new StdioClientTransport({
              command: cmd,
              args: args,
            });
          } else if (self.serverUrl.startsWith('ws://')) {
            const { WebSocketClientTransport } = yield* Effect.tryPromise(
              () => import('@modelcontextprotocol/sdk/client/websocket.js')
            );
            transport = new WebSocketClientTransport(new URL(self.serverUrl));
          } else if (
            self.serverUrl.startsWith('http://') ||
            self.serverUrl.startsWith('https://')
          ) {
            const { SSEClientTransport } = yield* Effect.tryPromise(
              () => import('@modelcontextprotocol/sdk/client/sse.js')
            );
            transport = new SSEClientTransport(new URL(self.serverUrl));
          } else {
            throw new Error(`Unsupported server URL format: ${self.serverUrl}`);
          }

          // Create and connect client
          const client = new Client(
            { name: 'dynamicflow-mcp-client', version: '1.0.0' },
            { capabilities: {} }
          );

          yield* Effect.tryPromise(() => client.connect(transport));

          self.client = client;
          self.transport = transport;

          console.log(`🔗 Connected to MCP server: ${self.serverUrl}`);
        } catch (error) {
          throw new Error(`Failed to connect to MCP server: ${error}`);
        }
      }) as Effect.Effect<void, Error, never>
    ).pipe(Effect.catchAll((error) => Effect.fail(error as Error)));
  }

  /**
   * Disconnect from MCP server
   */
  disconnect(): Effect.Effect<void, Error, never> {
    const self = this;
    return (
      Effect.gen(function* () {
        if (self.client) {
          yield* Effect.tryPromise(() => self.client.close());
          self.client = null;
          self.transport = null;
        }
      }) as Effect.Effect<void, Error, never>
    ).pipe(Effect.catchAll(() => Effect.void));
  }

  /**
   * Execute MCP tool call
   */
  private executeToolCall<T>(
    toolName: string,
    params: Record<string, unknown>
  ): Effect.Effect<T, Error, never> {
    const self = this;
    return (
      Effect.gen(function* () {
        if (!self.client) {
          yield* self.connect();
        }

        try {
          const result = yield* Effect.tryPromise(() =>
            self.client.callTool({ name: toolName, arguments: params })
          );

          console.log(
            `📡 MCP [${toolName}]: ${JSON.stringify(params)} -> Success`
          );

          // Return the tool result content with proper typing
          const resultAny = result as any;
          if (
            resultAny.content &&
            Array.isArray(resultAny.content) &&
            resultAny.content.length > 0
          ) {
            const firstContent = resultAny.content[0];
            if (
              typeof firstContent === 'object' &&
              firstContent !== null &&
              'text' in firstContent
            ) {
              return firstContent.text as T;
            }
            return firstContent as T;
          }

          return resultAny as T;
        } catch (error) {
          console.error(`📡 MCP [${toolName}] Error: ${error}`);
          throw new Error(`MCP tool call failed: ${error}`);
        }
      }) as Effect.Effect<T, Error, never>
    ).pipe(Effect.catchAll((error) => Effect.fail(error as Error)));
  }

  /**
   * Read the complete contents of a file as text. DEPRECATED: Use read_text_file instead.
   */
  read_file(
    path: string,
    tail: number | undefined,
    head: number | undefined
  ): Effect.Effect<unknown, Error, never> {
    return this.executeToolCall('read_file', {
      path: path ?? '',
      tail: tail ?? 0,
      head: head ?? 0,
    });
  }

  /**
   * Read the complete contents of a file from the file system as text. Handles various text encodings and provides detailed error messages if the file cannot be read. Use this tool when you need to examine the contents of a single file. Use the \'head\' parameter to read only the first N lines of a file, or the \'tail\' parameter to read only the last N lines of a file. Operates on the file as text regardless of extension. Only works within allowed directories.
   */
  read_text_file(
    path: string,
    tail: number | undefined,
    head: number | undefined
  ): Effect.Effect<unknown, Error, never> {
    return this.executeToolCall('read_text_file', {
      path: path ?? '',
      tail: tail ?? 0,
      head: head ?? 0,
    });
  }

  /**
   * Read an image or audio file. Returns the base64 encoded data and MIME type. Only works within allowed directories.
   */
  read_media_file(path: string): Effect.Effect<unknown, Error, never> {
    return this.executeToolCall('read_media_file', { path: path ?? '' });
  }

  /**
   * Read the contents of multiple files simultaneously. This is more efficient than reading files one by one when you need to analyze or compare multiple files. Each file\'s content is returned with its path as a reference. Failed reads for individual files won\'t stop the entire operation. Only works within allowed directories.
   */
  read_multiple_files(paths: unknown[]): Effect.Effect<unknown, Error, never> {
    return this.executeToolCall('read_multiple_files', { paths: paths ?? [] });
  }

  /**
   * Create a new file or completely overwrite an existing file with new content. Use with caution as it will overwrite existing files without warning. Handles text content with proper encoding. Only works within allowed directories.
   */
  write_file(
    path: string,
    content: string
  ): Effect.Effect<unknown, Error, never> {
    return this.executeToolCall('write_file', {
      path: path ?? '',
      content: content ?? '',
    });
  }

  /**
   * Make line-based edits to a text file. Each edit replaces exact line sequences with new content. Returns a git-style diff showing the changes made. Only works within allowed directories.
   */
  edit_file(
    path: string,
    edits: unknown[],
    dryRun: boolean | undefined
  ): Effect.Effect<unknown, Error, never> {
    return this.executeToolCall('edit_file', {
      path: path ?? '',
      edits: edits ?? [],
      dryRun: dryRun ?? false,
    });
  }

  /**
   * Create a new directory or ensure a directory exists. Can create multiple nested directories in one operation. If the directory already exists, this operation will succeed silently. Perfect for setting up directory structures for projects or ensuring required paths exist. Only works within allowed directories.
   */
  create_directory(path: string): Effect.Effect<unknown, Error, never> {
    return this.executeToolCall('create_directory', { path: path ?? '' });
  }

  /**
   * Get a detailed listing of all files and directories in a specified path. Results clearly distinguish between files and directories with [FILE] and [DIR] prefixes. This tool is essential for understanding directory structure and finding specific files within a directory. Only works within allowed directories.
   */
  list_directory(path: string): Effect.Effect<unknown, Error, never> {
    return this.executeToolCall('list_directory', { path: path ?? '' });
  }

  /**
   * Get a detailed listing of all files and directories in a specified path, including sizes. Results clearly distinguish between files and directories with [FILE] and [DIR] prefixes. This tool is useful for understanding directory structure and finding specific files within a directory. Only works within allowed directories.
   */
  list_directory_with_sizes(
    path: string,
    sortBy: string | undefined
  ): Effect.Effect<unknown, Error, never> {
    return this.executeToolCall('list_directory_with_sizes', {
      path: path ?? '',
      sortBy: sortBy ?? '',
    });
  }

  /**
   * Get a recursive tree view of files and directories as a JSON structure. Each entry includes \'name\', \'type\' (file/directory), and \'children\' for directories. Files have no children array, while directories always have a children array (which may be empty). The output is formatted with 2-space indentation for readability. Only works within allowed directories.
   */
  directory_tree(path: string): Effect.Effect<unknown, Error, never> {
    return this.executeToolCall('directory_tree', { path: path ?? '' });
  }

  /**
   * Move or rename files and directories. Can move files between directories and rename them in a single operation. If the destination exists, the operation will fail. Works across different directories and can be used for simple renaming within the same directory. Both source and destination must be within allowed directories.
   */
  move_file(
    source: string,
    destination: string
  ): Effect.Effect<unknown, Error, never> {
    return this.executeToolCall('move_file', {
      source: source ?? '',
      destination: destination ?? '',
    });
  }

  /**
   * Recursively search for files and directories matching a pattern. Searches through all subdirectories from the starting path. The search is case-insensitive and matches partial names. Returns full paths to all matching items. Great for finding files when you don\'t know their exact location. Only searches within allowed directories.
   */
  search_files(
    path: string,
    pattern: string,
    excludePatterns: unknown[] | undefined
  ): Effect.Effect<unknown, Error, never> {
    return this.executeToolCall('search_files', {
      path: path ?? '',
      pattern: pattern ?? '',
      excludePatterns: excludePatterns ?? [],
    });
  }

  /**
   * Retrieve detailed metadata about a file or directory. Returns comprehensive information including size, creation time, last modified time, permissions, and type. This tool is perfect for understanding file characteristics without reading the actual content. Only works within allowed directories.
   */
  get_file_info(path: string): Effect.Effect<unknown, Error, never> {
    return this.executeToolCall('get_file_info', { path: path ?? '' });
  }

  /**
   * Returns the list of directories that this server is allowed to access. Subdirectories within these allowed directories are also accessible. Use this to understand which directories and their nested paths are available before trying to access files.
   */
  list_allowed_directories(): Effect.Effect<unknown, Error, never> {
    return this.executeToolCall('list_allowed_directories', {});
  }
}

/**
 * Global MCP client instance
 */
const mcpClient =
  new stdionpxmodelcontextprotocolserverfilesystemtmptestmcpMCPClient();

/**
 * Read the complete contents of a file as text. DEPRECATED: Use read_text_file instead.
 */
export const read_fileTool: Tool<any, unknown> = {
  id: 'stdio-npx-modelcontextprotocol-server-filesystem-tmp-test-mcp_read_file',
  name: 'read_file',
  description:
    'Read the complete contents of a file as text. DEPRECATED: Use read_text_file instead.',
  inputSchema: Schema.Struct({
    path: Schema.String,
    tail: Schema.optional(Schema.Number),
    head: Schema.optional(Schema.Number),
  }),
  outputSchema: Schema.Unknown,
  execute: (input, context: ExecutionContext) => {
    return pipe(
      mcpClient.read_file(input.path, input.tail, input.head),
      Effect.map((result: unknown) => result as unknown),
      Effect.mapError(
        (error): ToolError =>
          new ToolError({
            toolId: 'read_file',
            phase: 'execution' as const,
            cause: error,
          })
      )
    );
  },
};

/**
 * Read the complete contents of a file from the file system as text. Handles various text encodings and provides detailed error messages if the file cannot be read. Use this tool when you need to examine the contents of a single file. Use the 'head' parameter to read only the first N lines of a file, or the 'tail' parameter to read only the last N lines of a file. Operates on the file as text regardless of extension. Only works within allowed directories.
 */
export const read_text_fileTool: Tool<any, unknown> = {
  id: 'stdio-npx-modelcontextprotocol-server-filesystem-tmp-test-mcp_read_text_file',
  name: 'read_text_file',
  description:
    "Read the complete contents of a file from the file system as text. Handles various text encodings and provides detailed error messages if the file cannot be read. Use this tool when you need to examine the contents of a single file. Use the 'head' parameter to read only the first N lines of a file, or the 'tail' parameter to read only the last N lines of a file. Operates on the file as text regardless of extension. Only works within allowed directories.",
  inputSchema: Schema.Struct({
    path: Schema.String,
    tail: Schema.optional(Schema.Number),
    head: Schema.optional(Schema.Number),
  }),
  outputSchema: Schema.Unknown,
  execute: (input, context: ExecutionContext) => {
    return pipe(
      mcpClient.read_text_file(input.path, input.tail, input.head),
      Effect.map((result: unknown) => result as unknown),
      Effect.mapError(
        (error): ToolError =>
          new ToolError({
            toolId: 'read_text_file',
            phase: 'execution' as const,
            cause: error,
          })
      )
    );
  },
};

/**
 * Read an image or audio file. Returns the base64 encoded data and MIME type. Only works within allowed directories.
 */
export const read_media_fileTool: Tool<any, unknown> = {
  id: 'stdio-npx-modelcontextprotocol-server-filesystem-tmp-test-mcp_read_media_file',
  name: 'read_media_file',
  description:
    'Read an image or audio file. Returns the base64 encoded data and MIME type. Only works within allowed directories.',
  inputSchema: Schema.Struct({
    path: Schema.String,
  }),
  outputSchema: Schema.Unknown,
  execute: (input, context: ExecutionContext) => {
    return pipe(
      mcpClient.read_media_file(input.path),
      Effect.map((result: unknown) => result as unknown),
      Effect.mapError(
        (error): ToolError =>
          new ToolError({
            toolId: 'read_media_file',
            phase: 'execution' as const,
            cause: error,
          })
      )
    );
  },
};

/**
 * Read the contents of multiple files simultaneously. This is more efficient than reading files one by one when you need to analyze or compare multiple files. Each file's content is returned with its path as a reference. Failed reads for individual files won't stop the entire operation. Only works within allowed directories.
 */
export const read_multiple_filesTool: Tool<any, unknown> = {
  id: 'stdio-npx-modelcontextprotocol-server-filesystem-tmp-test-mcp_read_multiple_files',
  name: 'read_multiple_files',
  description:
    "Read the contents of multiple files simultaneously. This is more efficient than reading files one by one when you need to analyze or compare multiple files. Each file's content is returned with its path as a reference. Failed reads for individual files won't stop the entire operation. Only works within allowed directories.",
  inputSchema: Schema.Struct({
    paths: Schema.Array(Schema.String).pipe(Schema.mutable),
  }),
  outputSchema: Schema.Unknown,
  execute: (input, context: ExecutionContext) => {
    return pipe(
      mcpClient.read_multiple_files(input.paths),
      Effect.map((result: unknown) => result as unknown),
      Effect.mapError(
        (error): ToolError =>
          new ToolError({
            toolId: 'read_multiple_files',
            phase: 'execution' as const,
            cause: error,
          })
      )
    );
  },
};

/**
 * Create a new file or completely overwrite an existing file with new content. Use with caution as it will overwrite existing files without warning. Handles text content with proper encoding. Only works within allowed directories.
 */
export const write_fileTool: Tool<any, unknown> = {
  id: 'stdio-npx-modelcontextprotocol-server-filesystem-tmp-test-mcp_write_file',
  name: 'write_file',
  description:
    'Create a new file or completely overwrite an existing file with new content. Use with caution as it will overwrite existing files without warning. Handles text content with proper encoding. Only works within allowed directories.',
  inputSchema: Schema.Struct({
    path: Schema.String,
    content: Schema.String,
  }),
  outputSchema: Schema.Unknown,
  execute: (input, context: ExecutionContext) => {
    return pipe(
      mcpClient.write_file(input.path, input.content),
      Effect.map((result: unknown) => result as unknown),
      Effect.mapError(
        (error): ToolError =>
          new ToolError({
            toolId: 'write_file',
            phase: 'execution' as const,
            cause: error,
          })
      )
    );
  },
};

/**
 * Make line-based edits to a text file. Each edit replaces exact line sequences with new content. Returns a git-style diff showing the changes made. Only works within allowed directories.
 */
export const edit_fileTool: Tool<any, unknown> = {
  id: 'stdio-npx-modelcontextprotocol-server-filesystem-tmp-test-mcp_edit_file',
  name: 'edit_file',
  description:
    'Make line-based edits to a text file. Each edit replaces exact line sequences with new content. Returns a git-style diff showing the changes made. Only works within allowed directories.',
  inputSchema: Schema.Struct({
    path: Schema.String,
    edits: Schema.Array(
      Schema.Struct({
        oldText: Schema.String,
        newText: Schema.String,
      })
    ).pipe(Schema.mutable),
    dryRun: Schema.optional(Schema.Boolean),
  }),
  outputSchema: Schema.Unknown,
  execute: (input, context: ExecutionContext) => {
    return pipe(
      mcpClient.edit_file(input.path, input.edits, input.dryRun),
      Effect.map((result: unknown) => result as unknown),
      Effect.mapError(
        (error): ToolError =>
          new ToolError({
            toolId: 'edit_file',
            phase: 'execution' as const,
            cause: error,
          })
      )
    );
  },
};

/**
 * Create a new directory or ensure a directory exists. Can create multiple nested directories in one operation. If the directory already exists, this operation will succeed silently. Perfect for setting up directory structures for projects or ensuring required paths exist. Only works within allowed directories.
 */
export const create_directoryTool: Tool<any, unknown> = {
  id: 'stdio-npx-modelcontextprotocol-server-filesystem-tmp-test-mcp_create_directory',
  name: 'create_directory',
  description:
    'Create a new directory or ensure a directory exists. Can create multiple nested directories in one operation. If the directory already exists, this operation will succeed silently. Perfect for setting up directory structures for projects or ensuring required paths exist. Only works within allowed directories.',
  inputSchema: Schema.Struct({
    path: Schema.String,
  }),
  outputSchema: Schema.Unknown,
  execute: (input, context: ExecutionContext) => {
    return pipe(
      mcpClient.create_directory(input.path),
      Effect.map((result: unknown) => result as unknown),
      Effect.mapError(
        (error): ToolError =>
          new ToolError({
            toolId: 'create_directory',
            phase: 'execution' as const,
            cause: error,
          })
      )
    );
  },
};

/**
 * Get a detailed listing of all files and directories in a specified path. Results clearly distinguish between files and directories with [FILE] and [DIR] prefixes. This tool is essential for understanding directory structure and finding specific files within a directory. Only works within allowed directories.
 */
export const list_directoryTool: Tool<any, unknown> = {
  id: 'stdio-npx-modelcontextprotocol-server-filesystem-tmp-test-mcp_list_directory',
  name: 'list_directory',
  description:
    'Get a detailed listing of all files and directories in a specified path. Results clearly distinguish between files and directories with [FILE] and [DIR] prefixes. This tool is essential for understanding directory structure and finding specific files within a directory. Only works within allowed directories.',
  inputSchema: Schema.Struct({
    path: Schema.String,
  }),
  outputSchema: Schema.Unknown,
  execute: (input, context: ExecutionContext) => {
    return pipe(
      mcpClient.list_directory(input.path),
      Effect.map((result: unknown) => result as unknown),
      Effect.mapError(
        (error): ToolError =>
          new ToolError({
            toolId: 'list_directory',
            phase: 'execution' as const,
            cause: error,
          })
      )
    );
  },
};

/**
 * Get a detailed listing of all files and directories in a specified path, including sizes. Results clearly distinguish between files and directories with [FILE] and [DIR] prefixes. This tool is useful for understanding directory structure and finding specific files within a directory. Only works within allowed directories.
 */
export const list_directory_with_sizesTool: Tool<any, unknown> = {
  id: 'stdio-npx-modelcontextprotocol-server-filesystem-tmp-test-mcp_list_directory_with_sizes',
  name: 'list_directory_with_sizes',
  description:
    'Get a detailed listing of all files and directories in a specified path, including sizes. Results clearly distinguish between files and directories with [FILE] and [DIR] prefixes. This tool is useful for understanding directory structure and finding specific files within a directory. Only works within allowed directories.',
  inputSchema: Schema.Struct({
    path: Schema.String,
    sortBy: Schema.optional(Schema.String),
  }),
  outputSchema: Schema.Unknown,
  execute: (input, context: ExecutionContext) => {
    return pipe(
      mcpClient.list_directory_with_sizes(input.path, input.sortBy),
      Effect.map((result: unknown) => result as unknown),
      Effect.mapError(
        (error): ToolError =>
          new ToolError({
            toolId: 'list_directory_with_sizes',
            phase: 'execution' as const,
            cause: error,
          })
      )
    );
  },
};

/**
 * Get a recursive tree view of files and directories as a JSON structure. Each entry includes 'name', 'type' (file/directory), and 'children' for directories. Files have no children array, while directories always have a children array (which may be empty). The output is formatted with 2-space indentation for readability. Only works within allowed directories.
 */
export const directory_treeTool: Tool<any, unknown> = {
  id: 'stdio-npx-modelcontextprotocol-server-filesystem-tmp-test-mcp_directory_tree',
  name: 'directory_tree',
  description:
    "Get a recursive tree view of files and directories as a JSON structure. Each entry includes 'name', 'type' (file/directory), and 'children' for directories. Files have no children array, while directories always have a children array (which may be empty). The output is formatted with 2-space indentation for readability. Only works within allowed directories.",
  inputSchema: Schema.Struct({
    path: Schema.String,
  }),
  outputSchema: Schema.Unknown,
  execute: (input, context: ExecutionContext) => {
    return pipe(
      mcpClient.directory_tree(input.path),
      Effect.map((result: unknown) => result as unknown),
      Effect.mapError(
        (error): ToolError =>
          new ToolError({
            toolId: 'directory_tree',
            phase: 'execution' as const,
            cause: error,
          })
      )
    );
  },
};

/**
 * Move or rename files and directories. Can move files between directories and rename them in a single operation. If the destination exists, the operation will fail. Works across different directories and can be used for simple renaming within the same directory. Both source and destination must be within allowed directories.
 */
export const move_fileTool: Tool<any, unknown> = {
  id: 'stdio-npx-modelcontextprotocol-server-filesystem-tmp-test-mcp_move_file',
  name: 'move_file',
  description:
    'Move or rename files and directories. Can move files between directories and rename them in a single operation. If the destination exists, the operation will fail. Works across different directories and can be used for simple renaming within the same directory. Both source and destination must be within allowed directories.',
  inputSchema: Schema.Struct({
    source: Schema.String,
    destination: Schema.String,
  }),
  outputSchema: Schema.Unknown,
  execute: (input, context: ExecutionContext) => {
    return pipe(
      mcpClient.move_file(input.source, input.destination),
      Effect.map((result: unknown) => result as unknown),
      Effect.mapError(
        (error): ToolError =>
          new ToolError({
            toolId: 'move_file',
            phase: 'execution' as const,
            cause: error,
          })
      )
    );
  },
};

/**
 * Recursively search for files and directories matching a pattern. Searches through all subdirectories from the starting path. The search is case-insensitive and matches partial names. Returns full paths to all matching items. Great for finding files when you don't know their exact location. Only searches within allowed directories.
 */
export const search_filesTool: Tool<any, unknown> = {
  id: 'stdio-npx-modelcontextprotocol-server-filesystem-tmp-test-mcp_search_files',
  name: 'search_files',
  description:
    "Recursively search for files and directories matching a pattern. Searches through all subdirectories from the starting path. The search is case-insensitive and matches partial names. Returns full paths to all matching items. Great for finding files when you don't know their exact location. Only searches within allowed directories.",
  inputSchema: Schema.Struct({
    path: Schema.String,
    pattern: Schema.String,
    excludePatterns: Schema.optional(
      Schema.Array(Schema.String).pipe(Schema.mutable)
    ),
  }),
  outputSchema: Schema.Unknown,
  execute: (input, context: ExecutionContext) => {
    return pipe(
      mcpClient.search_files(input.path, input.pattern, input.excludePatterns),
      Effect.map((result: unknown) => result as unknown),
      Effect.mapError(
        (error): ToolError =>
          new ToolError({
            toolId: 'search_files',
            phase: 'execution' as const,
            cause: error,
          })
      )
    );
  },
};

/**
 * Retrieve detailed metadata about a file or directory. Returns comprehensive information including size, creation time, last modified time, permissions, and type. This tool is perfect for understanding file characteristics without reading the actual content. Only works within allowed directories.
 */
export const get_file_infoTool: Tool<any, unknown> = {
  id: 'stdio-npx-modelcontextprotocol-server-filesystem-tmp-test-mcp_get_file_info',
  name: 'get_file_info',
  description:
    'Retrieve detailed metadata about a file or directory. Returns comprehensive information including size, creation time, last modified time, permissions, and type. This tool is perfect for understanding file characteristics without reading the actual content. Only works within allowed directories.',
  inputSchema: Schema.Struct({
    path: Schema.String,
  }),
  outputSchema: Schema.Unknown,
  execute: (input, context: ExecutionContext) => {
    return pipe(
      mcpClient.get_file_info(input.path),
      Effect.map((result: unknown) => result as unknown),
      Effect.mapError(
        (error): ToolError =>
          new ToolError({
            toolId: 'get_file_info',
            phase: 'execution' as const,
            cause: error,
          })
      )
    );
  },
};

/**
 * Returns the list of directories that this server is allowed to access. Subdirectories within these allowed directories are also accessible. Use this to understand which directories and their nested paths are available before trying to access files.
 */
export const list_allowed_directoriesTool: Tool<any, unknown> = {
  id: 'stdio-npx-modelcontextprotocol-server-filesystem-tmp-test-mcp_list_allowed_directories',
  name: 'list_allowed_directories',
  description:
    'Returns the list of directories that this server is allowed to access. Subdirectories within these allowed directories are also accessible. Use this to understand which directories and their nested paths are available before trying to access files.',
  inputSchema: Schema.Struct({}),
  outputSchema: Schema.Unknown,
  execute: (input, context: ExecutionContext) => {
    return pipe(
      mcpClient.list_allowed_directories(),
      Effect.map((result: unknown) => result as unknown),
      Effect.mapError(
        (error): ToolError =>
          new ToolError({
            toolId: 'list_allowed_directories',
            phase: 'execution' as const,
            cause: error,
          })
      )
    );
  },
};

/**
 * All tools from this MCP server
 */
export const stdionpxmodelcontextprotocolserverfilesystemtmptestmcpTools = [
  read_fileTool,
  read_text_fileTool,
  read_media_fileTool,
  read_multiple_filesTool,
  write_fileTool,
  edit_fileTool,
  create_directoryTool,
  list_directoryTool,
  list_directory_with_sizesTool,
  directory_treeTool,
  move_fileTool,
  search_filesTool,
  get_file_infoTool,
  list_allowed_directoriesTool,
];

/**
 * Neo4j Storage Backend - Graph-based persistence with relationships
 *
 * Features:
 * - Automatic database creation and schema setup
 * - Graph-based storage with node relationships
 * - Cypher query optimization
 * - Flow dependency modeling
 * - Automatic index creation for performance
 * - Connection pooling and clustering support
 */

import { Effect, pipe, Option } from 'effect';
import {
  type StorageBackend,
  type SerializedState,
  type StorageEntry,
  type ListCriteria,
  type CleanupCriteria,
  type BackendHealth,
  StorageError,
  type SuspensionKey,
} from '../types';

/**
 * Neo4j configuration
 */
export interface Neo4jConfig {
  readonly uri: string;
  readonly username: string;
  readonly password: string;
  readonly database: string;
  readonly maxConnectionPoolSize: number;
  readonly connectionAcquisitionTimeout: number;
  readonly autoCreateDatabase: boolean;
  readonly autoCreateIndexes: boolean;
  readonly enableRelationships: boolean;
}

/**
 * Default Neo4j configuration
 */
const DEFAULT_CONFIG: Neo4jConfig = {
  uri: process.env.NEO4J_URI || 'bolt://localhost:7687',
  username: process.env.NEO4J_USERNAME || 'neo4j',
  password: process.env.NEO4J_PASSWORD || 'password',
  database: process.env.NEO4J_DATABASE || 'dynamicflow',
  maxConnectionPoolSize: 50,
  connectionAcquisitionTimeout: 60000,
  autoCreateDatabase: true,
  autoCreateIndexes: true,
  enableRelationships: true,
};

/**
 * Cypher queries for schema setup
 */
const SCHEMA_QUERIES = [
  // Node constraint for unique keys
  'CREATE CONSTRAINT suspended_flow_key IF NOT EXISTS FOR (f:SuspendedFlow) REQUIRE f.key IS UNIQUE',

  // Indexes for performance
  'CREATE INDEX suspended_flow_created IF NOT EXISTS FOR (f:SuspendedFlow) ON (f.createdAt)',
  'CREATE INDEX suspended_flow_expires IF NOT EXISTS FOR (f:SuspendedFlow) ON (f.expiresAt)',
  'CREATE INDEX suspended_flow_tool_id IF NOT EXISTS FOR (f:SuspendedFlow) ON (f.toolId)',
  'CREATE INDEX suspended_flow_flow_id IF NOT EXISTS FOR (f:SuspendedFlow) ON (f.flowId)',

  // Relationship indexes
  'CREATE INDEX flow_dependency_type IF NOT EXISTS FOR ()-[r:DEPENDS_ON]-() ON (r.type)',
  'CREATE INDEX flow_sequence_order IF NOT EXISTS FOR ()-[r:FOLLOWS]-() ON (r.order)',
];

/**
 * Neo4j node properties for suspended flows
 */
interface SuspendedFlowNode {
  key: string;
  state: string; // JSON string
  createdAt: string; // ISO date string
  updatedAt: string;
  expiresAt?: string;
  toolId?: string;
  flowId?: string;
  size: number;
  checksum?: string;
  metadata: string; // JSON string
}

/**
 * Neo4j storage backend implementation
 */
export class Neo4jStorageBackend implements StorageBackend {
  private readonly config: Neo4jConfig;
  private driver: any = null; // neo4j.Driver
  private initialized = false;

  constructor(config: Partial<Neo4jConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Initialize Neo4j connection and schema
   */
  private async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // Import Neo4j driver dynamically
      const neo4j = await import('neo4j-driver');

      // Create driver with configuration
      this.driver = neo4j.driver(
        this.config.uri,
        neo4j.auth.basic(this.config.username, this.config.password),
        {
          maxConnectionPoolSize: this.config.maxConnectionPoolSize,
          connectionAcquisitionTimeout:
            this.config.connectionAcquisitionTimeout,
          disableLosslessIntegers: true, // Use regular JavaScript numbers
        }
      );

      // Test connectivity
      await this.driver.verifyConnectivity();

      // Auto-create database if enabled
      if (this.config.autoCreateDatabase) {
        await this.ensureDatabase();
      }

      // Auto-create indexes if enabled
      if (this.config.autoCreateIndexes) {
        await this.ensureSchema();
      }

      this.initialized = true;
      console.log(`✅ Connected to Neo4j: ${this.config.database}`);
    } catch (error) {
      throw new StorageError({
        module: 'persistence',
        operation: 'initialize',
        message: `Failed to initialize Neo4j backend: ${error instanceof Error ? error.message : 'Unknown error'}`,
        cause: error,
        backend: 'neo4j',
      });
    }
  }

  /**
   * Ensure database exists (Neo4j 4.0+)
   */
  private async ensureDatabase(): Promise<void> {
    if (this.config.database === 'neo4j') {
      return; // Skip auto-creation for default database
    }

    try {
      const session = this.driver.session({ database: 'system' });

      try {
        // Check if database exists
        const result = await session.run(
          'SHOW DATABASES YIELD name WHERE name = $dbName RETURN name',
          { dbName: this.config.database }
        );

        if (result.records.length === 0) {
          // Database doesn't exist, create it
          await session.run('CREATE DATABASE $dbName', {
            dbName: this.config.database,
          });

          console.log(`✅ Created Neo4j database: ${this.config.database}`);
        }
      } finally {
        await session.close();
      }
    } catch (error) {
      console.warn(
        `Warning: Could not auto-create Neo4j database: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      // Don't throw - database might already exist or user might not have permissions
    }
  }

  /**
   * Ensure schema constraints and indexes exist
   */
  private async ensureSchema(): Promise<void> {
    const session = this.driver.session({ database: this.config.database });

    try {
      // Execute schema queries
      for (const query of SCHEMA_QUERIES) {
        try {
          await session.run(query);
        } catch (error) {
          // Log warning but continue - constraints/indexes might already exist
          console.warn(
            `Neo4j schema warning: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }

      console.log('✅ Neo4j schema constraints and indexes ensured');
    } finally {
      await session.close();
    }
  }

  /**
   * Store serialized state as Neo4j node
   */
  store(
    key: SuspensionKey,
    state: SerializedState
  ): Effect.Effect<void, StorageError> {
    const self = this;
    return Effect.gen(function* () {
      yield* Effect.tryPromise({
        try: async () => {
          await self.initialize();

          const session = self.driver.session({
            database: self.config.database,
          });

          try {
            const now = new Date().toISOString();

            const nodeProperties: SuspendedFlowNode = {
              key,
              state: JSON.stringify(state),
              createdAt: now,
              updatedAt: now,
              expiresAt: state.expiresAt,
              toolId: ((state.metadata as any)?.toolId as string) || undefined,
              flowId: ((state.metadata as any)?.flowId as string) || undefined,
              size: state.data.length,
              checksum: (state.metadata?.checksum as string) || undefined,
              metadata: JSON.stringify(state.metadata || {}),
            };

            // Create or update node
            const query = `
              MERGE (f:SuspendedFlow {key: $key})
              SET f.state = $state,
                  f.createdAt = CASE WHEN f.createdAt IS NULL THEN $createdAt ELSE f.createdAt END,
                  f.updatedAt = $updatedAt,
                  f.expiresAt = $expiresAt,
                  f.toolId = $toolId,
                  f.flowId = $flowId,
                  f.size = $size,
                  f.checksum = $checksum,
                  f.metadata = $metadata
              RETURN f
            `;

            await session.run(query, nodeProperties);

            // Create relationships if enabled and flowId is available
            if (self.config.enableRelationships && nodeProperties.flowId) {
              await self.createFlowRelationships(
                session,
                key,
                nodeProperties.flowId
              );
            }
          } finally {
            await session.close();
          }
        },
        catch: (error) =>
          new StorageError({
            module: 'persistence',
            operation: 'store',
            message: `Failed to store in Neo4j: ${error instanceof Error ? error.message : 'Unknown error'}`,
            cause: error,
            backend: 'neo4j',
            retryable: self.isRetryableError(error),
          }),
      });
    });
  }

  /**
   * Retrieve serialized state from Neo4j
   */
  retrieve(
    key: SuspensionKey
  ): Effect.Effect<Option.Option<SerializedState>, StorageError> {
    const self = this;
    return Effect.gen(function* () {
      const result = yield* Effect.tryPromise({
        try: async () => {
          await self.initialize();

          const session = self.driver.session({
            database: self.config.database,
          });

          try {
            const query = `
              MATCH (f:SuspendedFlow {key: $key})
              WHERE f.expiresAt IS NULL OR datetime(f.expiresAt) > datetime()
              RETURN f.state as state, f.metadata as metadata
            `;

            return await session.run(query, { key });
          } finally {
            await session.close();
          }
        },
        catch: (error) =>
          new StorageError({
            module: 'persistence',
            operation: 'retrieve',
            message: `Failed to retrieve from Neo4j: ${error instanceof Error ? error.message : 'Unknown error'}`,
            cause: error,
            backend: 'neo4j',
          }),
      });

      if (result.records.length === 0) {
        return Option.none();
      }

      const record = result.records[0];
      const stateJson = record.get('state');
      const metadataJson = record.get('metadata');

      const state = yield* Effect.try({
        try: () => JSON.parse(stateJson) as SerializedState,
        catch: (error) =>
          new StorageError({
            module: 'persistence',
            operation: 'retrieve',
            message: `Failed to parse Neo4j state data: ${error instanceof Error ? error.message : 'Unknown error'}`,
            cause: error,
            backend: 'neo4j',
          }),
      });

      // Merge metadata from node properties
      const nodeMetadata = metadataJson ? JSON.parse(metadataJson) : {};

      return Option.some({
        ...state,
        metadata: {
          ...state.metadata,
          ...nodeMetadata,
          retrievedAt: new Date().toISOString(),
        },
      });
    });
  }

  /**
   * Delete stored state from Neo4j
   */
  delete(key: SuspensionKey): Effect.Effect<void, StorageError> {
    const self = this;
    return Effect.gen(function* () {
      yield* Effect.tryPromise({
        try: async () => {
          await self.initialize();

          const session = self.driver.session({
            database: self.config.database,
          });

          try {
            // Delete node and all its relationships
            const query = `
              MATCH (f:SuspendedFlow {key: $key})
              DETACH DELETE f
            `;

            await session.run(query, { key });
          } finally {
            await session.close();
          }
        },
        catch: (error) =>
          new StorageError({
            module: 'persistence',
            operation: 'delete',
            message: `Failed to delete from Neo4j: ${error instanceof Error ? error.message : 'Unknown error'}`,
            cause: error,
            backend: 'neo4j',
          }),
      });
    });
  }

  /**
   * List stored entries with Cypher queries
   */
  list(criteria?: ListCriteria): Effect.Effect<StorageEntry[], StorageError> {
    const self = this;
    return Effect.gen(function* () {
      const result = yield* Effect.tryPromise({
        try: async () => {
          await self.initialize();

          const session = self.driver.session({
            database: self.config.database,
          });

          try {
            let query = `
              MATCH (f:SuspendedFlow)
              WHERE 1=1
            `;
            const parameters: Record<string, any> = {};

            // Add filtering
            if (criteria?.prefix) {
              query += ` AND f.key STARTS WITH $prefix`;
              parameters.prefix = criteria.prefix;
            }

            if (criteria?.pattern) {
              query += ` AND f.key =~ $pattern`;
              parameters.pattern = criteria.pattern;
            }

            // Add ordering and pagination
            query += ` RETURN f.key as key, f.createdAt as createdAt, f.expiresAt as expiresAt, f.size as size, f.metadata as metadata`;
            query += ` ORDER BY f.createdAt DESC`;

            if (criteria?.offset) {
              query += ` SKIP $offset`;
              parameters.offset = criteria.offset;
            }

            if (criteria?.limit) {
              query += ` LIMIT $limit`;
              parameters.limit = criteria.limit;
            }

            return await session.run(query, parameters);
          } finally {
            await session.close();
          }
        },
        catch: (error) =>
          new StorageError({
            module: 'persistence',
            operation: 'list',
            message: `Failed to list from Neo4j: ${error instanceof Error ? error.message : 'Unknown error'}`,
            cause: error,
            backend: 'neo4j',
          }),
      });

      return result.records.map((record: any) => ({
        key: record.get('key') as SuspensionKey,
        createdAt: new Date(record.get('createdAt')),
        expiresAt: record.get('expiresAt')
          ? new Date(record.get('expiresAt'))
          : undefined,
        size: record.get('size') || 0,
        metadata: record.get('metadata')
          ? JSON.parse(record.get('metadata'))
          : {},
      }));
    });
  }

  /**
   * Health check
   */
  health(): Effect.Effect<BackendHealth, never> {
    const self = this;
    return Effect.gen(function* () {
      const startTime = Date.now();

      try {
        yield* Effect.tryPromise({
          try: async () => {
            await self.initialize();

            // Test connectivity and database access
            const session = self.driver.session({
              database: self.config.database,
            });

            try {
              await session.run('RETURN 1 as health_check');
            } finally {
              await session.close();
            }
          },
          catch: (error) => {
            throw error;
          },
        });

        const latency = Date.now() - startTime;

        return {
          backend: 'neo4j',
          healthy: true,
          latency,
          metadata: {
            uri: self.config.uri,
            database: self.config.database,
            maxConnectionPoolSize: self.config.maxConnectionPoolSize,
            enableRelationships: self.config.enableRelationships,
          },
        };
      } catch (error) {
        return {
          backend: 'neo4j',
          healthy: false,
          error: error instanceof Error ? error.message : 'Health check failed',
        };
      }
    });
  }

  /**
   * Cleanup expired entries
   */
  cleanup(criteria?: CleanupCriteria): Effect.Effect<number, StorageError> {
    const self = this;
    return Effect.gen(function* () {
      const deletedCount = yield* Effect.tryPromise({
        try: async () => {
          await self.initialize();

          const session = self.driver.session({
            database: self.config.database,
          });

          try {
            let query = `
              MATCH (f:SuspendedFlow)
              WHERE 1=1
            `;
            const parameters: Record<string, any> = {};

            if (criteria?.expiredOnly) {
              query += ` AND f.expiresAt IS NOT NULL AND datetime(f.expiresAt) <= datetime()`;
            }

            if (criteria?.olderThan) {
              query += ` AND datetime(f.createdAt) < datetime($olderThan)`;
              parameters.olderThan = criteria.olderThan.toISOString();
            }

            if (criteria?.toolId) {
              query += ` AND f.toolId = $toolId`;
              parameters.toolId = criteria.toolId;
            }

            if (criteria?.limit) {
              query += ` WITH f LIMIT $limit`;
              parameters.limit = criteria.limit;
            }

            query += ` DETACH DELETE f RETURN count(f) as deleted`;

            const result = await session.run(query, parameters);
            return result.records[0]?.get('deleted') || 0;
          } finally {
            await session.close();
          }
        },
        catch: (error) =>
          new StorageError({
            module: 'persistence',
            operation: 'cleanup',
            message: `Failed to cleanup from Neo4j: ${error instanceof Error ? error.message : 'Unknown error'}`,
            cause: error,
            backend: 'neo4j',
          }),
      });

      return deletedCount;
    });
  }

  /**
   * Dispose and cleanup resources
   */
  dispose(): Effect.Effect<void, never> {
    const self = this;
    return Effect.gen(function* () {
      if (self.driver) {
        yield* Effect.tryPromise({
          try: () => self.driver.close(),
          catch: () => undefined, // Ignore cleanup errors
        }).pipe(Effect.orElse(() => Effect.void));

        self.driver = null;
        self.initialized = false;
      }
    });
  }

  /**
   * Create relationships between flows (if enabled)
   */
  private async createFlowRelationships(
    session: any,
    key: SuspensionKey,
    flowId: string
  ): Promise<void> {
    try {
      // Example: Create relationships based on flow sequence or dependencies
      // This is a simplified example - real implementation would depend on flow metadata

      const query = `
        MATCH (current:SuspendedFlow {key: $key})
        MATCH (related:SuspendedFlow {flowId: $flowId})
        WHERE current.key <> related.key
        AND NOT EXISTS((current)-[:RELATED_TO]-(related))
        CREATE (current)-[:RELATED_TO {type: 'same_flow', createdAt: datetime()}]->(related)
      `;

      await session.run(query, { key, flowId });
    } catch (error) {
      // Log but don't fail - relationships are optional
      console.warn('Failed to create Neo4j relationships:', error);
    }
  }

  /**
   * Check if an error is retryable
   */
  private isRetryableError(error: unknown): boolean {
    if (error && typeof error === 'object' && 'code' in error) {
      const neo4jError = error as { code: string };

      // Neo4j error codes that indicate retryable errors
      const retryableCodes = [
        'Neo.TransientError.General.DatabaseUnavailable',
        'Neo.TransientError.Network.CommunicationError',
        'Neo.TransientError.Transaction.DeadlockDetected',
        'Neo.TransientError.Transaction.LockClientStopped',
      ];

      return retryableCodes.some((code) => neo4jError.code.includes(code));
    }

    return false;
  }
}

/**
 * Create Neo4j storage backend
 */
export const createNeo4jBackend = (
  config?: Partial<Neo4jConfig>
): StorageBackend => {
  return new Neo4jStorageBackend(config);
};

/**
 * Create Neo4j backend from connection details
 */
export const createNeo4jBackendFromConnection = (
  uri: string,
  username: string,
  password: string,
  options?: Omit<Partial<Neo4jConfig>, 'uri' | 'username' | 'password'>
): StorageBackend => {
  return new Neo4jStorageBackend({
    ...options,
    uri,
    username,
    password,
  });
};

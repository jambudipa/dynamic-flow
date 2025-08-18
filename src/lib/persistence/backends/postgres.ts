/**
 * PostgreSQL Storage Backend - Production-ready relational storage
 * 
 * Features:
 * - Automatic database and table creation
 * - ACID compliance for data integrity
 * - Connection pooling for performance
 * - Optimized indexes for query performance
 * - Automatic schema migrations
 * - TTL-based cleanup with background jobs
 */

import { Effect, pipe, Option } from 'effect'
import {
  type StorageBackend,
  type SerializedState,
  type StorageEntry,
  type ListCriteria,
  type CleanupCriteria,
  type BackendHealth,
  StorageError,
  type SuspensionKey
} from '../types'

/**
 * PostgreSQL configuration
 */
export interface PostgresConfig {
  readonly connectionString: string
  readonly tableName: string
  readonly maxConnections: number
  readonly idleTimeoutMillis: number
  readonly connectionTimeoutMillis: number
  readonly autoCreateDatabase: boolean
  readonly autoCreateSchema: boolean
  readonly enableBackgroundCleanup: boolean
  readonly cleanupIntervalMs: number
}

/**
 * Default PostgreSQL configuration
 */
const DEFAULT_CONFIG: PostgresConfig = {
  connectionString: process.env.POSTGRES_URL || 'postgresql://localhost:5432/dynamicflow',
  tableName: 'suspended_flows',
  maxConnections: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  autoCreateDatabase: true,
  autoCreateSchema: true,
  enableBackgroundCleanup: true,
  cleanupIntervalMs: 60 * 60 * 1000 // 1 hour
}

/**
 * Database schema for suspended flows
 */
const SCHEMA_SQL = `
-- Suspended flows table with optimized indexes
CREATE TABLE IF NOT EXISTS {{tableName}} (
  key VARCHAR(255) PRIMARY KEY,
  state JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  expires_at TIMESTAMP WITH TIME ZONE,
  metadata JSONB DEFAULT '{}',
  checksum VARCHAR(64),
  size_bytes INTEGER,
  
  -- Constraints
  CONSTRAINT valid_key_format CHECK (char_length(key) > 0),
  CONSTRAINT valid_size CHECK (size_bytes >= 0)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_{{tableName}}_created_at ON {{tableName}}(created_at);
CREATE INDEX IF NOT EXISTS idx_{{tableName}}_expires_at ON {{tableName}}(expires_at) WHERE expires_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_{{tableName}}_metadata ON {{tableName}} USING GIN(metadata);
CREATE INDEX IF NOT EXISTS idx_{{tableName}}_tool_id ON {{tableName}}((metadata->>'toolId')) WHERE metadata->>'toolId' IS NOT NULL;

-- Trigger for updating updated_at
CREATE OR REPLACE FUNCTION update_{{tableName}}_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

DROP TRIGGER IF EXISTS trigger_{{tableName}}_updated_at ON {{tableName}};
CREATE TRIGGER trigger_{{tableName}}_updated_at
  BEFORE UPDATE ON {{tableName}}
  FOR EACH ROW
  EXECUTE FUNCTION update_{{tableName}}_updated_at();

-- Cleanup function for expired flows
CREATE OR REPLACE FUNCTION cleanup_expired_{{tableName}}()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM {{tableName}} 
  WHERE expires_at IS NOT NULL AND expires_at < NOW();
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;
`

/**
 * Row structure from database
 */
interface SuspendedFlowRow {
  key: string
  state: any // JSONB
  created_at: Date
  updated_at: Date
  expires_at: Date | null
  metadata: any // JSONB
  checksum: string | null
  size_bytes: number | null
}

/**
 * PostgreSQL storage backend implementation
 */
export class PostgresStorageBackend implements StorageBackend {
  private readonly config: PostgresConfig
  private pool: any = null // pg.Pool
  private schemaInitialized = false
  private cleanupTimer?: NodeJS.Timeout

  constructor(config: Partial<PostgresConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  /**
   * Initialize the backend (lazy initialization)
   */
  private async initialize(): Promise<void> {
    if (this.pool && this.schemaInitialized) {
      return
    }

    try {
      // Import pg dynamically so it's optional
      const { Pool } = await import('pg')

      // Create connection pool
      this.pool = new Pool({
        connectionString: this.config.connectionString,
        max: this.config.maxConnections,
        idleTimeoutMillis: this.config.idleTimeoutMillis,
        connectionTimeoutMillis: this.config.connectionTimeoutMillis
      })

      // Test connection
      const client = await this.pool.connect()
      
      try {
        // Auto-create database if it doesn't exist
        if (this.config.autoCreateDatabase) {
          await this.ensureDatabase(client)
        }

        // Auto-create schema and tables
        if (this.config.autoCreateSchema) {
          await this.ensureSchema(client)
        }

        this.schemaInitialized = true

        // Start background cleanup if enabled
        if (this.config.enableBackgroundCleanup) {
          this.startBackgroundCleanup()
        }

      } finally {
        client.release()
      }

    } catch (error) {
      throw new StorageError({
        module: 'persistence',
        operation: 'initialize',
        message: `Failed to initialize PostgreSQL backend: ${error instanceof Error ? error.message : 'Unknown error'}`,
        cause: error,
        backend: 'postgres'
      })
    }
  }

  /**
   * Ensure database exists (for auto-provisioning)
   */
  private async ensureDatabase(client: any): Promise<void> {
    try {
      // Extract database name from connection string
      const url = new URL(this.config.connectionString)
      const dbName = url.pathname.slice(1) // Remove leading slash

      if (!dbName || dbName === 'postgres') {
        return // Skip auto-creation for default postgres database
      }

      // Check if database exists
      const result = await client.query(
        'SELECT 1 FROM pg_database WHERE datname = $1',
        [dbName]
      )

      if (result.rows.length === 0) {
        // Database doesn't exist, create it
        // Note: We need to connect to 'postgres' database to create a new one
        const { Pool } = await import('pg')
        const adminUrl = new URL(this.config.connectionString)
        adminUrl.pathname = '/postgres'

        const adminPool = new Pool({
          connectionString: adminUrl.toString(),
          max: 1
        })

        try {
          // Use query directly for database creation
          await adminPool.query(`CREATE DATABASE "${dbName}"`)
          console.log(`✅ Created database: ${dbName}`)
        } finally {
          await adminPool.end()
        }
      }

    } catch (error) {
      console.warn(`Warning: Could not auto-create database: ${error instanceof Error ? error.message : 'Unknown error'}`)
      // Don't throw - database might already exist or user might not have permissions
    }
  }

  /**
   * Ensure schema and tables exist (for auto-provisioning)
   */
  private async ensureSchema(client: any): Promise<void> {
    try {
      // Replace table name placeholder in schema
      const schemaSQL = SCHEMA_SQL.replace(/{{tableName}}/g, this.config.tableName)

      // Execute schema creation SQL
      await client.query(schemaSQL)

      console.log(`✅ Initialized PostgreSQL schema for table: ${this.config.tableName}`)

    } catch (error) {
      throw new StorageError({
        module: 'persistence',
        operation: 'ensureSchema',
        message: `Failed to create schema: ${error instanceof Error ? error.message : 'Unknown error'}`,
        cause: error,
        backend: 'postgres'
      })
    }
  }

  /**
   * Store serialized state
   */
  store(key: SuspensionKey, state: SerializedState): Effect.Effect<void, StorageError> {
    const self = this;
    return Effect.gen(function* () {
      yield* Effect.tryPromise({
        try: async () => {
          await self.initialize()

          const query = `
            INSERT INTO ${self.config.tableName} 
            (key, state, expires_at, metadata, checksum, size_bytes)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (key) DO UPDATE SET
            state = $2, updated_at = NOW(), expires_at = $3, 
            metadata = $4, checksum = $5, size_bytes = $6
          `

          const values = [
            key,
            state, // JSONB
            state.expiresAt ? new Date(state.expiresAt) : null,
            state.metadata || {}, // JSONB
            state.metadata?.checksum || null,
            state.data.length
          ]

          await self.pool.query(query, values)
        },
        catch: (error) => new StorageError({
          module: 'persistence',
          operation: 'store',
          message: `Failed to store state: ${error instanceof Error ? error.message : 'Unknown error'}`,
          cause: error,
          backend: 'postgres',
          retryable: self.isRetryableError(error)
        })
      })
    })
  }

  /**
   * Retrieve serialized state
   */
  retrieve(key: SuspensionKey): Effect.Effect<Option.Option<SerializedState>, StorageError> {
    const self = this;
    return Effect.gen(function* () {
      const result = yield* Effect.tryPromise({
        try: async () => {
          await self.initialize()

          const query = `
            SELECT state, created_at, expires_at, metadata, checksum
            FROM ${self.config.tableName}
            WHERE key = $1 AND (expires_at IS NULL OR expires_at > NOW())
          `

          return await self.pool.query(query, [key])
        },
        catch: (error) => new StorageError({
          module: 'persistence',
          operation: 'retrieve',
          message: `Failed to retrieve state: ${error instanceof Error ? error.message : 'Unknown error'}`,
          cause: error,
          backend: 'postgres'
        })
      })

      if (result.rows.length === 0) {
        return Option.none()
      }

      const row: SuspendedFlowRow = result.rows[0]
      
      return Option.some({
        ...row.state,
        metadata: {
          ...row.state.metadata,
          ...row.metadata,
          retrievedAt: new Date().toISOString()
        }
      } as SerializedState)
    })
  }

  /**
   * Delete stored state
   */
  delete(key: SuspensionKey): Effect.Effect<void, StorageError> {
    const self = this;
    return Effect.gen(function* () {
      yield* Effect.tryPromise({
        try: async () => {
          await self.initialize()

          const query = `DELETE FROM ${self.config.tableName} WHERE key = $1`
          await self.pool.query(query, [key])
        },
        catch: (error) => new StorageError({
          module: 'persistence',
          operation: 'delete',
          message: `Failed to delete state: ${error instanceof Error ? error.message : 'Unknown error'}`,
          cause: error,
          backend: 'postgres'
        })
      })
    })
  }

  /**
   * List stored entries
   */
  list(criteria?: ListCriteria): Effect.Effect<StorageEntry[], StorageError> {
    const self = this;
    return Effect.gen(function* () {
      const result = yield* Effect.tryPromise({
        try: async () => {
          await self.initialize()

          let query = `
            SELECT key, created_at, expires_at, metadata, size_bytes
            FROM ${self.config.tableName}
            WHERE 1=1
          `
          const values: any[] = []
          let paramCount = 0

          // Add filtering
          if (criteria?.prefix) {
            paramCount++
            query += ` AND key LIKE $${paramCount}`
            values.push(`${criteria.prefix}%`)
          }

          if (criteria?.pattern) {
            paramCount++
            query += ` AND key ~ $${paramCount}`
            values.push(criteria.pattern)
          }

          // Add ordering and pagination
          query += ` ORDER BY created_at DESC`

          if (criteria?.limit) {
            paramCount++
            query += ` LIMIT $${paramCount}`
            values.push(criteria.limit)
          }

          if (criteria?.offset) {
            paramCount++
            query += ` OFFSET $${paramCount}`
            values.push(criteria.offset)
          }

          return await self.pool.query(query, values)
        },
        catch: (error) => new StorageError({
          module: 'persistence',
          operation: 'list',
          message: `Failed to list entries: ${error instanceof Error ? error.message : 'Unknown error'}`,
          cause: error,
          backend: 'postgres'
        })
      })

      return result.rows.map((row: SuspendedFlowRow) => ({
        key: row.key as SuspensionKey,
        createdAt: row.created_at,
        expiresAt: row.expires_at || undefined,
        size: row.size_bytes || 0,
        metadata: row.metadata || {}
      }))
    })
  }

  /**
   * Health check
   */
  health(): Effect.Effect<BackendHealth, never> {
    const self = this;
    return Effect.gen(function* () {
      const startTime = Date.now()

      try {
        yield* Effect.tryPromise({
          try: async () => {
            await self.initialize()
            
            // Simple connectivity test
            const result = await self.pool.query('SELECT 1 as health_check')
            if (result.rows[0].health_check !== 1) {
              throw new Error('Health check query failed')
            }
          },
          catch: (error) => { throw error }
        })

        const latency = Date.now() - startTime

        return {
          backend: 'postgres',
          healthy: true,
          latency,
          metadata: {
            tableName: self.config.tableName,
            maxConnections: self.config.maxConnections,
            schemaInitialized: self.schemaInitialized
          }
        }

      } catch (error) {
        return {
          backend: 'postgres',
          healthy: false,
          error: error instanceof Error ? error.message : 'Health check failed'
        }
      }
    })
  }

  /**
   * Cleanup expired entries
   */
  cleanup(criteria?: CleanupCriteria): Effect.Effect<number, StorageError> {
    const self = this;
    return Effect.gen(function* () {
      const deletedCount = yield* Effect.tryPromise({
        try: async () => {
          await self.initialize()

          if (criteria?.expiredOnly) {
            // Use the stored procedure for efficient cleanup
            const result = await self.pool.query(`SELECT cleanup_expired_${self.config.tableName}()`)
            return result.rows[0][`cleanup_expired_${self.config.tableName}`]
          }

          // Manual cleanup with criteria
          let query = `DELETE FROM ${self.config.tableName} WHERE 1=1`
          const values: any[] = []
          let paramCount = 0

          if (criteria?.olderThan) {
            paramCount++
            query += ` AND created_at < $${paramCount}`
            values.push(criteria.olderThan)
          }

          if (criteria?.toolId) {
            paramCount++
            query += ` AND metadata->>'toolId' = $${paramCount}`
            values.push(criteria.toolId)
          }

          if (criteria?.limit) {
            // PostgreSQL doesn't support LIMIT in DELETE directly
            query = `DELETE FROM ${self.config.tableName} WHERE key IN (
              SELECT key FROM ${self.config.tableName} WHERE 1=1`
            
            if (criteria.olderThan) {
              query += ` AND created_at < $1`
            }
            if (criteria.toolId) {
              query += ` AND metadata->>'toolId' = $${criteria.olderThan ? 2 : 1}`
            }
            
            paramCount++
            query += ` LIMIT $${paramCount})`
            values.push(criteria.limit)
          }

          const result = await self.pool.query(query, values)
          return result.rowCount || 0
        },
        catch: (error) => new StorageError({
          module: 'persistence',
          operation: 'cleanup',
          message: `Failed to cleanup entries: ${error instanceof Error ? error.message : 'Unknown error'}`,
          cause: error,
          backend: 'postgres'
        })
      })

      return deletedCount
    })
  }

  /**
   * Dispose and cleanup resources
   */
  dispose(): Effect.Effect<void, never> {
    const self = this;
    return Effect.gen(function* () {
      if (self.cleanupTimer) {
        clearInterval(self.cleanupTimer)
        self.cleanupTimer = undefined
      }

      if (self.pool) {
        yield* Effect.tryPromise({
          try: () => self.pool.end(),
          catch: () => undefined // Ignore cleanup errors
        }).pipe(Effect.orElse(() => Effect.void))
        self.pool = null
      }
    })
  }

  /**
   * Start background cleanup process
   */
  private startBackgroundCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      Effect.runPromise(
        this.cleanup({ expiredOnly: true })
      ).catch(error => {
        console.warn('PostgreSQL background cleanup failed:', error)
      })
    }, this.config.cleanupIntervalMs)
  }

  /**
   * Check if an error is retryable
   */
  private isRetryableError(error: unknown): boolean {
    if (error && typeof error === 'object' && 'code' in error) {
      const pgError = error as { code: string }
      
      // PostgreSQL error codes that indicate retryable errors
      const retryableCodes = [
        '08000', // connection_exception
        '08003', // connection_does_not_exist
        '08006', // connection_failure
        '08001', // sqlclient_unable_to_establish_sqlconnection
        '08004', // sqlserver_rejected_establishment_of_sqlconnection
        '53300', // too_many_connections
        '57P03', // cannot_connect_now
      ]

      return retryableCodes.includes(pgError.code)
    }

    return false
  }
}

/**
 * Create PostgreSQL storage backend
 */
export const createPostgresBackend = (config?: Partial<PostgresConfig>): StorageBackend => {
  return new PostgresStorageBackend(config)
}

/**
 * Create PostgreSQL backend from connection string
 */
export const createPostgresBackendFromUrl = (
  connectionString: string,
  options?: Omit<Partial<PostgresConfig>, 'connectionString'>
): StorageBackend => {
  return new PostgresStorageBackend({
    ...options,
    connectionString
  })
}
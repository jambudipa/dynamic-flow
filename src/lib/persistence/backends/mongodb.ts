/**
 * MongoDB Storage Backend - Document-based persistence
 *
 * Features:
 * - Automatic database and collection creation
 * - Document-based storage with flexible schema
 * - Optimized indexes for query performance
 * - TTL indexes for automatic expiration
 * - Connection pooling and replica set support
 * - GridFS support for large states (future)
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
 * MongoDB configuration
 */
export interface MongoConfig {
  readonly connectionString: string;
  readonly databaseName: string;
  readonly collectionName: string;
  readonly maxPoolSize: number;
  readonly minPoolSize: number;
  readonly maxIdleTimeMS: number;
  readonly autoCreateDatabase: boolean;
  readonly autoCreateIndexes: boolean;
  readonly enableTTL: boolean;
  readonly defaultTTLSeconds: number;
}

/**
 * Default MongoDB configuration
 */
const DEFAULT_CONFIG: MongoConfig = {
  connectionString:
    process.env.MONGODB_URL || 'mongodb://localhost:27017/dynamicflow',
  databaseName: 'dynamicflow',
  collectionName: 'suspended_flows',
  maxPoolSize: 10,
  minPoolSize: 2,
  maxIdleTimeMS: 30000,
  autoCreateDatabase: true,
  autoCreateIndexes: true,
  enableTTL: true,
  defaultTTLSeconds: 24 * 60 * 60, // 24 hours
};

/**
 * MongoDB document structure
 */
interface SuspendedFlowDocument {
  _id: string; // suspension key
  state: SerializedState;
  createdAt: Date;
  updatedAt: Date;
  expiresAt?: Date;
  metadata: Record<string, unknown>;
  size: number;
  checksum?: string;
}

/**
 * Index definitions for the collection
 */
const INDEX_DEFINITIONS = [
  // Primary key is automatic

  // Query performance indexes
  { key: { createdAt: 1 }, name: 'idx_created_at' },
  { key: { updatedAt: 1 }, name: 'idx_updated_at' },
  { key: { 'metadata.toolId': 1 }, name: 'idx_tool_id' },
  { key: { 'metadata.flowId': 1 }, name: 'idx_flow_id' },

  // Compound indexes for common queries
  {
    key: { createdAt: 1, 'metadata.toolId': 1 },
    name: 'idx_created_tool',
  },

  // TTL index for automatic expiration
  {
    key: { expiresAt: 1 },
    name: 'idx_ttl_expires',
    expireAfterSeconds: 0, // Documents expire at the time specified in expiresAt
  },

  // Text search index for key patterns
  {
    key: { _id: 'text' },
    name: 'idx_text_search',
  },
];

/**
 * MongoDB storage backend implementation
 */
export class MongoStorageBackend implements StorageBackend {
  private readonly config: MongoConfig;
  private client: any = null; // MongoClient
  private db: any = null; // Db
  private collection: any = null; // Collection
  private initialized = false;

  constructor(config: Partial<MongoConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Extract database name from connection string if not provided
    if (!config.databaseName && this.config.connectionString) {
      try {
        const url = new URL(this.config.connectionString);
        const dbName = url.pathname.slice(1); // Remove leading slash
        if (dbName) {
          this.config = { ...this.config, databaseName: dbName };
        }
      } catch {
        // Use default database name if URL parsing fails
      }
    }
  }

  /**
   * Initialize MongoDB connection and schema
   */
  private async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      // Import MongoDB driver dynamically
      const { MongoClient } = await import('mongodb');

      // Create client with connection options
      this.client = new MongoClient(this.config.connectionString, {
        maxPoolSize: this.config.maxPoolSize,
        minPoolSize: this.config.minPoolSize,
        maxIdleTimeMS: this.config.maxIdleTimeMS,
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 10000,
      });

      // Connect to MongoDB
      await this.client.connect();

      // Get database (creates it if it doesn't exist)
      this.db = this.client.db(this.config.databaseName);

      // Get collection (creates it if it doesn't exist)
      this.collection = this.db.collection(this.config.collectionName);

      // Auto-create indexes if enabled
      if (this.config.autoCreateIndexes) {
        await this.ensureIndexes();
      }

      this.initialized = true;

      console.log(
        `✅ Connected to MongoDB: ${this.config.databaseName}.${this.config.collectionName}`
      );
    } catch (error) {
      throw new StorageError({
        module: 'persistence',
        operation: 'initialize',
        message: `Failed to initialize MongoDB backend: ${error instanceof Error ? error.message : 'Unknown error'}`,
        cause: error,
        backend: 'mongodb',
      });
    }
  }

  /**
   * Ensure all required indexes exist
   */
  private async ensureIndexes(): Promise<void> {
    try {
      // Get existing indexes
      const existingIndexes = await this.collection.listIndexes().toArray();
      const existingIndexNames = new Set(
        existingIndexes.map((idx: any) => idx.name)
      );

      // Create missing indexes
      for (const indexDef of INDEX_DEFINITIONS) {
        if (!existingIndexNames.has(indexDef.name)) {
          await this.collection.createIndex(indexDef.key, {
            name: indexDef.name,
            background: true,
            ...(indexDef as any), // Include any additional options like expireAfterSeconds
          });

          console.log(`✅ Created MongoDB index: ${indexDef.name}`);
        }
      }
    } catch (error) {
      console.warn(
        `Warning: Could not create MongoDB indexes: ${error instanceof Error ? error.message : 'Unknown error'}`
      );
      // Don't throw - indexes are performance optimizations, not critical for functionality
    }
  }

  /**
   * Store serialized state
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

          const document: SuspendedFlowDocument = {
            _id: key,
            state,
            createdAt: new Date(),
            updatedAt: new Date(),
            expiresAt: state.expiresAt ? new Date(state.expiresAt) : undefined,
            metadata: state.metadata || {},
            size: state.data.length,
            checksum: state.metadata?.checksum,
          };

          // Use upsert to handle both insert and update
          await self.collection.replaceOne({ _id: key }, document, {
            upsert: true,
          });
        },
        catch: (error) =>
          new StorageError({
            module: 'persistence',
            operation: 'store',
            message: `Failed to store document: ${error instanceof Error ? error.message : 'Unknown error'}`,
            cause: error,
            backend: 'mongodb',
            retryable: self.isRetryableError(error),
          }),
      });
    });
  }

  /**
   * Retrieve serialized state
   */
  retrieve(
    key: SuspensionKey
  ): Effect.Effect<Option.Option<SerializedState>, StorageError> {
    const self = this;
    return Effect.gen(function* () {
      const document = yield* Effect.tryPromise({
        try: async () => {
          await self.initialize();

          // Find document that hasn't expired
          const query: any = { _id: key };

          // Add expiration check
          if (self.config.enableTTL) {
            query.$or = [
              { expiresAt: { $exists: false } },
              { expiresAt: null },
              { expiresAt: { $gt: new Date() } },
            ];
          }

          return await self.collection.findOne(query);
        },
        catch: (error) =>
          new StorageError({
            module: 'persistence',
            operation: 'retrieve',
            message: `Failed to retrieve document: ${error instanceof Error ? error.message : 'Unknown error'}`,
            cause: error,
            backend: 'mongodb',
          }),
      });

      if (!document) {
        return Option.none();
      }

      const doc = document as SuspendedFlowDocument;

      return Option.some({
        ...doc.state,
        metadata: {
          ...doc.state.metadata,
          retrievedAt: new Date().toISOString(),
          mongoId: doc._id,
        },
      } as SerializedState);
    });
  }

  /**
   * Delete stored state
   */
  delete(key: SuspensionKey): Effect.Effect<void, StorageError> {
    const self = this;
    return Effect.gen(function* () {
      yield* Effect.tryPromise({
        try: async () => {
          await self.initialize();

          await self.collection.deleteOne({ _id: key });
        },
        catch: (error) =>
          new StorageError({
            module: 'persistence',
            operation: 'delete',
            message: `Failed to delete document: ${error instanceof Error ? error.message : 'Unknown error'}`,
            cause: error,
            backend: 'mongodb',
          }),
      });
    });
  }

  /**
   * List stored entries
   */
  list(criteria?: ListCriteria): Effect.Effect<StorageEntry[], StorageError> {
    const self = this;
    return Effect.gen(function* () {
      const documents = yield* Effect.tryPromise({
        try: async () => {
          await self.initialize();

          // Build query
          const query: any = {};

          // Add prefix filter
          if (criteria?.prefix) {
            query._id = { $regex: `^${self.escapeRegex(criteria.prefix)}` };
          }

          // Add pattern filter
          if (criteria?.pattern) {
            query._id = {
              ...query._id,
              $regex: criteria.pattern,
            };
          }

          // Build aggregation pipeline for complex queries
          const pipeline: any[] = [{ $match: query }];

          // Add sorting
          pipeline.push({ $sort: { createdAt: -1 } });

          // Add pagination
          if (criteria?.offset) {
            pipeline.push({ $skip: criteria.offset });
          }

          if (criteria?.limit) {
            pipeline.push({ $limit: criteria.limit });
          }

          // Project only needed fields
          pipeline.push({
            $project: {
              _id: 1,
              createdAt: 1,
              expiresAt: 1,
              metadata: 1,
              size: 1,
            },
          });

          return await self.collection.aggregate(pipeline).toArray();
        },
        catch: (error) =>
          new StorageError({
            module: 'persistence',
            operation: 'list',
            message: `Failed to list documents: ${error instanceof Error ? error.message : 'Unknown error'}`,
            cause: error,
            backend: 'mongodb',
          }),
      });

      return documents.map((doc: any) => ({
        key: doc._id as SuspensionKey,
        createdAt: doc.createdAt,
        expiresAt: doc.expiresAt || undefined,
        size: doc.size || 0,
        metadata: doc.metadata || {},
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

            // Test database connectivity
            await self.db.admin().ping();

            // Test collection access
            await self.collection.estimatedDocumentCount();
          },
          catch: (error) => {
            throw error;
          },
        });

        const latency = Date.now() - startTime;

        return {
          backend: 'mongodb',
          healthy: true,
          latency,
          metadata: {
            databaseName: self.config.databaseName,
            collectionName: self.config.collectionName,
            maxPoolSize: self.config.maxPoolSize,
            initialized: self.initialized,
          },
        };
      } catch (error) {
        return {
          backend: 'mongodb',
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

          // Build delete query
          const query: any = {};

          if (criteria?.expiredOnly) {
            query.expiresAt = { $lte: new Date() };
          }

          if (criteria?.olderThan) {
            query.createdAt = { $lt: criteria.olderThan };
          }

          if (criteria?.toolId) {
            query['metadata.toolId'] = criteria.toolId;
          }

          // Execute delete with limit if specified
          if (criteria?.limit) {
            // MongoDB doesn't support limit in deleteMany, so we need to find and delete
            const docs = await self.collection
              .find(query, { projection: { _id: 1 } })
              .limit(criteria.limit)
              .toArray();

            const ids = docs.map((doc: any) => doc._id);

            if (ids.length > 0) {
              const result = await self.collection.deleteMany({
                _id: { $in: ids },
              });
              return result.deletedCount || 0;
            }

            return 0;
          } else {
            const result = await self.collection.deleteMany(query);
            return result.deletedCount || 0;
          }
        },
        catch: (error) =>
          new StorageError({
            module: 'persistence',
            operation: 'cleanup',
            message: `Failed to cleanup documents: ${error instanceof Error ? error.message : 'Unknown error'}`,
            cause: error,
            backend: 'mongodb',
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
      if (self.client) {
        yield* Effect.tryPromise({
          try: () => self.client.close(),
          catch: () => undefined, // Ignore cleanup errors
        }).pipe(Effect.orElse(() => Effect.void));

        self.client = null;
        self.db = null;
        self.collection = null;
        self.initialized = false;
      }
    });
  }

  /**
   * Check if an error is retryable
   */
  private isRetryableError(error: unknown): boolean {
    if (error && typeof error === 'object' && 'code' in error) {
      const mongoError = error as { code: number };

      // MongoDB error codes that indicate retryable errors
      const retryableCodes = [
        11000, // DuplicateKey (might be retryable in some cases)
        11001, // DuplicateKey
        6, // HostUnreachable
        7, // HostNotFound
        89, // NetworkTimeout
        91, // ShutdownInProgress
        189, // PrimarySteppedDown
        262, // ExceededTimeLimit
        9001, // SocketException
        10107, // NotMaster
        13435, // NotMasterNoSlaveOk
        13436, // NotMasterOrSecondary
      ];

      return retryableCodes.includes(mongoError.code);
    }

    return false;
  }

  /**
   * Escape special regex characters
   */
  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
}

/**
 * Create MongoDB storage backend
 */
export const createMongoBackend = (
  config?: Partial<MongoConfig>
): StorageBackend => {
  return new MongoStorageBackend(config);
};

/**
 * Create MongoDB backend from connection string
 */
export const createMongoBackendFromUrl = (
  connectionString: string,
  options?: Omit<Partial<MongoConfig>, 'connectionString'>
): StorageBackend => {
  return new MongoStorageBackend({
    ...options,
    connectionString,
  });
};

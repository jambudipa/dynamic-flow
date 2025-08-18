/**
 * Storage Backends - Pluggable persistence backends for DynamicFlow
 * 
 * Provides multiple storage options for flow state persistence:
 * - Filesystem: Zero-dependency option for development
 * - PostgreSQL: Relational database with ACID compliance
 * - Redis: In-memory with TTL support
 * - MongoDB: Document-based storage
 * - Neo4j: Graph database with relationships
 */

// Export all backend implementations
export * from './filesystem'

// Conditional exports for optional backends
export { PostgresStorageBackend } from './postgres'
export { RedisStorageBackend } from './redis'
export { MongoStorageBackend } from './mongodb'
export { Neo4jStorageBackend } from './neo4j'
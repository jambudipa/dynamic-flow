/**
 * Filesystem Storage Backend - Zero-dependency persistence for development
 * 
 * Provides file-based storage with:
 * - Atomic file operations
 * - Directory structure organization
 * - Automatic directory creation
 * - File locking for concurrent access
 * - Cleanup of expired files
 * - JSON-based storage format
 */

import { Effect, Context, Layer, pipe, Option, Ref } from 'effect'
import { promises as fs } from 'fs'
import * as path from 'path'
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
 * Configuration for filesystem backend
 */
export interface FilesystemConfig {
  readonly basePath: string
  readonly enableLocking: boolean
  readonly maxConcurrentOps: number
  readonly cleanupInterval: number
}

/**
 * Default filesystem configuration
 */
const DEFAULT_CONFIG: FilesystemConfig = {
  basePath: './suspended-flows',
  enableLocking: true,
  maxConcurrentOps: 100,
  cleanupInterval: 60 * 60 * 1000 // 1 hour
}

/**
 * File metadata structure
 */
interface FileMetadata {
  readonly key: string
  readonly createdAt: string
  readonly expiresAt?: string
  readonly size: number
  readonly metadata: Record<string, unknown>
}

/**
 * Combined file structure (metadata + state)
 */
interface FileData {
  readonly metadata: FileMetadata
  readonly state: SerializedState
}

/**
 * Filesystem storage backend service
 */
export const FilesystemStorageBackend = Context.GenericTag<StorageBackend>('@persistence/FilesystemStorageBackend')

/**
 * Create filesystem storage backend service layer
 */
export const FilesystemStorageBackendLive = (config: Partial<FilesystemConfig> = {}) =>
  Layer.effect(
    FilesystemStorageBackend,
    Effect.gen(function* () {
      const finalConfig = { ...DEFAULT_CONFIG, ...config }
      const activeLocks = yield* Ref.make(new Set<string>())
      const cleanupTimer = yield* Ref.make<NodeJS.Timeout | undefined>(undefined)

      // Start periodic cleanup if configured
      if (finalConfig.cleanupInterval > 0) {
        const timer = setInterval(() => {
          Effect.runPromise(
            cleanup({ expiredOnly: true })
          ).catch(error => {
            console.warn('Periodic cleanup failed:', error)
          })
        }, finalConfig.cleanupInterval)
        yield* Ref.set(cleanupTimer, timer)
      }

      const ensureDirectory = (): Effect.Effect<void, StorageError> =>
        Effect.tryPromise({
          try: () => fs.mkdir(finalConfig.basePath, { recursive: true }),
          catch: (error) => new StorageError({
            module: 'persistence',
            operation: 'ensureDirectory',
            message: `Failed to create directory: ${error instanceof Error ? error.message : 'Unknown error'}`,
            cause: error,
            backend: 'filesystem'
          })
        }).pipe(Effect.map(() => {}))

      const getFilePath = (key: SuspensionKey): string => {
        // Sanitize key for filesystem use
        const sanitizedKey = key.replace(/[^a-zA-Z0-9_\-]/g, '_')
        return path.join(finalConfig.basePath, `${sanitizedKey}.json`)
      }

      const acquireLock = (lockPath: string): Effect.Effect<void, StorageError> =>
        Effect.gen(function* () {
          const locks = yield* Ref.get(activeLocks)
          let attempts = 0
          const maxAttempts = 50
          const delayMs = 100

          while (attempts < maxAttempts) {
            if (locks.has(lockPath)) {
              attempts++
              yield* Effect.sleep(delayMs)
              continue
            }

            try {
              // Try to create lock file
              const lockResult = yield* Effect.tryPromise({
                try: () => fs.writeFile(lockPath, process.pid.toString(), { flag: 'wx' }).then(() => true),
                catch: (error) => {
                  if ((error as any)?.code === 'EEXIST') {
                    return new StorageError({
                      module: 'persistence',
                      operation: 'acquireLock',
                      message: 'Lock exists',
                      cause: error,
                      backend: 'filesystem'
                    })
                  }
                  return new StorageError({
                    module: 'persistence',
                    operation: 'acquireLock',
                    message: `Failed to create lock: ${error instanceof Error ? error.message : 'Unknown error'}`,
                    cause: error,
                    backend: 'filesystem'
                  })
                }
              }).pipe(Effect.orElse(() => Effect.succeed(false)))
              
              if (lockResult === false) {
                attempts++
                yield* Effect.sleep(delayMs)
                continue
              }

              yield* Ref.update(activeLocks, (set) => new Set(set).add(lockPath))
              return

            } catch (error) {
              attempts++
              yield* Effect.sleep(delayMs)
            }
          }

          return yield* Effect.fail(new StorageError({
            module: 'persistence',
            operation: 'acquireLock',
            message: `Failed to acquire lock after ${maxAttempts} attempts`,
            cause: { lockPath, maxAttempts },
            backend: 'filesystem'
          }))
        })

      const releaseLock = (lockPath: string): Effect.Effect<void, never> =>
        Effect.gen(function* () {
          yield* Ref.update(activeLocks, (set) => {
            const newSet = new Set(set)
            newSet.delete(lockPath)
            return newSet
          })

          yield* Effect.tryPromise({
            try: () => fs.unlink(lockPath),
            catch: () => undefined // Ignore errors when removing lock files
          }).pipe(Effect.orElse(() => Effect.void))
        })

      /**
       * Store serialized state to filesystem
       */
      const store = (key: SuspensionKey, state: SerializedState): Effect.Effect<void, StorageError> =>
        Effect.gen(function* () {
          // Ensure base directory exists
          yield* ensureDirectory()

          // Create file path
          const filePath = getFilePath(key)
          const lockPath = `${filePath}.lock`

          // Acquire lock if enabled
          if (finalConfig.enableLocking) {
            yield* acquireLock(lockPath)
          }

          try {
            // Create file data structure
            const fileData: FileData = {
              metadata: {
                key,
                createdAt: new Date().toISOString(),
                expiresAt: state.expiresAt,
                size: state.data.length,
                metadata: state.metadata || {}
              },
              state
            }

            // Write atomically using temporary file
            const tempPath = `${filePath}.tmp`
            
            yield* Effect.tryPromise({
              try: () => fs.writeFile(tempPath, JSON.stringify(fileData, null, 2), 'utf8'),
              catch: (error) => new StorageError({
                module: 'persistence',
                operation: 'store',
                message: `Failed to write temporary file: ${error instanceof Error ? error.message : 'Unknown error'}`,
                cause: error,
                backend: 'filesystem'
              })
            })

            // Atomic rename
            yield* Effect.tryPromise({
              try: () => fs.rename(tempPath, filePath),
              catch: (error) => new StorageError({
                module: 'persistence',
                operation: 'store',
                message: `Failed to rename file: ${error instanceof Error ? error.message : 'Unknown error'}`,
                cause: error,
                backend: 'filesystem'
              })
            })

          } finally {
            // Release lock
            if (finalConfig.enableLocking) {
              yield* releaseLock(lockPath)
            }
          }
        })

      /**
       * Retrieve serialized state from filesystem
       */
      const retrieve = (key: SuspensionKey): Effect.Effect<Option.Option<SerializedState>, StorageError> =>
        Effect.gen(function* () {
          const filePath = getFilePath(key)

          // Check if file exists
          const exists = yield* Effect.tryPromise({
            try: () => fs.access(filePath).then(() => true).catch(() => false),
            catch: (error) => new StorageError({
              module: 'persistence',
              operation: 'retrieve',
              message: `Failed to check file existence: ${error instanceof Error ? error.message : 'Unknown error'}`,
              cause: error,
              backend: 'filesystem'
            })
          })

          if (!exists) {
            return Option.none()
          }

          // Read file content
          const content = yield* Effect.tryPromise({
            try: () => fs.readFile(filePath, 'utf8'),
            catch: (error) => new StorageError({
              module: 'persistence',
              operation: 'retrieve',
              message: `Failed to read file: ${error instanceof Error ? error.message : 'Unknown error'}`,
              cause: error,
              backend: 'filesystem'
            })
          })

          // Parse file data
          const fileData = yield* Effect.try({
            try: () => JSON.parse(content) as FileData,
            catch: (error) => new StorageError({
              module: 'persistence',
              operation: 'retrieve',
              message: `Failed to parse file data: ${error instanceof Error ? error.message : 'Unknown error'}`,
              cause: error,
              backend: 'filesystem'
            })
          })

          // Check expiration
          if (fileData.metadata.expiresAt) {
            const expiresAt = new Date(fileData.metadata.expiresAt)
            if (expiresAt < new Date()) {
              // File is expired, delete it and return none
              yield* Effect.tryPromise({
                try: () => fs.unlink(filePath),
                catch: (error) => new StorageError({
                  module: 'persistence',
                  operation: 'retrieve',
                  message: `Failed to cleanup expired file: ${error instanceof Error ? error.message : 'Unknown error'}`,
                  cause: error,
                  backend: 'filesystem'
                })
              }).pipe(Effect.orElse(() => Effect.void))
              return Option.none()
            }
          }

          return Option.some(fileData.state)
        })

      /**
       * Delete stored state
       */
      const deleteState = (key: SuspensionKey): Effect.Effect<void, StorageError> =>
        Effect.gen(function* () {
          const filePath = getFilePath(key)
          
          yield* Effect.tryPromise({
            try: () => fs.unlink(filePath),
            catch: (error) => {
              // If file doesn't exist, that's OK - don't throw error
              if ((error as any)?.code === 'ENOENT') {
                return new StorageError({
                  module: 'persistence',
                  operation: 'delete',
                  message: 'File not found (already deleted)',
                  cause: error,
                  backend: 'filesystem'
                })
              }
              return new StorageError({
                module: 'persistence',
                operation: 'delete',
                message: `Failed to delete file: ${error instanceof Error ? error.message : 'Unknown error'}`,
                cause: error,
                backend: 'filesystem'
              })
            }
          }).pipe(
            Effect.catchIf(
              (error) => error.message === 'File not found (already deleted)',
              () => Effect.void
            )
          )
        })

      /**
       * List stored entries with filtering
       */
      const list = (criteria?: ListCriteria): Effect.Effect<StorageEntry[], StorageError> =>
        Effect.gen(function* () {
          // Ensure directory exists
          yield* ensureDirectory()

          // Read directory contents
          const files = yield* Effect.tryPromise({
            try: () => fs.readdir(finalConfig.basePath),
            catch: (error) => new StorageError({
              module: 'persistence',
              operation: 'list',
              message: `Failed to read directory: ${error instanceof Error ? error.message : 'Unknown error'}`,
              cause: error,
              backend: 'filesystem'
            })
          })

          // Filter JSON files only
          const jsonFiles = files.filter(file => file.endsWith('.json') && !file.endsWith('.tmp'))

          // Apply offset and limit
          const offset = criteria?.offset || 0
          const limit = criteria?.limit || jsonFiles.length
          const filteredFiles = jsonFiles.slice(offset, offset + limit)

          // Read metadata from each file
          const entries: StorageEntry[] = []

          for (const file of filteredFiles) {
            const filePath = path.join(finalConfig.basePath, file)
            
            try {
              const content = yield* Effect.tryPromise({
                try: () => fs.readFile(filePath, 'utf8'),
                catch: (error) => new StorageError({
                  module: 'persistence',
                  operation: 'list',
                  message: `Failed to read file: ${error instanceof Error ? error.message : 'Unknown error'}`,
                  cause: error,
                  backend: 'filesystem'
                })
              }).pipe(Effect.orElse(() => Effect.succeed(null)))

              if (!content) continue

              const fileData = yield* Effect.try({
                try: () => JSON.parse(content) as FileData,
                catch: (error) => new StorageError({
                  module: 'persistence',
                  operation: 'list',
                  message: `Failed to parse JSON: ${error instanceof Error ? error.message : 'Unknown error'}`,
                  cause: error,
                  backend: 'filesystem'
                })
              }).pipe(Effect.orElse(() => Effect.succeed(null)))

              if (!fileData) continue

              // Check if file matches criteria
              if (criteria?.prefix && !fileData.metadata.key.startsWith(criteria.prefix)) {
                continue
              }

              if (criteria?.pattern) {
                const regex = new RegExp(criteria.pattern)
                if (!regex.test(fileData.metadata.key)) {
                  continue
                }
              }

              entries.push({
                key: fileData.metadata.key as SuspensionKey,
                createdAt: new Date(fileData.metadata.createdAt),
                expiresAt: fileData.metadata.expiresAt ? new Date(fileData.metadata.expiresAt) : undefined,
                size: fileData.metadata.size,
                metadata: fileData.metadata.metadata
              })

            } catch {
              // Skip files that can't be processed
              continue
            }
          }

          return entries
        })

      /**
       * Health check for filesystem backend
       */
      const health = (): Effect.Effect<BackendHealth, never> =>
        pipe(
          Effect.gen(function* () {
            const startTime = Date.now()

            // Test directory access and creation
            yield* ensureDirectory()

            // Test write/read/delete operations
            const testKey = `health_check_${Date.now()}` as SuspensionKey
            const testState: SerializedState = {
              version: '1.0.0',
              data: JSON.stringify({ test: 'health_check' }),
              metadata: {
                serializedAt: new Date().toISOString(),
                size: 20,
                checksum: 'test'
              }
            }

            yield* store(testKey, testState)
            const retrieved = yield* retrieve(testKey)
            yield* deleteState(testKey)

            const latency = Date.now() - startTime

            if (Option.isSome(retrieved)) {
              return {
                backend: 'filesystem',
                healthy: true as const,
                latency,
                metadata: {
                  basePath: finalConfig.basePath,
                  enableLocking: finalConfig.enableLocking
                }
              } satisfies BackendHealth
            } else {
              return {
                backend: 'filesystem',
                healthy: false as const,
                error: 'Health check data not retrieved correctly'
              } satisfies BackendHealth
            }
          }),
          Effect.catchAll((error) =>
            Effect.succeed({
              backend: 'filesystem',
              healthy: false as const,
              error: error instanceof Error ? error.message : 'Health check failed'
            } satisfies BackendHealth)
          )
        )

      /**
       * Cleanup expired entries
       */
      const cleanup = (criteria?: CleanupCriteria): Effect.Effect<number, StorageError> =>
        Effect.gen(function* () {
          const entries = yield* list({ limit: criteria?.limit })
          let deletedCount = 0

          for (const entry of entries) {
            let shouldDelete = false

            // Check expiration
            if (criteria?.expiredOnly) {
              shouldDelete = entry.expiresAt !== undefined && entry.expiresAt < new Date()
            }

            // Check age
            if (criteria?.olderThan) {
              shouldDelete = shouldDelete || entry.createdAt < criteria.olderThan
            }

            // Check tool ID
            if (criteria?.toolId) {
              shouldDelete = shouldDelete && entry.metadata.toolId === criteria.toolId
            }

            if (shouldDelete) {
              yield* Effect.either(deleteState(entry.key))
              deletedCount++
            }
          }

          return deletedCount
        })

      // Return the service implementation
      return {
        store,
        retrieve,
        delete: deleteState,
        list,
        health,
        cleanup
      }
    })
  )

/**
 * Create filesystem storage backend with configuration  
 */
export const createFilesystemBackend = (config?: Partial<FilesystemConfig>) => 
  FilesystemStorageBackendLive(config)
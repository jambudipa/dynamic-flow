import { Effect, Layer, Option } from 'effect'
import { CacheService } from './service'

/**
 * Test implementation of CacheService.
 * Always returns empty/none values, useful for testing without caching.
 */
export const CacheTest = Layer.succeed(
  CacheService,
  {
    get: <T>(_key: string) => Effect.succeed(Option.none<T>()),
    
    set: <T>(_key: string, _value: T, _ttl?: number) => Effect.void,
    
    has: (_key: string) => Effect.succeed(false),
    
    delete: (_key: string) => Effect.void,
    
    clear: () => Effect.void,
    
    size: () => Effect.succeed(0),
    
    invalidate: (_pattern: string) => Effect.void
  }
)

/**
 * Test implementation that stores everything in memory
 * but can be inspected for testing.
 */
export const CacheTestWithStorage = () => {
  const storage = new Map<string, unknown>()
  
  return {
    layer: Layer.succeed(
      CacheService,
      {
        get: <T>(key: string) => Effect.succeed(
          storage.has(key) 
            ? Option.some(storage.get(key) as T)
            : Option.none<T>()
        ),
        
        set: <T>(key: string, value: T, _ttl?: number) => Effect.sync(() => {
          storage.set(key, value)
        }),
        
        has: (key: string) => Effect.succeed(storage.has(key)),
        
        delete: (key: string) => Effect.sync(() => {
          storage.delete(key)
        }),
        
        clear: () => Effect.sync(() => {
          storage.clear()
        }),
        
        size: () => Effect.succeed(storage.size),
        
        invalidate: (pattern: string) => Effect.sync(() => {
          const regex = new RegExp(pattern.replace(/\*/g, '.*'))
          const keysToDelete = Array.from(storage.keys()).filter(k => regex.test(k))
          keysToDelete.forEach(k => storage.delete(k))
        })
      }
    ),
    
    // Expose storage for test inspection
    getStorage: () => storage,
    hasKey: (key: string) => storage.has(key),
    getValue: (key: string) => storage.get(key),
    getAllKeys: () => Array.from(storage.keys())
  }
}
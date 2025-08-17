/**
 * Cache Manager - Store and retrieve generated flows
 */

import { Duration, Effect, pipe } from 'effect';
import type {
  CacheEntry,
  CacheStats,
  GenerateFlowRequest,
  ValidatedFlow,
} from './types';
// Import types
import type { Tool, ToolJoin } from '@/tools/types';

/**
 * Manages caching of generated flows
 */
export class CacheManager {
  private cache: Map<string, CacheEntry>;
  private stats: CacheStats;
  private maxSize: number;
  private ttl: Duration.Duration;

  constructor(options?: { maxSize?: number; ttl?: Duration.Duration }) {
    this.cache = new Map();
    this.maxSize = options?.maxSize || 100;
    this.ttl = options?.ttl || Duration.hours(1);
    this.stats = {
      hits: 0,
      misses: 0,
      evictions: 0,
      size: 0,
    };
  }

  /**
   * Get cached flow if available
   */
  getCached(request: GenerateFlowRequest): ValidatedFlow | null {
    const key = this.generateKey(request);
    const entry = this.cache.get(key);

    if (entry) {
      const now = Date.now();
      const age = now - entry.timestamp;
      const ttlMillis = Duration.toMillis(this.ttl);

      if (age < ttlMillis) {
        // Cache hit
        this.stats.hits++;
        entry.accessCount++;
        entry.lastAccessed = now;
        return entry.flow;
      } else {
        // Expired entry
        this.cache.delete(key);
        this.stats.size--;
      }
    }

    // Cache miss
    this.stats.misses++;
    return null;
  }

  /**
   * Store flow in cache
   */
  store(request: GenerateFlowRequest, flow: ValidatedFlow): void {
    const key = this.generateKey(request);

    // Check size limit
    if (this.cache.size >= this.maxSize) {
      this.evictLRU();
    }

    // Store entry
    const entry: CacheEntry = {
      key,
      flow,
      request,
      timestamp: Date.now(),
      lastAccessed: Date.now(),
      accessCount: 0,
    };

    this.cache.set(key, entry);
    this.stats.size++;
  }

  /**
   * Clear cache
   */
  clear(): void {
    this.cache.clear();
    this.stats.size = 0;
  }

  /**
   * Get cache statistics
   */
  getStats(): CacheStats {
    return { ...this.stats };
  }

  /**
   * Prune expired entries
   */
  prune(): number {
    const now = Date.now();
    const ttlMillis = Duration.toMillis(this.ttl);
    let pruned = 0;

    for (const [key, entry] of this.cache.entries()) {
      const age = now - entry.timestamp;
      if (age >= ttlMillis) {
        this.cache.delete(key);
        this.stats.size--;
        pruned++;
      }
    }

    return pruned;
  }

  /**
   * Warm cache with predefined flows
   */
  warmCache(
    entries: Array<{
      request: GenerateFlowRequest;
      flow: ValidatedFlow;
    }>
  ): void {
    entries.forEach(({ request, flow }) => {
      this.store(request, flow);
    });
  }

  // Private methods

  private generateKey(request: GenerateFlowRequest): string {
    // Create deterministic key from request
    const parts = [
      request.prompt,
      request.tools
        .map((t) => t.id)
        .sort()
        .join(','),
      request.joins
        .map((j) => `${j.fromTool}-${j.toTool}`)
        .sort()
        .join(','),
      JSON.stringify(request.options?.constraints || {}),
    ];

    return this.hash(parts.join('|'));
  }

  private hash(str: string): string {
    // Simple hash function (would use crypto in _production)
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(36);
  }

  private evictLRU(): void {
    // Find least recently used entry
    let lruKey: string | null = null;
    let lruTime = Infinity;

    for (const [key, entry] of this.cache.entries()) {
      if (entry.lastAccessed < lruTime) {
        lruTime = entry.lastAccessed;
        lruKey = key;
      }
    }

    if (lruKey) {
      this.cache.delete(lruKey);
      this.stats.size--;
      this.stats.evictions++;
    }
  }
}

/**
 * Distributed cache using Redis/similar
 */
export class DistributedCacheManager extends CacheManager {
  private redisClient: unknown; // Would be actual Redis client

  constructor(options?: {
    redisUrl?: string;
    maxSize?: number;
    ttl?: Duration.Duration;
  }) {
    super(options);
    // Initialize Redis client
    // this.redisClient = createRedisClient(options.redisUrl)
  }

  /**
   * Get from distributed cache
   */
  getCached(request: GenerateFlowRequest): ValidatedFlow | null {
    // First check local cache
    const local = super.getCached(request);
    if (local) return local;

    // Then check distributed cache
    // const key = this.generateKey(request)
    // const distributed = await this.redisClient.get(key)
    // if (distributed) {
    //   const flow = JSON.parse(distributed)
    //   super.store(request, flow) // Store locally
    //   return flow
    // }

    return null;
  }

  /**
   * Store in both local and distributed cache
   */
  store(request: GenerateFlowRequest, flow: ValidatedFlow): void {
    super.store(request, flow);

    // Also store in distributed cache
    // const key = this.generateKey(request)
    // const ttlSeconds = Duration.toSeconds(this.ttl)
    // await this.redisClient.setex(key, ttlSeconds, JSON.stringify(flow))
  }
}

/**
 * Memory-efficient cache using WeakMap
 */
export class WeakCacheManager {
  private cache: WeakMap<object, CacheEntry>;
  private keyMap: Map<string, object>;

  constructor() {
    this.cache = new WeakMap();
    this.keyMap = new Map();
  }

  getCached(request: GenerateFlowRequest): ValidatedFlow | null {
    const key = this.generateStrongKey(request);
    const weakKey = this.keyMap.get(key);

    if (weakKey) {
      const entry = this.cache.get(weakKey);
      if (entry) {
        return entry.flow;
      }
    }

    return null;
  }

  store(request: GenerateFlowRequest, flow: ValidatedFlow): void {
    const key = this.generateStrongKey(request);
    const weakKey = {};

    this.keyMap.set(key, weakKey);
    this.cache.set(weakKey, {
      key,
      flow,
      request,
      timestamp: Date.now(),
      lastAccessed: Date.now(),
      accessCount: 0,
    });
  }

  private generateStrongKey(request: GenerateFlowRequest): string {
    return `${request.prompt}-${request.tools.length}-${request.joins.length}`;
  }
}

/**
 * Cache warming strategies
 */
export class CacheWarmer {
  /**
   * Warm cache with common patterns
   */
  static warmCommonPatterns(
    cache: CacheManager,
    tools: Tool[],
    joins: ToolJoin<unknown, unknown>[]
  ): void {
    const commonPatterns = [
      {
        name: 'Simple Linear',
        prompt: 'Process data through a series of transformations',
        toolCount: 3,
      },
      {
        name: 'Map Reduce',
        prompt: 'Process collection items and aggregate results',
        toolCount: 2,
      },
      {
        name: 'Conditional Branch',
        prompt: 'Check condition and execute different paths',
        toolCount: 4,
      },
      {
        name: 'Parallel Processing',
        prompt: 'Process data in parallel branches',
        toolCount: 5,
      },
    ];

    // Generate and cache flows for common patterns
    // This would be implemented with actual generation logic
  }

  /**
   * Precompute flows for known queries
   */
  static precompute(
    cache: CacheManager,
    queries: string[],
    tools: Tool[],
    joins: ToolJoin<unknown, unknown>[]
  ): Effect.Effect<void, never> {
    return pipe(
      Effect.forEach(
        queries,
        (query) => {
          // Generate flow for query
          // Store in cache
          return Effect.void;
        },
        { concurrency: 3 }
      ),
      Effect.asVoid
    );
  }
}

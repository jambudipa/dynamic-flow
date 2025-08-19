import { Effect, Layer, Option, Duration, Ref, HashMap } from 'effect';
import { CacheService } from './service';

interface CacheEntry<T> {
  readonly value: T;
  readonly timestamp: number;
  readonly ttl?: number;
  readonly accessCount: number;
  readonly lastAccessed: number;
}

interface CacheState {
  readonly entries: HashMap.HashMap<string, CacheEntry<unknown>>;
  readonly stats: {
    hits: number;
    misses: number;
    evictions: number;
    size: number;
  };
}

/**
 * In-memory cache implementation with LRU eviction
 */
export const InMemoryCacheLive = (options?: {
  maxSize?: number;
  defaultTtl?: Duration.Duration;
}) => {
  const maxSize = options?.maxSize || 1000;
  const defaultTtl = options?.defaultTtl
    ? Duration.toMillis(options.defaultTtl)
    : 3600000; // 1 hour

  return Layer.effect(
    CacheService,
    Effect.gen(function* () {
      const stateRef = yield* Ref.make<CacheState>({
        entries: HashMap.empty(),
        stats: { hits: 0, misses: 0, evictions: 0, size: 0 },
      });

      const evictLRU = Effect.gen(function* () {
        const state = yield* Ref.get(stateRef);

        if (state.stats.size <= 0) return;

        // Find LRU entry
        let lruKey: string | null = null;
        let lruTime = Date.now();

        for (const [key, entry] of state.entries) {
          if (entry.lastAccessed < lruTime) {
            lruTime = entry.lastAccessed;
            lruKey = key;
          }
        }

        if (lruKey !== null) {
          yield* Ref.update(stateRef, (s) => ({
            entries: HashMap.remove(s.entries, lruKey),
            stats: {
              ...s.stats,
              evictions: s.stats.evictions + 1,
              size: s.stats.size - 1,
            },
          }));
        }
      });

      const isExpired = (entry: CacheEntry<unknown>): boolean => {
        const now = Date.now();
        const age = now - entry.timestamp;
        const ttl = entry.ttl || defaultTtl;
        return age > ttl;
      };

      return {
        get: <T>(key: string) =>
          Effect.gen(function* () {
            const state = yield* Ref.get(stateRef);
            const entry = HashMap.get(state.entries, key);

            if (Option.isNone(entry)) {
              yield* Ref.update(stateRef, (s) => ({
                ...s,
                stats: { ...s.stats, misses: s.stats.misses + 1 },
              }));
              return Option.none<T>();
            }

            const cacheEntry = entry.value as CacheEntry<T>;

            if (isExpired(cacheEntry)) {
              // Remove expired entry
              yield* Ref.update(stateRef, (s) => ({
                entries: HashMap.remove(s.entries, key),
                stats: {
                  ...s.stats,
                  misses: s.stats.misses + 1,
                  size: s.stats.size - 1,
                },
              }));
              return Option.none<T>();
            }

            // Update access info
            const updatedEntry: CacheEntry<T> = {
              ...cacheEntry,
              lastAccessed: Date.now(),
              accessCount: cacheEntry.accessCount + 1,
            };

            yield* Ref.update(stateRef, (s) => ({
              entries: HashMap.set(
                s.entries,
                key,
                updatedEntry as CacheEntry<unknown>
              ),
              stats: { ...s.stats, hits: s.stats.hits + 1 },
            }));

            return Option.some(cacheEntry.value);
          }),

        set: <T>(key: string, value: T, ttl?: number) =>
          Effect.gen(function* () {
            const state = yield* Ref.get(stateRef);

            // Check if we need to evict
            if (
              state.stats.size >= maxSize &&
              !HashMap.has(state.entries, key)
            ) {
              yield* evictLRU;
            }

            const now = Date.now();
            const entry: CacheEntry<T> = {
              value,
              timestamp: now,
              ttl: ttl !== undefined ? ttl : undefined, // TTL is already in ms
              accessCount: 0,
              lastAccessed: now,
            };

            const isNew = !HashMap.has(state.entries, key);

            yield* Ref.update(stateRef, (s) => ({
              entries: HashMap.set(
                s.entries,
                key,
                entry as CacheEntry<unknown>
              ),
              stats: {
                ...s.stats,
                size: isNew ? s.stats.size + 1 : s.stats.size,
              },
            }));
          }),

        has: (key: string) =>
          Effect.gen(function* () {
            const state = yield* Ref.get(stateRef);
            const entry = HashMap.get(state.entries, key);

            if (Option.isNone(entry)) return false;

            const cacheEntry = entry.value;
            if (isExpired(cacheEntry)) {
              // Remove expired entry
              yield* Ref.update(stateRef, (s) => ({
                entries: HashMap.remove(s.entries, key),
                stats: { ...s.stats, size: s.stats.size - 1 },
              }));
              return false;
            }

            return true;
          }),

        delete: (key: string) =>
          Effect.gen(function* () {
            yield* Ref.update(stateRef, (s) => ({
              entries: HashMap.remove(s.entries, key),
              stats: {
                ...s.stats,
                size: HashMap.has(s.entries, key)
                  ? s.stats.size - 1
                  : s.stats.size,
              },
            }));
          }),

        clear: () =>
          Effect.gen(function* () {
            yield* Ref.set(stateRef, {
              entries: HashMap.empty(),
              stats: { hits: 0, misses: 0, evictions: 0, size: 0 },
            });
          }),

        size: () =>
          Effect.gen(function* () {
            const state = yield* Ref.get(stateRef);
            return state.stats.size;
          }),

        invalidate: (pattern: string) =>
          Effect.gen(function* () {
            const regex = new RegExp(pattern.replace(/\*/g, '.*'));
            const state = yield* Ref.get(stateRef);

            let newEntries = state.entries;
            let removed = 0;

            for (const [key] of state.entries) {
              if (regex.test(key)) {
                newEntries = HashMap.remove(newEntries, key);
                removed++;
              }
            }

            yield* Ref.update(stateRef, (s) => ({
              entries: newEntries,
              stats: { ...s.stats, size: s.stats.size - removed },
            }));
          }),
      };
    })
  );
};

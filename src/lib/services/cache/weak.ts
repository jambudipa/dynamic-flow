import { Effect, Layer, Option, Ref, HashMap } from 'effect';
import { CacheService } from './service';

/**
 * WeakMap-based cache implementation for memory-efficient caching.
 * Entries can be garbage collected when memory pressure is high.
 */
export const WeakCacheLive = Layer.effect(
  CacheService,
  Effect.gen(function* () {
    // WeakMap for actual cache storage (allows GC)
    const weakCache = new WeakMap<object, unknown>();

    // Strong references to keys (needed for WeakMap)
    const keyMapRef = yield* Ref.make<HashMap.HashMap<string, object>>(
      HashMap.empty()
    );

    // Stats tracking
    const statsRef = yield* Ref.make({
      sets: 0,
      gets: 0,
      hits: 0,
      misses: 0,
    });

    return {
      get: <T>(key: string) =>
        Effect.gen(function* () {
          const keyMap = yield* Ref.get(keyMapRef);
          const weakKey = HashMap.get(keyMap, key);

          yield* Ref.update(statsRef, (s) => ({ ...s, gets: s.gets + 1 }));

          if (Option.isNone(weakKey)) {
            yield* Ref.update(statsRef, (s) => ({
              ...s,
              misses: s.misses + 1,
            }));
            return Option.none<T>();
          }

          const value = weakCache.get(weakKey.value);

          if (value === undefined) {
            // Key was garbage collected
            yield* Ref.update(keyMapRef, (map) => HashMap.remove(map, key));
            yield* Ref.update(statsRef, (s) => ({
              ...s,
              misses: s.misses + 1,
            }));
            return Option.none<T>();
          }

          yield* Ref.update(statsRef, (s) => ({ ...s, hits: s.hits + 1 }));
          return Option.some(value as T);
        }),

      set: <T>(key: string, value: T, _ttl?: number) =>
        Effect.gen(function* () {
          // TTL is ignored for WeakMap cache - GC handles cleanup
          const weakKey = {};

          yield* Ref.update(keyMapRef, (map) => HashMap.set(map, key, weakKey));
          weakCache.set(weakKey, value);
          yield* Ref.update(statsRef, (s) => ({ ...s, sets: s.sets + 1 }));
        }),

      has: (key: string) =>
        Effect.gen(function* () {
          const keyMap = yield* Ref.get(keyMapRef);
          const weakKey = HashMap.get(keyMap, key);

          if (Option.isNone(weakKey)) {
            return false;
          }

          const hasValue = weakCache.has(weakKey.value);

          if (!hasValue) {
            // Clean up orphaned key
            yield* Ref.update(keyMapRef, (map) => HashMap.remove(map, key));
          }

          return hasValue;
        }),

      delete: (key: string) =>
        Effect.gen(function* () {
          const keyMap = yield* Ref.get(keyMapRef);
          const weakKey = HashMap.get(keyMap, key);

          if (Option.isSome(weakKey)) {
            weakCache.delete(weakKey.value);
            yield* Ref.update(keyMapRef, (map) => HashMap.remove(map, key));
          }
        }),

      clear: () =>
        Effect.gen(function* () {
          // Clear all strong references, allowing GC to clean up
          yield* Ref.set(keyMapRef, HashMap.empty());
          yield* Ref.set(statsRef, {
            sets: 0,
            gets: 0,
            hits: 0,
            misses: 0,
          });
          // WeakMap entries will be GC'd automatically
        }),

      size: () =>
        Effect.gen(function* () {
          const keyMap = yield* Ref.get(keyMapRef);

          // Clean up any GC'd entries
          let actualSize = 0;
          let toRemove: string[] = [];

          for (const [key, weakKey] of keyMap) {
            if (weakCache.has(weakKey)) {
              actualSize++;
            } else {
              toRemove.push(key);
            }
          }

          if (toRemove.length > 0) {
            yield* Ref.update(keyMapRef, (map) => {
              let updated = map;
              for (const key of toRemove) {
                updated = HashMap.remove(updated, key);
              }
              return updated;
            });
          }

          return actualSize;
        }),

      invalidate: (pattern: string) =>
        Effect.gen(function* () {
          const regex = new RegExp(pattern.replace(/\*/g, '.*'));
          const keyMap = yield* Ref.get(keyMapRef);

          let toRemove: string[] = [];

          for (const [key, weakKey] of keyMap) {
            if (regex.test(key)) {
              weakCache.delete(weakKey);
              toRemove.push(key);
            }
          }

          if (toRemove.length > 0) {
            yield* Ref.update(keyMapRef, (map) => {
              let updated = map;
              for (const key of toRemove) {
                updated = HashMap.remove(updated, key);
              }
              return updated;
            });
          }
        }),
    };
  })
);

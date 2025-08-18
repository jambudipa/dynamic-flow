/**
 * StateService - Centralized variable storage and retrieval
 * 
 * Purpose: Manages variables during flow execution with scoping, metadata,
 * computed values, and snapshot/restore capabilities.
 */

import { Effect, Context, Layer, Ref, HashMap, Option, pipe } from 'effect';
import { StateError, VariableNotFoundError } from '../errors';
import { type JsonValue, parseJsonSafe } from '../types/json';

// ============= Types =============

/**
 * Per-variable metadata tracked by the manager.
 */
export interface VariableMetadata {
  createdAt: number;
  updatedAt: number;
  accessCount: number;
  scope: number;
}

/**
 * Serializable snapshot containing variables, scopes, metadata, and computed functions.
 */
export interface StateSnapshot {
  variables: Record<string, unknown>;
  scopes: Array<Record<string, unknown>>;
  metadata: Record<string, VariableMetadata>;
  computed: Record<string, () => unknown>;
}

// ============= StateService Interface =============

export interface StateService {
  /**
   * Set a variable's value in the current scope (or global if no scopes).
   */
  readonly set: (name: string, value: unknown) => Effect.Effect<void>;

  /**
   * Get a variable's value, searching from the top-most scope down to global.
   */
  readonly get: (name: string) => Effect.Effect<unknown, VariableNotFoundError>;

  /**
   * Check if a variable exists in any scope or global.
   */
  readonly has: (name: string) => Effect.Effect<boolean>;

  /**
   * Delete a variable (removes metadata and the most-local binding).
   */
  readonly delete: (name: string) => Effect.Effect<void>;

  /**
   * Clear all state (variables, scopes, metadata, computed registry).
   */
  readonly clear: () => Effect.Effect<void>;

  /**
   * Get a nested value path under a variable.
   */
  readonly getPath: (name: string, path: string[]) => Effect.Effect<unknown, StateError>;

  /**
   * Set a nested value path under a variable, creating objects as needed.
   */
  readonly setPath: (name: string, path: string[], value: unknown) => Effect.Effect<void>;

  /**
   * Push a new (empty) scope onto the scope stack.
   */
  readonly pushScope: () => Effect.Effect<void>;

  /**
   * Pop the most recent scope.
   */
  readonly popScope: () => Effect.Effect<void, StateError>;

  /**
   * Get current scope depth (0 when no scopes are present).
   */
  readonly getScopeDepth: () => Effect.Effect<number>;

  /**
   * Create a full, serializable snapshot for persistence or debugging.
   */
  readonly snapshot: () => Effect.Effect<StateSnapshot>;

  /**
   * Restore a previously captured snapshot.
   */
  readonly restore: (snapshot: StateSnapshot) => Effect.Effect<void>;

  /**
   * Get a flattened view of all variables (scope variables override globals).
   */
  readonly getAll: () => Effect.Effect<Record<string, unknown>>;

  /**
   * Set multiple variables atomically in the current scope/global.
   */
  readonly setMany: (variables: Record<string, unknown>) => Effect.Effect<void>;

  /**
   * Merge variables using setMany semantics.
   */
  readonly merge: (variables: Record<string, unknown>) => Effect.Effect<void>;

  /**
   * Read variable metadata (if any).
   */
  readonly getMetadata: (name: string) => Effect.Effect<VariableMetadata | undefined>;

  /**
   * Register a computed value: resolved lazily when fetched via get().
   */
  readonly registerComputed: (name: string, compute: () => unknown) => Effect.Effect<void>;

  /**
   * Serialize state to JSON string.
   */
  readonly toJSON: () => Effect.Effect<string>;

  /**
   * Deserialize state from JSON string produced by toJSON().
   */
  readonly fromJSON: (json: string) => Effect.Effect<void, StateError>;
}

// ============= Context Tag =============

export const StateService = Context.GenericTag<StateService>('@services/State');

// ============= Helper Functions =============

/**
 * Convert a HashMap to a plain object for snapshots.
 */
const hashMapToObject = <V>(map: HashMap.HashMap<string, V>): Record<string, V> => {
  const obj: Record<string, V> = {};
  for (const [key, value] of HashMap.entries(map)) {
    obj[key] = value;
  }
  return obj;
};

/**
 * Convert a plain object to a HashMap for state hydration.
 */
const objectToHashMap = <V>(obj: Record<string, V>): HashMap.HashMap<string, V> => {
  let map = HashMap.empty<string, V>();
  for (const [key, value] of Object.entries(obj)) {
    map = HashMap.set(map, key, value);
  }
  return map;
};

// ============= Service Implementation =============

const makeStateService = (): Effect.Effect<StateService> =>
  Effect.gen(function* () {
    const variablesRef = yield* Ref.make(HashMap.empty<string, unknown>());
    const scopesRef = yield* Ref.make<Array<HashMap.HashMap<string, unknown>>>([]);
    const metadataRef = yield* Ref.make(HashMap.empty<string, VariableMetadata>());
    const computedRef = yield* Ref.make(HashMap.empty<string, () => unknown>());

    const updateMetadata = (name: string, isNew: boolean) =>
      Effect.gen(function* () {
        const metadata = yield* Ref.get(metadataRef);
        const scopes = yield* Ref.get(scopesRef);
        const now = Date.now();
        const existing = HashMap.get(metadata, name);

        const meta: VariableMetadata = Option.match(existing, {
          onNone: () => ({
            createdAt: now,
            updatedAt: now,
            accessCount: 0,
            scope: scopes.length,
          }),
          onSome: (m) => ({
            ...m,
            updatedAt: now,
          }),
        });

        yield* Ref.update(metadataRef, (current) => HashMap.set(current, name, meta));
      });

    const incrementAccessCount = (name: string) =>
      Effect.gen(function* () {
        const metadata = yield* Ref.get(metadataRef);
        const meta = HashMap.get(metadata, name);
        
        if (Option.isSome(meta)) {
          yield* Ref.update(metadataRef, (current) =>
            HashMap.set(current, name, {
              ...meta.value,
              accessCount: meta.value.accessCount + 1,
            })
          );
        }
      });

    const service: StateService = {
      set: (name: string, value: unknown) =>
        Effect.gen(function* () {
          yield* updateMetadata(name, false);

          const scopes = yield* Ref.get(scopesRef);
          
          if (scopes.length > 0) {
            // Set in current scope
            yield* Ref.update(scopesRef, (currentScopes) => {
              const newScopes = [...currentScopes];
              const currentScope = newScopes[newScopes.length - 1] || HashMap.empty();
              const updatedScope = HashMap.set(currentScope, name, value);
              newScopes[newScopes.length - 1] = updatedScope;
              return newScopes;
            });
          } else {
            // Set in global variables
            yield* Ref.update(variablesRef, (current) => HashMap.set(current, name, value));
          }
        }),

      get: (name: string) =>
        Effect.gen(function* () {
          // Check if it's a computed value
          const computed = yield* Ref.get(computedRef);
          const computedValue = HashMap.get(computed, name);
          
          if (Option.isSome(computedValue)) {
            return computedValue.value();
          }

          // Look in scopes from top to bottom
          const scopes = yield* Ref.get(scopesRef);
          let found: Option.Option<unknown> = Option.none();

          // Check current scopes (from most recent to oldest)
          for (let i = scopes.length - 1; i >= 0; i--) {
            found = HashMap.get(scopes[i] || HashMap.empty(), name);
            if (Option.isSome(found)) {
              break;
            }
          }

          // Check global variables if not found in scopes
          if (Option.isNone(found)) {
            const variables = yield* Ref.get(variablesRef);
            found = HashMap.get(variables, name);
          }

          if (Option.isNone(found)) {
            return yield* Effect.fail(new VariableNotFoundError({ name }));
          }

          // Update access count
          yield* incrementAccessCount(name);

          return found.value;
        }),

      has: (name: string) =>
        Effect.gen(function* () {
          // Check computed
          const computed = yield* Ref.get(computedRef);
          if (Option.isSome(HashMap.get(computed, name))) {
            return true;
          }

          // Check scopes
          const scopes = yield* Ref.get(scopesRef);
          for (const scope of scopes) {
            if (HashMap.has(scope, name)) {
              return true;
            }
          }

          // Check global
          const variables = yield* Ref.get(variablesRef);
          return HashMap.has(variables, name);
        }),

      delete: (name: string) =>
        Effect.gen(function* () {
          // Remove from metadata
          yield* Ref.update(metadataRef, (current) => HashMap.remove(current, name));

          const scopes = yield* Ref.get(scopesRef);
          
          if (scopes.length > 0) {
            // Remove from current scope
            yield* Ref.update(scopesRef, (currentScopes) => {
              const newScopes = [...currentScopes];
              const currentScope = newScopes[newScopes.length - 1] || HashMap.empty();
              const updatedScope = HashMap.remove(currentScope, name);
              newScopes[newScopes.length - 1] = updatedScope;
              return newScopes;
            });
          } else {
            // Remove from global variables
            yield* Ref.update(variablesRef, (current) => HashMap.remove(current, name));
          }
        }),

      clear: () =>
        Effect.gen(function* () {
          yield* Ref.set(variablesRef, HashMap.empty());
          yield* Ref.set(metadataRef, HashMap.empty());
          // Don't clear scopes or computed
        }),

      getPath: (name: string, path: string[]) =>
        Effect.gen(function* () {
          let value = yield* pipe(
            service.get(name),
            Effect.mapError(
              () =>
                new StateError({
                  message: `Variable ${name} not found`,
                  operation: 'getPath',
                  variable: name,
                })
            )
          );

          for (const key of path) {
            if (value === null || value === undefined) {
              return yield* Effect.fail(
                new StateError({
                  message: `Path ${path.join('.')} not found`,
                  operation: 'getPath',
                  variable: name,
                })
              );
            }

            if (Array.isArray(value)) {
              const index = parseInt(key);
              if (isNaN(index) || index < 0 || index >= value.length) {
                return yield* Effect.fail(
                  new StateError({
                    message: `Invalid array index: ${key}`,
                    operation: 'getPath',
                    variable: name,
                  })
                );
              }
              value = value[index];
            } else if (typeof value === 'object') {
              value = (value as Record<string, unknown>)[key];
              if (value === undefined) {
                return yield* Effect.fail(
                  new StateError({
                    message: `Path ${path.join('.')} not found`,
                    operation: 'getPath',
                    variable: name,
                  })
                );
              }
            } else {
              return yield* Effect.fail(
                new StateError({
                  message: `Cannot access path on non-object value`,
                  operation: 'getPath',
                  variable: name,
                })
              );
            }
          }

          return value;
        }),

      setPath: (name: string, path: string[], value: unknown) =>
        Effect.gen(function* () {
          const current = yield* pipe(
            service.get(name),
            Effect.orElse(() => Effect.succeed({}))
          );

          if (path.length === 0) {
            yield* service.set(name, value);
            return;
          }

          // Deep clone the object to avoid mutations
          const root = JSON.parse(JSON.stringify(current || {})) as Record<
            string,
            unknown
          >;
          let target: Record<string, unknown> = root;

          for (let i = 0; i < path.length - 1; i++) {
            const key = path[i]!;
            if (!(key in target) || typeof target[key] !== 'object') {
              target[key] = {};
            }
            target = target[key] as Record<string, unknown>;
          }

          target[path[path.length - 1]!] = value;
          yield* service.set(name, root);
        }),

      pushScope: () =>
        Effect.gen(function* () {
          yield* Ref.update(scopesRef, (current) => [...current, HashMap.empty()]);
        }),

      popScope: () =>
        Effect.gen(function* () {
          const scopes = yield* Ref.get(scopesRef);
          
          if (scopes.length === 0) {
            return yield* Effect.fail(
              new StateError({
                message: 'No scope to pop',
                operation: 'popScope',
              })
            );
          }

          // Remove variables from this scope from metadata
          const scope = scopes[scopes.length - 1] || HashMap.empty();
          const scopeVars = HashMap.keys(scope);

          for (const varName of scopeVars) {
            yield* Ref.update(metadataRef, (current) => HashMap.remove(current, varName));
          }

          yield* Ref.update(scopesRef, (current) => current.slice(0, -1));
        }),

      getScopeDepth: () =>
        Effect.gen(function* () {
          const scopes = yield* Ref.get(scopesRef);
          return scopes.length;
        }),

      snapshot: () =>
        Effect.gen(function* () {
          const variables = yield* Ref.get(variablesRef);
          const scopes = yield* Ref.get(scopesRef);
          const metadata = yield* Ref.get(metadataRef);
          const computed = yield* Ref.get(computedRef);

          return {
            variables: hashMapToObject(variables),
            scopes: scopes.map((scope) => hashMapToObject(scope)),
            metadata: hashMapToObject(metadata),
            computed: hashMapToObject(computed) as Record<string, () => unknown>,
          };
        }),

      restore: (snapshot: StateSnapshot) =>
        Effect.gen(function* () {
          yield* Ref.set(variablesRef, objectToHashMap(snapshot.variables));
          yield* Ref.set(scopesRef, snapshot.scopes.map((scope) => objectToHashMap(scope)));
          yield* Ref.set(metadataRef, objectToHashMap(snapshot.metadata));
          yield* Ref.set(computedRef, objectToHashMap(snapshot.computed) as HashMap.HashMap<string, () => unknown>);
        }),

      getAll: () =>
        Effect.gen(function* () {
          const result: Record<string, unknown> = {};

          // Add global variables
          const variables = yield* Ref.get(variablesRef);
          for (const [key, value] of HashMap.entries(variables)) {
            result[key] = value;
          }

          // Add scope variables (overriding globals)
          const scopes = yield* Ref.get(scopesRef);
          for (const scope of scopes) {
            for (const [key, value] of HashMap.entries(scope)) {
              result[key] = value;
            }
          }

          return result;
        }),

      setMany: (variables: Record<string, unknown>) =>
        Effect.gen(function* () {
          for (const [key, value] of Object.entries(variables)) {
            yield* service.set(key, value);
          }
        }),

      merge: (variables: Record<string, unknown>) =>
        Effect.gen(function* () {
          yield* service.setMany(variables);
        }),

      getMetadata: (name: string) =>
        Effect.gen(function* () {
          const metadata = yield* Ref.get(metadataRef);
          const meta = HashMap.get(metadata, name);
          return Option.isSome(meta) ? meta.value : undefined;
        }),

      registerComputed: (name: string, compute: () => unknown) =>
        Effect.gen(function* () {
          yield* Ref.update(computedRef, (current) => HashMap.set(current, name, compute));
        }),

      toJSON: () =>
        Effect.gen(function* () {
          const all = yield* service.getAll();
          return JSON.stringify({ variables: all });
        }),

      fromJSON: (json: string) =>
        Effect.gen(function* () {
          const parseResult = yield* pipe(
            parseJsonSafe(json),
            Effect.mapError(
              (error) =>
                new StateError({
                  message: error.message,
                  operation: 'fromJSON',
                })
            )
          );

          if (
            typeof parseResult === 'object' &&
            parseResult !== null &&
            !Array.isArray(parseResult)
          ) {
            const data = parseResult as Record<string, JsonValue>;
            if (
              data.variables &&
              typeof data.variables === 'object' &&
              !Array.isArray(data.variables)
            ) {
              yield* service.setMany(data.variables as Record<string, unknown>);
            }
          } else {
            return yield* Effect.fail(
              new StateError({
                message: 'JSON must contain an object with variables property',
                operation: 'fromJSON',
              })
            );
          }
        }),
    };
    
    return service;
  });

// ============= Layer Implementation =============

/**
 * Live implementation of StateService
 */
export const StateServiceLive = Layer.effect(StateService, makeStateService());

/**
 * Test implementation with initial state
 */
export const StateServiceTest = (initialState?: Record<string, unknown>) =>
  Layer.effect(
    StateService,
    Effect.gen(function* () {
      const service = yield* makeStateService();
      if (initialState) {
        yield* service.setMany(initialState);
      }
      return service;
    })
  );

// ============= Helper Functions =============

/**
 * Create state service with initial state
 */
export const createStateServiceWithInitial = (
  initial: Record<string, unknown>
) =>
  Effect.gen(function* () {
    const service = yield* StateService;
    yield* service.setMany(initial);
    return service;
  });

/**
 * Get all variables as a snapshot
 */
export const getAllVariables = () =>
  Effect.gen(function* () {
    const service = yield* StateService;
    return yield* service.getAll();
  });

/**
 * Set variable with path notation (e.g., "user.profile.name")
 */
export const setVariableByPath = (pathString: string, value: unknown) =>
  Effect.gen(function* () {
    const service = yield* StateService;
    const parts = pathString.split('.');
    const name = parts[0];
    const path = parts.slice(1);
    
    if (!name) {
      yield* Effect.fail(new VariableNotFoundError({ name: pathString }));
    }
    
    if (path.length === 0) {
      yield* service.set(name!, value);
    } else {
      yield* service.setPath(name!, path, value);
    }
  });

/**
 * Get variable with path notation (e.g., "user.profile.name")
 */
export const getVariableByPath = (pathString: string) =>
  Effect.gen(function* () {
    const service = yield* StateService;
    const parts = pathString.split('.');
    const name = parts[0];
    const path = parts.slice(1);
    
    if (!name) {
      return yield* Effect.fail(new VariableNotFoundError({ name: pathString }));
    }
    
    if (path.length === 0) {
      return yield* service.get(name!);
    } else {
      return yield* service.getPath(name!, path);
    }
  });
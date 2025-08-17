/**
 * State Manager Implementation
 *
 * Purpose: Centralizes storage and retrieval of variables during flow
 * execution. Supports scoping (push/pop), metadata (timestamps, access count),
 * computed values, and snapshot/restore for resilience and testing.
 *
 * How it fits in:
 * - The execution engine reads/writes variables via this interface.
 * - Control-flow handlers (loops, map/filter/reduce) use scopes to localize
 *   intermediate values.
 * - Tools can depend on variables populated by previous steps.
 */

import { Data, Effect, HashMap, Option } from 'effect';
import { type JsonValue, parseJsonSafe } from '@/types/json';

// ============= Types =============

/**
 * Per-variable metadata tracked by the manager.
 * @property createdAt Epoch ms when first created.
 * @property updatedAt Epoch ms when last updated.
 * @property accessCount How many times `get()` succeeded for this variable.
 * @property scope Scope depth where the variable was created.
 */
export interface VariableMetadata {
  createdAt: number;
  updatedAt: number;
  accessCount: number;
  scope: number;
}

/**
 * Serializable snapshot containing variables, scopes, metadata, and registered
 * computed value functions.
 */
export interface StateSnapshot {
  variables: Record<string, unknown>;
  scopes: Array<Record<string, unknown>>;
  metadata: Record<string, VariableMetadata>;
  computed: Record<string, () => unknown>;
}

/**
 * Typed error thrown for state operations.
 */
export class StateError extends Data.TaggedError('StateError')<{
  readonly message: string;
  readonly operation?: string;
  readonly variable?: string;
}> {
  get displayMessage(): string {
    const operation = this.operation ? ` during ${this.operation}` : '';
    const variable = this.variable ? ` for variable '${this.variable}'` : '';
    return `State error${operation}${variable}: ${this.message}`;
  }
}

export class VariableNotFoundError extends Data.TaggedError(
  'VariableNotFoundError'
)<{
  readonly name: string;
  readonly scope?: number;
}> {
  get displayMessage(): string {
    const scope = this.scope !== undefined ? ` in scope ${this.scope}` : '';
    return `Variable '${this.name}' not found${scope}`;
  }
}

// ============= State Manager Interface =============

export interface StateManager {
  /**
   * Set a variable’s value in the current scope (or global if no scopes).
   * @param name Variable name.
   * @param value Value to store (any serializable data).
   */
  set(name: string, value: unknown): Effect.Effect<void>;

  /**
   * Get a variable’s value, searching from the top-most scope down to global.
   * @param name Variable name.
   * @throws VariableNotFoundError if absent in all scopes and globals.
   */
  get(name: string): Effect.Effect<unknown, VariableNotFoundError>;

  /**
   * Check if a variable exists in any scope or global.
   * @param name Variable name.
   */
  has(name: string): Effect.Effect<boolean>;

  /**
   * Delete a variable (removes metadata and the most-local binding).
   * @param name Variable name.
   */
  delete(name: string): Effect.Effect<void>;

  /**
   * Clear all state (variables, scopes, metadata, computed registry).
   */
  clear(): Effect.Effect<void>;

  /**
   * Get a nested value `path` under a variable.
   * @param name Root variable name.
   * @param path Array of object keys or array indices to traverse.
   * @remarks Throws `StateError` for missing segments or type mismatches.
   */
  getPath(name: string, path: string[]): Effect.Effect<unknown, StateError>;

  /**
   * Set a nested value `path` under a variable, creating objects as needed.
   * @param name Root variable name.
   * @param path Path segments.
   * @param value Value to assign at the path.
   */
  setPath(name: string, path: string[], value: unknown): Effect.Effect<void>;

  /**
   * Push a new (empty) scope onto the scope stack.
   */
  pushScope(): Effect.Effect<void>;

  /**
   * Pop the most recent scope.
   * @throws StateError if there is no scope to pop.
   */
  popScope(): Effect.Effect<void, StateError>;

  /**
   * Get current scope depth (0 when no scopes are present).
   */
  getScopeDepth(): Effect.Effect<number>;

  /**
   * Create a full, serializable snapshot for persistence or debugging.
   */
  snapshot(): Effect.Effect<StateSnapshot>;

  /**
   * Restore a previously captured snapshot.
   * @param snapshot Snapshot object created by `snapshot()`.
   */
  restore(snapshot: StateSnapshot): Effect.Effect<void>;

  /**
   * Get a flattened view of all variables (scope variables override globals).
   */
  getAll(): Effect.Effect<Record<string, unknown>>;

  /**
   * Set multiple variables atomically in the current scope/global.
   * @param variables Record of names to values.
   */
  setMany(variables: Record<string, unknown>): Effect.Effect<void>;

  /**
   * Merge variables using `setMany` semantics.
   */
  merge(variables: Record<string, unknown>): Effect.Effect<void>;

  /**
   * Read variable metadata (if any).
   * @param name Variable name.
   */
  getMetadata(name: string): Effect.Effect<VariableMetadata | undefined>;

  /**
   * Register a computed value: resolved lazily when fetched via `get()`.
   * @param name Virtual variable name.
   * @param compute Function producing the value on demand.
   */
  registerComputed(name: string, compute: () => unknown): Effect.Effect<void>;

  /**
   * Serialize state to JSON string. (Currently variables only.)
   */
  toJSON(): Effect.Effect<string>;

  /**
   * Deserialize state from JSON string produced by `toJSON()`.
   * @param json Raw JSON string.
   */
  fromJSON(json: string): Effect.Effect<void, StateError>;
}

// ============= State Manager Implementation =============

class StateManagerImpl implements StateManager {
  private variables: HashMap.HashMap<string, unknown> = HashMap.empty();
  private scopes: Array<HashMap.HashMap<string, unknown>> = [];
  private metadata: HashMap.HashMap<string, VariableMetadata> = HashMap.empty();
  private computed: HashMap.HashMap<string, () => unknown> = HashMap.empty();

  set(name: string, value: unknown): Effect.Effect<void> {
    return Effect.sync(() => {
      const now = Date.now();
      const existing = HashMap.get(this.metadata, name);

      // Update metadata
      const meta: VariableMetadata = Option.match(existing, {
        onNone: () => ({
          createdAt: now,
          updatedAt: now,
          accessCount: 0,
          scope: this.scopes.length,
        }),
        onSome: (m) => ({
          ...m,
          updatedAt: now,
        }),
      });

      this.metadata = HashMap.set(this.metadata, name, meta);

      // Set in current scope or global
      if (this.scopes.length > 0) {
        const currentScope =
          this.scopes[this.scopes.length - 1] || HashMap.empty();
        const updatedScope = HashMap.set(currentScope, name, value);
        this.scopes[this.scopes.length - 1] = updatedScope;
      } else {
        this.variables = HashMap.set(this.variables, name, value);
      }
    });
  }

  get(name: string): Effect.Effect<unknown, VariableNotFoundError> {
    const self = this;
    return Effect.gen(function* () {
      // Check if it's a computed value
      const computed = HashMap.get(self.computed, name);
      if (Option.isSome(computed)) {
        return computed.value();
      }

      // Look in scopes from top to bottom
      let found: Option.Option<unknown> = Option.none();

      // Check current scopes (from most recent to oldest)
      for (let i = self.scopes.length - 1; i >= 0; i--) {
        found = HashMap.get(self.scopes[i] || HashMap.empty(), name);
        if (Option.isSome(found)) {
          break;
        }
      }

      // Check global variables if not found in scopes
      if (Option.isNone(found)) {
        found = HashMap.get(self.variables, name);
      }

      if (Option.isNone(found)) {
        return yield* Effect.fail(new VariableNotFoundError({ name }));
      }

      // Update access count
      const meta = HashMap.get(self.metadata, name);
      if (Option.isSome(meta)) {
        self.metadata = HashMap.set(self.metadata, name, {
          ...meta.value,
          accessCount: meta.value.accessCount + 1,
        });
      }

      return found.value;
    });
  }

  has(name: string): Effect.Effect<boolean> {
    return Effect.sync(() => {
      // Check computed
      if (Option.isSome(HashMap.get(this.computed, name))) {
        return true;
      }

      // Check scopes
      for (const scope of this.scopes) {
        if (HashMap.has(scope, name)) {
          return true;
        }
      }

      // Check global
      return HashMap.has(this.variables, name);
    });
  }

  delete(name: string): Effect.Effect<void> {
    return Effect.sync(() => {
      // Remove from metadata
      this.metadata = HashMap.remove(this.metadata, name);

      // Remove from current scope or global
      if (this.scopes.length > 0) {
        const currentScope =
          this.scopes[this.scopes.length - 1] || HashMap.empty();
        const updatedScope = HashMap.remove(currentScope, name);
        this.scopes[this.scopes.length - 1] = updatedScope;
      } else {
        this.variables = HashMap.remove(this.variables, name);
      }
    });
  }

  clear(): Effect.Effect<void> {
    return Effect.sync(() => {
      this.variables = HashMap.empty();
      this.metadata = HashMap.empty();
      // Don't clear scopes or computed
    });
  }

  getPath(name: string, path: string[]): Effect.Effect<unknown, StateError> {
    const self = this;
    return Effect.gen(function* () {
      let value = yield* self.get(name).pipe(
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
    });
  }

  setPath(name: string, path: string[], value: unknown): Effect.Effect<void> {
    const self = this;
    return Effect.gen(function* () {
      const current = yield* self
        .get(name)
        .pipe(Effect.orElse(() => Effect.succeed({})));

      if (path.length === 0) {
        yield* self.set(name, value);
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
      yield* self.set(name, root);
    });
  }

  pushScope(): Effect.Effect<void> {
    return Effect.sync(() => {
      this.scopes.push(HashMap.empty());
    });
  }

  popScope(): Effect.Effect<void, StateError> {
    const self = this;
    return Effect.gen(function* () {
      if (self.scopes.length === 0) {
        return yield* Effect.fail(
          new StateError({
            message: 'No scope to pop',
            operation: 'popScope',
          })
        );
      }

      // Remove variables from this scope from metadata
      const scope = self.scopes[self.scopes.length - 1] || HashMap.empty();
      const scopeVars = HashMap.keys(scope);

      for (const varName of scopeVars) {
        self.metadata = HashMap.remove(self.metadata, varName);
      }

      self.scopes.pop();
    });
  }

  getScopeDepth(): Effect.Effect<number> {
    return Effect.succeed(this.scopes.length);
  }

  snapshot(): Effect.Effect<StateSnapshot> {
    return Effect.sync(() => ({
      variables: this.hashMapToObject(this.variables),
      scopes: this.scopes.map((scope) => this.hashMapToObject(scope)),
      metadata: this.hashMapToObject(this.metadata),
      computed: this.hashMapToObject(this.computed) as Record<
        string,
        () => unknown
      >,
    }));
  }

  restore(snapshot: StateSnapshot): Effect.Effect<void> {
    return Effect.sync(() => {
      this.variables = this.objectToHashMap(snapshot.variables);
      this.scopes = snapshot.scopes.map((scope) => this.objectToHashMap(scope));
      this.metadata = this.objectToHashMap(snapshot.metadata);
      this.computed = this.objectToHashMap(
        snapshot.computed
      ) as HashMap.HashMap<string, () => unknown>;
    });
  }

  getAll(): Effect.Effect<Record<string, unknown>> {
    return Effect.sync(() => {
      const result: Record<string, unknown> = {};

      // Add global variables
      for (const [key, value] of HashMap.entries(this.variables)) {
        result[key] = value;
      }

      // Add scope variables (overriding globals)
      for (const scope of this.scopes) {
        for (const [key, value] of HashMap.entries(scope)) {
          result[key] = value;
        }
      }

      return result;
    });
  }

  setMany(variables: Record<string, unknown>): Effect.Effect<void> {
    const self = this;
    return Effect.gen(function* () {
      for (const [key, value] of Object.entries(variables)) {
        yield* self.set(key, value);
      }
    });
  }

  merge(variables: Record<string, unknown>): Effect.Effect<void> {
    return this.setMany(variables);
  }

  getMetadata(name: string): Effect.Effect<VariableMetadata | undefined> {
    return Effect.sync(() => {
      const meta = HashMap.get(this.metadata, name);
      return Option.isSome(meta) ? meta.value : undefined;
    });
  }

  registerComputed(name: string, compute: () => unknown): Effect.Effect<void> {
    return Effect.sync(() => {
      this.computed = HashMap.set(this.computed, name, compute);
    });
  }

  toJSON(): Effect.Effect<string> {
    const self = this;
    return Effect.gen(function* () {
      const all = yield* self.getAll();
      return JSON.stringify({ variables: all });
    });
  }

  fromJSON(json: string): Effect.Effect<void, StateError> {
    const self = this;
    return Effect.gen(function* () {
      const parseResult = yield* parseJsonSafe(json).pipe(
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
          yield* self.setMany(data.variables as Record<string, unknown>);
        }
      } else {
        return yield* Effect.fail(
          new StateError({
            message: 'JSON must contain an object with variables property',
            operation: 'fromJSON',
          })
        );
      }
    });
  }

  // Helper methods
  /**
   * Internal helper: Convert a HashMap to a plain object for snapshots.
   */
  private hashMapToObject<V>(
    map: HashMap.HashMap<string, V>
  ): Record<string, V> {
    const obj: Record<string, V> = {};
    for (const [key, value] of HashMap.entries(map)) {
      obj[key] = value;
    }
    return obj;
  }

  /**
   * Internal helper: Convert a plain object to a HashMap for state hydration.
   */
  private objectToHashMap<V>(
    obj: Record<string, V>
  ): HashMap.HashMap<string, V> {
    let map = HashMap.empty<string, V>();
    for (const [key, value] of Object.entries(obj)) {
      map = HashMap.set(map, key, value);
    }
    return map;
  }
}

// ============= Factory Functions =============

/**
 * Create a new state manager
 */
export function createStateManager(): StateManager {
  return new StateManagerImpl();
}

/**
 * Create a state manager with initial state
 */
export function createStateManagerWithInitial(
  initial: Record<string, unknown>
): Effect.Effect<StateManager> {
  return Effect.gen(function* () {
    const manager = createStateManager();
    yield* manager.setMany(initial);
    return manager;
  });
}

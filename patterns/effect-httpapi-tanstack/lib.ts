import * as React from 'react';
import { HttpApi } from '@effect/platform';
import * as HttpApiClient from '@effect/platform/HttpApiClient';
import type * as HttpApiGroupNS from '@effect/platform/HttpApiGroup';
import * as FetchHttpClient from '@effect/platform/FetchHttpClient';
import { Effect } from 'effect';
import {
  useQuery,
  useMutation,
  type UseQueryOptions,
  type UseMutationOptions,
  type UseQueryResult,
  type UseMutationResult
} from '@tanstack/react-query';

// ============================================================================
// Generic library hooks to enable strict type inference for HttpApi groups
// ============================================================================

export type Client<
  Groups extends HttpApiGroupNS.HttpApiGroup.Any,
  E,
> = HttpApiClient.Client<Groups, E, never>;

export type EffectSuccess<T> = T extends Effect.Effect<infer S, unknown, unknown>
  ? S
  : never;
export type EffectError<T> = T extends Effect.Effect<unknown, infer E, unknown>
  ? E
  : never;

// Utility to get the first (and only) argument of an endpoint method
type ArgOf<F> = F extends (...args: infer A) => any
  ? A extends [infer P]
    ? P
    : undefined
  : undefined;

// If an arg has a headers field, make it optional so callers don't need to supply it explicitly
type MakeHeadersOptional<T> = T extends { headers: infer H }
  ? Omit<T, 'headers'> & { headers?: H }
  : T;

// (helpers kept minimal; rely on conditional types inline below)

export interface ApiConfig {
  baseUrl: string;
  getAuthHeaders?: () => Promise<Record<string, string>> | Record<string, string>;
}

const ApiConfigContext = React.createContext<ApiConfig | null>(null);

export function ApiProvider({
  config,
  children
}: {
  config: ApiConfig;
  children: React.ReactNode;
}) {
  return React.createElement(
    ApiConfigContext.Provider,
    { value: config },
    children
  );
}

export function useHttpApiClient<
  Id extends string,
  Groups extends HttpApiGroupNS.HttpApiGroup.Any,
  E,
  R,
>(api: HttpApi.HttpApi<Id, Groups, E, R>): Client<Groups, E> | null {
  const config = React.useContext(ApiConfigContext);
  const [client, setClient] = React.useState<Client<Groups, E> | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    if (!config?.baseUrl) {
      setClient(null);
      return;
    }

    const program = HttpApiClient.make(api, {
      baseUrl: config.baseUrl
    });

    const promise = (Effect.runPromise as any)(
      program.pipe(Effect.provide(FetchHttpClient.layer)) as any
    ) as Promise<any>;

    promise.then(
      (c) => {
        if (!cancelled) setClient(c as Client<Groups, E>);
      },
      (err) => {
        if (!cancelled) {
          console.error('Failed to create API client:', err);
          setClient(null);
        }
      }
    );

    return () => {
      cancelled = true;
    };
  }, [api, config?.baseUrl]);

  return client;
}

export function useHttpApiGroup<
  Id extends string,
  Groups extends HttpApiGroupNS.HttpApiGroup.Any,
  E,
  R,
  GroupName extends keyof Client<Groups, E> & string,
>(
  api: HttpApi.HttpApi<Id, Groups, E, R>,
  groupName: GroupName,
): Client<Groups, E>[GroupName] | null {
  const client = useHttpApiClient(api);
  return React.useMemo(() => {
    if (!client) return null;
    return (client as Client<Groups, E>)[groupName];
  }, [client, groupName]);
}

// Helper to merge auth headers when applicable
async function withAuthHeaders<T>(vars: T, config: ApiConfig | null): Promise<T> {
  try {
    if (!config?.getAuthHeaders) return vars;
    const hdrs = await config.getAuthHeaders();
    if (!hdrs || typeof vars !== 'object' || vars === null) return vars;
    const anyVars: any = vars;
    return {
      ...anyVars,
      headers: { ...(anyVars.headers ?? {}), ...hdrs }
    } as T;
  } catch {}
  return vars;
}

// Generic query/mutation wrappers for any endpoint method
function useMethodQuery<
  M extends (...args: any[]) => Effect.Effect<any, any, any>
>(
  label: string,
  method: M | undefined,
  args?: MakeHeadersOptional<ArgOf<M>>,
  config?: ApiConfig | null,
  options?: Omit<
    UseQueryOptions<
      EffectSuccess<ReturnType<M>>,
      EffectError<ReturnType<M>>,
      EffectSuccess<ReturnType<M>>,
      readonly unknown[]
    >,
    'queryKey' | 'queryFn'
  > & { queryKey?: readonly unknown[] }
): UseQueryResult<EffectSuccess<ReturnType<M>>, EffectError<ReturnType<M>>> {
  const key = options?.queryKey ?? ['httpapi', label, args];
  return useQuery<
    EffectSuccess<ReturnType<M>>,
    EffectError<ReturnType<M>>,
    EffectSuccess<ReturnType<M>>,
    readonly unknown[]
  >(
    {
      queryKey: key,
      queryFn: async () => {
        if (!method) throw new Error('API method not available');
        const vars = await withAuthHeaders(args ?? ({} as any), config ?? null);
        const eff = (method as any)(vars) as ReturnType<M>;
        return (Effect.runPromise as any)(eff) as Promise<
          EffectSuccess<ReturnType<M>>
        >;
      },
      enabled: !!method && (options?.enabled ?? true),
      ...options
    }
  );
}

function useMethodMutation<
  M extends (...args: any[]) => Effect.Effect<any, any, any>
>(
  method: M | undefined,
  config?: ApiConfig | null,
  options?: UseMutationOptions<
    EffectSuccess<ReturnType<M>>,
    EffectError<ReturnType<M>>,
    MakeHeadersOptional<ArgOf<M>>,
    unknown
  >
): UseMutationResult<
  EffectSuccess<ReturnType<M>>,
  EffectError<ReturnType<M>>,
  MakeHeadersOptional<ArgOf<M>>,
  unknown
> {
  return useMutation<
    EffectSuccess<ReturnType<M>>,
    EffectError<ReturnType<M>>,
    MakeHeadersOptional<ArgOf<M>>,
    unknown
  >({
    mutationFn: async (variables) => {
      if (!method) throw new Error('API method not available');
      const vars = await withAuthHeaders(variables ?? ({} as any), config ?? null);
      const eff = (method as any)(vars) as ReturnType<M>;
      return (Effect.runPromise as any)(eff) as Promise<
        EffectSuccess<ReturnType<M>>
      >;
    },
    ...options
  });
}

// Create mapped types for per-group and per-method hooks
export type MethodHooks<G> = {
  [K in keyof G & string as `use${Capitalize<K>}Query`]: G[K] extends (
    a: infer A
  ) => Effect.Effect<infer S, infer E, any>
    ? (
        args: MakeHeadersOptional<A>,
        options?: Omit<
          UseQueryOptions<S, E, S, readonly unknown[]>,
          'queryKey' | 'queryFn'
        > & { queryKey?: readonly unknown[] }
      ) => UseQueryResult<S, E>
    : never
} & {
  [K in keyof G & string as `use${Capitalize<K>}Mutation`]: G[K] extends (
    a: infer A
  ) => Effect.Effect<infer S, infer E, any>
    ? (
        options?: UseMutationOptions<S, E, MakeHeadersOptional<A>, unknown>
      ) => UseMutationResult<S, E, MakeHeadersOptional<A>, unknown>
    : never
} & {
  // Also expose raw methods for direct Effect usage
  [K in keyof G & string]: G[K]
};

export type GroupHooks<
  Groups extends HttpApiGroupNS.HttpApiGroup.Any,
  E
> = {
  [K in keyof Client<Groups, E> & string as `use${Capitalize<K>}Group`]: () =>
    MethodHooks<Client<Groups, E>[K]>;
};

// New API: return per-group hooks with names like useChatGroup
export function useHttpApi<
  Id extends string,
  Groups extends HttpApiGroupNS.HttpApiGroup.Any,
  E,
  R,
>(api: HttpApi.HttpApi<Id, Groups, E, R>): GroupHooks<Groups, E> {
  // Helper to map hook name back to group key
  const toGroupKey = React.useCallback((hookName: string) => {
    const base = hookName.slice(3, -5); // remove 'use' prefix and 'Group' suffix
    if (!base) return '';
    return base.charAt(0).toLowerCase() + base.slice(1);
  }, []);

  // Cache per-group hook functions for stability across renders
  return React.useMemo(() => {
    const cache = new Map<string, unknown>();
    const handler: ProxyHandler<object> = {
      get(_target, prop) {
        if (typeof prop !== 'string') return undefined;
        if (!cache.has(prop)) {
          const groupKey = toGroupKey(prop) as keyof Client<Groups, E> & string;
          const hook = () => {
            const config = React.useContext(ApiConfigContext);
            const group = useHttpApiGroup(api, groupKey as any);

            // Build per-method hooks for this group
            const toMethodKey = (name: string) => {
              // Strip leading 'use' and trailing 'Query'/'Mutation'
              let base = name.startsWith('use') ? name.slice(3) : name;
              base = base.replace(/(Query|Mutation)$/u, '');
              return base.length
                ? (base.charAt(0).toLowerCase() + base.slice(1))
                : '';
            };

            return React.useMemo(() => {
              const methodCache = new Map<string, unknown>();
              const methodHandler: ProxyHandler<object> = {
                get(_t, p) {
                  if (typeof p !== 'string') return undefined;

                  // Raw method passthrough when exact name requested
                  if (group && p in (group as any)) {
                    return (group as any)[p];
                  }

                  if (!methodCache.has(p)) {
                    const methodKey = toMethodKey(p);
                    const method = group ? (group as any)[methodKey] : undefined;
                    if (p.endsWith('Query')) {
                      const fn = (args: any, options?: any) =>
                        useMethodQuery(
                          `${String(groupKey)}.${methodKey}`,
                          method,
                          args,
                          config,
                          options
                        );
                      methodCache.set(p, fn);
                    } else if (p.endsWith('Mutation')) {
                      const fn = (options?: any) =>
                        useMethodMutation(method, config, options);
                      methodCache.set(p, fn);
                    } else {
                      methodCache.set(p, undefined);
                    }
                  }
                  return methodCache.get(p);
                }
              };
              return new Proxy({}, methodHandler) as MethodHooks<
                Client<Groups, E>[typeof groupKey]
              >;
            }, [group, config]);
          };
          cache.set(prop, hook);
        }
        return cache.get(prop);
      },
    };
    return new Proxy({}, handler) as GroupHooks<Groups, E>;
  }, [api, toGroupKey]);
}

# Effect HttpApi + TanStack Query

Strongly-typed React hooks for Effect platform HttpApi groups with TanStack Query integration and auth middleware.

- Tech: Effect, @effect/platform (HttpApi, HttpApiClient, FetchHttpClient), React, @tanstack/react-query v5, TypeScript
- Problem: Easy, type-safe consumption of Effect HttpApi endpoints in React with query/mutation caching, while injecting auth headers centrally.
- Solution:
  - ApiProvider supplies `baseUrl` and optional `getAuthHeaders()` middleware.
  - `useHttpApiClient` creates a real HttpApiClient at runtime (FetchHttpClient.layer), cached by React state, error handled.
  - `useHttpApi` returns per-group hooks (e.g. `useChatGroup`) that expose:
    - Raw endpoint methods for direct Effect usage.
    - Per-method hooks: `use{Method}Query` / `use{Method}Mutation` built on TanStack Query.
  - Headers middleware merges auth into every call’s variables.
  - Fully inferred types from the HttpApi schema; no duplication.

## Files
- `lib.ts`: Generic, reusable hooks and types.
- `example.tsx`: Self-contained demo with a sample `jambudipaApi` schema and a `ThreadList` component using the hooks.

## Usage
```tsx
import { ApiProvider, useHttpApi } from './lib';
import { jambudipaApi } from './example'; // or your own HttpApi

function Demo() {
  const { useChatGroup } = useHttpApi(jambudipaApi);
  const chat = useChatGroup();
  const threads = chat.useGetThreadsQuery({}, { staleTime: 30_000 });
  const createThread = chat.useCreateThreadMutation();

  return (
    <ApiProvider
      config={{
        baseUrl: 'http://localhost:3000',
        getAuthHeaders: () => ({ authorization: 'Bearer demo-token' })
      }}
    >
      {/* ...render threads / call createThread.mutate(...) */}
    </ApiProvider>
  );
}
```

## Notes
- The hooks infer method args and result types from the HttpApi definition.
- `headers` on endpoint args are optional in the hook signatures; middleware injects them.
- Works with all TanStack Query options you’d expect (enabled, staleTime, etc.).
- Suitable for reuse across projects; consider extracting to a publishable package if needed.

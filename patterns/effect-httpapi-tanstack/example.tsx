// Dear GPT-5,
// I would like you to write the hook useHttpApiGroup such that the code in
// ThreadList works as expected. chatGroup should be fine, but nonExistentGroup
// should not. Use context7 MCP server, or otherwise try to infer the types
// from the HttpApi source code in node_modules. It is *ABSOLUTELY FORBIDDEN*
// to duplicate the types as they appear in jambudipaApi, they are to be
// *INFERRED ONLY* since this pattern will be used with other HttpApi configs.
// DO NOT RETURN until the types are correct.

import * as React from 'react';
import { Effect, Schema } from 'effect';
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from '@effect/platform';
import { useHttpApi, ApiProvider /*, useHttpApiGroup */ } from './lib';

// Library hooks are now imported from ./lib

// ============================================================================
// API Contract Definition
// ============================================================================
const jambudipaApi = HttpApi.make('jambudipaApi').add(
  HttpApiGroup.make('chat')
    .add(
      HttpApiEndpoint.get('getStream', '/stream')
        .setUrlParams(
          Schema.Struct({
            message: Schema.String,
            threadId: Schema.optional(Schema.String),
          }),
        )
        .addSuccess(
          Schema.String.pipe(
            HttpApiSchema.withEncoding({
              kind: 'Text',
              contentType: 'application/x-ndjson',
            }),
          ),
        ),
    )
    .add(
      HttpApiEndpoint.post('createThread', '/thread').addSuccess(
        Schema.Struct({
          threadId: Schema.String,
        }),
      ),
    )
    .add(
      HttpApiEndpoint.get('getThreadState', '/thread')
        .setUrlParams(
          Schema.Struct({
            threadId: Schema.String,
          }),
        )
        .addSuccess(
          Schema.Struct({
            threadId: Schema.String,
            messages: Schema.Array(
              Schema.Struct({
                id: Schema.String,
                role: Schema.Literal('human', 'assistant'),
                content: Schema.String,
                timestamp: Schema.optional(Schema.String),
              }),
            ),
          }),
        ),
    )
    .add(
      HttpApiEndpoint.get('getThreads', '/threads')
        .setHeaders(
          Schema.Struct({
            authorization: Schema.optional(Schema.String),
          }),
        )
        .addSuccess(
          Schema.Struct({
            threads: Schema.Array(
              Schema.Struct({
                thread_id: Schema.String,
                created_at: Schema.String,
                updated_at: Schema.String,
                metadata: Schema.optional(
                  Schema.Struct({
                    title: Schema.optional(Schema.String),
                    last_message: Schema.optional(Schema.String),
                  }),
                ),
              }),
            ),
          }),
        ),
    )
    .add(
      HttpApiEndpoint.post('assignThreadToUser', '/thread/assign')
        .setUrlParams(
          Schema.Struct({
            threadId: Schema.String,
          }),
        )
        .setHeaders(
          Schema.Struct({
            authorization: Schema.String,
          }),
        )
        .addSuccess(
          Schema.Struct({
            success: Schema.Boolean,
          }),
        ),
    ),
);

// ============================================================================
// Example Components
// ============================================================================
/**
 * Thread list with TanStack Query
 */
function ThreadList() {
  // const chatGroup = useHttpApiGroup(jambudipaApi, 'chat'); // THIS SHOULD PASS TYPE CHECKING
  // const nonExistentGroup = useHttpApiGroup(jambudipaApi, 'nonExistentGroup'); // THIS SHOULD NOT because the group does not exist

  //TODO Create alternative syntax...useHttpApi can return all of the groups,
  // using TypeScript key rewriting to add 'use{name}Group'
  const {useChatGroup} = useHttpApi(jambudipaApi);
  const chat = useChatGroup();

  // TanStack Query-powered hooks exposed on the group
  const threadsQuery = chat.useGetThreadsQuery({}, { staleTime: 30_000 });
  const createThread = chat.useCreateThreadMutation();

  return (
    <div>
      <h3>Threads</h3>
      {threadsQuery.isLoading && <p>Loading…</p>}
      {threadsQuery.error && (
        <p style={{ color: 'red' }}>Error: {String(threadsQuery.error)}</p>
      )}
      {threadsQuery.data && (
        <pre>{JSON.stringify(threadsQuery.data, null, 2)}</pre>
      )}
      <button
        onClick={() => createThread.mutate({})}
        disabled={createThread.isPending}
      >
        Create thread
      </button>
    </div>
  );
}

// Demo wrapper to provide baseUrl and auth middleware
export function Demo() {
  return (
    <ApiProvider
      config={{
        baseUrl: 'http://localhost:3000',
        getAuthHeaders: () => ({ authorization: 'Bearer demo-token' })
      }}
    >
      <ThreadList />
    </ApiProvider>
  );
}

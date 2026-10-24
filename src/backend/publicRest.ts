// The public Data API client. The public pages only read tables and call RPCs anonymously, so a bare
// PostgREST client is enough: none of the auth, storage or functions code of the full client. That
// client stays in `supabaseClient.ts`, for the admin.
//
// Effects (creating the client) are isolated here at the edge; the adapters take a ready client from
// `getPublicRest()` and stay a pure transform of its responses.

import { PostgrestClient } from '@supabase/postgrest-js'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config'
import { BACKEND_NOT_CONFIGURED, publicApiHeaders, restUrl } from './publicApi'

/** Memoized singleton — created on first `getPublicRest()` call, never at import time. */
let client: PostgrestClient | undefined

/**
 * The shared public Data API client. Throws a clear error while the backend is unconfigured —
 * unreachable in practice (the selectors only pick a Supabase adapter when `isBackendConfigured()`
 * is true), but the guard makes the misuse explicit instead of building a client with no credentials.
 */
export function getPublicRest(): PostgrestClient {
  if (SUPABASE_URL === undefined || SUPABASE_ANON_KEY === undefined) {
    throw new Error(BACKEND_NOT_CONFIGURED)
  }
  client ??= new PostgrestClient(restUrl(SUPABASE_URL), {
    headers: publicApiHeaders(SUPABASE_ANON_KEY),
    schema: 'public',
    // PostgrestClient keeps the `fetch` it sees at construction; looking the global up per request
    // keeps a later stub or polyfill effective, as it was through supabase-js.
    fetch: (input, init) => globalThis.fetch(input, init),
  })
  return client
}

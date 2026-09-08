// The Supabase client seam — the ONLY module that imports `@supabase/supabase-js`. It is reached
// solely through a DYNAMIC import from the supabase adapters (which the selectors lazy-load when the
// backend is configured), so supabase-js lands in a SEPARATE chunk and never weighs down the main
// bundle. The "configured?" check lives in `config.ts` (no supabase-js) so the selectors can decide
// real-vs-mock without pulling this in.
//
// Effects (creating the network client) are isolated here at the edge; the rest of the backend layer
// takes a ready `SupabaseClient` from `getSupabase()` and stays a pure transform of its responses.

import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config'

/** Memoized singleton — created on first `getSupabase()` call, never at import time. */
let client: SupabaseClient | undefined

/**
 * The shared Supabase client (lazily created, memoized). Throws a clear error if called while the
 * backend is unconfigured — unreachable in practice (the selectors only pick a Supabase adapter when
 * `isBackendConfigured()` is true), but the guard makes the misuse explicit instead of constructing a
 * client with empty credentials.
 */
export function getSupabase(): SupabaseClient {
  if (SUPABASE_URL === undefined || SUPABASE_ANON_KEY === undefined) {
    throw new Error(
      'Supabase backend is not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY ' +
        '(or use the offline mock adapters, which require no env).',
    )
  }
  if (client === undefined) {
    // No auth/session: the app is static + anonymous, the anon key is the only credential, and the
    // security boundary is RLS + SECURITY DEFINER RPCs (so persisting a session would be pointless).
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    })
  }
  return client
}

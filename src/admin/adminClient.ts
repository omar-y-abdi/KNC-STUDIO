// The ADMIN Supabase client seam — a SECOND client instance, DISTINCT from the public
// `getSupabase()` in `src/backend/supabaseClient.ts`. Two deliberate differences:
//
//   1. `persistSession: true` (+ autoRefreshToken) with its OWN `storageKey` — so an owner/barber
//      stays logged in across reloads WITHOUT touching the public site (which keeps
//      persistSession:false). The two clients never share session state.
//   2. It is imported ONLY from lazy-loaded admin code, so `@supabase/supabase-js`'s auth machinery
//      lands in the admin chunk and never weighs down the public critical path.
//
// Security: the browser holds the PUBLIC anon key + (after login) the user's Auth session. RLS +
// the SECURITY DEFINER helpers/RPCs are the ENTIRE boundary — there is NO service_role here.
//
// Effects (creating the network client, reading localStorage) are isolated at this edge; the admin
// adapters take a ready client from `getAdminClient()` and stay pure transforms of its responses.

import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../backend/config'

/** A unique storage key so the admin session never collides with anything the public client stores. */
const ADMIN_STORAGE_KEY = 'knc-admin-auth'

/** Memoized singleton — created on first `getAdminClient()` call, never at import time. */
let client: SupabaseClient | undefined

/**
 * The admin Supabase client (lazily created, memoized, session-persisting). Throws a clear error if
 * called while the backend is unconfigured — the login screen checks `isBackendConfigured()` first
 * and shows a notice, so this guard only ever fires on misuse.
 */
export function getAdminClient(): SupabaseClient {
  if (SUPABASE_URL === undefined || SUPABASE_ANON_KEY === undefined) {
    throw new Error(
      'Admin backend is not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
    )
  }
  if (client === undefined) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storageKey: ADMIN_STORAGE_KEY,
      },
    })
  }
  return client
}

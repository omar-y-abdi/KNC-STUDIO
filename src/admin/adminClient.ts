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
import { captureAdminOperation } from './orderedOperations'

/** A unique storage key so the admin session never collides with anything the public client stores. */
const ADMIN_STORAGE_KEY = 'knc-admin-auth'
const memory = new Map<string, string>()

// Web Locks make the compare/remove atomic with every SDK storage write across tabs. Older
// browsers keep admin sessions per tab; they must not share credentials without that guarantee.
function storage(): Storage | null {
  try {
    return typeof navigator !== 'undefined' && navigator.locks
      ? globalThis.localStorage
      : (globalThis.sessionStorage ?? null)
  } catch {
    return null
  }
}
function storageRead(key: string): string | null {
  try {
    const target = storage()
    return target === null ? (memory.get(key) ?? null) : target.getItem(key)
  } catch {
    return memory.get(key) ?? null
  }
}
function storageWrite(key: string, value: string | null): void {
  try {
    const target = storage()
    if (target !== null) {
      if (value === null) target.removeItem(key)
      else target.setItem(key, value)
    }
  } catch {
    // Match the SDK's in-memory fallback when browser storage is unavailable.
  }
  if (value === null) memory.delete(key)
  else memory.set(key, value)
}
function withStorageLock<T>(operation: () => T): Promise<T> {
  return typeof navigator !== 'undefined' && navigator.locks
    ? navigator.locks.request(`${ADMIN_STORAGE_KEY}:storage`, operation)
    : Promise.resolve(operation())
}
const adminStorage = {
  getItem: (key: string) => withStorageLock(() => storageRead(key)),
  setItem: (key: string, value: string) => withStorageLock(() => storageWrite(key, value)),
  removeItem: (key: string) => withStorageLock(() => storageWrite(key, null)),
}

/** Clear only the account being signed out, atomically with another tab's SDK sign-in. */
export function clearStoredAdminSession(userId: string): Promise<void> {
  return withStorageLock(() => {
    const saved = storageRead(ADMIN_STORAGE_KEY)
    if (saved === null) return
    const parsed: unknown = JSON.parse(saved)
    if (typeof parsed !== 'object' || parsed === null || !('user' in parsed)) return
    const user = parsed.user
    if (typeof user === 'object' && user !== null && 'id' in user && user.id === userId)
      storageWrite(ADMIN_STORAGE_KEY, null)
  })
}

/** Memoized singleton — created on first `getAdminClient()` call, never at import time. */
let client: SupabaseClient | undefined
type AdminClient = Pick<SupabaseClient, 'auth' | 'from' | 'rpc' | 'functions' | 'storage'>
let protectedData:
  | { readonly userId: string; readonly isCurrent: () => boolean; readonly client: AdminClient }
  | undefined

/**
 * The admin Supabase client (lazily created, memoized, session-persisting). Throws a clear error if
 * called while the backend is unconfigured — the login screen checks `isBackendConfigured()` first
 * and shows a notice, so this guard only ever fires on misuse.
 */
function createAdminClient(
  persistSession: boolean,
  accessToken?: () => Promise<string>,
): SupabaseClient {
  if (SUPABASE_URL === undefined || SUPABASE_ANON_KEY === undefined) {
    throw new Error(
      'Admin backend is not configured: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
    )
  }
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    ...(accessToken === undefined ? {} : { accessToken }),
    auth: {
      persistSession,
      autoRefreshToken: persistSession,
      detectSessionInUrl: false,
      storageKey: persistSession ? ADMIN_STORAGE_KEY : `${ADMIN_STORAGE_KEY}-operation`,
      ...(persistSession ? { storage: adminStorage } : {}),
    },
  })
}

/** Session establishment/profile verification cannot depend on a previously mounted admin gate. */
export function getAdminAuthClient(): SupabaseClient {
  return (client ??= createAdminClient(true))
}

/**
 * Capture the verified principal in a data client. The SDK may observe another tab's storage
 * before delivering its Auth event; each request must check identity and then use the token it
 * actually checked, never ask the mutable singleton for credentials a second time.
 */
export function activateAdminDataClient(userId: string, onSessionChange: () => void): void {
  if (protectedData?.userId === userId && protectedData.isCurrent()) return
  const isCurrent = captureAdminOperation()
  const auth = getAdminAuthClient().auth
  const data = createAdminClient(false, async () => {
    if (!isCurrent()) throw new Error('Admin session changed')
    const result = await auth.getSession()
    if (!isCurrent()) throw new Error('Admin session changed')
    if (result.error !== null) {
      if ([400, 401, 403].includes(result.error.status ?? 0)) onSessionChange()
      throw new Error('Admin session unavailable')
    }
    const session = result.data.session
    if (session === null || session.user.id !== userId) {
      onSessionChange()
      throw new Error('Admin session changed')
    }
    return session.access_token
  })
  protectedData = {
    userId,
    isCurrent,
    client: {
      auth,
      from: data.from.bind(data),
      rpc: data.rpc.bind(data),
      functions: data.functions,
      storage: data.storage,
    },
  }
}

/** Auth stays shared; protected adapters retain the data client's captured principal. */
export function getAdminClient(): AdminClient {
  return protectedData?.client ?? getAdminAuthClient()
}

/** Password responses must not persist or broadcast a session after its UI owner has left. */
export function createAdminAuthOperationClient(): SupabaseClient['auth'] {
  return createAdminClient(false).auth
}

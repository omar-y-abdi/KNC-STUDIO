// Admin authentication — the thin, typed seam over Supabase Auth + the `profiles` self-read. Every
// function returns a `Result` (no throw reaches the UI). The login screen calls `signIn`; the
// `/admin` gate calls `getActiveProfile` (session check + profile resolve) on mount.
//
// The profile is resolved with a PostgREST self-read (`select role, barber_id from profiles where
// id = auth.uid()`); the `profiles_select_self` RLS policy scopes it to the caller's own row, so an
// authenticated user can always read their own role but never anyone else's.

import { getAdminClient } from './adminClient'
import { parseWith, profileRow } from './adminSchemas'
import type { AdminProfile, AdminResult } from './types'
import { err, ok } from './types'

/** Map any thrown/transport problem to a neutral network error (kept human + non-leaky). */
const NETWORK_ERROR = 'Kunde inte nå servern. Försök igen.'
/** Wrong email/password (Supabase returns "Invalid login credentials"). */
const BAD_CREDENTIALS = 'Fel e‑post eller lösenord.'
/** Authenticated but no linked profile (owner forgot to create the `profiles` row). */
const NO_PROFILE = 'Ditt konto saknar en roll. Kontakta ägaren.'

/**
 * Sign in with email + password, then resolve the profile. On success the admin client persists the
 * session (its own storageKey). A sign-in that succeeds but has no `profiles` row is treated as an
 * error (the account cannot act in the panel) and the session is cleared.
 */
export async function signIn(email: string, password: string): Promise<AdminResult<AdminProfile>> {
  const supabase = getAdminClient()
  try {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error !== null || data.user === null) return err('auth', BAD_CREDENTIALS)
    return resolveProfile(data.user.id, data.user.email ?? email)
  } catch {
    return err('network', NETWORK_ERROR)
  }
}

/**
 * Resolve the CURRENT session's profile (used by the `/admin` gate on mount + after a reload). Returns
 * `not_found`-kinded error when there is no active session (the gate redirects to `/login`).
 */
export async function getActiveProfile(): Promise<AdminResult<AdminProfile>> {
  const supabase = getAdminClient()
  try {
    const { data, error } = await supabase.auth.getSession()
    if (error !== null) return err('network', NETWORK_ERROR)
    const session = data.session
    if (session === null) return err('not_found', 'No active session')
    return resolveProfile(session.user.id, session.user.email ?? '')
  } catch {
    return err('network', NETWORK_ERROR)
  }
}

/** Read + validate the caller's own `profiles` row (RLS self-read) into an `AdminProfile`. */
async function resolveProfile(userId: string, email: string): Promise<AdminResult<AdminProfile>> {
  const supabase = getAdminClient()
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('role, barber_id')
      .eq('id', userId)
      .maybeSingle()
    if (error !== null) return err('network', NETWORK_ERROR)
    if (data === null) return err('forbidden', NO_PROFILE)

    const parsed = parseWith(profileRow, data)
    if (!parsed.ok) return err('malformed', NO_PROFILE)

    return ok<AdminProfile>({
      userId,
      email,
      role: parsed.value.role,
      barberId: parsed.value.barber_id,
    })
  } catch {
    return err('network', NETWORK_ERROR)
  }
}

/** Sign out — clears the persisted session. Idempotent + never throws. */
export async function signOut(): Promise<void> {
  try {
    await getAdminClient().auth.signOut()
  } catch {
    // Already signed out / offline — nothing to surface.
  }
}

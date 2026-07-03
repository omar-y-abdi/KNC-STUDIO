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
/** A recovery link that is missing, malformed, or expired (server rejected the session). */
const RECOVERY_LINK_INVALID = 'Återställningslänken är ogiltig eller har gått ut. Begär en ny.'
/** The password update itself failed (e.g. server-side policy) after the input passed local checks. */
const PASSWORD_UPDATE_FAILED = 'Kunde inte uppdatera lösenordet. Försök igen.'

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

// --- Password change + recovery (available to EVERY account, owner or barber) --------------------

/**
 * Change the password of an account that KNOWS its current one (the `/login` "Byt lösenord" flow).
 * Verifies the current password by signing in, updates to the new one, then signs OUT — the caller
 * shows a "log in with your new password" confirmation rather than routing into the panel. Signing out
 * (instead of resolving the profile + entering) keeps this a pure auth operation: a barber whose
 * `profiles` row is missing/malformed can still change their password without a misleading "no role"
 * error appearing AFTER the change already succeeded. `updateUser` runs against the just-established
 * session; local `validateNewPassword` should gate the input first, so a server rejection here is rare.
 */
export async function changePassword(
  email: string,
  currentPassword: string,
  newPassword: string,
): Promise<AdminResult<void>> {
  const supabase = getAdminClient()
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password: currentPassword,
    })
    if (error !== null || data.user === null) return err('auth', BAD_CREDENTIALS)
    const updated = await supabase.auth.updateUser({ password: newPassword })
    await supabase.auth.signOut()
    if (updated.error !== null) return err('validation', PASSWORD_UPDATE_FAILED)
    return ok(undefined)
  } catch {
    return err('network', NETWORK_ERROR)
  }
}

/**
 * Request a password-reset email (the `/login` "Glömt lösenord?" flow). Supabase emails a recovery
 * link to `redirectTo` (our `/reset` page). It resolves OK even for an unknown address (no user
 * enumeration), so the caller shows the SAME neutral message regardless of `ok` — only a transport
 * failure surfaces as an error.
 */
export async function requestPasswordReset(
  email: string,
  redirectTo: string,
): Promise<AdminResult<void>> {
  const supabase = getAdminClient()
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo })
    if (error !== null) return err('network', NETWORK_ERROR)
    return ok(undefined)
  } catch {
    return err('network', NETWORK_ERROR)
  }
}

/**
 * Establish a recovery session from the implicit-flow tokens carried in the `/reset` URL hash. The
 * admin client has `detectSessionInUrl: false`, so the page parses the URL (`recoveryLink.ts`) and
 * hands the tokens here; `setSession` validates them (an expired link => error). On success the client
 * holds a short-lived session that authorizes exactly one thing: `setNewPassword`.
 */
export async function establishRecoverySession(
  accessToken: string,
  refreshToken: string,
): Promise<AdminResult<void>> {
  const supabase = getAdminClient()
  try {
    const { error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    })
    if (error !== null) return err('auth', RECOVERY_LINK_INVALID)
    return ok(undefined)
  } catch {
    return err('network', NETWORK_ERROR)
  }
}

/**
 * Exchange a PKCE `code` (the alternate recovery-link shape) for a session. Only used if the flow is
 * ever switched to PKCE; the default implicit flow uses `establishRecoverySession` instead.
 */
export async function exchangeRecoveryCode(code: string): Promise<AdminResult<void>> {
  const supabase = getAdminClient()
  try {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (error !== null) return err('auth', RECOVERY_LINK_INVALID)
    return ok(undefined)
  } catch {
    return err('network', NETWORK_ERROR)
  }
}

/**
 * Set a new password using the active recovery session, then sign out so the user logs in fresh with
 * it. Call ONLY after `establishRecoverySession` / `exchangeRecoveryCode` succeeded. `validateNewPassword`
 * should gate the input first; a server rejection maps to a generic validation error.
 */
export async function setNewPassword(newPassword: string): Promise<AdminResult<void>> {
  const supabase = getAdminClient()
  try {
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error !== null) return err('validation', PASSWORD_UPDATE_FAILED)
    await supabase.auth.signOut()
    return ok(undefined)
  } catch {
    return err('network', NETWORK_ERROR)
  }
}

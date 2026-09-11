// Admin authentication — the thin, typed seam over Supabase Auth + the `profiles` self-read. Every
// function returns a `Result` (no throw reaches the UI). The login screen calls `signIn`; the
// `/admin` lifecycle revalidates `getActiveProfile`; it owns immediate UI locking and sign-out.
//
// The profile is resolved with a PostgREST self-read (`select role, barber_id from profiles where
// id = auth.uid()`); the `profiles_select_self` RLS policy scopes it to the caller's own row, so an
// authenticated user can always read their own role but never anyone else's.

import type { Session } from '@supabase/supabase-js'
import {
  clearStoredAdminSession,
  createAdminAuthOperationClient,
  getAdminAuthClient,
  getAdminClient,
} from './adminClient'
import { parseWith, profileRow } from './adminSchemas'
import type { AdminProfile, AdminResult } from './types'
import { err, ok } from './types'
import { captureAdminOperation } from './orderedOperations'

/** Map any thrown/transport problem to a neutral network error (kept human + non-leaky). */
const NETWORK_ERROR = 'Kunde inte nå servern. Försök igen.'
const RECOVERY_CHALLENGE_ERROR = {
  sv: 'Säkerhetskontrollen misslyckades. Försök igen.',
  en: 'The security check failed. Please try again.',
} as const
/** Wrong email/password (Supabase returns "Invalid login credentials"). */
const BAD_CREDENTIALS = 'Fel e‑post eller lösenord.'
/** Authenticated but no linked profile (owner forgot to create the `profiles` row). */
const NO_PROFILE = 'Ditt konto saknar en roll. Kontakta ägaren.'
const ACCOUNT_DISABLED = 'Kontot är avstängt. Kontakta ägaren.'
const SESSION_EXPIRED = 'Din session har gått ut. Logga in igen.'
/** A recovery link that is missing, malformed, or expired (server rejected the session). */
const RECOVERY_LINK_INVALID = 'Återställningslänken är ogiltig eller har gått ut. Begär en ny.'
/** The password update itself failed (e.g. server-side policy) after the input passed local checks. */
const PASSWORD_UPDATE_FAILED = 'Kunde inte uppdatera lösenordet. Försök igen.'
/** Supabase rejected an authenticated email-change request. */
const EMAIL_UPDATE_FAILED = 'Kunde inte skicka bekräftelsen. Försök igen.'
/** Supabase rejected a missing, malformed, consumed, or expired email-change token. */
const EMAIL_CONFIRM_FAILED = 'Bekräftelselänken är ogiltig eller har gått ut.'

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
    const profile = await resolveProfile(data.user.id, data.user.email ?? email)
    if (!profile.ok && profile.error.kind !== 'network') await signOut(data.user.id)
    return profile
  } catch {
    return err('network', NETWORK_ERROR)
  }
}

/**
 * Read the current session and authoritative profile. This does not sign out: callers must first
 * discard stale results and clear protected UI, before starting network-dependent Auth cleanup.
 */
export async function getActiveProfile(signal?: AbortSignal): Promise<AdminResult<AdminProfile>> {
  const supabase = getAdminClient()
  try {
    const { data, error } = await supabase.auth.getSession()
    if (error !== null) {
      return error.status === 400 || error.status === 401 || error.status === 403
        ? err('auth', SESSION_EXPIRED)
        : err('network', NETWORK_ERROR)
    }
    const session = data.session
    if (session === null) return err('not_found', 'No active session')
    return await resolveProfile(session.user.id, session.user.email ?? '', signal)
  } catch {
    return err('network', NETWORK_ERROR)
  }
}

/** Read + validate the caller's own `profiles` row (RLS self-read) into an `AdminProfile`. */
async function resolveProfile(
  userId: string,
  email: string,
  signal?: AbortSignal,
): Promise<AdminResult<AdminProfile>> {
  const supabase = getAdminAuthClient()
  try {
    const query = supabase
      .from('profiles')
      .select('role, barber_id, must_change_password, account_enabled')
      .eq('id', userId)
    const { data, error, status } = await (
      signal === undefined ? query : query.abortSignal(signal)
    ).maybeSingle()
    if (error !== null) {
      return status === 401 || status === 403
        ? err('auth', SESSION_EXPIRED)
        : err('network', NETWORK_ERROR)
    }
    if (data === null) return err('forbidden', NO_PROFILE)

    const parsed = parseWith(profileRow, data)
    if (!parsed.ok) return err('malformed', NO_PROFILE)
    if (!parsed.value.account_enabled) return err('forbidden', ACCOUNT_DISABLED)

    return ok<AdminProfile>({
      userId,
      email,
      role: parsed.value.role,
      barberId: parsed.value.barber_id,
      mustChangePassword: parsed.value.must_change_password,
    })
  } catch {
    return err('network', NETWORK_ERROR)
  }
}

/** Sign out — clears the persisted session. Idempotent + never throws. */
export async function signOut(expectedUserId?: string): Promise<void> {
  try {
    const result = await getAdminAuthClient().auth.getSession()
    const session = result.data.session
    if (session !== null && (expectedUserId === undefined || expectedUserId === session.user.id))
      await signOutSession(session)
  } catch {
    // Already signed out / offline — nothing to surface.
  }
}

async function signOutSession(session: Session): Promise<void> {
  try {
    // Same endpoint used by Auth.signOut, but the explicit JWT cannot drift to another account.
    await getAdminAuthClient().auth.admin.signOut(session.access_token, 'global')
  } finally {
    await clearStoredAdminSession(session.user.id)
  }
}

// --- Account settings + recovery (available to EVERY account, owner or barber) -------------------

/**
 * Change the signed-in account's password from Settings. The explicit sign-in verifies the current
 * password independently of project-level Auth settings; the update also carries `current_password`
 * for server-side enforcement. The refreshed session stays active after success.
 */
export async function changeOwnPassword(
  email: string,
  currentPassword: string,
  newPassword: string,
): Promise<AdminResult<void>> {
  const result = await updatePasswordForCurrentSession(newPassword, {
    email,
    password: currentPassword,
  })
  return result.ok ? ok(undefined) : result
}

/**
 * Auth-js writes its captured session after updateUser/signIn responses. Keep those writes in an
 * isolated client so late responses cannot undo logout or replace another staff member's session.
 * Password verification issues a temporary session; the actual update uses the original session
 * because GoTrue revokes every other session when changing a password.
 */
async function updatePasswordForCurrentSession(
  newPassword: string,
  verification?: { readonly email: string; readonly password: string },
): Promise<AdminResult<Session>> {
  const isCurrent = captureAdminOperation()
  const main = getAdminClient().auth
  const isolated = createAdminAuthOperationClient()
  try {
    const original = await main.getSession()
    if (original.error !== null) return err('network', NETWORK_ERROR)
    const session = original.data.session
    if (session === null || !isCurrent()) return err('auth', SESSION_EXPIRED)
    const ownsSession = async (): Promise<AdminResult<void>> => {
      if (!isCurrent()) return err('auth', SESSION_EXPIRED)
      const latest = await main.getSession()
      if (latest.error !== null) return err('network', NETWORK_ERROR)
      return isCurrent() && latest.data.session?.access_token === session.access_token
        ? ok(undefined)
        : err('auth', SESSION_EXPIRED)
    }
    if (verification !== undefined) {
      if (session.user.email?.toLowerCase() !== verification.email.toLowerCase())
        return err('auth', SESSION_EXPIRED)
      const verified = await isolated.signInWithPassword(verification)
      if (verified.error !== null || verified.data.user === null)
        return err('auth', BAD_CREDENTIALS)
      const cleanup = await isolated.signOut({ scope: 'local' })
      if (cleanup.error !== null) return err('network', NETWORK_ERROR)
      if (verified.data.user.id !== session.user.id || !isCurrent())
        return err('auth', SESSION_EXPIRED)
    }
    const seeded = await isolated.setSession({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    })
    if (seeded.error !== null) return err('auth', SESSION_EXPIRED)
    const beforeUpdate = await ownsSession()
    if (!beforeUpdate.ok) return beforeUpdate
    const updated = await isolated.updateUser({
      ...(verification === undefined ? {} : { current_password: verification.password }),
      password: newPassword,
    })
    if (updated.error !== null) return err('validation', PASSWORD_UPDATE_FAILED)
    const afterUpdate = await ownsSession()
    return afterUpdate.ok ? ok(session) : afterUpdate
  } catch {
    return err('network', NETWORK_ERROR)
  } finally {
    await isolated.dispose()
  }
}

/** Request an email change that the user confirms from the new address. */
export async function requestOwnEmailChange(
  newEmail: string,
  lang: 'sv' | 'en',
): Promise<AdminResult<void>> {
  try {
    const { data, error } = await getAdminClient().functions.invoke('send-email-change', {
      body: { new_email: newEmail, lang },
    })
    if (error !== null || typeof data !== 'object' || data === null || data.ok !== true) {
      return err('validation', EMAIL_UPDATE_FAILED)
    }
    return ok(undefined)
  } catch {
    return err('network', NETWORK_ERROR)
  }
}

/** Confirm a pending email change from the one-time token in the branded callback URL. */
export async function confirmOwnEmailChange(tokenHash: string): Promise<AdminResult<void>> {
  try {
    const { error } = await getAdminClient().auth.verifyOtp({
      token_hash: tokenHash,
      type: 'email_change',
    })
    if (error !== null) return err('auth', EMAIL_CONFIRM_FAILED)
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
  lang: 'sv' | 'en',
  turnstileToken: string,
): Promise<AdminResult<void>> {
  try {
    const { data, error } = await getAdminAuthClient().functions.invoke('send-recovery-email', {
      body: { email, lang, turnstileToken },
    })
    if (error !== null) return err('network', NETWORK_ERROR)
    if (
      typeof data === 'object' &&
      data !== null &&
      'ok' in data &&
      data.ok === false &&
      'error' in data &&
      data.error === 'failed_challenge'
    ) {
      return err('challenge', RECOVERY_CHALLENGE_ERROR[lang])
    }
    if (typeof data !== 'object' || data === null || !('ok' in data) || data.ok !== true) {
      return err('network', NETWORK_ERROR)
    }
    return ok(undefined)
  } catch {
    return err('network', NETWORK_ERROR)
  }
}

/** Verify the branded recovery token and establish the short-lived password-reset session. */
export async function verifyRecoveryTokenHash(tokenHash: string): Promise<AdminResult<void>> {
  try {
    const { error } = await getAdminClient().auth.verifyOtp({
      token_hash: tokenHash,
      type: 'recovery',
    })
    if (error !== null) return err('auth', RECOVERY_LINK_INVALID)
    return ok(undefined)
  } catch {
    return err('network', NETWORK_ERROR)
  }
}

/** Verify a branded staff invite token and establish its short-lived password-setup session. */
export async function verifyInviteTokenHash(tokenHash: string): Promise<AdminResult<void>> {
  try {
    const { error } = await getAdminClient().auth.verifyOtp({
      token_hash: tokenHash,
      type: 'invite',
    })
    if (error !== null) return err('auth', RECOVERY_LINK_INVALID)
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
  const result = await updatePasswordForCurrentSession(newPassword)
  if (!result.ok) return result
  try {
    await signOutSession(result.value)
  } catch {
    // Password changed and local account cleared; a failed remote revocation cannot undo it.
  }
  return ok(undefined)
}

// --- Forced first-login password change (provisioned barber accounts) ---------------------------

/**
 * Update the signed-in barber's password WITHOUT signing out. Used ONLY in the forced-change gate
 * (`ForcedPasswordChange`) so the barber proceeds into the panel immediately after picking a new
 * password. The voluntary change flow (`changePassword`) is different — it signs out by design.
 * `validateNewPassword` should gate the input before calling this.
 */
export async function setOwnPasswordKeepSession(newPassword: string): Promise<AdminResult<void>> {
  const result = await updatePasswordForCurrentSession(newPassword)
  return result.ok ? ok(undefined) : result
}

/**
 * Clear the `must_change_password` flag on the caller's own profiles row via the
 * `set_own_password_changed()` SECURITY DEFINER RPC. Called after `setOwnPasswordKeepSession`
 * succeeds — the RPC restricts the UPDATE to `auth.uid()` so no other row can be touched.
 */
export async function clearMustChangePassword(): Promise<AdminResult<void>> {
  try {
    const { error } = await getAdminClient().rpc('set_own_password_changed')
    if (error !== null) return err('network', NETWORK_ERROR)
    return ok(undefined)
  } catch {
    return err('network', NETWORK_ERROR)
  }
}

// Pure password-policy checks for the admin auth screens (change password + recovery landing). NO
// effects: the callers in `auth.ts` perform the actual Supabase `updateUser`; this only decides if the
// input is well-formed BEFORE any network round-trip, so the server's own rejection is a fallback, not
// the first line of defence. Kept pure (string in, typed result out) so it is unit-tested in the
// node-env harness with no DOM or client.

/** Matches production Auth config so invite, recovery, and settings reject weak passwords before
 * the network round-trip. */
export const MIN_PASSWORD_LENGTH = 12

/** Result of validating a proposed password — a stable success flag + a human reason on failure. */
export type PasswordCheck = { readonly ok: true } | { readonly ok: false; readonly reason: string }

/**
 * Validate a proposed NEW password against its confirmation and (when changing a known password) the
 * current one. Total — every branch returns a typed `PasswordCheck`, never throws.
 *
 * @param next    the proposed new password
 * @param confirm the re-typed confirmation (must match `next`)
 * @param current the existing password when changing in-place; omit for the recovery flow (unknown)
 */
export function validateNewPassword(
  next: string,
  confirm: string,
  current?: string,
): PasswordCheck {
  if (next.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, reason: `Lösenordet måste vara minst ${MIN_PASSWORD_LENGTH} tecken.` }
  }
  if (
    !/[a-z]/.test(next) ||
    !/[A-Z]/.test(next) ||
    !/\d/.test(next) ||
    !/[^A-Za-z0-9\s]/.test(next)
  ) {
    return {
      ok: false,
      reason: 'Lösenordet måste innehålla liten bokstav, stor bokstav, siffra och symbol.',
    }
  }
  if (/\s/.test(next)) {
    return { ok: false, reason: 'Lösenordet får inte innehålla blanksteg.' }
  }
  if (next !== confirm) {
    return { ok: false, reason: 'Lösenorden matchar inte.' }
  }
  if (current !== undefined && next === current) {
    return { ok: false, reason: 'Nytt lösenord måste skilja sig från det nuvarande.' }
  }
  return { ok: true }
}

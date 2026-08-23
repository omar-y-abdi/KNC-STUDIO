// Pure parser for the Supabase password-recovery landing URL (`/reset`). The admin client uses the
// default `implicit` flow (verified against the installed auth-js), so the recovery email link returns
// the session tokens in the URL HASH:
//   #access_token=...&refresh_token=...&expires_in=...&token_type=bearer&type=recovery
// A PKCE deployment would instead put `?code=...` in the query string. This parser recognises BOTH
// shapes (so the landing page keeps working if the flow ever changes) and reports link errors
// (e.g. an expired link arrives as `#error=access_denied&error_description=...`) explicitly.
//
// Pure: the component reads `window.location` and passes the raw `hash` + `search` strings in; this
// module never touches `window`, so it is unit-tested in the node env.

export type PasswordLinkType = 'recovery' | 'invite'

/** What a password-setup URL resolved to. `tokens` = implicit flow, `code` = PKCE, else error/none. */
export type RecoveryLink =
  | { readonly kind: 'tokens'; readonly accessToken: string; readonly refreshToken: string }
  | { readonly kind: 'code'; readonly code: string }
  | { readonly kind: 'token_hash'; readonly tokenHash: string }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'none' }

/** Drop a single leading `#` or `?` then parse as URL-encoded params. */
function toParams(raw: string): URLSearchParams {
  const trimmed = raw.startsWith('#') || raw.startsWith('?') ? raw.slice(1) : raw
  return new URLSearchParams(trimmed)
}

/**
 * Resolve a recovery landing URL into a typed outcome. Order: hash error → hash recovery tokens →
 * query `code` (PKCE) → query error → none. Total; never throws.
 */
export function parseRecoveryLink(
  hash: string,
  search: string,
  expectedType: PasswordLinkType = 'recovery',
): RecoveryLink {
  const h = toParams(hash)
  const hashError = h.get('error_description') ?? h.get('error')
  if (hashError !== null) return { kind: 'error', message: hashError }

  const accessToken = h.get('access_token')
  const refreshToken = h.get('refresh_token')
  if (accessToken !== null && refreshToken !== null && h.get('type') === expectedType) {
    return { kind: 'tokens', accessToken, refreshToken }
  }

  const q = toParams(search)
  const tokenHash = q.get('token_hash')
  if (tokenHash !== null && tokenHash.trim() !== '' && q.get('type') === expectedType) {
    return { kind: 'token_hash', tokenHash }
  }
  const code = q.get('code')
  if (code !== null) return { kind: 'code', code }
  const queryError = q.get('error_description') ?? q.get('error')
  if (queryError !== null) return { kind: 'error', message: queryError }

  return { kind: 'none' }
}

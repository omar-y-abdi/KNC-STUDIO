// Pure parser for the password-setup landing URLs (`/reset`, `/invite`). An Auth email link carries a
// one-time token hash in the query string:
//   ?token_hash=...&type=recovery
// and a staff invitation carries its capability in the URL HASH (`#staff_invite=...`). Link errors
// (e.g. an expired link arrives as `#error=access_denied&error_description=...`) are reported
// explicitly.
//
// Pure: the component reads `window.location` and passes the raw `hash` + `search` strings in; this
// module never touches `window`, so it is unit-tested in the node env.

export type PasswordLinkType = 'recovery' | 'invite'

/** What a password-setup URL resolved to. */
export type RecoveryLink =
  | { readonly kind: 'staff_invite'; readonly token: string }
  | { readonly kind: 'token_hash'; readonly tokenHash: string }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'none' }

/** Drop a single leading `#` or `?` then parse as URL-encoded params. */
function toParams(raw: string): URLSearchParams {
  const trimmed = raw.startsWith('#') || raw.startsWith('?') ? raw.slice(1) : raw
  return new URLSearchParams(trimmed)
}

/**
 * Resolve a recovery landing URL into a typed outcome. Order: hash error → hash staff invitation →
 * query token hash → query error → none. Total; never throws.
 */
export function parseRecoveryLink(
  hash: string,
  search: string,
  expectedType: PasswordLinkType = 'recovery',
): RecoveryLink {
  const h = toParams(hash)
  const hashError = h.get('error_description') ?? h.get('error')
  if (hashError !== null) return { kind: 'error', message: hashError }

  const staffToken = h.get('staff_invite')
  if (expectedType === 'invite' && staffToken !== null && /^[a-f0-9]{64}$/.test(staffToken)) {
    return { kind: 'staff_invite', token: staffToken }
  }

  const q = toParams(search)
  const tokenHash = q.get('token_hash')
  if (tokenHash !== null && tokenHash.trim() !== '' && q.get('type') === expectedType) {
    return { kind: 'token_hash', tokenHash }
  }
  const queryError = q.get('error_description') ?? q.get('error')
  if (queryError !== null) return { kind: 'error', message: queryError }

  return { kind: 'none' }
}

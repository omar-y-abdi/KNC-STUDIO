/** Parse the branded email-change callback without consuming its one-time token. */
export function parseEmailChangeToken(search: string): string | null {
  const raw = search.startsWith('?') ? search.slice(1) : search
  const params = new URLSearchParams(raw)
  const tokenHash = params.get('token_hash')
  if (params.get('type') !== 'email_change' || tokenHash === null || tokenHash.trim() === '') {
    return null
  }
  return tokenHash
}

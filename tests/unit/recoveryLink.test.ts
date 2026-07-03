import { describe, expect, it } from 'vitest'
import { parseRecoveryLink } from '../../src/admin/recoveryLink'

describe('parseRecoveryLink', () => {
  it('parses implicit-flow recovery tokens from the hash', () => {
    const hash = '#access_token=AT123&refresh_token=RT456&expires_in=3600&token_type=bearer&type=recovery'
    expect(parseRecoveryLink(hash, '')).toEqual({
      kind: 'tokens',
      accessToken: 'AT123',
      refreshToken: 'RT456',
    })
  })

  it('does NOT treat non-recovery token hashes as a recovery link', () => {
    const hash = '#access_token=AT123&refresh_token=RT456&type=signup'
    expect(parseRecoveryLink(hash, '')).toEqual({ kind: 'none' })
  })

  it('requires both tokens to be present', () => {
    expect(parseRecoveryLink('#access_token=AT123&type=recovery', '')).toEqual({ kind: 'none' })
  })

  it('parses a PKCE code from the query string', () => {
    expect(parseRecoveryLink('', '?code=PKCE_CODE_789')).toEqual({ kind: 'code', code: 'PKCE_CODE_789' })
  })

  it('surfaces an expired-link error carried in the hash', () => {
    const hash = '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'
    const r = parseRecoveryLink(hash, '')
    expect(r.kind).toBe('error')
    if (r.kind === 'error') expect(r.message).toContain('expired')
  })

  it('surfaces an error carried in the query string', () => {
    const r = parseRecoveryLink('', '?error=server_error&error_description=boom')
    expect(r.kind).toBe('error')
    if (r.kind === 'error') expect(r.message).toBe('boom')
  })

  it('returns none for an empty URL', () => {
    expect(parseRecoveryLink('', '')).toEqual({ kind: 'none' })
  })

  it('tolerates hash/search with no leading # or ?', () => {
    expect(parseRecoveryLink('access_token=A&refresh_token=B&type=recovery', '')).toEqual({
      kind: 'tokens',
      accessToken: 'A',
      refreshToken: 'B',
    })
  })
})

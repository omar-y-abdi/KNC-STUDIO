import { describe, expect, it } from 'vitest'
import { parseEmailChangeToken } from '../../src/admin/emailChangeLink'

describe('parseEmailChangeToken', () => {
  it('reads an email-change token hash from the branded callback URL', () => {
    expect(parseEmailChangeToken('?token_hash=email-token-123&type=email_change')).toBe(
      'email-token-123',
    )
  })

  it('does not accept another auth action type', () => {
    expect(parseEmailChangeToken('?token_hash=recovery-token&type=recovery')).toBeNull()
  })

  it('rejects missing and blank token hashes', () => {
    expect(parseEmailChangeToken('?type=email_change')).toBeNull()
    expect(parseEmailChangeToken('?token_hash=%20%20&type=email_change')).toBeNull()
  })
})

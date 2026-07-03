import { describe, expect, it } from 'vitest'
import { MIN_PASSWORD_LENGTH, validateNewPassword } from '../../src/admin/passwordPolicy'

describe('validateNewPassword', () => {
  it('rejects a password shorter than the minimum', () => {
    const short = 'a'.repeat(MIN_PASSWORD_LENGTH - 1)
    const r = validateNewPassword(short, short)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain(String(MIN_PASSWORD_LENGTH))
  })

  it('accepts a password exactly at the minimum length', () => {
    const min = 'a'.repeat(MIN_PASSWORD_LENGTH)
    expect(validateNewPassword(min, min)).toEqual({ ok: true })
  })

  it('rejects when confirmation does not match', () => {
    const r = validateNewPassword('secret123', 'secret124')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('Lösenorden matchar inte.')
  })

  it('rejects when the new password equals the current one', () => {
    const r = validateNewPassword('samePass1', 'samePass1', 'samePass1')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('skilja sig')
  })

  it('accepts a valid change that differs from the current password', () => {
    expect(validateNewPassword('newPass99', 'newPass99', 'oldPass11')).toEqual({ ok: true })
  })

  it('ignores the current-password check when current is omitted (recovery flow)', () => {
    expect(validateNewPassword('freshPass1', 'freshPass1')).toEqual({ ok: true })
  })

  it('checks length before the match check (short + mismatched => length reason)', () => {
    const r = validateNewPassword('abc', 'xyz')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('tecken')
  })
})

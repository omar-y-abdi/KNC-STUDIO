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
    const min = 'Aa1!' + 'a'.repeat(MIN_PASSWORD_LENGTH - 4)
    expect(validateNewPassword(min, min)).toEqual({ ok: true })
  })

  it('requires lowercase, uppercase, digit, symbol, and no whitespace', () => {
    for (const weak of [
      'STRONGPASSWORD1!',
      'strongpassword1!',
      'StrongPassword!',
      'StrongPassword1',
      'Strong Pass1!',
    ]) {
      expect(validateNewPassword(weak, weak).ok).toBe(false)
    }
  })

  it('rejects when confirmation does not match', () => {
    const r = validateNewPassword('StrongPass1!', 'StrongPass2!')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('Lösenorden matchar inte.')
  })

  it('rejects when the new password equals the current one', () => {
    const r = validateNewPassword('SamePassword1!', 'SamePassword1!', 'SamePassword1!')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('skilja sig')
  })

  it('accepts a valid change that differs from the current password', () => {
    expect(validateNewPassword('NewPassword99!', 'NewPassword99!', 'OldPassword11!')).toEqual({
      ok: true,
    })
  })

  it('ignores the current-password check when current is omitted (recovery flow)', () => {
    expect(validateNewPassword('FreshPassword1!', 'FreshPassword1!')).toEqual({ ok: true })
  })

  it('checks length before the match check (short + mismatched => length reason)', () => {
    const r = validateNewPassword('abc', 'xyz')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('tecken')
  })
})

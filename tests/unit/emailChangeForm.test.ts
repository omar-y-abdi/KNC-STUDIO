// Unit tests for the pure decisions of the Settings email form (no mocks, no DOM). The view only
// stores what these functions return, so the form's rules are pinned here.

import { describe, expect, it } from 'vitest'
import { adminText } from '../../modules/staff-admin/src/adminStrings'
import type { EmailChangeOutcome } from '../../modules/staff-admin/src/auth'
import {
  afterEmailChange,
  checkEmailChange,
  EMAIL_ERROR_ID,
  passwordFieldAria,
  type EmailFormStatus,
} from '../../modules/staff-admin/src/views/emailChangeForm'

const CURRENT = 'Staff@Example.test'
const LANGS = ['sv', 'en'] as const

describe.each(LANGS)('Settings email form (%s)', (lang) => {
  const t = adminText(lang)

  it.each([
    ['', 'current-password'],
    ['   ', 'current-password'],
    ['not-an-address', 'current-password'],
    ['two words@example.test', 'current-password'],
    // The address is judged first: an empty password does not hide a bad address.
    ['not-an-address', ''],
  ])('refuses the address %j before anything is sent', (newEmail, password) => {
    expect(checkEmailChange({ newEmail, password }, CURRENT, t)).toEqual({
      ok: false,
      status: { kind: 'error', message: t.settingsEmailInvalid },
    })
  })

  it.each([
    ['staff@example.test', 'current-password'],
    ['  STAFF@EXAMPLE.TEST ', 'current-password'],
    ['staff@example.test', ''],
  ])('refuses the current address %j as the new one', (newEmail, password) => {
    expect(checkEmailChange({ newEmail, password }, CURRENT, t)).toEqual({
      ok: false,
      status: { kind: 'error', message: t.settingsEmailSame },
    })
  })

  it('asks for the current password, on its own field, once the address is good', () => {
    expect(checkEmailChange({ newEmail: 'new@example.test', password: '' }, CURRENT, t)).toEqual({
      ok: false,
      status: { kind: 'password_error', message: t.settingsEmailPasswordRequired },
    })
  })

  it('sends the address trimmed and lower-cased and the password as typed', () => {
    expect(
      checkEmailChange({ newEmail: '  New@Example.TEST ', password: ' Pass Word ' }, CURRENT, t),
    ).toEqual({ ok: true, email: 'new@example.test', password: ' Pass Word ' })
    // A password of spaces is a password: only the server can say whether it is the right one.
    expect(checkEmailChange({ newEmail: 'new@example.test', password: ' ' }, CURRENT, t)).toEqual({
      ok: true,
      email: 'new@example.test',
      password: ' ',
    })
  })

  const typed = { newEmail: ' New@Example.test', password: ' Pass Word ' }
  const failed: EmailChangeOutcome = {
    kind: 'error',
    error: { kind: 'validation', message: 'Kunde inte skicka bekräftelsen. Försök igen.' },
  }

  it('empties both fields and reports the sent link only after a success', () => {
    expect(afterEmailChange({ kind: 'sent' }, typed, t)).toEqual({
      fields: { newEmail: '', password: '' },
      status: { kind: 'done' },
    })
  })

  it('marks the password field for a refused password and keeps what was typed', () => {
    expect(afterEmailChange({ kind: 'wrong_password' }, typed, t)).toEqual({
      fields: typed,
      status: { kind: 'password_error', message: t.settingsEmailPasswordWrong },
    })
  })

  it('tells a rate-limited user to wait, in their language, without blaming the password', () => {
    expect(afterEmailChange({ kind: 'rate_limited' }, typed, t)).toEqual({
      fields: typed,
      status: { kind: 'error', message: t.settingsEmailRateLimited },
    })
  })

  it('shows the message of any other failure on the form and keeps what was typed', () => {
    expect(afterEmailChange(failed, typed, t)).toEqual({
      fields: typed,
      status: { kind: 'error', message: 'Kunde inte skicka bekräftelsen. Försök igen.' },
    })
    const offline: EmailChangeOutcome = {
      kind: 'error',
      error: { kind: 'network', message: 'Kunde inte nå servern. Försök igen.' },
    }
    expect(afterEmailChange(offline, typed, t).status).toEqual({
      kind: 'error',
      message: 'Kunde inte nå servern. Försök igen.',
    })
  })

  it('words every state of the form', () => {
    for (const key of [
      'settingsEmailInvalid',
      'settingsEmailSame',
      'settingsEmailPasswordRequired',
      'settingsEmailPasswordWrong',
      'settingsEmailRateLimited',
    ] as const) {
      expect(t[key].trim(), key).not.toBe('')
    }
    expect(new Set([t.settingsEmailPasswordWrong, t.settingsEmailRateLimited]).size).toBe(2)
  })
})

describe('Settings email form wording', () => {
  it('has its own text in each language for the password and the limit', () => {
    const [sv, en] = [adminText('sv'), adminText('en')]
    for (const key of [
      'settingsEmailPasswordRequired',
      'settingsEmailPasswordWrong',
      'settingsEmailRateLimited',
    ] as const) {
      expect(sv[key], key).not.toBe(en[key])
    }
    expect(sv.settingsEmailRateLimited).toBe('Vänta en minut och försök igen.')
    expect(en.settingsEmailRateLimited).toBe('Wait a minute and try again.')
  })
})

describe('current-password field of the Settings email form', () => {
  it('is invalid and described by the form error only for its own error', () => {
    expect(passwordFieldAria({ kind: 'password_error', message: 'x' })).toEqual({
      'aria-invalid': true,
      'aria-describedby': EMAIL_ERROR_ID,
    })
    expect(EMAIL_ERROR_ID).toBe('settings-email-error')
  })

  const others: readonly EmailFormStatus[] = [
    { kind: 'idle' },
    { kind: 'submitting' },
    { kind: 'error', message: 'x' },
    { kind: 'done' },
  ]
  it.each(others)('is not marked while the form is %j', (status) => {
    expect(passwordFieldAria(status)).toEqual({
      'aria-invalid': false,
      'aria-describedby': undefined,
    })
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

const authMocks = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  updateUser: vi.fn(),
  verifyOtp: vi.fn(),
  signOut: vi.fn(),
  invoke: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
}))

vi.mock('../../src/admin/adminClient', () => ({
  getAdminClient: () => ({
    auth: authMocks,
    functions: { invoke: authMocks.invoke },
    from: authMocks.from,
  }),
}))

import {
  changeOwnPassword,
  confirmOwnEmailChange,
  requestPasswordReset,
  requestOwnEmailChange,
  signIn,
} from '../../src/admin/auth'

describe('admin account settings auth', () => {
  beforeEach(() => {
    authMocks.signInWithPassword.mockReset()
    authMocks.updateUser.mockReset()
    authMocks.verifyOtp.mockReset()
    authMocks.signOut.mockReset()
    authMocks.invoke.mockReset()
    authMocks.from.mockReset()
    authMocks.select.mockReset()
    authMocks.eq.mockReset()
    authMocks.maybeSingle.mockReset()
    authMocks.from.mockReturnValue({ select: authMocks.select })
    authMocks.select.mockReturnValue({ eq: authMocks.eq })
    authMocks.eq.mockReturnValue({ maybeSingle: authMocks.maybeSingle })
  })

  it('verifies the current password, updates it and keeps the session', async () => {
    authMocks.signInWithPassword.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    authMocks.updateUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })

    const result = await changeOwnPassword('staff@example.com', 'old-password', 'new-password')

    expect(result).toEqual({ ok: true, value: undefined })
    expect(authMocks.signInWithPassword).toHaveBeenCalledWith({
      email: 'staff@example.com',
      password: 'old-password',
    })
    expect(authMocks.updateUser).toHaveBeenCalledWith({
      current_password: 'old-password',
      password: 'new-password',
    })
    expect(authMocks.signOut).not.toHaveBeenCalled()
  })

  it('rejects a wrong current password before updating', async () => {
    authMocks.signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { message: 'Invalid login credentials' },
    })

    const result = await changeOwnPassword('staff@example.com', 'wrong', 'new-password')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('auth')
    expect(authMocks.updateUser).not.toHaveBeenCalled()
  })

  it('requests a confirmed email change', async () => {
    authMocks.invoke.mockResolvedValue({ data: { ok: true }, error: null })

    const result = await requestOwnEmailChange('new@example.com', 'sv')

    expect(result).toEqual({ ok: true, value: undefined })
    expect(authMocks.invoke).toHaveBeenCalledWith('send-email-change', {
      body: { new_email: 'new@example.com', lang: 'sv' },
    })
  })

  it('surfaces an email-change provider rejection', async () => {
    authMocks.invoke.mockResolvedValue({
      data: { ok: false, error: 'generate_failed' },
      error: null,
    })

    const result = await requestOwnEmailChange('taken@example.com', 'en')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('validation')
  })

  it('sends the password-recovery Turnstile token to the Edge function', async () => {
    authMocks.invoke.mockResolvedValue({ data: { ok: true }, error: null })

    const result = await requestPasswordReset('staff@example.com', 'en', 'challenge-token')

    expect(result).toEqual({ ok: true, value: undefined })
    expect(authMocks.invoke).toHaveBeenCalledWith('send-recovery-email', {
      body: { email: 'staff@example.com', lang: 'en', turnstileToken: 'challenge-token' },
    })
  })

  it('surfaces a generic localized challenge failure for password recovery', async () => {
    authMocks.invoke.mockResolvedValue({
      data: { ok: false, error: 'failed_challenge' },
      error: null,
    })

    const result = await requestPasswordReset('staff@example.com', 'en', 'invalid-token')

    expect(result).toEqual({
      ok: false,
      error: { kind: 'challenge', message: 'The security check failed. Please try again.' },
    })
  })

  it('confirms an email change from its one-time token hash', async () => {
    authMocks.verifyOtp.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })

    const result = await confirmOwnEmailChange('email-change-token')

    expect(result).toEqual({ ok: true, value: undefined })
    expect(authMocks.verifyOtp).toHaveBeenCalledWith({
      token_hash: 'email-change-token',
      type: 'email_change',
    })
  })

  it('rejects an expired email-change token', async () => {
    authMocks.verifyOtp.mockResolvedValue({
      data: { user: null },
      error: { message: 'Email link is invalid or has expired' },
    })

    const result = await confirmOwnEmailChange('expired-token')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('auth')
  })

  it('clears a newly issued session when the staff account is disabled', async () => {
    authMocks.signInWithPassword.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'staff@example.com' } },
      error: null,
    })
    authMocks.maybeSingle.mockResolvedValue({
      data: {
        role: 'barber',
        barber_id: 'hassan',
        must_change_password: false,
        account_enabled: false,
      },
      error: null,
    })
    authMocks.signOut.mockResolvedValue({ error: null })

    const result = await signIn('staff@example.com', 'password')

    expect(result).toEqual({
      ok: false,
      error: { kind: 'forbidden', message: 'Kontot är avstängt. Kontakta ägaren.' },
    })
    expect(authMocks.signOut).toHaveBeenCalledOnce()
    expect(authMocks.select).toHaveBeenCalledWith(
      'role, barber_id, must_change_password, account_enabled',
    )
  })
})

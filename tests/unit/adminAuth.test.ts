import { beforeEach, describe, expect, it, vi } from 'vitest'

const authMocks = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  updateUser: vi.fn(),
  verifyOtp: vi.fn(),
  signOut: vi.fn(),
  getSession: vi.fn(),
  invoke: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
  admin: { signOut: vi.fn() },
  clearStored: vi.fn(),
}))
const passwordMocks = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  updateUser: vi.fn(),
  signOut: vi.fn(),
  setSession: vi.fn(),
  dispose: vi.fn(),
}))

vi.mock('../../src/admin/adminClient', () => ({
  createAdminAuthOperationClient: () => passwordMocks,
  clearStoredAdminSession: authMocks.clearStored,
  getAdminAuthClient: () => ({
    auth: authMocks,
    functions: { invoke: authMocks.invoke },
    from: authMocks.from,
  }),
  getAdminClient: () => ({
    auth: authMocks,
    functions: { invoke: authMocks.invoke },
    from: authMocks.from,
  }),
}))

import {
  changeOwnPassword,
  getActiveProfile,
  confirmOwnEmailChange,
  requestPasswordReset,
  requestOwnEmailChange,
  setOwnPasswordKeepSession,
  signIn,
} from '../../src/admin/auth'
import { invalidateAdminOperations } from '../../src/admin/orderedOperations'

describe('admin account settings auth', () => {
  beforeEach(() => {
    authMocks.signInWithPassword.mockReset()
    authMocks.updateUser.mockReset()
    authMocks.verifyOtp.mockReset()
    authMocks.signOut.mockReset()
    authMocks.getSession.mockReset()
    authMocks.invoke.mockReset()
    authMocks.from.mockReset()
    authMocks.select.mockReset()
    authMocks.eq.mockReset()
    authMocks.maybeSingle.mockReset()
    authMocks.admin.signOut.mockReset()
    authMocks.admin.signOut.mockResolvedValue({ error: null })
    authMocks.clearStored.mockReset()
    for (const mock of Object.values(passwordMocks)) mock.mockReset()
    authMocks.getSession.mockResolvedValue({
      data: {
        session: {
          access_token: 'original-token',
          refresh_token: 'original-refresh',
          user: { id: 'user-1', email: 'staff@example.com' },
        },
      },
      error: null,
    })
    passwordMocks.signOut.mockResolvedValue({ error: null })
    passwordMocks.setSession.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
    authMocks.from.mockReturnValue({ select: authMocks.select })
    authMocks.select.mockReturnValue({ eq: authMocks.eq })
    authMocks.eq.mockReturnValue({ maybeSingle: authMocks.maybeSingle })
  })

  it('verifies the current password, updates it and keeps the session', async () => {
    passwordMocks.signInWithPassword.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    passwordMocks.updateUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })

    const result = await changeOwnPassword('staff@example.com', 'old-password', 'new-password')

    expect(result).toEqual({ ok: true, value: undefined })
    expect(passwordMocks.signInWithPassword).toHaveBeenCalledWith({
      email: 'staff@example.com',
      password: 'old-password',
    })
    expect(passwordMocks.updateUser).toHaveBeenCalledWith({
      current_password: 'old-password',
      password: 'new-password',
    })
    expect(authMocks.signOut).not.toHaveBeenCalled()
    expect(authMocks.signInWithPassword).not.toHaveBeenCalled()
    expect(authMocks.updateUser).not.toHaveBeenCalled()
    expect(passwordMocks.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(passwordMocks.setSession).toHaveBeenCalledWith({
      access_token: 'original-token',
      refresh_token: 'original-refresh',
    })
    expect(passwordMocks.dispose).toHaveBeenCalledOnce()
  })

  it('rejects a wrong current password before updating', async () => {
    passwordMocks.signInWithPassword.mockResolvedValue({
      data: { user: null },
      error: { message: 'Invalid login credentials' },
    })

    const result = await changeOwnPassword('staff@example.com', 'wrong', 'new-password')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('auth')
    expect(authMocks.updateUser).not.toHaveBeenCalled()
    expect(passwordMocks.updateUser).not.toHaveBeenCalled()
  })

  it('never verifies an old Settings form against a different current staff account', async () => {
    const result = await changeOwnPassword('other@example.com', 'old-password', 'new-password')
    expect(result).toMatchObject({ ok: false, error: { kind: 'auth' } })
    expect(passwordMocks.signInWithPassword).not.toHaveBeenCalled()
    expect(passwordMocks.updateUser).not.toHaveBeenCalled()
  })

  it('stops the next password step when the admin operation lifetime has ended', async () => {
    passwordMocks.signInWithPassword.mockImplementation(() => {
      invalidateAdminOperations()
      return Promise.resolve({ data: { user: { id: 'user-1' } }, error: null })
    })
    expect(
      await changeOwnPassword('staff@example.com', 'old-password', 'new-password'),
    ).toMatchObject({ ok: false, error: { kind: 'auth' } })
    expect(passwordMocks.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(passwordMocks.setSession).not.toHaveBeenCalled()
    expect(passwordMocks.updateUser).not.toHaveBeenCalled()
  })

  it('stops an isolated password update after a session switch', async () => {
    passwordMocks.setSession.mockImplementation(() => {
      authMocks.getSession.mockResolvedValue({
        data: { session: { access_token: 'another-session' } },
        error: null,
      })
      return Promise.resolve({ data: {}, error: null })
    })
    expect(await setOwnPasswordKeepSession('new-password')).toMatchObject({
      ok: false,
      error: { kind: 'auth' },
    })
    expect(passwordMocks.updateUser).not.toHaveBeenCalled()
    expect(passwordMocks.dispose).toHaveBeenCalledOnce()
  })

  it('preserves transport failure while checking the password operation owner', async () => {
    passwordMocks.setSession.mockImplementation(() => {
      authMocks.getSession.mockResolvedValue({ data: { session: null }, error: { status: 503 } })
      return Promise.resolve({ data: {}, error: null })
    })
    expect(await setOwnPasswordKeepSession('new-password')).toMatchObject({
      ok: false,
      error: { kind: 'network' },
    })
    expect(passwordMocks.updateUser).not.toHaveBeenCalled()
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
    expect(authMocks.admin.signOut).toHaveBeenCalledWith('original-token', 'global')
    expect(authMocks.clearStored).toHaveBeenCalledWith('user-1')
    expect(authMocks.select).toHaveBeenCalledWith(
      'role, barber_id, must_change_password, account_enabled',
    )
  })

  it('reports revoked access without waiting for network sign-out', async () => {
    authMocks.getSession.mockResolvedValue({
      data: { session: { user: { id: 'user-1', email: 'staff@example.com' } } },
      error: null,
    })
    authMocks.maybeSingle.mockResolvedValue({
      data: { role: 'barber', barber_id: 'a', must_change_password: false, account_enabled: false },
      error: null,
    })
    let release = (): void => undefined
    authMocks.signOut.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve
        }),
    )
    let result: unknown
    const check = getActiveProfile().then((value) => {
      result = value
    })
    try {
      await vi.waitFor(
        () => expect(result).toMatchObject({ ok: false, error: { kind: 'forbidden' } }),
        { timeout: 100 },
      )
      expect(authMocks.signOut).not.toHaveBeenCalled()
    } finally {
      release()
      await check
    }
  })

  it('distinguishes a profile transport failure from confirmed denial', async () => {
    authMocks.getSession.mockResolvedValue({
      data: { session: { user: { id: 'user-1' } } },
      error: null,
    })
    authMocks.maybeSingle.mockResolvedValue({
      data: null,
      error: { message: 'offline' },
      status: 503,
    })
    expect(await getActiveProfile()).toMatchObject({ ok: false, error: { kind: 'network' } })
    authMocks.maybeSingle.mockResolvedValue({
      data: null,
      error: { code: 'PGRST301' },
      status: 401,
    })
    expect(await getActiveProfile()).toMatchObject({ ok: false, error: { kind: 'auth' } })
  })
})

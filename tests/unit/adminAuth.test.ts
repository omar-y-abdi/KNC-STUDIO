import { beforeEach, describe, expect, it, vi } from 'vitest'

const authMocks = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  updateUser: vi.fn(),
  verifyOtp: vi.fn(),
  signOut: vi.fn(),
  invoke: vi.fn(),
}))

vi.mock('../../src/admin/adminClient', () => ({
  getAdminClient: () => ({ auth: authMocks, functions: { invoke: authMocks.invoke } }),
}))

import {
  changeOwnPassword,
  confirmOwnEmailChange,
  requestOwnEmailChange,
} from '../../src/admin/auth'

describe('admin account settings auth', () => {
  beforeEach(() => {
    authMocks.signInWithPassword.mockReset()
    authMocks.updateUser.mockReset()
    authMocks.verifyOtp.mockReset()
    authMocks.signOut.mockReset()
    authMocks.invoke.mockReset()
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
})

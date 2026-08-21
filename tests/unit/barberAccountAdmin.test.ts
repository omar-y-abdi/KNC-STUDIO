import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))

vi.mock('../../src/admin/adminClient', () => ({
  getAdminClient: () => ({ functions: { invoke } }),
}))

import {
  createBarberAccount,
  setBarberAccountAccess,
} from '../../src/admin/adapters/barberAccountAdmin'

beforeEach(() => {
  invoke.mockReset()
})

describe('setBarberAccountAccess', () => {
  it('maps a secure disable result including Auth synchronization state', async () => {
    invoke.mockResolvedValue({
      data: { ok: true, account_enabled: false, auth_sync_pending: true },
      error: null,
    })

    const result = await setBarberAccountAccess('hassan', false)

    expect(result).toEqual({
      ok: true,
      value: { enabled: false, authSyncPending: true },
    })
    expect(invoke).toHaveBeenCalledWith('admin-manage-barber', {
      body: { action: 'set_access', barber_id: 'hassan', enabled: false },
    })
  })

  it('fails closed when a linked account is missing', async () => {
    invoke.mockResolvedValue({ data: { ok: false, error: 'not_linked' }, error: null })

    const result = await setBarberAccountAccess('hassan', true)

    expect(result).toMatchObject({ ok: false, error: { kind: 'not_found' } })
  })
})

describe('createBarberAccount', () => {
  it('accepts a successful create or resend response', async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null })

    const result = await createBarberAccount('barber@example.com', 'hassan', 'sv')

    expect(result.ok).toBe(true)
    expect(invoke).toHaveBeenCalledWith('admin-create-barber', {
      body: { email: 'barber@example.com', barber_id: 'hassan', lang: 'sv' },
    })
  })

  it.each([
    ['account_active', 'Kontot är redan aktiverat.'],
    ['email_mismatch', 'Ange e-postadressen som är kopplad till kontot.'],
  ])('maps %s to a non-leaky validation error', async (code, message) => {
    invoke.mockResolvedValue({ data: { ok: false, error: code }, error: null })

    const result = await createBarberAccount('barber@example.com', 'hassan', 'sv')

    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'validation', message },
    })
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))

vi.mock('../../src/admin/adminClient', () => ({
  getAdminClient: () => ({ functions: { invoke } }),
}))

import { createBarberAccount } from '../../src/admin/adapters/barberAccountAdmin'

beforeEach(() => {
  invoke.mockReset()
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

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))

vi.mock('../../src/backend/supabaseClient', () => ({
  getSupabase: () => ({ functions: { invoke } }),
}))

import { invokePublicBookingAction } from '../../src/backend/publicBookingActions'
import { bookingLookupResponse, parseWith } from '../../src/backend/rpcSchemas'

beforeEach(() => invoke.mockReset())

describe('public booking action gateway client', () => {
  it('accepts current email-delivery lookup rows and rejects legacy SMS semantics', () => {
    const booking = {
      id: '4d3f88f7-5e08-4d03-abfa-9604816f5614',
      barber_id: 'hassan',
      service_name: 'Hårklippning',
      price: 350,
      start_at: '2040-03-14T12:30:00.000Z',
      method: 'email',
      contact: '0701234567',
    }
    expect(parseWith(bookingLookupResponse, { ok: true, booking }).ok).toBe(true)
    expect(
      parseWith(bookingLookupResponse, {
        ok: true,
        booking: { ...booking, method: 'sms' },
      }).ok,
    ).toBe(false)
  })

  it('forwards protected action payloads unchanged', async () => {
    const payload = {
      action: 'cancel' as const,
      bookingId: '4d3f88f7-5e08-4d03-abfa-9604816f5614',
      phone: '0701234567',
      turnstileToken: 'challenge-token',
    }
    invoke.mockResolvedValue({ data: { ok: true }, error: null })

    await expect(invokePublicBookingAction(payload)).resolves.toEqual({
      data: { ok: true },
      failed: false,
    })
    expect(invoke).toHaveBeenCalledWith('public-booking-actions', { body: payload })
  })

  it('fails closed on function and transport errors', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: new Error('denied') })
    await expect(
      invokePublicBookingAction({
        action: 'lookup',
        phone: '0701234567',
        turnstileToken: 'challenge-token',
      }),
    ).resolves.toEqual({ data: null, failed: true })

    invoke.mockRejectedValueOnce(new Error('offline'))
    await expect(
      invokePublicBookingAction({
        action: 'list',
        phone: '0701234567',
        turnstileToken: 'challenge-token',
      }),
    ).resolves.toEqual({ data: null, failed: true })
  })
})

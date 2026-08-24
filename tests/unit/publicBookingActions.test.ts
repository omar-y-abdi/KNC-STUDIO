import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))

vi.mock('../../src/backend/supabaseClient', () => ({
  getSupabase: () => ({ functions: { invoke } }),
}))

import { invokePublicBookingAction } from '../../src/backend/publicBookingActions'
import {
  customerAccessExchangeResponse,
  customerAccessRequestResponse,
  customerBookingCancelResponse,
  listCustomerBookingsResponse,
  parseWith,
} from '../../src/backend/rpcSchemas'

beforeEach(() => invoke.mockReset())

describe('public booking action gateway client', () => {
  it('accepts every secure customer-access response contract', () => {
    expect(parseWith(customerAccessRequestResponse, { ok: true }).ok).toBe(true)
    expect(
      parseWith(customerAccessExchangeResponse, {
        ok: true,
        access_token: 'a'.repeat(64),
      }).ok,
    ).toBe(true)
    expect(
      parseWith(listCustomerBookingsResponse, {
        ok: true,
        bookings: [
          {
            id: '4d3f88f7-5e08-4d03-abfa-9604816f5614',
            barber_id: 'hassan',
            service_name: 'Hårklippning',
            price: 350,
            duration_min: 45,
            start_at: '2040-03-14T12:30:00.000Z',
          },
        ],
      }).ok,
    ).toBe(true)
    expect(parseWith(customerBookingCancelResponse, { ok: true }).ok).toBe(true)
  })

  it('forwards protected action payloads unchanged', async () => {
    const payload = {
      action: 'request_access' as const,
      email: 'customer@example.com',
      lang: 'sv' as const,
      turnstileToken: 'challenge-token',
    }
    invoke.mockResolvedValue({ data: { ok: true }, error: null })

    await expect(invokePublicBookingAction(payload)).resolves.toEqual({
      data: { ok: true },
      failed: false,
    })
    expect(invoke).toHaveBeenCalledWith('public-booking-actions', { body: payload })
  })

  it.each(['failed_challenge', 'rate_limited'] as const)(
    'accepts gateway access-request error %s',
    (error) => {
      expect(parseWith(customerAccessRequestResponse, { ok: false, error }).ok).toBe(true)
    },
  )

  it.each(['invalid'] as const)('accepts gateway exchange error %s', (error) => {
    expect(parseWith(customerAccessExchangeResponse, { ok: false, error }).ok).toBe(true)
  })

  it.each(['access_denied'] as const)('accepts gateway list and cancel error %s', (error) => {
    expect(parseWith(listCustomerBookingsResponse, { ok: false, error }).ok).toBe(true)
    expect(parseWith(customerBookingCancelResponse, { ok: false, error }).ok).toBe(true)
  })

  it('fails closed on function and transport errors', async () => {
    invoke.mockResolvedValueOnce({ data: null, error: new Error('denied') })
    await expect(
      invokePublicBookingAction({
        action: 'exchange_access',
        accessCode: 'a'.repeat(64),
      }),
    ).resolves.toEqual({ data: null, failed: true })

    invoke.mockRejectedValueOnce(new Error('offline'))
    await expect(
      invokePublicBookingAction({
        action: 'list',
        accessToken: 'b'.repeat(64),
      }),
    ).resolves.toEqual({ data: null, failed: true })

    invoke.mockRejectedValueOnce(new Error('offline'))
    await expect(
      invokePublicBookingAction({
        action: 'request_access',
        email: 'customer@example.com',
        lang: 'sv',
        turnstileToken: 'challenge-token',
      }),
    ).resolves.toEqual({ data: null, failed: true })
  })
})

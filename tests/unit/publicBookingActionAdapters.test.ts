import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invokePublicBookingAction } = vi.hoisted(() => ({
  invokePublicBookingAction: vi.fn(),
}))

vi.mock('../../src/backend/publicBookingActions', () => ({ invokePublicBookingAction }))

import { supabaseMyBookingsAdapter } from '../../src/mybookings/adapters/supabaseMyBookings'
import type { MyBooking } from '../../src/mybookings/domain'

const myBooking: MyBooking = {
  id: '4d3f88f7-5e08-4d03-abfa-9604816f5614',
  barber: { id: 'hassan', name: 'Hassan', ig: '' },
  serviceName: 'Klippning',
  price: 350,
  durationMin: 45,
  start: new Date('2040-03-14T12:30:00.000Z'),
  whenLabel: '14 mars, 13:30',
}

describe('public booking action adapter errors', () => {
  beforeEach(() => invokePublicBookingAction.mockReset())

  it.each(['failed_challenge', 'rate_limited'] as const)(
    'preserves access-request gateway error %s',
    async (error) => {
      invokePublicBookingAction.mockResolvedValue({ data: { ok: false, error }, failed: false })

      await expect(
        supabaseMyBookingsAdapter.requestAccess({
          phone: '0701234567',
          email: 'customer@example.com',
          lang: 'sv',
          turnstileToken: 'challenge',
        }),
      ).resolves.toEqual({ ok: false, error })
    },
  )

  it.each(['invalid'] as const)('preserves access-exchange gateway error %s', async (error) => {
    invokePublicBookingAction.mockResolvedValue({ data: { ok: false, error }, failed: false })

    await expect(supabaseMyBookingsAdapter.exchangeAccess('a'.repeat(64))).resolves.toEqual({
      ok: false,
      error,
    })
  })

  it.each(['access_denied'] as const)(
    'preserves scoped list and cancellation gateway error %s',
    async (error) => {
      invokePublicBookingAction.mockResolvedValue({ data: { ok: false, error }, failed: false })

      await expect(
        supabaseMyBookingsAdapter.list({ accessToken: 'a'.repeat(64), lang: 'sv' }),
      ).resolves.toEqual({ ok: false, error })
      await expect(supabaseMyBookingsAdapter.cancel(myBooking, 'a'.repeat(64))).resolves.toEqual({
        ok: false,
        error,
      })
    },
  )
})

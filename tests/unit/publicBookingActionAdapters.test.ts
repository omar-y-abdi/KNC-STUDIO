import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { invokePublicBookingAction } = vi.hoisted(() => ({
  invokePublicBookingAction: vi.fn(),
}))

vi.mock('../../src/backend/publicBookingActions', () => ({
  invokePublicBookingAction,
}))

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
  afterEach(() => vi.unstubAllGlobals())

  it('confirms the HttpOnly session without persisting the direct token in browser storage', async () => {
    const values = new Map<string, string>()
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    })
    const token = 'a'.repeat(64)
    invokePublicBookingAction.mockResolvedValue({
      data: {
        ok: true,
        session_proof: 'a'.repeat(64),
        phone: '0701234567',
        bookings: [],
      },
      failed: false,
    })

    await expect(
      supabaseMyBookingsAdapter.list({ accessToken: token, lang: 'sv' }),
    ).resolves.toEqual({
      ok: true,
      bookings: { upcoming: [], past: [] },
      profile: { name: '', phone: '0701234567', email: '' },
    })
    expect(invokePublicBookingAction).toHaveBeenCalledTimes(2)
    expect(invokePublicBookingAction).toHaveBeenLastCalledWith({ action: 'list' })
    expect(values.size).toBe(0)
  })

  it.each(['failed_challenge', 'rate_limited'] as const)(
    'preserves access-request gateway error %s',
    async (error) => {
      invokePublicBookingAction.mockResolvedValue({ data: { ok: false, error }, failed: false })

      await expect(
        supabaseMyBookingsAdapter.requestAccess({
          email: 'customer@example.com',
          lang: 'sv',
          turnstileToken: 'challenge',
        }),
      ).resolves.toEqual({ ok: false, error })
      expect(invokePublicBookingAction).toHaveBeenLastCalledWith({
        action: 'request_access',
        email: 'customer@example.com',
        lang: 'sv',
        turnstileToken: 'challenge',
      })
    },
  )

  it.each(['direct', 'legacy'] as const)(
    'rejects a retained old cookie after %s link authentication',
    async (kind) => {
      const newlyAuthenticated = {
        ok: true,
        session_proof: 'b'.repeat(64),
        phone: '0701234567',
        email: 'new@example.test',
        bookings: [],
      }
      invokePublicBookingAction
        .mockResolvedValueOnce({ data: newlyAuthenticated, failed: false })
        .mockResolvedValueOnce({
          data: { ...newlyAuthenticated, session_proof: 'a'.repeat(64) },
          failed: false,
        })
      // Even matching profile details are insufficient: the exact newly minted session must win.
      const result =
        kind === 'direct'
          ? supabaseMyBookingsAdapter.list({ accessToken: 'c'.repeat(64), lang: 'sv' })
          : supabaseMyBookingsAdapter.exchangeAccess('c'.repeat(64))
      await expect(result).resolves.toEqual({ ok: false, error: 'cookies_disabled' })
      expect(invokePublicBookingAction).toHaveBeenLastCalledWith({ action: 'list' })
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

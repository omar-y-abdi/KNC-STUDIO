import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../src/backend/config', () => ({
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_ANON_KEY: 'test-anon-key',
}))

import { invokePublicBookingAction } from '../../src/backend/publicBookingActions'
import { supabaseBookingAdapter } from '../../src/booking/adapters/supabaseBooking'
import { asBarberId, type Booking } from '../../src/booking/domain'
import {
  customerAccessExchangeResponse,
  customerAccessRequestResponse,
  customerBookingCancelResponse,
  listCustomerBookingsResponse,
  parseWith,
} from '../../src/backend/rpcSchemas'

afterEach(() => vi.unstubAllGlobals())

describe('public booking action gateway client', () => {
  it('accepts every secure customer-access response contract', () => {
    expect(parseWith(customerAccessRequestResponse, { ok: true }).ok).toBe(true)
    expect(
      parseWith(customerAccessExchangeResponse, {
        ok: true,
        session_proof: 'a'.repeat(64),
      }).ok,
    ).toBe(true)
    expect(
      parseWith(listCustomerBookingsResponse, {
        ok: true,
        session_proof: 'a'.repeat(64),
        phone: '0701234567',
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
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)

    await expect(invokePublicBookingAction(payload)).resolves.toEqual({
      data: { ok: true },
      failed: false,
    })
    expect(fetch).toHaveBeenCalledWith(
      '/api/customer-bookings',
      expect.objectContaining({
        method: 'POST',
        credentials: 'same-origin',
        body: JSON.stringify(payload),
      }),
    )
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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(new Response('', { status: 403 })))
    await expect(
      invokePublicBookingAction({
        action: 'exchange_access',
        accessCode: 'a'.repeat(64),
      }),
    ).resolves.toEqual({ data: null, failed: true })

    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('offline')))
    await expect(
      invokePublicBookingAction({
        action: 'list',
        accessToken: 'b'.repeat(64),
      }),
    ).resolves.toEqual({ data: null, failed: true })

    vi.stubGlobal('fetch', vi.fn().mockRejectedValueOnce(new Error('offline')))
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

describe('booking receipt registration', () => {
  const bookingId = '4d3f88f7-5e08-4d03-abfa-9604816f5614'
  const proof = 'a'.repeat(64)
  const booking: Booking = {
    barber: { id: asBarberId('receipt-test'), name: 'Receipt Test', ig: '' },
    service: { id: 'service', name: 'Haircut', price: 300, dur: 30 },
    start: new Date(2040, 2, 14, 13, 30),
    end: new Date(2040, 2, 14, 14),
    customerName: 'Receipt Test',
    phone: '0701234567',
    email: 'receipt@example.test',
    lang: 'sv',
    turnstileToken: 'challenge',
  }
  const row = {
    id: bookingId,
    barber_id: 'receipt-test',
    service_name: 'Haircut',
    price: 300,
    duration_min: 30,
    start_at: '2040-03-14T12:30:00.000Z',
  }
  function browser(cookie: string, lock = true): void {
    vi.stubGlobal('document', { cookie })
    vi.stubGlobal(
      'navigator',
      lock ? { locks: { request: (_name: string, task: () => Promise<unknown>) => task() } } : {},
    )
  }
  function success(receipt = true): Response {
    return Response.json({
      ok: true,
      booking: { id: bookingId },
      ...(receipt ? { receipt_proof: proof } : {}),
    })
  }

  it.each(['', 'bladeblend_storage_preferences=essential'])(
    'does not automatically remember without accepted storage (%s)',
    async (cookie) => {
      browser(cookie)
      const fetch = vi.fn<typeof globalThis.fetch>(async () => success())
      vi.stubGlobal('fetch', fetch)
      expect(await supabaseBookingAdapter.submit(booking)).toMatchObject({
        ok: true,
        customerAccess: 'email',
      })
      expect(fetch).toHaveBeenCalledOnce()
      expect(JSON.parse(fetch.mock.calls[0]?.[1]?.body as string).rememberBookings).toBe(false)
    },
  )

  it('books safely without Web Locks and does not promise receipt retention', async () => {
    browser('bladeblend_storage_preferences=functional', false)
    const fetch = vi.fn<typeof globalThis.fetch>(async () => success())
    vi.stubGlobal('fetch', fetch)
    expect(await supabaseBookingAdapter.submit(booking)).toMatchObject({
      ok: true,
      customerAccess: 'email',
    })
    expect(JSON.parse(fetch.mock.calls[0]?.[1]?.body as string).rememberBookings).toBe(false)
  })

  it('confirms the exact receipt and new booking through the first-party cookie', async () => {
    browser('bladeblend_storage_preferences=functional')
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(success())
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          authority: 'device',
          session_proof: proof,
          receipt_proof: proof,
          bookings: [row],
        }),
      )
    vi.stubGlobal('fetch', fetch)
    expect(await supabaseBookingAdapter.submit(booking)).toMatchObject({
      ok: true,
      customerAccess: 'ready',
    })
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      '/api/bookings',
      expect.objectContaining({ credentials: 'same-origin' }),
    )
    expect(JSON.parse(fetch.mock.calls[0]?.[1]?.body as string).rememberBookings).toBe(true)
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      '/api/customer-bookings',
      expect.objectContaining({ body: '{"action":"list"}' }),
    )
  })

  it.each([
    { receipt_proof: 'b'.repeat(64), bookings: [row] },
    { receipt_proof: proof, bookings: [] },
    { receipt_proof: undefined, bookings: [row] },
  ])('does not mistake an old full session for the intended receipt', async (observed) => {
    browser('bladeblend_storage_preferences=functional')
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(success())
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          authority: 'verified',
          session_proof: proof,
          phone: '0701234567',
          ...observed,
        }),
      )
    vi.stubGlobal('fetch', fetch)
    expect(await supabaseBookingAdapter.submit(booking)).toMatchObject({
      ok: true,
      customerAccess: 'email',
    })
    expect(fetch).toHaveBeenCalledTimes(2)
  })

  it('preserves successful booking when receipt setup or proof fails', async () => {
    browser('bladeblend_storage_preferences=functional')
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(success(false))
      .mockResolvedValueOnce(success())
      .mockRejectedValueOnce(new Error('cookie proof offline'))
    vi.stubGlobal('fetch', fetch)
    expect(await supabaseBookingAdapter.submit(booking)).toMatchObject({
      ok: true,
      customerAccess: 'email',
    })
    expect(fetch).toHaveBeenCalledOnce()
    expect(await supabaseBookingAdapter.submit(booking)).toMatchObject({
      ok: true,
      customerAccess: 'email',
    })
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(fetch.mock.calls.filter(([url]) => url === '/api/bookings')).toHaveLength(2)
  })

  it('falls back before a denied lock without submitting twice', async () => {
    browser('bladeblend_storage_preferences=functional')
    vi.stubGlobal('navigator', {
      locks: { request: () => Promise.reject(new Error('lock denied')) },
    })
    const fetch = vi.fn<typeof globalThis.fetch>(async () => success())
    vi.stubGlobal('fetch', fetch)
    expect(await supabaseBookingAdapter.submit(booking)).toMatchObject({
      ok: true,
      customerAccess: 'email',
    })
    expect(fetch).toHaveBeenCalledOnce()
  })
})

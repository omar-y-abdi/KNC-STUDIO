import { describe, it, expect } from 'vitest'
import { makeMockMyBookingsAdapter } from '../../src/mybookings/adapters/mockMyBookings'
import { asBarberId } from '../../src/booking/domain'

// Pin "today" so the demo history is deterministic (no real clock). 2026-06-19 is a Friday.
const fixedClock = (): Date => new Date(2026, 5, 19)
const adapter = makeMockMyBookingsAdapter(fixedClock)

describe('mockMyBookingsAdapter', () => {
  it('issues access then lists an honest empty offline history', async () => {
    await expect(
      adapter.requestAccess({
        email: 'customer@example.com',
        lang: 'sv',
        turnstileToken: 'test',
      }),
    ).resolves.toEqual({ ok: true })
    const r = await adapter.list({ accessToken: 'mock-customer-access', lang: 'sv' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.bookings.upcoming).toEqual([])
      expect(r.bookings.past).toEqual([])
    }
  })

  it('exchanges a one-time access link for a scoped demo session', async () => {
    await expect(adapter.exchangeAccess('a'.repeat(64))).resolves.toEqual({
      ok: true,
      accessToken: 'mock-customer-access',
    })
  })

  it('cancel() resolves ok, echoing the id', async () => {
    const target = {
      id: 'test-booking',
      barber: { id: asBarberId('test'), name: 'Test', ig: '' },
      serviceName: 'Test',
      price: 100,
      durationMin: 30,
      start: new Date('2040-01-01T10:00:00Z'),
      whenLabel: 'Test',
    }
    const c = await adapter.cancel(target, 'mock-customer-access')
    expect(c.ok).toBe(true)
    if (c.ok) expect(c.id).toBe(target.id)
  })
})

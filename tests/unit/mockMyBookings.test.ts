import { describe, it, expect } from 'vitest'
import { makeMockMyBookingsAdapter } from '../../src/mybookings/adapters/mockMyBookings'

// Pin "today" so the demo history is deterministic (no real clock). 2026-06-19 is a Friday.
const fixedClock = (): Date => new Date(2026, 5, 19)
const adapter = makeMockMyBookingsAdapter(fixedClock)

describe('mockMyBookingsAdapter', () => {
  it('issues access then lists a demo history split into upcoming + past', async () => {
    await expect(
      adapter.requestAccess({
        phone: '0701234567',
        email: 'customer@example.com',
        lang: 'sv',
        turnstileToken: 'test',
      }),
    ).resolves.toEqual({ ok: true })
    const r = await adapter.list({ accessToken: 'mock-customer-access', lang: 'sv' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.bookings.upcoming).toHaveLength(3)
      expect(r.bookings.past).toHaveLength(4)

      // Upcoming ascending, past descending.
      const ups = r.bookings.upcoming.map((b) => b.start.getTime())
      expect(ups).toEqual([...ups].sort((a, b) => a - b))
      const pasts = r.bookings.past.map((b) => b.start.getTime())
      expect(pasts).toEqual([...pasts].sort((a, b) => b - a))

      // Rows carry displayable content.
      const first = r.bookings.upcoming[0]
      expect(first?.whenLabel.length).toBeGreaterThan(0)
      expect(first?.barber.name.length).toBeGreaterThan(0)
      expect(first?.price).toBeGreaterThan(0)
    }
  })

  it('exchanges a one-time access link for a scoped demo session', async () => {
    await expect(adapter.exchangeAccess('a'.repeat(64))).resolves.toEqual({
      ok: true,
      accessToken: 'mock-customer-access',
    })
  })

  it('cancel() resolves ok, echoing the id', async () => {
    const r = await adapter.list({ accessToken: 'mock-customer-access', lang: 'en' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      const target = r.bookings.upcoming[0]
      expect(target).toBeDefined()
      if (target) {
        const c = await adapter.cancel(target, 'mock-customer-access')
        expect(c.ok).toBe(true)
        if (c.ok) expect(c.id).toBe(target.id)
      }
    }
  })
})

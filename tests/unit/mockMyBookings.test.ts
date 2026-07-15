import { describe, it, expect } from 'vitest'
import { makeMockMyBookingsAdapter } from '../../src/mybookings/adapters/mockMyBookings'

// Pin "today" so the demo history is deterministic (no real clock). 2026-06-19 is a Friday.
const fixedClock = (): Date => new Date(2026, 5, 19)
const adapter = makeMockMyBookingsAdapter(fixedClock)

describe('mockMyBookingsAdapter', () => {
  it('lists a demo history split into upcoming + past for a known number', async () => {
    const r = await adapter.listByPhone({ contact: '0701234567', lang: 'sv' })
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

  it('returns not_found for the reserved unknown demo number (normalising spaces)', async () => {
    const r = await adapter.listByPhone({ contact: '070 000 00 00', lang: 'sv' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('not_found')
  })

  it('cancel() resolves ok, echoing the id', async () => {
    const r = await adapter.listByPhone({ contact: '0701234567', lang: 'en' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      const target = r.bookings.upcoming[0]
      expect(target).toBeDefined()
      if (target) {
        const c = await adapter.cancel(target, '0701234567')
        expect(c.ok).toBe(true)
        if (c.ok) expect(c.id).toBe(target.id)
      }
    }
  })
})

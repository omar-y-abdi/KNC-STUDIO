import { describe, it, expect } from 'vitest'
import { makeMockCancellationAdapter } from '../../src/cancellation/adapters/mockCancellation'

// Pin "today" so the looked-up demo appointment is deterministic (no real clock).
const fixedClock = (): Date => new Date(2026, 5, 19)
const adapter = makeMockCancellationAdapter(fixedClock)

describe('mockCancellationAdapter', () => {
  it('lookup() resolves a plausible upcoming booking for the contact (phone)', async () => {
    const r = await adapter.lookup({ contact: '0701234567', lang: 'sv' })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.booking.barber.name.length).toBeGreaterThan(0)
      expect(r.booking.serviceName.length).toBeGreaterThan(0)
      expect(r.booking.price).toBeGreaterThan(0)
      expect(r.booking.whenLabel.length).toBeGreaterThan(0)
      expect(r.booking.contact).toBe('0701234567')
      // Lands on the next open day after the fixed Friday → Monday 2026-06-22.
      expect(r.booking.start.getDate()).toBe(22)
    }
  })

  it('cancel() resolves ok and echoes the booking', async () => {
    const lookup = await adapter.lookup({ contact: '0709999999', lang: 'en' })
    expect(lookup.ok).toBe(true)
    if (lookup.ok) {
      const cancelled = await adapter.cancel(lookup.booking)
      expect(cancelled.ok).toBe(true)
      if (cancelled.ok) expect(cancelled.booking.id).toBe(lookup.booking.id)
    }
  })
})

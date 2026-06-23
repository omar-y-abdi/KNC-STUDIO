// Cancellation adapter ↔ live stack. Seeds a booking through the booking adapter, then drives
// `supabaseCancellationAdapter`: lookup(correct contact) finds it → cancel → re-lookup not_found;
// and lookup(WRONG contact) → not_found (the contact-proving security guarantee). Truncates first.

import { beforeEach, describe, expect, it } from 'vitest'
import { supabaseBookingAdapter } from '../../src/booking/adapters/supabaseBooking'
import { supabaseCancellationAdapter } from '../../src/cancellation/adapters/supabaseCancellation'
import { BARBERS } from '../../src/booking/barbers'
import type { Barber, Booking, ServiceItem } from '../../src/booking/domain'
import { backendReady, readStackEnv, truncateAll, uniquePhone } from './_helpers'

const HASSAN: Barber = BARBERS[0] ?? { id: 'hassan', name: 'Hassan', ig: 'freebandzcuts' }
const HAIRCUT: ServiceItem = { id: 'h', name: 'Hårklippning', price: 350, dur: 45 }

/** A future SMS booking for `phone` on a fixed far-future local slot. */
function smsBooking(phone: string): Booking {
  const start = new Date(2041, 4, 9, 11, 15) // 2041-05-09 11:15 local
  const end = new Date(start.getTime() + HAIRCUT.dur * 60000)
  return {
    barber: HASSAN,
    service: HAIRCUT,
    start,
    end,
    confirmMethod: 'sms',
    customerName: 'Cancel Tester',
    phone,
    email: '',
    lang: 'sv',
  }
}

describe.skipIf(!backendReady())('supabaseCancellationAdapter (integration)', () => {
  beforeEach(async () => {
    const env = readStackEnv()
    if (env) await truncateAll(env.dbUrl)
  })

  it('lookup(correct contact) finds the booking, cancel cancels it, re-lookup is not_found', async () => {
    const phone = uniquePhone()
    const created = await supabaseBookingAdapter.submit(smsBooking(phone))
    expect(created.ok).toBe(true)

    const found = await supabaseCancellationAdapter.lookup({ contact: phone, method: 'sms', lang: 'sv' })
    expect(found.ok).toBe(true)
    if (!found.ok) return
    expect(found.booking.barber.id).toBe(HASSAN.id)
    expect(found.booking.serviceName).toBe(HAIRCUT.name)
    expect(found.booking.contact).toBe(phone)
    // whenLabel mirrors buildDemoBooking's format: "Weekday D Month, HH:MM" (zero-padded time).
    expect(found.booking.whenLabel).toContain('11:15')

    const cancelled = await supabaseCancellationAdapter.cancel(found.booking)
    expect(cancelled.ok).toBe(true)

    // Idempotent: the booking is now cancelled → no longer found.
    const again = await supabaseCancellationAdapter.lookup({ contact: phone, method: 'sms', lang: 'sv' })
    expect(again.ok).toBe(false)
  })

  it('lookup(WRONG contact) returns not_found (cannot find someone else’s booking)', async () => {
    const realPhone = uniquePhone()
    const created = await supabaseBookingAdapter.submit(smsBooking(realPhone))
    expect(created.ok).toBe(true)

    // A different, non-matching phone must never surface the existing booking.
    const wrong = uniquePhone()
    const result = await supabaseCancellationAdapter.lookup({ contact: wrong, method: 'sms', lang: 'sv' })
    expect(result.ok).toBe(false)
  })
})

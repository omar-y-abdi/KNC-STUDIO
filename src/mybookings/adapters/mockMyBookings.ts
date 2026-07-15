// The offline (mock) MyBookingsPort adapter: no network, NOTHING PERSISTED.
//
//  - `listByPhone()` returns the deterministic demo history (`buildDemoMyBookings`) split into
//    upcoming/past around the injected clock — for EVERY validly-formatted number except a reserved
//    sentinel, which returns `not_found` so the "unknown number" + escalation states are demoable
//    offline.
//  - `cancel()` always resolves `ok`, echoing the id. No state is mutated; a reload forgets it.
//
// The clock is injected (default: env-selected `defaultClock`), mirroring the mock cancellation
// adapter, so under VITE_CLOCK=fixed the split is deterministic and the adapter is unit-testable.

import { defaultClock } from '../../config'
import type { Clock } from '../../config'
import { normalizePhone } from '../../booking/validation'
import { buildDemoMyBookings } from '../demoMyBookings'
import type { MyBooking, MyBookingsResult, MyCancelResult } from '../domain'
import { splitByTime } from '../format'
import type { MyBookingsLookupParams, MyBookingsPort } from '../port'

/** A reserved demo number that returns "no bookings" so the not-found + escalation states can be
 * exercised offline; every other validly-formatted number returns the demo history. */
const DEMO_UNKNOWN = '0700000000'

export function makeMockMyBookingsAdapter(clock: Clock = defaultClock): MyBookingsPort {
  return {
    listByPhone(params: MyBookingsLookupParams): Promise<MyBookingsResult> {
      if (normalizePhone(params.contact) === DEMO_UNKNOWN) {
        return Promise.resolve({ ok: false, error: 'not_found' })
      }
      const all = buildDemoMyBookings(clock(), params.lang)
      return Promise.resolve({ ok: true, bookings: splitByTime(all, clock()) })
    },
    cancel(booking: MyBooking): Promise<MyCancelResult> {
      return Promise.resolve({ ok: true, id: booking.id })
    },
  }
}

/** The default mock adapter wired into the UI (real clock in production). */
export const mockMyBookingsAdapter: MyBookingsPort = makeMockMyBookingsAdapter()

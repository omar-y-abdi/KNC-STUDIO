// The offline (mock) MyBookingsPort adapter: no network, NOTHING PERSISTED.
//
//  - `requestAccess()` and `exchangeAccess()` issue a deterministic opaque session. `list()` returns
//    deterministic demo history (`buildDemoMyBookings`) split around the injected clock.
//  - `cancel()` always resolves `ok`, echoing the id. No state is mutated; a reload forgets it.
//
// The clock is injected (default: env-selected `defaultClock`) so the split remains unit-testable.

import { defaultClock } from '../../config'
import type { Clock } from '../../config'
import { buildDemoMyBookings } from '../demoMyBookings'
import type { MyBooking, MyBookingsResult, MyCancelResult } from '../domain'
import { splitByTime } from '../format'
import type {
  MyBookingsAccessExchangeResult,
  MyBookingsAccessRequestResult,
  MyBookingsListParams,
  MyBookingsPort,
} from '../port'

export function makeMockMyBookingsAdapter(clock: Clock = defaultClock): MyBookingsPort {
  return {
    requestAccess(): Promise<MyBookingsAccessRequestResult> {
      return Promise.resolve({ ok: true })
    },
    exchangeAccess(): Promise<MyBookingsAccessExchangeResult> {
      return Promise.resolve({ ok: true, accessToken: 'mock-customer-access' })
    },
    list(params: MyBookingsListParams): Promise<MyBookingsResult> {
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

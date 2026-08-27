// The offline (mock) MyBookingsPort adapter: no network, NOTHING PERSISTED.
//
//  - `requestAccess()` and `exchangeAccess()` issue a deterministic opaque session. `list()` returns
//    an honest empty history; no real-looking customer or barber data is fabricated.
//  - `cancel()` always resolves `ok`, echoing the id. No state is mutated; a reload forgets it.
//
// The clock is injected (default: env-selected `defaultClock`) so the split remains unit-testable.

import { defaultClock } from '../../config'
import type { Clock } from '../../config'
import type { MyBooking, MyBookingsResult, MyCancelResult } from '../domain'
import type {
  MyBookingsAccessExchangeResult,
  MyBookingsAccessRequestResult,
  MyBookingsListParams,
  MyBookingsPort,
} from '../port'

export function makeMockMyBookingsAdapter(clock: Clock = defaultClock): MyBookingsPort {
  void clock
  return {
    requestAccess(): Promise<MyBookingsAccessRequestResult> {
      return Promise.resolve({ ok: true })
    },
    exchangeAccess(): Promise<MyBookingsAccessExchangeResult> {
      return Promise.resolve({ ok: true, accessToken: 'mock-customer-access' })
    },
    list(params: MyBookingsListParams): Promise<MyBookingsResult> {
      void params
      return Promise.resolve({ ok: true, bookings: { upcoming: [], past: [] } })
    },
    cancel(booking: MyBooking): Promise<MyCancelResult> {
      return Promise.resolve({ ok: true, id: booking.id })
    },
  }
}

/** The default mock adapter wired into the UI (real clock in production). */
export const mockMyBookingsAdapter: MyBookingsPort = makeMockMyBookingsAdapter()

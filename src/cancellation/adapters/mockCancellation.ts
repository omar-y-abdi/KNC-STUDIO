// The ONE real CancellationPort adapter: no network, NOTHING PERSISTED.
//
//  - `lookup()` fabricates a plausible upcoming appointment via the pure `buildDemoBooking`, using
//    an injected clock for "today" (the only effect, isolated at this edge). It always succeeds —
//    a future backend would query by contact and may return a "not found" error (already
//    representable in `CancelLookupResult`).
//  - `cancel()` always resolves `ok`, echoing the booking. No state is mutated; a reload forgets
//    everything. A future networked adapter would DELETE/PATCH the row and return the outcome.
//
// The injectable clock mirrors `config.defaultClock`, so under VITE_CLOCK=fixed the demo appointment
// is deterministic and the adapter is unit-testable without DOM or mocks.

import { defaultClock } from '../../config'
import type { Clock } from '../../config'
import type { CancelBooking, CancelLookupResult, CancelResult } from '../domain'
import { buildDemoBooking } from '../demoBooking'
import type { CancellationPort, CancelLookupParams } from '../port'

/**
 * Build the local-only CancellationPort. The clock is injected (default: env-selected) so tests can
 * pin "today"; production uses the real current day.
 */
export function makeMockCancellationAdapter(clock: Clock = defaultClock): CancellationPort {
  return {
    lookup(params: CancelLookupParams): Promise<CancelLookupResult> {
      const booking = buildDemoBooking(clock(), params.lang, params.method, params.contact)
      return Promise.resolve({ ok: true, booking })
    },
    cancel(booking: CancelBooking): Promise<CancelResult> {
      return Promise.resolve({ ok: true, booking })
    },
  }
}

/** The default mock adapter wired into the UI (real clock in production). */
export const mockCancellationAdapter: CancellationPort = makeMockCancellationAdapter()

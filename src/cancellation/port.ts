// The "backend-ready" seam for cancellation. A `CancellationPort` looks up a booking by contact +
// method, then cancels a looked-up booking. The dialog depends on this interface only; today the
// one concrete implementation is `mockCancellationAdapter` (no network — it fabricates a plausible
// demo appointment). A future backend implements the same interface — intentionally not stubbed.

import type { Lang } from '../i18n/index'
import type { CancelBooking, CancelLookupResult, CancelMethod, CancelResult } from './domain'

/** The validated parameters of a lookup (contact already format-checked by the caller). */
export interface CancelLookupParams {
  readonly contact: string
  readonly method: CancelMethod
  /** UI language — the demo appointment's labels are built in this language. */
  readonly lang: Lang
}

export interface CancellationPort {
  /** Find the booking for a contact + method. Resolves with the appointment (or a domain error). */
  lookup(params: CancelLookupParams): Promise<CancelLookupResult>
  /** Cancel a looked-up booking. Resolves `ok` (or a domain error). */
  cancel(booking: CancelBooking): Promise<CancelResult>
}

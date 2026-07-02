// The cancellation seam. A `CancellationPort` looks up a booking by contact (phone), then cancels
// a looked-up booking. The dialog depends on this interface only; the concrete implementations are
// `mockCancellationAdapter` (no network — it fabricates a plausible demo appointment) and
// `supabaseCancellationAdapter` (the real backend).

import type { Lang } from '../i18n/index'
import type { CancelBooking, CancelLookupResult, CancelResult } from './domain'

/** The validated parameters of a lookup (contact already format-checked by the caller). */
export interface CancelLookupParams {
  readonly contact: string
  /** UI language — the demo appointment's labels are built in this language. */
  readonly lang: Lang
}

export interface CancellationPort {
  /** Find the booking for a contact (phone). Resolves with the appointment (or a domain error). */
  lookup(params: CancelLookupParams): Promise<CancelLookupResult>
  /** Cancel a looked-up booking. Resolves `ok` (or a domain error). */
  cancel(booking: CancelBooking): Promise<CancelResult>
}

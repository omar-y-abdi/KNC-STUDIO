// The cancellation-adapter swap point. Supabase when configured, the offline mock otherwise (chosen
// once at module load). With no `VITE_SUPABASE_*` set this is the mock (a fabricated demo appointment)
// — identical to today.
//
// The Supabase adapter is reached through a LAZY proxy (dynamic import on first call), so supabase-js
// lands in its own chunk — fetched only when the backend is configured and a lookup/cancel runs.

import { isBackendConfigured } from '../../backend/config'
import type { CancelBooking } from '../domain'
import type { CancellationPort, CancelLookupParams } from '../port'
import { mockCancellationAdapter } from './mockCancellation'

const lazySupabaseCancellationPort: CancellationPort = {
  lookup: (params: CancelLookupParams) =>
    import('./supabaseCancellation').then((m) => m.supabaseCancellationAdapter.lookup(params)),
  cancel: (booking: CancelBooking, turnstileToken: string) =>
    import('./supabaseCancellation').then((m) =>
      m.supabaseCancellationAdapter.cancel(booking, turnstileToken),
    ),
}

export const defaultCancellationPort: CancellationPort = isBackendConfigured()
  ? lazySupabaseCancellationPort
  : mockCancellationAdapter

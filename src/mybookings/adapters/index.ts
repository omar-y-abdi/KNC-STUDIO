// The Mina-bokningar adapter swap point. Supabase when configured, the offline mock otherwise (chosen
// once at module load). With no `VITE_SUPABASE_*` set this is the mock (deterministic demo history)
// — so local dev + the visual baseline see every state without a backend.
//
// The Supabase adapter is reached through a LAZY proxy (dynamic import on first call), so supabase-js
// stays in its own chunk — fetched only when the backend is configured and a lookup/cancel runs.

import { isBackendConfigured } from '../../backend/config'
import type { MyBooking } from '../domain'
import type { MyBookingsLookupParams, MyBookingsPort } from '../port'
import { mockMyBookingsAdapter } from './mockMyBookings'

const lazySupabaseMyBookingsPort: MyBookingsPort = {
  listByPhone: (params: MyBookingsLookupParams) =>
    import('./supabaseMyBookings').then((m) => m.supabaseMyBookingsAdapter.listByPhone(params)),
  cancel: (booking: MyBooking, contact: string) =>
    import('./supabaseMyBookings').then((m) =>
      m.supabaseMyBookingsAdapter.cancel(booking, contact),
    ),
}

export const defaultMyBookingsPort: MyBookingsPort = isBackendConfigured()
  ? lazySupabaseMyBookingsPort
  : mockMyBookingsAdapter

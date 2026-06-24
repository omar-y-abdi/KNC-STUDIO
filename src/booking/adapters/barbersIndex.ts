// The barbers-roster swap point. Supabase when configured, the offline mock (the `BARBERS` constant)
// otherwise — chosen ONCE at module load. With no `VITE_SUPABASE_*` set this is the mock, so the
// public roster (booking grid + About cards) is byte-identical to today and resolves immediately.
//
// The Supabase adapter is reached through a LAZY proxy (dynamic import on first call), so supabase-js
// lands in its own chunk — fetched only when the backend is configured AND the roster loads. With no
// env it is never imported, so the public critical path ships none of it.

import { isBackendConfigured } from '../../backend/config'
import type { BarbersPort, RosterBarber } from '../barbersPort'
import { mockBarbersAdapter } from './mockBarbers'

const lazySupabaseBarbersPort: BarbersPort = {
  listActive: (): Promise<readonly RosterBarber[]> =>
    import('./supabaseBarbers').then((m) => m.supabaseBarbersAdapter.listActive()),
}

export const defaultBarbersPort: BarbersPort = isBackendConfigured()
  ? lazySupabaseBarbersPort
  : mockBarbersAdapter

/**
 * Whether the configured roster source is the offline mock (i.e. no backend). The public components
 * use this to render the constant roster SYNCHRONOUSLY on first paint (no loading flash, no layout
 * shift) and only switch to an async fetch when a real backend is configured.
 */
export const barbersAreMock = !isBackendConfigured()

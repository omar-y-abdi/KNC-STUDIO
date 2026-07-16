// The services swap point. Supabase when configured, the offline mock (the flat starter menu)
// otherwise — chosen ONCE at module load. With no `VITE_SUPABASE_*` set this is the mock, so the
// booking service step is byte-identical to a static menu and resolves immediately. The Supabase
// adapter is reached through a LAZY proxy (dynamic import on first call) so supabase-js stays out of
// the public critical path.

import { isBackendConfigured } from '../../backend/config'
import type { BarberId, ServiceItem } from '../domain'
import type { ServicesPort } from '../servicesPort'
import { mockServicesAdapter } from './mockServices'

const lazySupabaseServicesPort: ServicesPort = {
  listForBarber: (barberId: BarberId): Promise<readonly ServiceItem[]> =>
    import('./supabaseServices').then((m) => m.supabaseServicesAdapter.listForBarber(barberId)),
}

export const defaultServicesPort: ServicesPort = isBackendConfigured()
  ? lazySupabaseServicesPort
  : mockServicesAdapter

/** Whether the configured menu source is the offline mock (no backend) — paint the seed immediately. */
export const servicesAreMock = !isBackendConfigured()

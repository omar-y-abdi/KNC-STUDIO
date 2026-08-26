// Public roster swap point. Production uses one cached catalog RPC; unconfigured/offline builds
// return no invented business data.

import { isBackendConfigured } from '../../backend/config'
import type { BarbersPort, RosterBarber } from '../barbersPort'
import { mockBarbersAdapter } from './mockBarbers'

const lazySupabaseBarbersPort: BarbersPort = {
  listActive: (): Promise<readonly RosterBarber[]> =>
    import('./supabaseBookingCatalog').then((m) =>
      m.cachedBookingCatalog().then((catalog) => catalog.barbers),
    ),
}

export const defaultBarbersPort: BarbersPort = isBackendConfigured()
  ? lazySupabaseBarbersPort
  : mockBarbersAdapter

/** Begin one background catalog read when live configuration exists. */
export function preloadBookingCatalog(): void {
  if (!isBackendConfigured()) return
  void import('./supabaseBookingCatalog').then((module) => module.preloadBookingCatalog())
}

export function subscribeBookingCatalog(onChange: () => void): () => void {
  if (!isBackendConfigured()) return () => undefined
  let disposed = false
  let unsubscribe: (() => void) | null = null
  void import('./supabaseBookingCatalog').then((module) => {
    if (disposed) return
    unsubscribe = module.subscribeBookingCatalog(onChange)
  })
  return () => {
    disposed = true
    unsubscribe?.()
  }
}

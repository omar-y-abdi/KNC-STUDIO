// Public roster swap point. Production uses one cached catalog RPC; unconfigured/offline builds
// return no invented business data.

import { backgroundLoad } from '../../backend/backgroundLoad'
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

/**
 * Begin one background catalog read when live configuration exists. A page that is leaving or
 * offline skips it (`backgroundLoad`); any other failure to load the adapter surfaces.
 */
export function preloadBookingCatalog(): void {
  if (!isBackendConfigured()) return
  void backgroundLoad(() => import('./supabaseBookingCatalog')).then((module) =>
    module?.preloadBookingCatalog(),
  )
}

export function subscribeBookingCatalog(onChange: () => void): () => void {
  if (!isBackendConfigured()) return () => undefined
  let disposed = false
  let unsubscribe: (() => void) | null = null
  // No adapter (the page is leaving or offline) means no live updates.
  void backgroundLoad(() => import('./supabaseBookingCatalog')).then((module) => {
    if (disposed || module === null) return
    unsubscribe = module.subscribeBookingCatalog(onChange)
  })
  return () => {
    disposed = true
    unsubscribe?.()
  }
}

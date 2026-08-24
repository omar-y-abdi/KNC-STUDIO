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

/**
 * Whether the configured roster source is the offline mock (i.e. no backend). The public components
 * use this to render the constant roster SYNCHRONOUSLY on first paint (no loading flash, no layout
 * shift) and only switch to an async fetch when a real backend is configured.
 */
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

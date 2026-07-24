// Offline/demo CalendarSyncPort. With no backend there is nothing to OAuth against, so status is
// always "disconnected" (the panel renders the Koppla button — visible in the visual baseline) and
// connect explains that a backend is required. Mirrors the mock/real split used across the app.

import { err, ok } from '../../types'
import type { CalendarSyncPort } from '../port'

export const mockCalendarSyncPort: CalendarSyncPort = {
  status: () => Promise.resolve(ok({ connected: false, googleEmail: null, lastSyncError: null })),
  connectUrl: () =>
    Promise.resolve(err('network', 'Kalenderkoppling kräver en konfigurerad backend.')),
  disconnect: () => Promise.resolve(ok(undefined)),
}

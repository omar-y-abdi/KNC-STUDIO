// The calendar-sync adapter swap point. Supabase when configured, the offline mock otherwise (chosen
// once at module load) — mirrors the Mina-bokningar selector. The Supabase adapter is reached through
// a LAZY proxy (dynamic import on first call) so supabase-js stays in its own chunk.

import { isBackendConfigured } from '../../../backend/config'
import type { CalendarSyncPort } from '../port'
import { mockCalendarSyncPort } from './mockCalendarSync'

const lazySupabaseCalendarSyncPort: CalendarSyncPort = {
  status: () => import('./supabaseCalendarSync').then((m) => m.supabaseCalendarSyncPort.status()),
  connectUrl: () =>
    import('./supabaseCalendarSync').then((m) => m.supabaseCalendarSyncPort.connectUrl()),
  disconnect: () =>
    import('./supabaseCalendarSync').then((m) => m.supabaseCalendarSyncPort.disconnect()),
}

export const defaultCalendarSyncPort: CalendarSyncPort = isBackendConfigured()
  ? lazySupabaseCalendarSyncPort
  : mockCalendarSyncPort

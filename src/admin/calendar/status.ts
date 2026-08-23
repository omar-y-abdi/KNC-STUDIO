// Pure boundary parser: the `calendar_connection_status()` RPC returns an untyped jsonb object, so we
// validate it into a `CalendarStatus` here (never trust the wire shape). Kept dependency-free so it is
// unit-tested directly (tests/unit/calendar.test.ts).

import type { CalendarStatus } from './port'

const DISCONNECTED: CalendarStatus = {
  connected: false,
  disconnectPending: false,
  repairRequired: false,
  googleEmail: null,
  lastSyncError: null,
}

/** Validate the RPC payload into a `CalendarStatus`. Anything malformed collapses to "disconnected". */
export function parseCalendarStatus(raw: unknown): CalendarStatus {
  if (typeof raw !== 'object' || raw === null) return DISCONNECTED
  const r = raw as Record<string, unknown>
  return {
    connected: r['connected'] === true,
    disconnectPending: r['disconnect_pending'] === true,
    repairRequired: r['repair_required'] === true,
    googleEmail: typeof r['google_email'] === 'string' ? r['google_email'] : null,
    lastSyncError: typeof r['last_sync_error'] === 'string' ? r['last_sync_error'] : null,
  }
}

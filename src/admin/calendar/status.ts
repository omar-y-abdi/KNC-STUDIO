// Pure boundary parser: the `calendar_connection_status()` RPC returns an untyped jsonb object, so we
// validate it into a `CalendarStatus` here (never trust the wire shape). Kept dependency-free so it is
// unit-tested directly (tests/unit/calendarSync.test.ts).

import type { CalendarStatus } from './port'

/** Malformed responses are unavailable status, never evidence of a completed disconnect. */
export function parseCalendarStatus(raw: unknown): CalendarStatus | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  if (typeof r['connected'] !== 'boolean') return null
  for (const key of ['disconnect_pending', 'repair_required']) {
    if (key in r && typeof r[key] !== 'boolean') return null
  }
  for (const key of ['google_email', 'last_sync_error']) {
    if (key in r && r[key] !== null && typeof r[key] !== 'string') return null
  }
  return {
    connected: r['connected'] === true,
    disconnectPending: r['disconnect_pending'] === true,
    repairRequired: r['repair_required'] === true,
    googleEmail: typeof r['google_email'] === 'string' ? r['google_email'] : null,
    lastSyncError: typeof r['last_sync_error'] === 'string' ? r['last_sync_error'] : null,
  }
}

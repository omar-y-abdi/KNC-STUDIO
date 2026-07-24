// The calendar-sync seam. A `CalendarSyncPort` reports the signed-in barber's Google Calendar
// connection state, hands back the Google consent URL to start a connect, and disconnects. The button
// depends on this interface only; concrete implementations are `mockCalendarSyncPort` (offline demo)
// and `supabaseCalendarSyncPort` (the real backend: calendar_connection_status RPC + the
// calendar-oauth-start / calendar-disconnect edge functions).

import type { AdminResult } from '../types'

/** The barber's connection state — a boolean + email + last-sync info. NEVER the refresh token. */
export interface CalendarStatus {
  readonly connected: boolean
  readonly googleEmail: string | null
  readonly lastSyncError: string | null
}

export interface CalendarSyncPort {
  /** The signed-in barber's own connection state. */
  status(): Promise<AdminResult<CalendarStatus>>
  /** The Google consent URL to navigate to (top-level) to start a connect. */
  connectUrl(): Promise<AdminResult<string>>
  /** Unlink the signed-in barber's calendar (revokes + forgets the token server-side). */
  disconnect(): Promise<AdminResult<void>>
}

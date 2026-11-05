// The real (Supabase) CalendarSyncPort.
//   - status():     calendar_connection_status() RPC (definer; returns the caller's own state).
//   - connectUrl(): calendar-oauth-start edge function -> { ok, url }. The barber's JWT is forwarded
//                   automatically by the admin client; the function resolves the barber id server-side.
//   - disconnect(): calendar-disconnect edge function.
//
// Boundary discipline (same as barberAccountAdmin): map BOTH invoke transport errors and typed
// { ok:false } bodies to an AdminResult; never throw to the UI.

import { getAdminClient } from '../../adminClient'
import type { AdminResult } from '../../types'
import { err, ok } from '../../types'
import type { CalendarStatus, CalendarSyncPort } from '../port'
import { parseCalendarStatus } from '../status'

const GENERIC = 'Något gick fel med kalendern. Försök igen.'

/** supabase-js v2 may return the typed body even on non-2xx; read `data.ok` first, then fall back to
 *  the error. Returns the parsed body object when present. */
function readBody(data: unknown): Record<string, unknown> | null {
  return data !== null && typeof data === 'object' ? (data as Record<string, unknown>) : null
}

export const supabaseCalendarSyncPort: CalendarSyncPort = {
  status: async (): Promise<AdminResult<CalendarStatus>> => {
    try {
      const { data, error } = await getAdminClient().rpc('calendar_connection_status')
      if (error !== null) return err('network', GENERIC)
      const status = parseCalendarStatus(data)
      return status === null ? err('network', GENERIC) : ok(status)
    } catch {
      return err('network', GENERIC)
    }
  },

  connectUrl: async (): Promise<AdminResult<string>> => {
    try {
      const { data, error } = await getAdminClient().functions.invoke('calendar-oauth-start', {
        body: {},
      })
      const body = readBody(data)
      if (body !== null && body['ok'] === true && typeof body['url'] === 'string') {
        return ok(body['url'])
      }
      if (body !== null && body['ok'] === false) return err('network', GENERIC)
      if (error !== null) return err('network', GENERIC)
      return err('network', GENERIC)
    } catch {
      return err('network', GENERIC)
    }
  },

  disconnect: async (): Promise<AdminResult<void>> => {
    try {
      const { data, error } = await getAdminClient().functions.invoke('calendar-disconnect', {
        body: {},
      })
      const body = readBody(data)
      if (body !== null && body['ok'] === true) return ok(undefined)
      if (body !== null && body['ok'] === false) return err('network', GENERIC)
      if (error !== null) return err('network', GENERIC)
      return err('network', GENERIC)
    } catch {
      return err('network', GENERIC)
    }
  },
}

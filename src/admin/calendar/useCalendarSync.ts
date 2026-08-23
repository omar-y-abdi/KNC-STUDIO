// useCalendarSync — loads the signed-in barber's calendar connection state and exposes connect /
// disconnect actions. The port is injectable (default: env-selected — Supabase when configured, else
// the mock) so the seam stays testable and the component depends on the interface, not the client.
//
// connect() navigates the whole tab to Google's consent screen (an OAuth code flow needs a top-level
// redirect, not a fetch). On return, the barber lands on the calendar-oauth-callback success page.

import { useEffect, useState } from 'preact/hooks'
import { defaultCalendarSyncPort } from './adapters/index'
import type { CalendarStatus, CalendarSyncPort } from './port'

interface CalendarSyncState {
  readonly loading: boolean
  readonly status: CalendarStatus | null
  readonly error: string | null
  /** An action (connect/disconnect) is in flight. */
  readonly busy: boolean
}

export interface UseCalendarSync extends CalendarSyncState {
  readonly connect: () => Promise<void>
  readonly disconnect: () => Promise<void>
  readonly refresh: () => Promise<void>
}

const INITIAL: CalendarSyncState = { loading: true, status: null, error: null, busy: false }
const DISCONNECTING: CalendarStatus = {
  connected: false,
  disconnectPending: true,
  repairRequired: false,
  googleEmail: null,
  lastSyncError: null,
}

export function useCalendarSync(port: CalendarSyncPort = defaultCalendarSyncPort): UseCalendarSync {
  const [state, setState] = useState<CalendarSyncState>(INITIAL)

  const load = async (): Promise<void> => {
    const res = await port.status()
    setState((prev) =>
      res.ok
        ? { ...prev, loading: false, status: res.value, error: null }
        : { ...prev, loading: false, error: res.error.message },
    )
  }

  useEffect(() => {
    let active = true
    void (async () => {
      const res = await port.status()
      if (!active) return
      setState((prev) =>
        res.ok
          ? { ...prev, loading: false, status: res.value, error: null }
          : { ...prev, loading: false, error: res.error.message },
      )
    })()
    return () => {
      active = false
    }
  }, [port])

  const connect = async (): Promise<void> => {
    setState((prev) => ({ ...prev, busy: true, error: null }))
    const res = await port.connectUrl()
    if (!res.ok) {
      setState((prev) => ({ ...prev, busy: false, error: res.error.message }))
      return
    }
    // Top-level navigation to Google's consent screen (the tab leaves the app).
    window.location.assign(res.value)
  }

  const disconnect = async (): Promise<void> => {
    setState((prev) => ({ ...prev, busy: true, error: null }))
    const res = await port.disconnect()
    if (!res.ok) {
      setState((prev) => ({ ...prev, busy: false, error: res.error.message }))
      return
    }
    setState({ loading: false, status: DISCONNECTING, error: null, busy: false })
  }

  return { ...state, connect, disconnect, refresh: load }
}

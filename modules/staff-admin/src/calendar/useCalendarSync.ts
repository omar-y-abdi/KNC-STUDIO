// useCalendarSync — loads the signed-in barber's calendar connection state and exposes connect /
// disconnect actions. The port is injectable (default: env-selected — Supabase when configured, else
// the mock) so the seam stays testable and the component depends on the interface, not the client.
//
// connect() navigates the whole tab to Google's consent screen (an OAuth code flow needs a top-level
// redirect, not a fetch). On return, the barber lands on the calendar-oauth-callback success page.

import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { defaultCalendarSyncPort } from './adapters/index'
import type { CalendarStatus, CalendarSyncPort } from './port'

interface CalendarSyncState {
  readonly loading: boolean
  readonly status: CalendarStatus | null
  readonly error: 'status' | 'action' | null
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

const STATUS_TIMEOUT_MS = 10_000
const PENDING_POLL_MS = 15_000

interface StatusRead {
  readonly promise: Promise<void>
  readonly cancel: () => void
}

interface CalendarContext {
  readonly port: CalendarSyncPort
  active: boolean
  state: CalendarSyncState
  read: StatusRead | null
  actionInFlight: boolean
}

function cancelRead(context: CalendarContext): void {
  const read = context.read
  context.read = null
  read?.cancel()
}

export function useCalendarSync(port: CalendarSyncPort = defaultCalendarSyncPort): UseCalendarSync {
  const current = useRef<CalendarContext | null>(null)
  if (current.current === null || current.current.port !== port) {
    current.current = { port, active: true, state: INITIAL, read: null, actionInFlight: false }
  }
  const context = current.current
  const [snapshot, setSnapshot] = useState({ context, state: INITIAL })
  // A new port must never render the previous barber's status, even before effect cleanup runs.
  const state = snapshot.context === context ? snapshot.state : context.state
  const isCurrent = useCallback(() => current.current === context && context.active, [context])
  const update = useCallback(
    (next: CalendarSyncState): void => {
      if (!isCurrent()) return
      context.state = next
      setSnapshot({ context, state: next })
    },
    [context, isCurrent],
  )

  const load = useCallback(
    (manual = false): Promise<void> => {
      if (!isCurrent() || context.actionInFlight) return Promise.resolve()
      if (context.read !== null) return context.read.promise
      update({ ...context.state, loading: true, error: manual ? null : context.state.error })

      let cancel = (): void => undefined
      const expired = new Promise<null>((resolve) => {
        const timer = setTimeout(() => resolve(null), STATUS_TIMEOUT_MS)
        cancel = () => {
          clearTimeout(timer)
          resolve(null)
        }
      })
      const read: StatusRead = {
        cancel: () => cancel(),
        promise: Promise.race([
          Promise.resolve().then(() =>
            isCurrent() && context.read === read ? port.status() : null,
          ),
          expired,
        ])
          .then((res) => {
            if (!isCurrent() || context.read !== read) return
            update({
              ...context.state,
              loading: false,
              status: res?.ok === true ? res.value : context.state.status,
              error:
                res?.ok === true ? (context.state.error === 'action' ? 'action' : null) : 'status',
            })
          })
          .catch(() => {
            if (isCurrent() && context.read === read) {
              update({ ...context.state, loading: false, error: 'status' })
            }
          })
          .finally(() => {
            cancel()
            if (context.read === read) context.read = null
          }),
      }
      context.read = read
      return read.promise
    },
    [context, isCurrent, port, update],
  )

  useEffect(() => {
    context.active = true
    void load()
    const refreshVisible = (): void => {
      if (document.visibilityState === 'visible') void load()
    }
    window.addEventListener('focus', refreshVisible)
    document.addEventListener('visibilitychange', refreshVisible)
    return () => {
      context.active = false
      cancelRead(context)
      window.removeEventListener('focus', refreshVisible)
      document.removeEventListener('visibilitychange', refreshVisible)
    }
  }, [context, load])

  const disconnectPending = state.status?.disconnectPending === true
  useEffect(() => {
    if (!disconnectPending) return
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load()
    }, PENDING_POLL_MS)
    return () => clearInterval(timer)
  }, [disconnectPending, load])

  const beginAction = (): boolean => {
    if (!isCurrent() || context.actionInFlight) return false
    // Synchronous fencing also covers two clicks before the busy state renders. Reads begun before
    // this mutation cannot overwrite its acknowledgement, including after their timeout expires.
    context.actionInFlight = true
    cancelRead(context)
    update({ ...context.state, loading: false, busy: true, error: null })
    return true
  }

  const connect = async (): Promise<void> => {
    if (!beginAction()) return
    try {
      const res = await port.connectUrl()
      if (!isCurrent()) return
      if (res.ok) {
        // Keep the action fenced while the tab leaves; a stale port must never redirect this tab.
        window.location.assign(res.value)
        return
      }
    } catch {
      // A thrown adapter or navigation error follows the same recoverable UI path.
    }
    context.actionInFlight = false
    update({ ...context.state, busy: false, error: 'action' })
  }

  const disconnect = async (): Promise<void> => {
    if (!beginAction()) return
    try {
      const res = await port.disconnect()
      if (!isCurrent()) return
      update(
        res.ok
          ? { loading: false, status: DISCONNECTING, error: null, busy: false }
          : { ...context.state, busy: false, error: 'action' },
      )
    } catch {
      update({ ...context.state, busy: false, error: 'action' })
    } finally {
      context.actionInFlight = false
      // Resolve the authoritative state after either an acknowledgement or an ambiguous failure.
      // Durable cleanup can finish without another user action; visible polling follows it to done.
      if (isCurrent()) void load()
    }
  }

  return { ...state, connect, disconnect, refresh: () => load(true) }
}

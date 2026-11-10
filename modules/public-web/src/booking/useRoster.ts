// Public roster state. It starts empty and renders a truthful loading/empty/failed state; named
// barbers arrive only from the selected port (the production catalog RPC).

import { useEffect, useState } from 'preact/hooks'
import type { BarbersPort, RosterBarber } from './barbersPort'
import { defaultBarbersPort, subscribeBookingCatalog } from './adapters/barbersIndex'

export interface RosterState {
  /** Active rows returned by selected port; empty with `ready` means no configured/active barbers. */
  readonly roster: readonly RosterBarber[]
  /** `loading` while the selected port fetch is in flight or deferred (`enabled` false); `error`
   * when it failed — a failed read is never reported as a `ready` empty roster. */
  readonly status: 'loading' | 'ready' | 'error'
  /** Run the read again (the way out of `error`). */
  readonly retry: () => void
}

/**
 * Subscribe to the public roster. `port` defaults to the env-selected `defaultBarbersPort`. The
 * initial value is empty; configured backend rows are the only production roster authority.
 */
export function useRoster(port: BarbersPort = defaultBarbersPort, enabled = true): RosterState {
  const [roster, setRoster] = useState<readonly RosterBarber[]>([])
  const [status, setStatus] = useState<RosterState['status']>('loading')
  const [attempt, setAttempt] = useState<number>(0)

  useEffect(() => {
    if (!enabled) {
      setRoster([])
      setStatus('loading')
      return
    }
    let cancelled = false
    const load = (): void => {
      setStatus('loading')
      void port
        .listActive()
        .then((rows) => {
          if (cancelled) return
          setRoster(rows)
          setStatus('ready')
        })
        .catch(() => {
          if (cancelled) return
          setRoster([])
          setStatus('error')
        })
    }
    load()
    const unsubscribe =
      port === defaultBarbersPort ? subscribeBookingCatalog(load) : () => undefined
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [enabled, port, attempt])

  return { roster, status, retry: () => setAttempt((n) => n + 1) }
}

// Public roster state. It starts empty and renders a truthful loading/empty state; named barbers
// arrive only from the selected port (the production catalog RPC).

import { useEffect, useState } from 'preact/hooks'
import type { BarbersPort, RosterBarber } from './barbersPort'
import { defaultBarbersPort, subscribeBookingCatalog } from './adapters/barbersIndex'

export interface RosterState {
  /** The active roster to render (constant under the mock; DB rows under a backend once loaded). */
  readonly roster: readonly RosterBarber[]
  /** True only while a real backend fetch is in flight (always false under the mock). */
  readonly loading: boolean
}

/**
 * Subscribe to the public roster. `port` defaults to the env-selected `defaultBarbersPort`. The
 * initial value is always the constant roster (immediate, stable paint); a configured backend then
 * replaces it with the live `barbers` rows.
 */
export function useRoster(port: BarbersPort = defaultBarbersPort): RosterState {
  const [roster, setRoster] = useState<readonly RosterBarber[]>([])
  const [loading, setLoading] = useState<boolean>(true)

  useEffect(() => {
    let cancelled = false
    const load = (): void => {
      setLoading(true)
      void port
        .listActive()
        .then((rows) => {
          if (cancelled) return
          setRoster(rows)
          setLoading(false)
        })
        .catch(() => {
          if (cancelled) return
          setRoster([])
          setLoading(false)
        })
    }
    load()
    const unsubscribe =
      port === defaultBarbersPort ? subscribeBookingCatalog(load) : () => undefined
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [port])

  return { roster, loading }
}

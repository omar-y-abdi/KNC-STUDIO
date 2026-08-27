// `useServices` — the chosen barber's service menu as React state, refetched when the barber changes.
//
// Services start empty and come only from the selected port. Switching barber clears prior rows
// immediately, preventing a stale service-menu flash while the shared catalog resolves.

import { useEffect, useState } from 'preact/hooks'
import type { BarberId, ServiceItem } from './domain'
import type { ServicesPort } from './servicesPort'
import { defaultServicesPort } from './adapters/servicesIndex'
import { subscribeBookingCatalog } from './adapters/barbersIndex'

export interface ServicesState {
  /** Active rows returned by selected port; empty means no configured services. */
  readonly services: readonly ServiceItem[]
  /** True while selected port fetch is in flight. */
  readonly loading: boolean
}

/**
 * Subscribe to a barber's service menu. `port` defaults to the env-selected `defaultServicesPort`.
 * Passing `null` (no barber chosen yet) yields an empty list; service step renders after selection.
 */
export function useServices(
  barberId: BarberId | null,
  port: ServicesPort = defaultServicesPort,
): ServicesState {
  const [services, setServices] = useState<readonly ServiceItem[]>([])
  const [loading, setLoading] = useState<boolean>(false)

  useEffect(() => {
    if (barberId === null) {
      setServices([])
      setLoading(false)
      return
    }
    let cancelled = false
    const load = (): void => {
      setServices([])
      setLoading(true)
      void port
        .listForBarber(barberId)
        .then((rows) => {
          if (cancelled) return
          setServices(rows)
          setLoading(false)
        })
        .catch(() => {
          if (cancelled) return
          setServices([])
          setLoading(false)
        })
    }
    load()
    const unsubscribe =
      port === defaultServicesPort ? subscribeBookingCatalog(load) : () => undefined
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [barberId, port])

  return { services, loading }
}

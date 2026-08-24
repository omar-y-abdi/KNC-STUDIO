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
  /** The active services to render (the starter menu under the mock; DB rows under a backend). */
  readonly services: readonly ServiceItem[]
  /** True only while a real backend fetch is in flight (always false under the mock). */
  readonly loading: boolean
}

/**
 * Subscribe to a barber's service menu. `port` defaults to the env-selected `defaultServicesPort`.
 * Passing `null` (no barber chosen yet) yields the mock menu under the mock, or an empty list under a
 * backend — the service step only renders once a barber AND a date are chosen anyway.
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

// `useServices` — chosen barber's date-specific service menu, refetched with barber or date changes.
//
// Services start empty and come only from the selected port. Switching barber clears prior rows
// immediately on barber or date change, preventing stale cross-day menus while the shared catalog resolves.

import { useEffect, useState } from 'preact/hooks'
import type { BarberId, ServiceItem } from './domain'
import type { ServicesPort } from './servicesPort'
import { defaultServicesPort } from './adapters/servicesIndex'
import { subscribeBookingCatalog } from './adapters/barbersIndex'

export interface ServicesState {
  /** Active rows returned by selected port; empty with `ready` means no configured services. */
  readonly services: readonly ServiceItem[]
  /** `loading` while the selected port fetch is in flight, and before a barber and date are chosen
   * (nothing has been read yet); `error` when it failed — a failed read is never reported as a
   * `ready` empty menu. */
  readonly status: 'loading' | 'ready' | 'error'
  /** Run the read again (the way out of `error`). */
  readonly retry: () => void
}

/**
 * Subscribe to a barber's service menu. `port` defaults to the env-selected `defaultServicesPort`.
 * Passing `null` (no barber chosen yet) yields an empty list; service step renders after selection.
 */
export function useServices(
  barberId: BarberId | null,
  dateIso: string | null,
  port: ServicesPort = defaultServicesPort,
): ServicesState {
  const [services, setServices] = useState<readonly ServiceItem[]>([])
  const [status, setStatus] = useState<ServicesState['status']>('loading')
  const [attempt, setAttempt] = useState<number>(0)

  useEffect(() => {
    if (barberId === null || dateIso === null) {
      setServices([])
      setStatus('loading')
      return
    }
    let cancelled = false
    const load = (): void => {
      setServices([])
      setStatus('loading')
      void port
        .listForBarber(barberId, dateIso)
        .then((rows) => {
          if (cancelled) return
          setServices(rows)
          setStatus('ready')
        })
        .catch(() => {
          if (cancelled) return
          setServices([])
          setStatus('error')
        })
    }
    load()
    const unsubscribe =
      port === defaultServicesPort ? subscribeBookingCatalog(load) : () => undefined
    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [barberId, dateIso, port, attempt])

  return { services, status, retry: () => setAttempt((n) => n + 1) }
}

// `useServices` — chosen barber's date-specific service menu, refetched with barber or date changes.
//
// Under the MOCK (no backend): the flat starter menu is the immediate value for any barber, so the
// booking service step paints at once (no loading flash). Under a BACKEND: the selected barber's rows
// are fetched (race-guarded — a stale response is dropped, exactly like the availability effect); an
// an empty live result is a real business state, never a hard-coded fallback service menu.

import { useEffect, useState } from 'preact/hooks'
import type { BarberId, ServiceItem } from './domain'
import type { ServicesPort } from './servicesPort'
import { defaultServicesPort, servicesAreMock } from './adapters/servicesIndex'
import { MOCK_SERVICES } from './adapters/mockServices'

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
  dateIso: string | null,
  port: ServicesPort = defaultServicesPort,
): ServicesState {
  const [services, setServices] = useState<readonly ServiceItem[]>(
    servicesAreMock ? MOCK_SERVICES : [],
  )
  const [loading, setLoading] = useState<boolean>(false)

  useEffect(() => {
    if (barberId === null || dateIso === null) {
      if (!servicesAreMock) setServices([])
      return
    }
    // Mock: the starter menu is already correct for every barber; skip the fetch (no flash/shift).
    if (servicesAreMock) {
      setServices(MOCK_SERVICES)
      return
    }
    let cancelled = false
    setLoading(true)
    void port
      .listForBarber(barberId, dateIso)
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
    return () => {
      cancelled = true
    }
  }, [barberId, dateIso, port])

  return { services, loading }
}

// `useServices` — the chosen barber's service menu as React state, refetched when the barber changes.
//
// Under the MOCK (no backend): the flat starter menu is the immediate value for any barber, so the
// booking service step paints at once (no loading flash). Under a BACKEND: the selected barber's rows
// are fetched (race-guarded — a stale response is dropped, exactly like the availability effect); an
// empty result OR a transport error falls back to the starter menu, so the booking menu is never
// empty (mirrors useRoster) — which also makes a code deploy safe ahead of the cloud migration.

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
  port: ServicesPort = defaultServicesPort,
): ServicesState {
  const [services, setServices] = useState<readonly ServiceItem[]>(
    servicesAreMock ? MOCK_SERVICES : [],
  )
  const [loading, setLoading] = useState<boolean>(false)

  useEffect(() => {
    if (barberId === null) return
    // Mock: the starter menu is already correct for every barber; skip the fetch (no flash/shift).
    if (servicesAreMock) {
      setServices(MOCK_SERVICES)
      return
    }
    let cancelled = false
    setLoading(true)
    void port
      .listForBarber(barberId)
      .then((rows) => {
        if (cancelled) return
        // Fall back to the starter menu when a barber has no rows OR the table is unreachable (e.g.
        // the migration hasn't been pushed to the cloud yet) — so the booking menu is NEVER empty,
        // exactly like useRoster falling back to the constant roster. Keeps the deploy order safe.
        setServices(rows.length > 0 ? rows : MOCK_SERVICES)
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setServices(MOCK_SERVICES)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [barberId, port])

  return { services, loading }
}

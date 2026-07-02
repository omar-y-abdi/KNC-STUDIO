// `useRoster` — the public roster as React state, with a graceful, layout-shift-free load.
//
// Under the MOCK (no backend): the constant `BARBERS` roster is the initial state, so first paint is
// byte-identical to today (the booking grid + About cards render the 3 constants immediately — no
// loading flash, no shift). The port still resolves (synchronously-wrapped), so the effect is a
// no-op replacement with the same data.
//
// Under a BACKEND: the SAME constant roster seeds the initial paint (so the grid never renders empty
// and the layout is stable), then the DB roster replaces it once `listActive()` resolves. The effect
// is race-guarded (a stale response is dropped) exactly like BookingFlow's availability effect.
//
// The hook is injection-friendly: callers pass the port (default: env-selected) so tests/usages can
// swap it. It returns the roster plus a `loading` flag (false immediately under the mock).

import { useEffect, useState } from 'preact/hooks'
import type { BarbersPort, RosterBarber } from './barbersPort'
import { barbersAreMock, defaultBarbersPort } from './adapters/barbersIndex'
import { CONSTANT_ROSTER } from './adapters/mockBarbers'

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
  const [roster, setRoster] = useState<readonly RosterBarber[]>(CONSTANT_ROSTER)
  // Under the mock the constant IS the answer — never enter a loading state (no flash/shift).
  const [loading, setLoading] = useState<boolean>(!barbersAreMock)

  useEffect(() => {
    // Mock: the constant roster is already correct; skip the fetch entirely.
    if (barbersAreMock) return
    let cancelled = false
    setLoading(true)
    void port
      .listActive()
      .then((rows) => {
        if (cancelled) return
        // An empty roster (transport error / no active rows) falls back to the constant so the page
        // still renders barbers rather than an empty grid.
        setRoster(rows.length > 0 ? rows : CONSTANT_ROSTER)
        setLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setRoster(CONSTANT_ROSTER)
        setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [port])

  return { roster, loading }
}

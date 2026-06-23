// Roster hook for the admin shell. Loads the barbers the caller may see (the owner sees inactive
// too) once on mount and exposes a `reload` so a roster mutation (add / toggle / edit) refreshes the
// selector + the id->name resolution across views. Effect isolated here; consumers get plain data.

import { useEffect, useState } from 'preact/hooks'
import { listBarbers } from './adapters/barbersAdmin'
import type { AdminBarber } from './types'

export interface BarbersState {
  readonly barbers: readonly AdminBarber[]
  readonly loading: boolean
  readonly error: string | null
  reload: () => Promise<void>
}

export function useBarbers(): BarbersState {
  const [barbers, setBarbers] = useState<readonly AdminBarber[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const reload = async (): Promise<void> => {
    setLoading(true)
    const result = await listBarbers()
    if (result.ok) {
      setBarbers(result.value)
      setError(null)
    } else {
      setError(result.error.message)
    }
    setLoading(false)
  }

  useEffect(() => {
    void reload()
  }, [])

  return { barbers, loading, error, reload }
}

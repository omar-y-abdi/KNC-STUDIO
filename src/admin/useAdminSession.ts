import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { activateAdminDataClient, getAdminClient } from './adminClient'
import { getActiveProfile, signOut } from './auth'
import { isBackendConfigured } from '../backend/config'
import { clearAdminNavigationState } from './navigationState'
import { invalidateAdminOperations } from './orderedOperations'
import { err, type AdminProfile, type AdminResult } from './types'

export type AdminGate =
  | { readonly kind: 'checking' | 'redirecting' | 'unavailable' }
  | { readonly kind: 'authed' | 'forced_change'; readonly profile: AdminProfile }

function sameAccess(a: AdminProfile, b: AdminProfile): boolean {
  return (
    a.userId === b.userId &&
    a.role === b.role &&
    a.barberId === b.barberId &&
    a.mustChangePassword === b.mustChangePassword
  )
}

/** One lifecycle owns the protected subtree, revalidation, and its outstanding operation epoch. */
export function useAdminSession(navigate: (path: string, options: { replace: boolean }) => void) {
  const [gate, setGate] = useState<AdminGate>({ kind: 'checking' })
  const [error, setError] = useState<string | null>(null)
  const actions = useRef({ check: (): void => undefined, leave: (): void => undefined })

  useEffect(() => {
    let stopped = false
    let terminal = false
    let checking = false
    let repeat = false
    let sequence = 0
    let userId: string | null = null
    let profile: AdminProfile | null = null
    let controller: AbortController | null = null
    let scheduled: ReturnType<typeof setTimeout> | undefined

    const discard = (): void => {
      sequence += 1
      controller?.abort()
      controller = null
      checking = false
      repeat = false
      if (scheduled !== undefined) clearTimeout(scheduled)
      scheduled = undefined
      invalidateAdminOperations()
      if (profile !== null) {
        try {
          clearAdminNavigationState(sessionStorage, profile.userId)
        } catch {
          /* Storage may be unavailable. */
        }
      }
      profile = null
    }

    const leave = (cleanup: boolean): void => {
      if (stopped || terminal) return
      const departingUserId = profile?.userId ?? userId
      terminal = true
      discard()
      setError(null)
      setGate({ kind: 'redirecting' })
      // Protected content is gone while Auth can still be waiting on the network. Do not open the
      // login route early: its returning-session check could otherwise reuse that pending session.
      if (cleanup) {
        void signOut(departingUserId ?? undefined).then(() => {
          if (!stopped) navigate('/login', { replace: true })
        })
      } else navigate('/login', { replace: true })
    }

    const schedule = (): void => {
      if (stopped || terminal || scheduled !== undefined) return
      scheduled = setTimeout(() => {
        scheduled = undefined
        void check()
      }, 0)
    }

    const check = async (): Promise<void> => {
      if (stopped || terminal) return
      if (checking) {
        repeat = true
        return
      }
      checking = true
      const request = ++sequence
      const abort = new AbortController()
      controller = abort
      const timeout = setTimeout(() => abort.abort(), 10_000)
      const cancelled = new Promise<AdminResult<AdminProfile>>((resolve) => {
        abort.signal.addEventListener(
          'abort',
          () => resolve(err('network', 'Kunde inte nå servern. Försök igen.')),
          { once: true },
        )
      })
      const result = await Promise.race([getActiveProfile(abort.signal), cancelled])
      clearTimeout(timeout)
      if (stopped || terminal || request !== sequence) return
      controller = null
      checking = false
      if (result.ok) {
        if (profile !== null && !sameAccess(profile, result.value)) discard()
        profile = result.value
        userId = result.value.userId
        activateAdminDataClient(profile.userId, () => {
          if (stopped || terminal) return
          discard()
          setGate({ kind: 'checking' })
          schedule()
        })
        setError(null)
        setGate({ kind: profile.mustChangePassword ? 'forced_change' : 'authed', profile })
      } else if (result.error.kind === 'network') {
        setError(result.error.message)
        if (profile === null) setGate({ kind: 'unavailable' })
      } else {
        leave(true)
      }
      if (repeat) {
        repeat = false
        schedule()
      }
    }

    actions.current = { check: schedule, leave: () => leave(true) }
    if (!isBackendConfigured()) {
      leave(false)
      return () => {
        stopped = true
        discard()
      }
    }

    const {
      data: { subscription },
    } = getAdminClient().auth.onAuthStateChange((event, session) => {
      if (stopped || terminal) return
      if (event === 'SIGNED_OUT') {
        leave(false)
        return
      }
      if (session !== null) {
        if (userId !== null && userId !== session.user.id) {
          discard()
          setGate({ kind: 'checking' })
        }
        userId = session.user.id
      }
      // Auth subscribers must stay short; a refresh-triggering read runs outside this callback.
      schedule()
    })
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') schedule()
    }
    const onStorage = (event: StorageEvent): void => {
      if (event.key === 'knc-admin-auth' || event.key === null) schedule()
    }
    window.addEventListener('focus', onVisible)
    window.addEventListener('storage', onStorage)
    document.addEventListener('visibilitychange', onVisible)
    const poll = setInterval(onVisible, 30_000)
    schedule()
    return () => {
      stopped = true
      discard()
      subscription.unsubscribe()
      window.removeEventListener('focus', onVisible)
      window.removeEventListener('storage', onStorage)
      document.removeEventListener('visibilitychange', onVisible)
      clearInterval(poll)
    }
  }, [navigate])

  return {
    gate,
    error,
    revalidate: useCallback(() => actions.current.check(), []),
    onSignOut: useCallback(() => actions.current.leave(), []),
  }
}

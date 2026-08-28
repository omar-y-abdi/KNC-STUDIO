// The `/admin` gate. On mount it resolves the active session's profile:
//   - no session / no profile -> redirect to `/login` (the public login screen handles sign-in).
//   - backend unconfigured -> redirect to `/login` (which shows the "not configured" notice).
//   - resolved -> render the role's `AdminShell`.
// Sign-out clears the session and routes back to `/login`.
//
// This component (and everything it imports) lives behind a dynamic import in `Root`, so none of the
// admin/auth/supabase-auth code ships on the public critical path.

import type { JSX } from 'preact'
import { lazy, Suspense } from 'preact/compat'
import { useEffect, useState } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import { isBackendConfigured } from '../backend/config'
import { palette } from '../booking/bookingStyles'
import { getActiveProfile, signOut } from './auth'
import { clearAdminNavigationState } from './navigationState'
import { useTheme } from './useTheme'
import type { AdminProfile } from './types'

const AdminShell = lazy(() =>
  import('./AdminShell').then((module) => ({ default: module.AdminShell })),
)
const ForcedPasswordChange = lazy(() =>
  import('./ForcedPasswordChange').then((module) => ({ default: module.ForcedPasswordChange })),
)

type Gate =
  | { readonly kind: 'checking' }
  | { readonly kind: 'forced_change'; readonly profile: AdminProfile }
  | { readonly kind: 'authed'; readonly profile: AdminProfile }
  | { readonly kind: 'redirecting' }

export function AdminApp(): JSX.Element {
  const theme = useTheme()
  const [, navigate] = useLocation()
  const [gate, setGate] = useState<Gate>({ kind: 'checking' })

  useEffect(() => {
    let active = true
    void (async () => {
      if (!isBackendConfigured()) {
        if (active) setGate({ kind: 'redirecting' })
        navigate('/login', { replace: true })
        return
      }
      const result = await getActiveProfile()
      if (!active) return
      if (result.ok) {
        if (result.value.mustChangePassword) {
          setGate({ kind: 'forced_change', profile: result.value })
        } else {
          setGate({ kind: 'authed', profile: result.value })
        }
      } else {
        setGate({ kind: 'redirecting' })
        navigate('/login', { replace: true })
      }
    })()
    return () => {
      active = false
    }
  }, [navigate])

  const onSignOut = async (): Promise<void> => {
    if (gate.kind === 'authed' || gate.kind === 'forced_change') {
      clearAdminNavigationState(sessionStorage, gate.profile.userId)
    }
    await signOut()
    setGate({ kind: 'redirecting' })
    navigate('/login', { replace: true })
  }

  const c = palette(theme.dark)

  // Forced first-login gate — blocks the panel until the barber picks a real password.
  if (gate.kind === 'forced_change') {
    return (
      <Suspense fallback={null}>
        <ForcedPasswordChange
          lang={theme.lang}
          onDone={() =>
            setGate({ kind: 'authed', profile: { ...gate.profile, mustChangePassword: false } })
          }
          onSignOut={() => void onSignOut()}
        />
      </Suspense>
    )
  }

  if (gate.kind !== 'authed') {
    // A minimal, on-brand placeholder while resolving / redirecting (never a flash of admin UI).
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: c.bg,
          color: c.text,
          fontFamily: "'Inter Variable',-apple-system,system-ui,sans-serif",
          fontSize: '14px',
          opacity: 0.7,
        }}
      >
        Laddar …
      </div>
    )
  }

  return (
    <Suspense fallback={null}>
      <AdminShell
        profile={gate.profile}
        dark={theme.dark}
        lang={theme.lang}
        toggleMode={theme.toggleMode}
        setLang={theme.setLang}
        onSignOut={() => void onSignOut()}
      />
    </Suspense>
  )
}

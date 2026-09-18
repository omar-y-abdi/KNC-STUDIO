// The `/admin` gate. Its session lifecycle resolves and revalidates the active profile:
//   - no session / no profile -> redirect to `/login` (the public login screen handles sign-in).
//   - backend unconfigured -> redirect to `/login` (which shows the "not configured" notice).
//   - resolved -> render the role's `AdminShell`.
// Sign-out clears the session and routes back to `/login`.
//
// This component (and everything it imports) lives behind a dynamic import in `Root`, so none of the
// admin/auth/supabase-auth code ships on the public critical path.

import type { JSX } from 'preact'
import { lazy } from 'preact/compat'
import { useLocation } from 'wouter-preact'
import { palette } from '../booking/bookingStyles'
import { adminText } from '../i18n/adminStrings'
import { useTheme } from './useTheme'
import { useAdminSession } from './useAdminSession'
import { LazySurface } from '../ui/LazySurface'

const CmsStudio = lazy(() => import('./cms/Studio'))
const CmsPreview = lazy(() => import('./cms/Preview'))

const AdminShell = lazy(() =>
  import('./AdminShell').then((module) => ({ default: module.AdminShell })),
)
const ForcedPasswordChange = lazy(() =>
  import('./ForcedPasswordChange').then((module) => ({ default: module.ForcedPasswordChange })),
)

export function AdminApp(): JSX.Element {
  const theme = useTheme()
  const [pathname, navigate] = useLocation()
  const { gate, error, revalidate, onSignOut } = useAdminSession(navigate)

  const c = palette(theme.dark)
  const t = adminText(theme.lang)

  // Forced first-login gate — blocks the panel until the barber picks a real password.
  if (gate.kind === 'forced_change') {
    return (
      <LazySurface
        loadingLabel={t.lazyLoading}
        errorLabel={t.lazyError}
        retryLabel={t.lazyReload}
        minHeight="100vh"
      >
        <ForcedPasswordChange
          key={gate.profile.userId}
          lang={theme.lang}
          onDone={revalidate}
          onSignOut={onSignOut}
        />
      </LazySurface>
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
        {gate.kind === 'unavailable' ? (
          <div role="alert">
            <p>{error}</p>
            <button type="button" onClick={revalidate}>
              {t.lazyReload}
            </button>
          </div>
        ) : (
          t.lazyLoading
        )}
      </div>
    )
  }

  // The additive studio uses the existing session and forced-password gate.
  if (pathname === '/admin/cms' || pathname.startsWith('/admin/cms/')) {
    return gate.profile.role === 'owner' ? (
      <LazySurface
        loadingLabel={t.lazyLoading}
        errorLabel={t.lazyError}
        retryLabel={t.lazyReload}
        minHeight="100vh"
      >
        {pathname.replace(/\/+$/, '') === '/admin/cms/preview' ? (
          <CmsPreview />
        ) : (
          <CmsStudio
            profile={gate.profile}
            initialLang={theme.lang}
            initialMode={theme.dark ? 'dark' : 'light'}
          />
        )}
      </LazySurface>
    ) : (
      <main
        role="alert"
        style={{ minHeight: '100vh', background: c.bg, color: c.text, padding: '32px' }}
      >
        <h1>
          {theme.lang === 'sv'
            ? 'Endast ägaren kan redigera webbplatsen.'
            : 'Only the owner can edit the website.'}
        </h1>
        <button type="button" onClick={() => navigate('/admin')}>
          {theme.lang === 'sv' ? 'Till admin' : 'Back to admin'}
        </button>
      </main>
    )
  }

  return (
    <>
      {error === null ? null : (
        <p role="status" style={{ color: c.text, padding: '12px 20px', margin: 0 }}>
          {error}
        </p>
      )}
      <LazySurface
        loadingLabel={t.lazyLoading}
        errorLabel={t.lazyError}
        retryLabel={t.lazyReload}
        minHeight="100vh"
      >
        <AdminShell
          key={`${gate.profile.userId}:${gate.profile.role}:${gate.profile.barberId ?? ''}`}
          profile={gate.profile}
          dark={theme.dark}
          lang={theme.lang}
          toggleMode={theme.toggleMode}
          setLang={theme.setLang}
          onSignOut={onSignOut}
        />
      </LazySurface>
    </>
  )
}

// The application router — the single entry rendered by `main.tsx`. It keeps the marketing site
// EXACTLY as before at `/` (the `App` component is statically imported and rendered with NO wrapper
// DOM, so the public markup is byte-identical) and LAZY-loads the entire admin surface for `/login`
// and `/admin/*` so none of the admin/auth/supabase-auth code ships on the public critical path.
//
// Routing rules (ADMIN_SPEC §4):
//   `/`            -> the existing site (unchanged)
//   `/login`       -> admin login (lazy)
//   `/reset`       -> password-recovery landing (lazy)
//   `/invite`      -> staff invitation landing (lazy)
//   `/auth/confirm` -> email-change confirmation landing (lazy)
//   `/admin` + sub -> the panel (lazy, gated)
//   unknown routes -> visible not-found page
//
// wouter's `<Route>` adds no wrapper element, so on `/` the rendered tree is just `<App/>` — the same
// DOM the old `render(<App/>)` produced. The lazy admin chunk is fetched only when a user actually
// navigates to `/login` or `/admin`.

import type { JSX } from 'preact'
import { lazy } from 'preact/compat'
import { Suspense } from 'preact/compat'
import { Route, Switch, useLocation } from 'wouter-preact'
import { useEffect } from 'preact/hooks'
import { privatePageTitle } from '../site/routeMetadata'
import { App } from './App'
import { NotFound } from './NotFound'

// One dynamic import for the whole admin surface (login + panel share this chunk).
const AdminEntry = lazy(() => import('../admin/index'))

/** Lightweight fallback while the admin chunk loads (no admin code; plain neutral text). */
function AdminFallback(): JSX.Element {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: "'Inter Variable',-apple-system,system-ui,sans-serif",
        fontSize: '14px',
        opacity: 0.6,
      }}
    >
      Laddar …
    </div>
  )
}

export function Root(): JSX.Element {
  const [pathname] = useLocation()
  useEffect(() => {
    const title = privatePageTitle(pathname)
    if (title !== null) {
      document.title = title
      document.querySelector('meta[name="robots"]')?.setAttribute('content', 'noindex, nofollow')
    }
  }, [pathname])
  return (
    <>
      <Switch>
        {/* Public marketing site — unchanged, rendered with no wrapper so DOM stays byte-identical. */}
        <Route path="/">
          <App />
        </Route>
        <Route path="/about">
          <App />
        </Route>
        <Route path="/booking">
          <App />
        </Route>
        <Route path="/my-bookings">
          <App />
        </Route>

        {/* Admin surface — lazy-loaded. /login, /reset and /admin/* all resolve inside the admin entry. */}
        <Route path="/login">
          <Suspense fallback={<AdminFallback />}>
            <AdminEntry />
          </Suspense>
        </Route>
        {/* Password-recovery landing (the email link target). Lazy, same chunk as login. */}
        <Route path="/reset">
          <Suspense fallback={<AdminFallback />}>
            <AdminEntry />
          </Suspense>
        </Route>
        {/* Staff invitation landing. Token verification waits for an explicit button click. */}
        <Route path="/invite">
          <Suspense fallback={<AdminFallback />}>
            <AdminEntry />
          </Suspense>
        </Route>
        {/* An email scanner may load this route, but only a real button click consumes the token. */}
        <Route path="/auth/confirm">
          <Suspense fallback={<AdminFallback />}>
            <AdminEntry />
          </Suspense>
        </Route>
        {/* Match BOTH the bare `/admin` and any subpath. wouter's `:rest*` matches `/admin/...` and
            `/admin/` but NOT bare `/admin`, so the explicit `/admin` route is required (otherwise a
            post-login navigate('/admin') falls through to the catch-all and redirects home). */}
        <Route path="/admin">
          <Suspense fallback={<AdminFallback />}>
            <AdminEntry />
          </Suspense>
        </Route>
        <Route path="/admin/:rest*">
          <Suspense fallback={<AdminFallback />}>
            <AdminEntry />
          </Suspense>
        </Route>

        {/* Permanent customer tokens are random one-segment paths. The production Worker redirects
            them into a fragment before assets load; this route preserves direct Vite/dev visits. */}
        <Route path="/:customerAccessToken">
          {(params) =>
            /^[0-9a-f]{64}$/i.test(params.customerAccessToken) ? <App /> : <NotFound />
          }
        </Route>

        {/* Unknown -> not found; the Worker supplies HTTP 404 on direct requests. */}
        <Route>
          <NotFound />
        </Route>
      </Switch>
    </>
  )
}

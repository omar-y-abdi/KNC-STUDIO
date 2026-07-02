// The application router — the single entry rendered by `main.tsx`. It keeps the marketing site
// EXACTLY as before at `/` (the `App` component is statically imported and rendered with NO wrapper
// DOM, so the public markup is byte-identical) and LAZY-loads the entire admin surface for `/login`
// and `/admin/*` so none of the admin/auth/supabase-auth code ships on the public critical path.
//
// Routing rules (ADMIN_SPEC §4):
//   `/`            -> the existing site (unchanged)
//   `/login`       -> admin login (lazy)
//   `/admin` + sub -> the panel (lazy, gated)
//   anything else  -> redirect to `/`
//
// wouter's `<Route>` adds no wrapper element, so on `/` the rendered tree is just `<App/>` — the same
// DOM the old `render(<App/>)` produced. The lazy admin chunk is fetched only when a user actually
// navigates to `/login` or `/admin`.

import type { JSX } from 'preact'
import { lazy } from 'preact/compat'
import { Suspense } from 'preact/compat'
import { Redirect, Route, Switch } from 'wouter-preact'
import { Analytics } from '@vercel/analytics/react'
import { SpeedInsights } from '@vercel/speed-insights/react'
import { App } from './App'

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
        fontFamily: "'SF Pro Text',-apple-system,system-ui,sans-serif",
        fontSize: '14px',
        opacity: 0.6,
      }}
    >
      Laddar …
    </div>
  )
}

export function Root(): JSX.Element {
  return (
    <>
      <Switch>
        {/* Public marketing site — unchanged, rendered with no wrapper so DOM stays byte-identical. */}
        <Route path="/" component={App} />

        {/* Admin surface — lazy-loaded. Both /login and /admin/* resolve inside the admin entry. */}
        <Route path="/login">
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

        {/* Unknown -> home. */}
        <Route>
          <Redirect to="/" />
        </Route>
      </Switch>
      <Analytics />
      <SpeedInsights />
    </>
  )
}

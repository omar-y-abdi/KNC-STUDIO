// The admin ENTRY — the single module `Root` dynamically imports. Everything reachable from here
// (login, gate, shell, views, adapters, the admin Supabase client) lands in ONE lazy chunk, OFF the
// public critical path. The public site (`/`) never statically imports this file or anything under
// `src/admin/**`, so none of the admin/auth/supabase-auth code ships to visitors.
//
// It owns the admin-side routing: `/login` -> the login route, `/admin` (+ any subpath) -> the gated
// panel. Anything else under this entry falls back to the panel (which itself redirects to /login
// when unauthenticated).

import type { JSX } from 'preact'
import { lazy, Suspense } from 'preact/compat'
import { Route, Switch } from 'wouter-preact'
import { LoginRoute } from './LoginRoute'
const ResetPasswordRoute = lazy(() =>
  import('./ResetPasswordRoute').then((module) => ({ default: module.ResetPasswordRoute })),
)
const InvitePasswordRoute = lazy(() =>
  import('./InvitePasswordRoute').then((module) => ({ default: module.InvitePasswordRoute })),
)
const EmailChangeConfirmRoute = lazy(() =>
  import('./EmailChangeConfirmRoute').then((module) => ({
    default: module.EmailChangeConfirmRoute,
  })),
)
const AdminApp = lazy(() => import('./AdminApp').then((module) => ({ default: module.AdminApp })))

/** Default export so `Root` can `lazy(() => import('./admin'))` and get this component. */
export default function AdminEntry(): JSX.Element {
  return (
    <Suspense fallback={<div aria-live="polite">Laddar …</div>}>
      <Switch>
        <Route path="/login" component={LoginRoute} />
        <Route path="/reset" component={ResetPasswordRoute} />
        <Route path="/invite" component={InvitePasswordRoute} />
        <Route path="/auth/confirm" component={EmailChangeConfirmRoute} />
        <Route path="/admin/:rest*" component={AdminApp} />
        <Route path="/admin" component={AdminApp} />
      </Switch>
    </Suspense>
  )
}

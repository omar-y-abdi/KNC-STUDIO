// Thin routing wrapper around `LoginPage`: provides the `onSignedIn` callback that navigates to
// `/admin` after a successful sign-in. Kept separate from `LoginPage` (which is presentation +
// the sign-in call) so the page itself stays router-agnostic and easy to reason about.

import type { JSX } from 'preact'
import { useLocation } from 'wouter-preact'
import { LoginPage } from './LoginPage'

export function LoginRoute(): JSX.Element {
  const [, navigate] = useLocation()
  return <LoginPage onSignedIn={() => navigate('/admin', { replace: true })} />
}

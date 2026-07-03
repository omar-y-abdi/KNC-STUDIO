// Thin routing wrapper around `ResetPasswordPage`: provides the `onDone` callback that navigates to
// `/login` (after a successful reset or from an invalid-link screen). Kept separate so the page stays
// router-agnostic — mirrors the `LoginRoute` / `LoginPage` split.

import type { JSX } from 'preact'
import { useLocation } from 'wouter-preact'
import { ResetPasswordPage } from './ResetPasswordPage'

export function ResetPasswordRoute(): JSX.Element {
  const [, navigate] = useLocation()
  return <ResetPasswordPage onDone={() => navigate('/login', { replace: true })} />
}

import type { JSX } from 'preact'
import { useLocation } from 'wouter-preact'
import { ResetPasswordPage } from './ResetPasswordPage'

export function InvitePasswordRoute(): JSX.Element {
  const [, navigate] = useLocation()
  return (
    <ResetPasswordPage linkType="invite" onDone={() => navigate('/login', { replace: true })} />
  )
}

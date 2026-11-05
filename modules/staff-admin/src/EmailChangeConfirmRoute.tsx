import type { JSX } from 'preact'
import { useLocation } from 'wouter-preact'
import { EmailChangeConfirmPage } from './EmailChangeConfirmPage'

export function EmailChangeConfirmRoute(): JSX.Element {
  const [, navigate] = useLocation()
  return (
    <EmailChangeConfirmPage
      onDone={() => navigate('/admin', { replace: true })}
      onInvalid={() => navigate('/login', { replace: true })}
    />
  )
}

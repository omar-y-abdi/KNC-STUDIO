// "Glömt lösenord?" (flow B) on `/login`: request a password-reset email. Supabase sends a recovery
// link to our `/reset` page. To avoid leaking which addresses have accounts, the success message is
// NEUTRAL — shown whether or not the address exists (the request resolves OK either way); only a
// transport failure surfaces as an error.
//
// NOTE (owner infra): delivery needs SMTP configured in Supabase Auth AND `<origin>/reset` allow-listed
// under Auth → URL Configuration, otherwise the link falls back to the Site URL.

import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { Lang } from '../i18n/index'
import { adminText } from '../i18n/adminStrings'
import { palette } from '../booking/bookingStyles'
import { AuthCard, authLinkStyle } from './AuthCard'
import { buildAdminStyles } from './adminStyles'
import { requestPasswordReset } from './auth'
import { useTheme } from './useTheme'

export interface ForgotPasswordFormProps {
  /** The active UI language (threaded from LoginPage — `useTheme` is per-instance). */
  readonly lang: Lang
  /** Return to the sign-in view. */
  readonly onBackToSignIn: () => void
}

type Status =
  | { readonly kind: 'idle' }
  | { readonly kind: 'submitting' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'done' }

/** Where Supabase should send the recovery link. Read at the edge (browser origin) + our route. */
function resetRedirectUrl(): string {
  return `${window.location.origin}/reset`
}

export function ForgotPasswordForm(props: ForgotPasswordFormProps): JSX.Element {
  const { dark } = useTheme()
  const c = palette(dark)
  const s = buildAdminStyles(c, dark)
  const t = adminText(props.lang)

  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const emailRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    emailRef.current?.focus()
  }, [])

  const onSubmit = async (e: JSX.TargetedEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    if (status.kind === 'submitting') return
    setStatus({ kind: 'submitting' })
    const result = await requestPasswordReset(email.trim(), resetRedirectUrl())
    if (result.ok) {
      setStatus({ kind: 'done' })
      return
    }
    setStatus({ kind: 'error', message: result.error.message })
  }

  if (status.kind === 'done') {
    return (
      <AuthCard subtitle={t.forgotPwSubtitle}>
        <p role="status" style={{ ...s.successText, fontSize: '14px', margin: '0 0 18px', lineHeight: 1.5 }}>
          {t.forgotPwSuccess}
        </p>
        <button type="button" style={{ ...s.primaryBtn, width: '100%' }} onClick={props.onBackToSignIn}>
          {t.authToSignIn}
        </button>
      </AuthCard>
    )
  }

  const busy = status.kind === 'submitting'

  return (
    <AuthCard subtitle={t.forgotPwSubtitle}>
      <form onSubmit={onSubmit} noValidate>
        <div style={s.fieldRow}>
          <label htmlFor="fp-email" style={s.label}>
            {t.forgotPwEmailLabel}
          </label>
          <input
            ref={emailRef}
            id="fp-email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onInput={(e) => setEmail(e.currentTarget.value)}
            style={s.input}
          />
        </div>

        <div aria-live="assertive" role="alert" style={{ minHeight: '18px', marginBottom: '12px' }}>
          {status.kind === 'error' ? <span style={s.errorText}>{status.message}</span> : null}
        </div>

        <button
          type="submit"
          disabled={busy}
          style={{
            ...s.primaryBtn,
            width: '100%',
            opacity: busy ? 0.6 : 1,
            cursor: busy ? 'default' : 'pointer',
          }}
        >
          {busy ? t.forgotPwSending : t.forgotPwSubmit}
        </button>
      </form>

      <div style={{ marginTop: '16px', textAlign: 'center' }}>
        <button type="button" style={authLinkStyle(c.accent)} onClick={props.onBackToSignIn}>
          {t.authBackToSignIn}
        </button>
      </div>
    </AuthCard>
  )
}

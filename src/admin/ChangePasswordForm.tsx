// "Byt lösenord" (flow A) on `/login`: change the password of an account that knows its current one.
// Available to EVERY account (owner or barber), no email required. The input is validated locally
// (`validateNewPassword`) before any network call; on success we do NOT enter the panel — we show a
// confirmation and let the user sign in fresh with the new password (see `auth.changePassword`).
//
// Accessibility mirrors the sign-in form: labelled inputs, an assertive `role="alert"` error region,
// autofocus on the first field, Enter submits (native form).

import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { palette } from '../booking/bookingStyles'
import { AuthCard, authLinkStyle } from './AuthCard'
import { buildAdminStyles } from './adminStyles'
import { changePassword } from './auth'
import { validateNewPassword } from './passwordPolicy'
import { useTheme } from './useTheme'

export interface ChangePasswordFormProps {
  /** Return to the sign-in view (cancel, or after a successful change). */
  readonly onBackToSignIn: () => void
}

type Status =
  | { readonly kind: 'idle' }
  | { readonly kind: 'submitting' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'done' }

export function ChangePasswordForm(props: ChangePasswordFormProps): JSX.Element {
  const { dark } = useTheme()
  const c = palette(dark)
  const s = buildAdminStyles(c, dark)

  const [email, setEmail] = useState('')
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const emailRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    emailRef.current?.focus()
  }, [])

  const onSubmit = async (e: JSX.TargetedEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    if (status.kind === 'submitting') return
    const check = validateNewPassword(next, confirm, current)
    if (!check.ok) {
      setStatus({ kind: 'error', message: check.reason })
      return
    }
    setStatus({ kind: 'submitting' })
    const result = await changePassword(email.trim(), current, next)
    if (result.ok) {
      setStatus({ kind: 'done' })
      return
    }
    setStatus({ kind: 'error', message: result.error.message })
  }

  if (status.kind === 'done') {
    return (
      <AuthCard subtitle="Byt lösenord">
        <p role="status" style={{ ...s.successText, fontSize: '14px', margin: '0 0 18px', lineHeight: 1.5 }}>
          Lösenordet är ändrat. Logga in med ditt nya lösenord.
        </p>
        <button type="button" style={{ ...s.primaryBtn, width: '100%' }} onClick={props.onBackToSignIn}>
          Till inloggning
        </button>
      </AuthCard>
    )
  }

  const busy = status.kind === 'submitting'

  return (
    <AuthCard subtitle="Byt lösenord">
      <form onSubmit={onSubmit} noValidate>
        <div style={s.fieldRow}>
          <label htmlFor="cp-email" style={s.label}>
            E‑post
          </label>
          <input
            ref={emailRef}
            id="cp-email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onInput={(e) => setEmail(e.currentTarget.value)}
            style={s.input}
          />
        </div>

        <div style={s.fieldRow}>
          <label htmlFor="cp-current" style={s.label}>
            Nuvarande lösenord
          </label>
          <input
            id="cp-current"
            type="password"
            autoComplete="current-password"
            required
            value={current}
            onInput={(e) => setCurrent(e.currentTarget.value)}
            style={s.input}
          />
        </div>

        <div style={s.fieldRow}>
          <label htmlFor="cp-next" style={s.label}>
            Nytt lösenord
          </label>
          <input
            id="cp-next"
            type="password"
            autoComplete="new-password"
            required
            value={next}
            onInput={(e) => setNext(e.currentTarget.value)}
            style={s.input}
          />
        </div>

        <div style={s.fieldRow}>
          <label htmlFor="cp-confirm" style={s.label}>
            Bekräfta nytt lösenord
          </label>
          <input
            id="cp-confirm"
            type="password"
            autoComplete="new-password"
            required
            value={confirm}
            onInput={(e) => setConfirm(e.currentTarget.value)}
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
          {busy ? 'Sparar …' : 'Byt lösenord'}
        </button>
      </form>

      <div style={{ marginTop: '16px', textAlign: 'center' }}>
        <button type="button" style={authLinkStyle(c.accent)} onClick={props.onBackToSignIn}>
          Tillbaka till inloggning
        </button>
      </div>
    </AuthCard>
  )
}

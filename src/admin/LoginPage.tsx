// Admin login (`/login`). Email + password -> `signIn`. Three states are explicit:
//   - backend UNCONFIGURED (no VITE_SUPABASE_*): a clear notice, no crash, no network attempt.
//   - submitting: the button is busy + disabled.
//   - error: an inline, aria-live message (wrong credentials / no profile / network).
// On success the parent (`Root`) navigates to `/admin` via the passed `onSignedIn` callback (which
// also receives the resolved profile so the panel renders immediately without a second fetch).
//
// Accessibility: labelled inputs, the error region is `role="alert"` (assertive) so SR users hear
// failures, focus starts on the email field, and Enter submits (native form).

import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { isBackendConfigured } from '../backend/config'
import { palette } from '../booking/bookingStyles'
import { buildAdminStyles } from './adminStyles'
import { signIn } from './auth'
import type { AdminProfile } from './types'
import { useTheme } from './useTheme'

export interface LoginPageProps {
  /** Called with the resolved profile on a successful sign-in (parent then routes to /admin). */
  readonly onSignedIn: (profile: AdminProfile) => void
}

type Status =
  | { readonly kind: 'idle' }
  | { readonly kind: 'submitting' }
  | { readonly kind: 'error'; readonly message: string }

export function LoginPage(props: LoginPageProps): JSX.Element {
  const { dark } = useTheme()
  const c = palette(dark)
  const s = buildAdminStyles(c, dark)
  const configured = isBackendConfigured()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const emailRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (configured) emailRef.current?.focus()
  }, [configured])

  const onSubmit = async (e: JSX.TargetedEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    if (status.kind === 'submitting') return
    setStatus({ kind: 'submitting' })
    const result = await signIn(email.trim(), password)
    if (result.ok) {
      props.onSignedIn(result.value)
      return
    }
    setStatus({ kind: 'error', message: result.error.message })
  }

  const wrapStyle: JSX.CSSProperties = {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
    background: c.bg,
    color: c.text,
    fontFamily: "'SF Pro Text',-apple-system,system-ui,sans-serif",
    WebkitFontSmoothing: 'antialiased',
  }
  const cardStyle: JSX.CSSProperties = {
    width: '100%',
    maxWidth: '380px',
    border: '0.5px solid ' + c.line,
    borderRadius: '16px',
    background: c.card,
    padding: '28px 26px',
    boxShadow: '0 24px 60px rgba(0,0,0,.18)',
  }
  const titleStyle: JSX.CSSProperties = {
    fontFamily: "'SF Pro Display',-apple-system,system-ui,sans-serif",
    fontSize: '22px',
    fontWeight: 700,
    letterSpacing: '-0.3px',
    margin: '0 0 6px',
  }

  return (
    <div style={wrapStyle}>
      <div style={cardStyle}>
        <h1 style={titleStyle}>KNC Studio</h1>
        <p style={{ ...s.sectionLead, marginBottom: '20px' }}>Adminpanel — logga in</p>

        {!configured ? (
          <div role="alert" style={{ ...s.card, margin: 0, background: c.subtle }}>
            <p style={{ margin: 0, fontSize: '13.5px', lineHeight: 1.5 }}>
              Adminpanelen kräver den live-backend som inte är konfigurerad i den här miljön. Sätt
              <code style={{ opacity: 0.8 }}> VITE_SUPABASE_URL</code> och
              <code style={{ opacity: 0.8 }}> VITE_SUPABASE_ANON_KEY</code> för att aktivera
              inloggning.
            </p>
          </div>
        ) : (
          <form onSubmit={onSubmit} noValidate>
            <div style={s.fieldRow}>
              <label htmlFor="admin-email" style={s.label}>
                E‑post
              </label>
              <input
                ref={emailRef}
                id="admin-email"
                type="email"
                autoComplete="username"
                required
                value={email}
                onInput={(e) => setEmail(e.currentTarget.value)}
                style={s.input}
              />
            </div>

            <div style={s.fieldRow}>
              <label htmlFor="admin-password" style={s.label}>
                Lösenord
              </label>
              <input
                id="admin-password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onInput={(e) => setPassword(e.currentTarget.value)}
                style={s.input}
              />
            </div>

            <div aria-live="assertive" style={{ minHeight: '18px', marginBottom: '12px' }}>
              {status.kind === 'error' ? (
                <span style={s.errorText}>
                  {status.message}
                </span>
              ) : null}
            </div>

            <button
              type="submit"
              disabled={status.kind === 'submitting'}
              style={{
                ...s.primaryBtn,
                width: '100%',
                opacity: status.kind === 'submitting' ? 0.6 : 1,
                cursor: status.kind === 'submitting' ? 'default' : 'pointer',
              }}
            >
              {status.kind === 'submitting' ? 'Loggar in …' : 'Logga in'}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}

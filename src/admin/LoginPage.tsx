// Admin login (`/login`) — dressed as the public site, not as a floating widget: the same nav bar
// (barber-pole logo + tracked KNC STUDIO wordmark + the site's theme toggle), the same hero
// typography (tracked kicker, SF Pro Display heading), a booking-panel-style form card, and the
// site footer. Palette/tokens come from the same modules the marketing pages use, so the two
// surfaces cannot drift apart.
//
// States are explicit and complete:
//   - backend UNCONFIGURED (no VITE_SUPABASE_*): a clear notice, no crash, no network attempt.
//   - already signed in: a session check on mount routes straight to /admin (no re-typing).
//   - empty fields: caught locally before any network call.
//   - submitting: the button is busy + disabled (double-submit safe).
//   - error: an inline, aria-live message (wrong credentials / no profile / network).
// On success the parent (`Root`) navigates to `/admin` via the passed `onSignedIn` callback (which
// also receives the resolved profile so the panel renders immediately without a second fetch).
//
// Accessibility: labelled inputs, the error region is `role`d via aria-live assertive, focus starts
// on the email field, and Enter submits (native form).

import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { shellPalette } from '../app/shared'
import { isBackendConfigured } from '../backend/config'
import { palette } from '../booking/bookingStyles'
import { appStrings } from '../i18n/index'
import { PoleLogo } from '../ui/PoleLogo'
import { buildAdminStyles } from './adminStyles'
import { getActiveProfile, signIn } from './auth'
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

const FONT_DISPLAY = "'SF Pro Display',-apple-system,system-ui,sans-serif"

export function LoginPage(props: LoginPageProps): JSX.Element {
  const { dark, toggleMode } = useTheme()
  const c = palette(dark)
  const shell = shellPalette(dark)
  const s = buildAdminStyles(c, dark)
  const tx = appStrings('sv') // the admin surface is Swedish-first (matches the panel)
  const configured = isBackendConfigured()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const emailRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (configured) emailRef.current?.focus()
  }, [configured])

  // A returning barber with a live session skips the form entirely.
  useEffect(() => {
    if (!configured) return
    let active = true
    void getActiveProfile().then((result) => {
      if (active && result.ok) props.onSignedIn(result.value)
    })
    return () => {
      active = false
    }
    // Mount-only: `configured` is a build-time constant and `onSignedIn` navigates away.
  }, [])

  const onSubmit = async (e: JSX.TargetedEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    if (status.kind === 'submitting') return
    const trimmedEmail = email.trim()
    if (trimmedEmail === '' || password === '') {
      setStatus({ kind: 'error', message: 'Fyll i både e‑post och lösenord.' })
      return
    }
    setStatus({ kind: 'submitting' })
    const result = await signIn(trimmedEmail, password)
    if (result.ok) {
      props.onSignedIn(result.value)
      return
    }
    setStatus({ kind: 'error', message: result.error.message })
  }

  // --- chrome (mirrors DesktopSite's nav/footer + App's theme toggle) ---
  const navStyle: JSX.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '12px',
    padding: '15px clamp(20px, 4vw, 30px)',
    background: shell.navBg,
    borderBottom: '.5px solid ' + shell.line,
  }
  const themeTrackStyle: JSX.CSSProperties = {
    position: 'relative',
    width: '54px',
    height: '30px',
    borderRadius: '999px',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    flex: 'none',
    background: dark ? 'rgba(120,120,128,.42)' : 'rgba(120,120,128,.26)',
  }
  const themeKnobStyle: JSX.CSSProperties = {
    position: 'absolute',
    top: '3px',
    left: dark ? '27px' : '3px',
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    background: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 1px 2px rgba(0,0,0,.3)',
    transition: 'left .32s cubic-bezier(.32,.72,0,1)',
  }
  const themeTrackIconStyle: JSX.CSSProperties = dark
    ? {
        position: 'absolute',
        top: '8px',
        left: '9px',
        width: '14px',
        height: '14px',
        opacity: 0.5,
        filter: 'invert(1)',
      }
    : {
        position: 'absolute',
        top: '8px',
        right: '9px',
        width: '14px',
        height: '14px',
        opacity: 0.5,
        filter: 'none',
      }

  const footerStyle: JSX.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '18px clamp(20px, 4vw, 40px)',
    borderTop: '.5px solid ' + shell.line,
    background: shell.footer,
    fontSize: '13px',
    opacity: 0.6,
    flex: 'none',
    flexWrap: 'wrap',
    gap: '8px',
  }

  const panelStyle: JSX.CSSProperties = {
    width: '100%',
    maxWidth: '400px',
    boxSizing: 'border-box',
    border: '0.5px solid ' + c.line,
    borderRadius: '14px',
    background: c.card,
    padding: '22px 22px 20px',
    boxShadow: '0 1px 2px rgba(0,0,0,.04)',
    textAlign: 'left',
  }

  return (
    <div
      style={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        background: shell.bg,
        color: shell.text,
        fontFamily: "'SF Pro Text',-apple-system,system-ui,sans-serif",
        WebkitFontSmoothing: 'antialiased',
      }}
    >
      <div style={navStyle}>
        <a
          href="/"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '9px',
            textDecoration: 'none',
            color: 'inherit',
          }}
          aria-label="KNC Studio — till webbplatsen"
        >
          <PoleLogo uid="login" style={{ width: '26px', height: '26px', flex: 'none' }} />
          <span
            style={{
              fontFamily: FONT_DISPLAY,
              fontWeight: 700,
              letterSpacing: '2px',
              fontSize: 'clamp(16px, 4vw, 20px)',
              whiteSpace: 'nowrap',
            }}
          >
            KNC STUDIO
          </span>
        </a>
        <button
          onClick={toggleMode}
          style={themeTrackStyle}
          title={tx.ariaTheme}
          aria-label={tx.ariaTheme}
        >
          <img
            src={dark ? '/icons/sun.max.svg' : '/icons/moon.svg'}
            alt=""
            style={themeTrackIconStyle}
          />
          <span style={themeKnobStyle}>
            <img
              src={dark ? '/icons/moon.svg' : '/icons/sun.max.svg'}
              alt=""
              style={{ width: '14px', height: '14px', opacity: 0.92 }}
            />
          </span>
        </button>
      </div>

      <main
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          padding: '48px clamp(20px, 5vw, 40px) 56px',
        }}
      >
        <div
          style={{
            fontSize: '13px',
            fontWeight: 600,
            letterSpacing: '1.5px',
            opacity: 0.45,
            marginBottom: '14px',
          }}
        >
          ADMINPANEL
        </div>
        <h1
          style={{
            fontFamily: FONT_DISPLAY,
            fontWeight: 600,
            fontSize: 'clamp(28px, 6vw, 38px)',
            letterSpacing: '-0.8px',
            lineHeight: 1.08,
            margin: '0 0 10px',
          }}
        >
          Logga in
        </h1>
        <p
          style={{
            fontSize: '15px',
            lineHeight: 1.5,
            opacity: 0.5,
            maxWidth: '380px',
            margin: '0 auto 28px',
          }}
        >
          Hantera schema, bokningar och innehåll.
        </p>

        {!configured ? (
          <div role="alert" style={{ ...panelStyle, background: c.subtle }}>
            <p style={{ margin: 0, fontSize: '13.5px', lineHeight: 1.5 }}>
              Adminpanelen kräver den live-backend som inte är konfigurerad i den här miljön. Sätt
              <code style={{ opacity: 0.8 }}> VITE_SUPABASE_URL</code> och
              <code style={{ opacity: 0.8 }}> VITE_SUPABASE_ANON_KEY</code> för att aktivera
              inloggning.
            </p>
          </div>
        ) : (
          <form onSubmit={onSubmit} noValidate style={panelStyle}>
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
              {status.kind === 'error' ? <span style={s.errorText}>{status.message}</span> : null}
            </div>

            <button
              type="submit"
              disabled={status.kind === 'submitting'}
              style={{
                width: '100%',
                padding: '13px',
                border: 'none',
                borderRadius: '11px',
                fontFamily: 'inherit',
                fontSize: '15px',
                fontWeight: 600,
                background: shell.accent,
                color: shell.accentText,
                opacity: status.kind === 'submitting' ? 0.6 : 1,
                cursor: status.kind === 'submitting' ? 'default' : 'pointer',
                transition: 'opacity .15s',
              }}
            >
              {status.kind === 'submitting' ? 'Loggar in …' : 'Logga in'}
            </button>
          </form>
        )}
      </main>

      <div style={footerStyle}>
        <span>{tx.hours}</span>
        <span>{tx.addr}</span>
      </div>
    </div>
  )
}

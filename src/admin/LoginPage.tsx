// Admin login (`/login`) — the staff door, dressed exactly like the site the customers see.
//
// Desktop mirrors the public DESKTOP chrome: the nav bar (pole logo + tracked BLADE & BLEND STUDIO wordmark,
// linking home) with the site's original theme switch, then hero typography (tracked kicker,
// SF Pro Display heading) over a booking-panel-style form card. No footer: staff don't need the
// salon's address or opening hours to sign in.
//
// Mobile mirrors the public MOBILE hero instead: the warm panel surface fills the screen,
// safe-area-aware top row (back-to-site link left, theme switch right — nothing under the notch),
// and the centred pole logo + wordmark above the kicker and form. Same building blocks, same
// tokens (`shellPalette`, booking `palette`, `PoleLogo`, `ThemeSwitch`), so the two surfaces
// cannot drift apart.
//
// States are explicit and complete:
//   - backend UNCONFIGURED (no VITE_SUPABASE_*): a clear notice, no crash, no network attempt.
//   - already signed in: a session check on mount routes straight to /admin (no re-typing).
//   - empty fields: caught locally before any network call.
//   - submitting: the button is busy + disabled (double-submit safe).
//   - error: an inline, aria-live message (wrong credentials / no profile / network).
//
// Accessibility: labelled inputs, aria-live error region, focus starts on the email field, Enter
// submits (native form).

import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { shellPalette } from '../app/shared'
import { isBackendConfigured } from '../backend/config'
import { palette } from '../booking/bookingStyles'
import { appStrings } from '../i18n/index'
import { adminText } from '../i18n/adminStrings'
import { PoleLogo } from '../ui/PoleLogo'
import { authLinkStyle } from './AuthCard'
import { buildAdminStyles } from './adminStyles'
import { ForgotPasswordForm } from './ForgotPasswordForm'
import { LangSwitch, ThemeSwitch, useNarrow } from './chrome'
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

/** Which auth screen the `/login` route shows. Password changes live inside authenticated Settings. */
type LoginView = 'signin' | 'forgot'

const FONT_DISPLAY = "'SF Pro Display',-apple-system,system-ui,sans-serif"

export function LoginPage(props: LoginPageProps): JSX.Element {
  const { dark, lang, toggleMode, setLang } = useTheme()
  const narrow = useNarrow()
  const c = palette(dark)
  const shell = shellPalette(dark)
  const s = buildAdminStyles(c, dark)
  const tx = appStrings(lang) // ThemeSwitch aria label, in the chosen language
  const t = adminText(lang) // the admin surface is Swedish-first (matches the panel)
  const configured = isBackendConfigured()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [view, setView] = useState<LoginView>('signin')
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
      setStatus({ kind: 'error', message: t.loginErrorEmptyFields })
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

  if (view === 'forgot') {
    return <ForgotPasswordForm lang={lang} onBackToSignIn={() => setView('signin')} />
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

  const formBody = !configured ? (
    <div role="alert" style={{ ...panelStyle, background: c.subtle }}>
      <p style={{ margin: 0, fontSize: '13.5px', lineHeight: 1.5 }}>
        {t.loginNotConfiguredPre}
        <code style={{ opacity: 0.8 }}> VITE_SUPABASE_URL</code> {t.loginNotConfiguredMid}
        <code style={{ opacity: 0.8 }}> VITE_SUPABASE_ANON_KEY</code> {t.loginNotConfiguredPost}
      </p>
    </div>
  ) : (
    <form onSubmit={onSubmit} noValidate style={panelStyle}>
      <div style={s.fieldRow}>
        <label htmlFor="admin-email" style={s.label}>
          {t.loginEmailLabel}
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
          {t.loginPasswordLabel}
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
        {status.kind === 'submitting' ? t.loginSubmitting : t.loginSubmit}
      </button>

      <div style={{ display: 'flex', justifyContent: 'center', marginTop: '16px' }}>
        <button type="button" style={authLinkStyle(c.accent)} onClick={() => setView('forgot')}>
          {t.loginForgotPasswordLink}
        </button>
      </div>
    </form>
  )

  const kicker = (
    <div
      style={{
        fontSize: narrow ? '11px' : '13px',
        fontWeight: 600,
        letterSpacing: narrow ? '2.5px' : '1.5px',
        opacity: 0.45,
        marginBottom: '14px',
      }}
    >
      {t.loginKicker}
    </div>
  )

  // ---- MOBILE: the public mobile hero's shape — warm panel surface, safe-area top row, centred
  // pole logo + wordmark, then the form. ----
  if (narrow) {
    return (
      <div
        style={{
          minHeight: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          background: dark ? '#242427' : '#f4f3f0',
          color: shell.text,
          fontFamily: "'SF Pro Text',-apple-system,system-ui,sans-serif",
          WebkitFontSmoothing: 'antialiased',
        }}
      >
        {/* Safe-area-aware top row (mirrors MobileSite's chrome row: nothing under the notch). */}
        <div style={{ flex: 'none', padding: '0 22px' }}>
          <div style={{ height: 'calc(env(safe-area-inset-top, 0px) + 30px)' }} />
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '10px',
            }}
          >
            <a
              href="/"
              style={{
                fontSize: '12px',
                fontWeight: 600,
                textDecoration: 'none',
                color: 'inherit',
                opacity: 0.6,
              }}
            >
              {t.loginBackToSite}
            </a>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <LangSwitch lang={lang} setLang={setLang} dark={dark} />
              <ThemeSwitch dark={dark} onToggle={toggleMode} label={tx.ariaTheme} />
            </div>
          </div>
        </div>

        <main
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            padding: '20px 26px calc(env(safe-area-inset-bottom, 0px) + 48px)',
          }}
        >
          <PoleLogo
            uid="login"
            style={{ width: '66px', height: '66px', margin: '0 0 16px', color: shell.text }}
          />
          <h1
            style={{
              margin: '0 0 16px',
              fontFamily: FONT_DISPLAY,
              fontWeight: 700,
              fontSize: '22px',
              letterSpacing: '2.5px',
            }}
          >
            BLADE & BLEND STUDIO
          </h1>
          {kicker}
          {formBody}
        </main>
      </div>
    )
  }

  // ---- DESKTOP: the public desktop chrome — nav bar + hero typography + form card. ----
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
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          padding: '15px 30px',
          background: shell.navBg,
          borderBottom: '.5px solid ' + shell.line,
        }}
      >
        <a
          href="/"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '9px',
            textDecoration: 'none',
            color: 'inherit',
          }}
          aria-label={t.loginBackToSiteAria}
        >
          <PoleLogo uid="login" style={{ width: '26px', height: '26px', flex: 'none' }} />
          <span
            style={{
              fontFamily: FONT_DISPLAY,
              fontWeight: 700,
              letterSpacing: '2px',
              fontSize: '20px',
              whiteSpace: 'nowrap',
            }}
          >
            BLADE & BLEND STUDIO
          </span>
        </a>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <LangSwitch lang={lang} setLang={setLang} dark={dark} />
          <ThemeSwitch dark={dark} onToggle={toggleMode} label={tx.ariaTheme} />
        </div>
      </div>

      <main
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          padding: '48px 40px 72px',
        }}
      >
        {kicker}
        <h1
          style={{
            fontFamily: FONT_DISPLAY,
            fontWeight: 600,
            fontSize: '38px',
            letterSpacing: '-0.8px',
            lineHeight: 1.08,
            margin: '0 0 10px',
          }}
        >
          {t.loginHeading}
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
          {t.loginLead}
        </p>
        {formBody}
      </main>
    </div>
  )
}

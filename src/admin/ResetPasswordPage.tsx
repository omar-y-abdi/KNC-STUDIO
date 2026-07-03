// `/reset` — the password-recovery landing the email link opens. On mount it reads the recovery
// tokens from the URL (`recoveryLink.ts`; the admin client has `detectSessionInUrl:false`, so we parse
// + establish the session ourselves), then shows a "set new password" form. On success the password is
// updated and the session cleared, so the user signs in fresh (`auth.setNewPassword`).
//
// Phases are explicit: checking the link -> ready (show the form) -> done, or invalid (bad/expired
// link) at any point. Accessibility mirrors the other auth screens (labelled inputs, assertive error
// region, autofocus, native submit).

import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { isBackendConfigured } from '../backend/config'
import { palette } from '../booking/bookingStyles'
import { adminText } from '../i18n/adminStrings'
import { AuthCard } from './AuthCard'
import { buildAdminStyles } from './adminStyles'
import { LangSwitch } from './chrome'
import { establishRecoverySession, exchangeRecoveryCode, setNewPassword } from './auth'
import { parseRecoveryLink } from './recoveryLink'
import { validateNewPassword } from './passwordPolicy'
import { useTheme } from './useTheme'

export interface ResetPasswordPageProps {
  /** Navigate to `/login` (after a successful reset, or from an invalid-link screen). */
  readonly onDone: () => void
}

type Phase =
  | { readonly kind: 'checking' }
  | { readonly kind: 'ready' }
  | { readonly kind: 'invalid'; readonly message: string }
  | { readonly kind: 'done' }

type FormStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'submitting' }
  | { readonly kind: 'error'; readonly message: string }

export function ResetPasswordPage(props: ResetPasswordPageProps): JSX.Element {
  const { dark, lang, setLang } = useTheme()
  const c = palette(dark)
  const s = buildAdminStyles(c, dark)
  const t = adminText(lang)

  const [phase, setPhase] = useState<Phase>({ kind: 'checking' })
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [form, setForm] = useState<FormStatus>({ kind: 'idle' })
  const nextRef = useRef<HTMLInputElement>(null)
  const started = useRef(false)

  // Establish the recovery session from the URL exactly once.
  useEffect(() => {
    if (started.current) return
    started.current = true
    let active = true
    void (async () => {
      if (!isBackendConfigured()) {
        if (active) setPhase({ kind: 'invalid', message: t.resetPwInvalidLink })
        return
      }
      const link = parseRecoveryLink(window.location.hash, window.location.search)
      const result =
        link.kind === 'tokens'
          ? await establishRecoverySession(link.accessToken, link.refreshToken)
          : link.kind === 'code'
            ? await exchangeRecoveryCode(link.code)
            : null
      if (!active) return
      if (result !== null && result.ok) setPhase({ kind: 'ready' })
      else setPhase({ kind: 'invalid', message: t.resetPwInvalidLink })
    })()
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    if (phase.kind === 'ready') nextRef.current?.focus()
  }, [phase.kind])

  const onSubmit = async (e: JSX.TargetedEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    if (form.kind === 'submitting') return
    const check = validateNewPassword(next, confirm)
    if (!check.ok) {
      setForm({ kind: 'error', message: check.reason })
      return
    }
    setForm({ kind: 'submitting' })
    const result = await setNewPassword(next)
    if (result.ok) {
      setPhase({ kind: 'done' })
      return
    }
    setForm({ kind: 'error', message: result.error.message })
  }

  const overlay = (
    <div
      style={{
        position: 'fixed',
        top: 'calc(env(safe-area-inset-top, 0px) + 16px)',
        right: '16px',
        zIndex: 10,
      }}
    >
      <LangSwitch lang={lang} setLang={setLang} dark={dark} />
    </div>
  )

  if (phase.kind === 'checking') {
    return (
      <>
        {overlay}
        <AuthCard subtitle={t.resetPwSubtitle}>
          <p style={{ ...s.mutedText, margin: 0 }}>{t.resetPwChecking}</p>
        </AuthCard>
      </>
    )
  }

  if (phase.kind === 'invalid') {
    return (
      <>
        {overlay}
        <AuthCard subtitle={t.resetPwSubtitle}>
          <p role="alert" style={{ ...s.errorText, fontSize: '14px', margin: '0 0 18px', lineHeight: 1.5 }}>
            {phase.message}
          </p>
          <button type="button" style={{ ...s.primaryBtn, width: '100%' }} onClick={props.onDone}>
            {t.authToSignIn}
          </button>
        </AuthCard>
      </>
    )
  }

  if (phase.kind === 'done') {
    return (
      <>
        {overlay}
        <AuthCard subtitle={t.resetPwSubtitle}>
          <p role="status" style={{ ...s.successText, fontSize: '14px', margin: '0 0 18px', lineHeight: 1.5 }}>
            {t.resetPwSuccess}
          </p>
          <button type="button" style={{ ...s.primaryBtn, width: '100%' }} onClick={props.onDone}>
            {t.authToSignIn}
          </button>
        </AuthCard>
      </>
    )
  }

  const busy = form.kind === 'submitting'

  return (
    <>
      {overlay}
      <AuthCard subtitle={t.resetPwSubtitle}>
        <form onSubmit={onSubmit} noValidate>
          <div style={s.fieldRow}>
            <label htmlFor="rp-next" style={s.label}>
              {t.resetPwNewPassword}
            </label>
            <input
              ref={nextRef}
              id="rp-next"
              type="password"
              autoComplete="new-password"
              required
              value={next}
              onInput={(e) => setNext(e.currentTarget.value)}
              style={s.input}
            />
          </div>

          <div style={s.fieldRow}>
            <label htmlFor="rp-confirm" style={s.label}>
              {t.resetPwConfirmPassword}
            </label>
            <input
              id="rp-confirm"
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onInput={(e) => setConfirm(e.currentTarget.value)}
              style={s.input}
            />
          </div>

          <div aria-live="assertive" role="alert" style={{ minHeight: '18px', marginBottom: '12px' }}>
            {form.kind === 'error' ? <span style={s.errorText}>{form.message}</span> : null}
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
            {busy ? t.resetPwSaving : t.resetPwSubmit}
          </button>
        </form>
      </AuthCard>
    </>
  )
}

// Forced first-login password change for provisioned barber accounts. Shown by `AdminApp` when
// `profile.mustChangePassword` is true — it BLOCKS the panel until the barber picks a new
// password. The owner provisioned the account with the temporary password '123456'; this screen
// validates that the barber does not keep it.
//
// Flow: new + confirm inputs → `validateNewPassword(next, confirm, '123456')` (blocks the default)
//   → `setOwnPasswordKeepSession(next)` (keeps session — barber lands in the panel, not /login)
//   → `clearMustChangePassword()` (clears the flag via the SECURITY DEFINER RPC)
//   → `props.onDone()` (parent flips the gate to `authed`).
//
// A sign-out affordance is present if the barber wants to exit instead.

import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { Lang } from '../i18n/index'
import { adminText } from '../i18n/adminStrings'
import { palette } from '../booking/bookingStyles'
import { AuthCard, authLinkStyle } from './AuthCard'
import { buildAdminStyles } from './adminStyles'
import { clearMustChangePassword, setOwnPasswordKeepSession } from './auth'
import { validateNewPassword } from './passwordPolicy'
import { useTheme } from './useTheme'

export interface ForcedPasswordChangeProps {
  /** The active UI language (threaded from AdminApp — `useTheme` is per-instance). */
  readonly lang: Lang
  /** Called after the password is changed and the flag is cleared — parent enters the panel. */
  readonly onDone: () => void
  /** Called if the barber chooses to sign out instead of completing the change. */
  readonly onSignOut: () => void
}

type Status =
  | { readonly kind: 'idle' }
  | { readonly kind: 'submitting' }
  | { readonly kind: 'error'; readonly message: string }

export function ForcedPasswordChange(props: ForcedPasswordChangeProps): JSX.Element {
  const { dark } = useTheme()
  const c = palette(dark)
  const s = buildAdminStyles(c, dark)
  const t = adminText(props.lang)

  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const nextRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    nextRef.current?.focus()
  }, [])

  const onSubmit = async (e: JSX.TargetedEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault()
    if (status.kind === 'submitting') return

    // Validate: '123456' as current — the barber must not keep the provisioned default.
    const check = validateNewPassword(next, confirm, '123456')
    if (!check.ok) {
      setStatus({ kind: 'error', message: check.reason })
      return
    }

    setStatus({ kind: 'submitting' })

    // Step 1: update the password (stay signed in).
    const pwResult = await setOwnPasswordKeepSession(next)
    if (!pwResult.ok) {
      setStatus({ kind: 'error', message: pwResult.error.message })
      return
    }

    // Step 2: clear the forced-change flag in the DB.
    const clearResult = await clearMustChangePassword()
    if (!clearResult.ok) {
      // The password was changed but the flag is still set — the gate will show again on next
      // login, but the barber can now use their new password. Surface a soft message.
      setStatus({ kind: 'error', message: t.forcedPwClearError })
      return
    }

    // Both steps succeeded — enter the panel.
    props.onDone()
  }

  const busy = status.kind === 'submitting'

  return (
    <AuthCard subtitle={t.forcedPwSubtitle}>
      <p
        style={{
          fontSize: '13.5px',
          lineHeight: 1.55,
          opacity: 0.7,
          margin: '0 0 20px',
        }}
      >
        {t.forcedPwIntro}
      </p>

      <form onSubmit={onSubmit} noValidate>
        <div style={s.fieldRow}>
          <label htmlFor="fp-next" style={s.label}>
            {t.forcedPwNewPassword}
          </label>
          <input
            ref={nextRef}
            id="fp-next"
            type="password"
            autoComplete="new-password"
            required
            value={next}
            onInput={(e) => setNext(e.currentTarget.value)}
            style={s.input}
          />
        </div>

        <div style={s.fieldRow}>
          <label htmlFor="fp-confirm" style={s.label}>
            {t.forcedPwConfirmPassword}
          </label>
          <input
            id="fp-confirm"
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
          {busy ? t.forcedPwSaving : t.forcedPwSubmit}
        </button>
      </form>

      <div style={{ marginTop: '16px', textAlign: 'center' }}>
        <button type="button" style={authLinkStyle(c.accent)} onClick={props.onSignOut}>
          {t.signOut}
        </button>
      </div>
    </AuthCard>
  )
}

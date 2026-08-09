import type { JSX } from 'preact'
import { useState } from 'preact/hooks'
import type { Lang } from '../../i18n/index'
import { adminText } from '../../i18n/adminStrings'
import { changeOwnPassword, requestOwnEmailChange } from '../auth'
import { validateNewPassword } from '../passwordPolicy'
import type { AdminProfile } from '../types'
import type { AdminStylesBundle } from './viewTypes'

export interface SettingsViewProps {
  readonly dark: boolean
  readonly lang: Lang
  readonly s: AdminStylesBundle
  readonly profile: AdminProfile
}

type FormStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'submitting' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'done' }

function validEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

export function SettingsView(props: SettingsViewProps): JSX.Element {
  const { s, profile } = props
  const t = adminText(props.lang)
  const [newEmail, setNewEmail] = useState('')
  const [emailStatus, setEmailStatus] = useState<FormStatus>({ kind: 'idle' })
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [passwordStatus, setPasswordStatus] = useState<FormStatus>({ kind: 'idle' })

  const submitEmail = async (event: JSX.TargetedEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (emailStatus.kind === 'submitting') return
    const email = newEmail.trim().toLowerCase()
    if (!validEmail(email)) {
      setEmailStatus({ kind: 'error', message: t.settingsEmailInvalid })
      return
    }
    if (email === profile.email.toLowerCase()) {
      setEmailStatus({ kind: 'error', message: t.settingsEmailSame })
      return
    }

    setEmailStatus({ kind: 'submitting' })
    const result = await requestOwnEmailChange(email)
    if (!result.ok) {
      setEmailStatus({ kind: 'error', message: result.error.message })
      return
    }
    setNewEmail('')
    setEmailStatus({ kind: 'done' })
  }

  const submitPassword = async (event: JSX.TargetedEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (passwordStatus.kind === 'submitting') return
    const check = validateNewPassword(newPassword, confirmPassword, currentPassword)
    if (!check.ok) {
      setPasswordStatus({ kind: 'error', message: check.reason })
      return
    }

    setPasswordStatus({ kind: 'submitting' })
    const result = await changeOwnPassword(profile.email, currentPassword, newPassword)
    if (!result.ok) {
      setPasswordStatus({ kind: 'error', message: result.error.message })
      return
    }
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
    setPasswordStatus({ kind: 'done' })
  }

  const formStyle: JSX.CSSProperties = {
    maxWidth: '560px',
    marginTop: '22px',
  }
  const dividerStyle: JSX.CSSProperties = {
    border: 0,
    borderTop: s.card.border,
    margin: '28px 0',
  }
  const subheadingStyle: JSX.CSSProperties = {
    margin: '0 0 4px',
    fontSize: '16px',
    fontWeight: 700,
  }

  return (
    <section style={s.card} aria-labelledby="settings-heading">
      <h2 id="settings-heading" style={s.sectionTitle}>
        {t.settingsTitle}
      </h2>
      <p style={s.sectionLead}>{t.settingsLead}</p>

      <div style={formStyle}>
        <form onSubmit={submitEmail} noValidate aria-labelledby="settings-email-heading">
          <h3 id="settings-email-heading" style={subheadingStyle}>
            {t.settingsEmailTitle}
          </h3>
          <p style={{ ...s.mutedText, margin: '0 0 16px', lineHeight: 1.5 }}>
            {t.settingsEmailLead}
          </p>

          <div style={s.fieldRow}>
            <label htmlFor="settings-current-email" style={s.label}>
              {t.settingsCurrentEmail}
            </label>
            <input
              id="settings-current-email"
              type="email"
              value={profile.email}
              readOnly
              style={{ ...s.input, opacity: 0.62 }}
            />
          </div>
          <div style={s.fieldRow}>
            <label htmlFor="settings-new-email" style={s.label}>
              {t.settingsNewEmail}
            </label>
            <input
              id="settings-new-email"
              type="email"
              autoComplete="email"
              required
              value={newEmail}
              placeholder={t.settingsEmailPlaceholder}
              disabled={emailStatus.kind === 'submitting'}
              onInput={(event) => {
                setNewEmail(event.currentTarget.value)
                if (emailStatus.kind !== 'submitting') setEmailStatus({ kind: 'idle' })
              }}
              style={s.input}
            />
          </div>
          <div aria-live="polite" style={{ minHeight: '20px', marginBottom: '10px' }}>
            {emailStatus.kind === 'error' ? (
              <span style={s.errorText}>{emailStatus.message}</span>
            ) : null}
            {emailStatus.kind === 'done' ? (
              <span role="status" style={s.successText}>
                {t.settingsEmailSent}
              </span>
            ) : null}
          </div>
          <button
            type="submit"
            disabled={emailStatus.kind === 'submitting'}
            style={{
              ...s.primaryBtn,
              opacity: emailStatus.kind === 'submitting' ? 0.6 : 1,
              cursor: emailStatus.kind === 'submitting' ? 'default' : 'pointer',
            }}
          >
            {emailStatus.kind === 'submitting' ? t.settingsEmailSaving : t.settingsEmailSubmit}
          </button>
        </form>

        <hr style={dividerStyle} />

        <form onSubmit={submitPassword} noValidate aria-labelledby="settings-password-heading">
          <h3 id="settings-password-heading" style={subheadingStyle}>
            {t.settingsPasswordTitle}
          </h3>
          <p style={{ ...s.mutedText, margin: '0 0 16px', lineHeight: 1.5 }}>
            {t.settingsPasswordLead}
          </p>

          <div style={s.fieldRow}>
            <label htmlFor="settings-current-password" style={s.label}>
              {t.changePwCurrentPassword}
            </label>
            <input
              id="settings-current-password"
              type="password"
              autoComplete="current-password"
              required
              value={currentPassword}
              disabled={passwordStatus.kind === 'submitting'}
              onInput={(event) => {
                setCurrentPassword(event.currentTarget.value)
                if (passwordStatus.kind !== 'submitting') setPasswordStatus({ kind: 'idle' })
              }}
              style={s.input}
            />
          </div>
          <div style={s.fieldRow}>
            <label htmlFor="settings-new-password" style={s.label}>
              {t.changePwNewPassword}
            </label>
            <input
              id="settings-new-password"
              type="password"
              autoComplete="new-password"
              required
              value={newPassword}
              disabled={passwordStatus.kind === 'submitting'}
              onInput={(event) => {
                setNewPassword(event.currentTarget.value)
                if (passwordStatus.kind !== 'submitting') setPasswordStatus({ kind: 'idle' })
              }}
              style={s.input}
            />
          </div>
          <div style={s.fieldRow}>
            <label htmlFor="settings-confirm-password" style={s.label}>
              {t.changePwConfirmPassword}
            </label>
            <input
              id="settings-confirm-password"
              type="password"
              autoComplete="new-password"
              required
              value={confirmPassword}
              disabled={passwordStatus.kind === 'submitting'}
              onInput={(event) => {
                setConfirmPassword(event.currentTarget.value)
                if (passwordStatus.kind !== 'submitting') setPasswordStatus({ kind: 'idle' })
              }}
              style={s.input}
            />
          </div>
          <div aria-live="polite" style={{ minHeight: '20px', marginBottom: '10px' }}>
            {passwordStatus.kind === 'error' ? (
              <span style={s.errorText}>{passwordStatus.message}</span>
            ) : null}
            {passwordStatus.kind === 'done' ? (
              <span role="status" style={s.successText}>
                {t.changePwSuccess}
              </span>
            ) : null}
          </div>
          <button
            type="submit"
            disabled={passwordStatus.kind === 'submitting'}
            style={{
              ...s.primaryBtn,
              opacity: passwordStatus.kind === 'submitting' ? 0.6 : 1,
              cursor: passwordStatus.kind === 'submitting' ? 'default' : 'pointer',
            }}
          >
            {passwordStatus.kind === 'submitting' ? t.changePwSaving : t.changePwSubmit}
          </button>
        </form>
      </div>
    </section>
  )
}

import type { JSX } from 'preact'
import { useState } from 'preact/hooks'
import type { Lang } from '../i18n/index'
import { privacyStrings } from '../i18n/index'
import {
  clearFunctionalStorage,
  readStoragePreferences,
  saveStoragePreferences,
  type StoragePreferences,
} from './storageConsent'

export interface PrivacyBannerProps {
  readonly lang: Lang
  readonly dark: boolean
}

/**
 * Public ePrivacy controls. No analytics or advertising storage exists in this build. Accepting
 * enables only the optional first-party preference cookie; rejecting removes no customer data.
 * Necessary HttpOnly session cookies after email-token authentication remain required by that flow.
 */
export function PrivacyBanner({ lang, dark }: PrivacyBannerProps): JSX.Element {
  const tx = privacyStrings(lang)
  const [saved, setSaved] = useState<StoragePreferences | null>(() => readStoragePreferences())
  const [showPreferences, setShowPreferences] = useState(false)
  const [functional, setFunctional] = useState(() => saved?.functional ?? false)

  const save = (next: StoragePreferences): void => {
    saveStoragePreferences(next)
    if (!next.functional) clearFunctionalStorage()
    setSaved(next)
    setShowPreferences(false)
  }

  const openPreferences = (): void => {
    setFunctional(saved?.functional ?? false)
    setShowPreferences(true)
  }

  const surface = dark ? '#262629' : '#f1f0ec'
  const text = dark ? '#f5f5f7' : '#1c1c1e'
  const line = dark ? 'rgba(255,255,255,.14)' : 'rgba(0,0,0,.12)'
  const muted = dark ? 'rgba(255,255,255,.68)' : 'rgba(0,0,0,.62)'
  const topOffset = 'calc(env(safe-area-inset-top, 0px) + 12px)'
  const buttonStyle: JSX.CSSProperties = {
    border: 'none',
    borderRadius: '10px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontWeight: 600,
    fontSize: '13px',
    padding: '10px 13px',
  }

  if (saved !== null && !showPreferences) {
    return (
      <button
        type="button"
        onClick={openPreferences}
        aria-label={tx.manageLabel}
        style={{
          position: 'fixed',
          zIndex: 30,
          right: '12px',
          top: topOffset,
          background: surface,
          color: text,
          border: '.5px solid ' + line,
          borderRadius: '999px',
          cursor: 'pointer',
          fontFamily: "'Inter Variable',-apple-system,system-ui,sans-serif",
          fontSize: '12px',
          fontWeight: 600,
          padding: '8px 11px',
          boxShadow: '0 5px 18px rgba(0,0,0,.12)',
        }}
      >
        {tx.manage}
      </button>
    )
  }

  return (
    <div
      role="region"
      aria-label={tx.title}
      style={{
        position: 'fixed',
        zIndex: 30,
        right: '12px',
        top: topOffset,
        left: '12px',
        maxWidth: '520px',
        marginLeft: 'auto',
        background: surface,
        color: text,
        border: '.5px solid ' + line,
        borderRadius: '14px',
        boxShadow: '0 16px 40px rgba(0,0,0,.20)',
        padding: '16px',
        fontFamily: "'Inter Variable',-apple-system,system-ui,sans-serif",
      }}
    >
      <strong style={{ display: 'block', fontSize: '15px', marginBottom: '7px' }}>
        {tx.title}
      </strong>
      <p style={{ color: muted, fontSize: '13px', lineHeight: 1.5, margin: '0 0 12px' }}>
        {tx.lead}{' '}
        <a href="/privacy" style={{ color: text, textUnderlineOffset: '3px' }}>
          {tx.privacyLink}
        </a>
      </p>

      {showPreferences ? (
        <div style={{ borderTop: '.5px solid ' + line, marginTop: '12px', paddingTop: '12px' }}>
          <div
            style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', marginBottom: '10px' }}
          >
            <input
              id="functional-storage"
              type="checkbox"
              checked={functional}
              onInput={(event) => setFunctional(event.currentTarget.checked)}
            />
            <label htmlFor="functional-storage" style={{ fontSize: '13px', lineHeight: 1.45 }}>
              <strong style={{ display: 'block' }}>{tx.functionalTitle}</strong>
              <span style={{ color: muted }}>{tx.functionalLead}</span>
            </label>
          </div>
          <p style={{ color: muted, fontSize: '12px', lineHeight: 1.45, margin: '0 0 12px' }}>
            {tx.necessary}
          </p>
          <button
            type="button"
            onClick={() => save({ functional })}
            style={{ ...buttonStyle, background: text, color: surface }}
          >
            {tx.save}
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <button
            type="button"
            onClick={() => save({ functional: true })}
            style={{ ...buttonStyle, background: text, color: surface }}
          >
            {tx.accept}
          </button>
          <button
            type="button"
            onClick={() => save({ functional: false })}
            style={{
              ...buttonStyle,
              background: 'transparent',
              color: text,
              border: '.5px solid ' + line,
            }}
          >
            {tx.reject}
          </button>
          <button
            type="button"
            onClick={openPreferences}
            style={{ ...buttonStyle, background: 'transparent', color: text, paddingInline: '4px' }}
          >
            {tx.preferences}
          </button>
        </div>
      )}
    </div>
  )
}

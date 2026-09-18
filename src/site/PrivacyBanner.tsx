import { useCms, mergeCmsStrings } from '../cms/context'
import type { JSX } from 'preact'
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks'
import type { Lang } from '../i18n/index'
import { privacyStrings } from '../i18n/index'
import type { PrivacyControls } from './usePrivacyPreferences'

export interface PrivacyBannerProps {
  readonly lang: Lang
  readonly dark: boolean
  readonly controls: PrivacyControls
}

/**
 * Public ePrivacy controls. No analytics or advertising storage exists in this build. Accepting
 * permits a first-party receipt for bookings created on this device; rejecting removes no customer data.
 * Necessary HttpOnly session cookies after email-token authentication remain required by that flow.
 */
export function PrivacyBanner({ lang, dark, controls }: PrivacyBannerProps): JSX.Element | null {
  const _cmsPresentation = useCms().presentation

  const tx = mergeCmsStrings(_cmsPresentation, 'privacy', lang, privacyStrings(lang))
  const {
    preferences: saved,
    expanded: showPreferences,
    functional,
    setFunctional,
    choose,
    openPreferences,
  } = controls
  const save = choose
  const panel = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const visible = saved === null || showPreferences
  useLayoutEffect(() => {
    if (!visible || panel.current === null) return
    const root = document.documentElement
    const measure = (): void => {
      if (panel.current === null) return
      const bottom = Number.parseFloat(getComputedStyle(panel.current).bottom) || 0
      root.style.setProperty(
        '--privacy-overlay-space',
        `${panel.current.offsetHeight + bottom + 12}px`,
      )
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(panel.current)
    return () => {
      observer.disconnect()
      root.style.removeProperty('--privacy-overlay-space')
    }
  }, [visible])
  useEffect(() => {
    if (showPreferences) heading.current?.focus({ preventScroll: true })
  }, [showPreferences])

  const surface = dark ? '#262629' : '#f1f0ec'
  const text = dark ? '#f5f5f7' : '#1c1c1e'
  const line = dark ? 'rgba(255,255,255,.14)' : 'rgba(0,0,0,.12)'
  const muted = dark ? 'rgba(255,255,255,.68)' : 'rgba(0,0,0,.62)'
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
    return null
  }

  return (
    <div
      data-cms-node="privacybanner-div-1"
      data-cms-copy="copy:privacy:title"
      ref={panel}
      id="privacy-preferences"
      role="region"
      aria-label={tx.title}
      style={{
        position: 'fixed',
        zIndex: 30,
        right: '12px',
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 12px)',
        left: '12px',
        maxHeight: 'calc(100dvh - 24px)',
        overflowY: 'auto',
        boxSizing: 'border-box',
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
      <h2
        data-cms-node="privacybanner-h2-2"
        data-cms-copy="copy:privacy:title"
        ref={heading}
        tabIndex={-1}
        style={{ fontSize: '15px', margin: '0 0 7px' }}
      >
        {tx.title}
      </h2>
      <p
        data-cms-node="privacybanner-p-3"
        style={{ color: muted, fontSize: '13px', lineHeight: 1.5, margin: '0 0 12px' }}
      >
        {tx.lead}{' '}
        <a
          data-cms-node="privacybanner-a-4"
          data-cms-copy="copy:privacy:privacyLink"
          href="/privacy"
          style={{ color: text, textUnderlineOffset: '3px' }}
        >
          {tx.privacyLink}
        </a>
      </p>

      {showPreferences ? (
        <div
          data-cms-node="privacybanner-div-5"
          style={{ borderTop: '.5px solid ' + line, marginTop: '12px', paddingTop: '12px' }}
        >
          <div
            data-cms-node="privacybanner-div-6"
            style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', marginBottom: '10px' }}
          >
            <input
              data-cms-node="privacybanner-input-7"
              id="functional-storage"
              type="checkbox"
              checked={functional}
              onInput={(event) => setFunctional(event.currentTarget.checked)}
            />
            <label
              data-cms-node="privacybanner-label-8"
              htmlFor="functional-storage"
              style={{ fontSize: '13px', lineHeight: 1.45 }}
            >
              <strong style={{ display: 'block' }}>{tx.functionalTitle}</strong>
              <span
                data-cms-node="privacybanner-span-9"
                data-cms-copy="copy:privacy:functionalLead"
                style={{ color: muted }}
              >
                {tx.functionalLead}
              </span>
            </label>
          </div>
          <p
            data-cms-node="privacybanner-p-10"
            data-cms-copy="copy:privacy:necessary"
            style={{ color: muted, fontSize: '12px', lineHeight: 1.45, margin: '0 0 12px' }}
          >
            {tx.necessary}
          </p>
          <button
            data-cms-node="privacybanner-button-11"
            data-cms-copy="copy:privacy:save"
            type="button"
            onClick={() => save({ functional })}
            style={{ ...buttonStyle, background: text, color: surface }}
          >
            {tx.save}
          </button>
        </div>
      ) : (
        <div
          data-cms-node="privacybanner-div-12"
          style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}
        >
          <button
            data-cms-node="privacybanner-button-13"
            data-cms-copy="copy:privacy:accept"
            type="button"
            onClick={() => save({ functional: true })}
            style={{ ...buttonStyle, background: text, color: surface }}
          >
            {tx.accept}
          </button>
          <button
            data-cms-node="privacybanner-button-14"
            data-cms-copy="copy:privacy:reject"
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
            data-cms-node="privacybanner-button-15"
            data-cms-copy="copy:privacy:preferences"
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

/** Hero-owned reopening control; it scrolls away before About. */
export function PrivacyManageButton({
  lang,
  dark,
  controls,
}: PrivacyBannerProps): JSX.Element | null {
  const _cmsPresentation = useCms().presentation

  if (controls.preferences === null) return null
  const tx = mergeCmsStrings(_cmsPresentation, 'privacy', lang, privacyStrings(lang))
  return (
    <button
      data-cms-node="privacybanner-button-16"
      data-cms-copy="copy:privacy:manage"
      type="button"
      aria-label={tx.manageLabel}
      disabled={controls.expanded}
      onClick={(event) => {
        event.currentTarget.focus()
        controls.openPreferences()
      }}
      style={{
        position: 'absolute',
        left: '12px',
        bottom: 'calc(env(safe-area-inset-bottom, 0px) + 76px)',
        background: dark ? '#262629' : '#f1f0ec',
        color: dark ? '#f5f5f7' : '#1c1c1e',
        border: '.5px solid ' + (dark ? 'rgba(255,255,255,.14)' : 'rgba(0,0,0,.12)'),
        borderRadius: '999px',
        cursor: 'pointer',
        fontFamily: 'inherit',
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

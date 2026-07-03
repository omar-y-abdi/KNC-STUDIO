// Shared admin chrome — the small pieces every admin surface needs to look like the PUBLIC site
// rather than a generic dashboard:
//   ThemeSwitch — the site's original light/dark track+knob toggle (byte-for-byte the same styles
//                 App.tsx builds), so the admin never grows a second, off-brand switch.
//   LangSwitch  — the public nav's mini SV/EN pill pair (pill-track container + two buttons),
//                 extracted so `/login`, `/reset` and the panel share one identical control.
//   WorkSwitch  — the same pill-track control reused as an on/off switch (week editor's
//                 working-day toggle): larger tap target + clearer state than a bare checkbox.
//   useNarrow   — one matchMedia hook for the admin's 760px breakpoint (the same breakpoint the
//                 `.knc-admin-*` CSS uses), so JSX and CSS agree on what "mobile" means.
//
// Pure presentation + one isolated matchMedia effect; no data access.

import type { JSX } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import type { Lang } from '../i18n/index'
import { palette } from '../booking/bookingStyles'

/** The admin surface's single mobile breakpoint (matches the `.knc-admin-*` CSS media query). */
export const ADMIN_NARROW_MQ = '(max-width: 760px)'

/** Reactive matchMedia: true when the viewport matches `query`. SSR-safe (defaults to false). */
export function useNarrow(query: string = ADMIN_NARROW_MQ): boolean {
  const [narrow, setNarrow] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
    return window.matchMedia(query).matches
  })
  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = (e: MediaQueryListEvent): void => setNarrow(e.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])
  return narrow
}

export interface ThemeSwitchProps {
  readonly dark: boolean
  readonly onToggle: () => void
  /** Accessible label (e.g. "Byt tema"). */
  readonly label: string
}

/** The public site's theme toggle (App.tsx's track + knob), extracted verbatim for the admin. */
export function ThemeSwitch(props: ThemeSwitchProps): JSX.Element {
  const { dark } = props
  const trackStyle: JSX.CSSProperties = {
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
  const knobStyle: JSX.CSSProperties = {
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
  const trackIconStyle: JSX.CSSProperties = dark
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
  return (
    <button
      onClick={props.onToggle}
      style={trackStyle}
      title={props.label}
      aria-label={props.label}
    >
      <img src={dark ? '/icons/sun.max.svg' : '/icons/moon.svg'} alt="" style={trackIconStyle} />
      <span style={knobStyle}>
        <img
          src={dark ? '/icons/moon.svg' : '/icons/sun.max.svg'}
          alt=""
          style={{ width: '14px', height: '14px', opacity: 0.92 }}
        />
      </span>
    </button>
  )
}

export interface LangSwitchProps {
  readonly lang: Lang
  readonly setLang: (lang: Lang) => void
  readonly dark: boolean
}

/**
 * The public nav's mini SV/EN language pill, extracted verbatim from AdminShell so every admin
 * surface (`/login`, `/reset`, and the panel) renders the identical control: a pill-track container
 * holding two buttons — the active language gets the accent fill, the other a muted, transparent one.
 */
export function LangSwitch(props: LangSwitchProps): JSX.Element {
  const c = palette(props.dark)
  const pill = (target: Lang): JSX.Element => {
    const on = props.lang === target
    return (
      <button
        type="button"
        onClick={() => props.setLang(target)}
        aria-pressed={on}
        style={{
          border: 'none',
          cursor: 'pointer',
          fontFamily: 'inherit',
          fontSize: '11px',
          fontWeight: 700,
          letterSpacing: '.3px',
          padding: '5px 10px',
          borderRadius: '999px',
          background: on ? c.accent : 'transparent',
          color: on ? c.accentText : c.text,
          opacity: on ? 1 : 0.6,
        }}
      >
        {target.toUpperCase()}
      </button>
    )
  }
  return (
    <div
      style={{
        display: 'flex',
        background: props.dark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.06)',
        borderRadius: '999px',
        padding: '2px',
      }}
    >
      {pill('sv')}
      {pill('en')}
    </div>
  )
}

export interface WorkSwitchProps {
  readonly on: boolean
  readonly onToggle: () => void
  /** Accessible label (e.g. "Jobbar måndag"). */
  readonly label: string
  readonly dark: boolean
}

/**
 * An on/off switch in the same visual family as ThemeSwitch (pill track + sliding knob), sized a
 * notch smaller. `role="switch"` + `aria-checked` so screen readers announce it as a toggle.
 */
export function WorkSwitch(props: WorkSwitchProps): JSX.Element {
  const { on, dark } = props
  const onBg = dark ? '#f5f5f7' : '#1c1c1e'
  const trackStyle: JSX.CSSProperties = {
    position: 'relative',
    width: '46px',
    height: '26px',
    borderRadius: '999px',
    border: 'none',
    cursor: 'pointer',
    padding: 0,
    flex: 'none',
    background: on ? onBg : dark ? 'rgba(120,120,128,.42)' : 'rgba(120,120,128,.26)',
    transition: 'background .25s ease',
  }
  const knobStyle: JSX.CSSProperties = {
    position: 'absolute',
    top: '3px',
    left: on ? '23px' : '3px',
    width: '20px',
    height: '20px',
    borderRadius: '50%',
    background: on && dark ? '#1c1c1e' : '#fff',
    boxShadow: '0 1px 2px rgba(0,0,0,.3)',
    transition: 'left .28s cubic-bezier(.32,.72,0,1), background .25s ease',
  }
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={props.label}
      onClick={props.onToggle}
      style={trackStyle}
    >
      <span style={knobStyle} />
    </button>
  )
}

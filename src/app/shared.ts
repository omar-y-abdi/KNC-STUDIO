// Shared site-shell palette + derived chrome values. Centralises the `c`/`mob*` computations so
// DesktopSite and MobileSite read identical values (no per-file drift).

import type { JSX } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import type { Lang } from '../i18n/index'
import type { BusinessSettings } from '../site/siteChrome'

export type Mode = 'light' | 'dark'

/**
 * Which mutually-exclusive site state is showing. Home always contains the scrollable About section;
 * pressing "Boka tid" opens the booking fold and removes that section from the document.
 */
export type View = 'home' | 'booking'

/** Site-shell palette for a given mode. */
export interface ShellPalette {
  bg: string
  surface: string
  secondarySurface: string
  text: string
  muted: string
  mobileMuted: string
  line: string
  navBg: string
  footer: string
  accent: string
  accentText: string
  iconF: string
}

const DARK: ShellPalette = {
  bg: '#1c1c1e',
  surface: '#242427',
  secondarySurface: 'rgba(255,255,255,.10)',
  text: '#f5f5f7',
  muted: 'rgba(255,255,255,.7)',
  mobileMuted: 'rgba(255,255,255,.55)',
  line: 'rgba(255,255,255,.1)',
  navBg: '#262629',
  footer: '#161618',
  accent: '#f5f5f7',
  accentText: '#1c1c1e',
  iconF: 'invert(1)',
}

const LIGHT: ShellPalette = {
  bg: '#ffffff',
  surface: '#f4f3f0',
  secondarySurface: 'rgba(0,0,0,.06)',
  text: '#1c1c1e',
  muted: 'rgba(0,0,0,.62)',
  mobileMuted: 'rgba(0,0,0,.6)',
  line: 'rgba(0,0,0,.08)',
  navBg: '#f1f0ec',
  footer: '#faf9f6',
  accent: '#1c1c1e',
  accentText: '#ffffff',
  iconF: 'none',
}

export function shellPalette(dark: boolean): ShellPalette {
  return dark ? DARK : LIGHT
}

/** Keep shell animation preferences current when the operating-system setting changes. */
export function useReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)'
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches,
  )
  useEffect(() => {
    const media = window.matchMedia(query)
    const sync = (): void => setReduced(media.matches)
    sync()
    media.addEventListener('change', sync)
    return () => media.removeEventListener('change', sync)
  }, [])
  return reduced
}

/** Shared easing token for the shell animations. */
export const EASE = 'cubic-bezier(.32,.72,0,1)'
export const MOBILE_MQ = '(max-width: 768px)'
export const PANEL_FULL = '100dvh'
export const PANEL_COMPACT = '112px'

/** Shared chrome icon style. */
export function chromeIcon(dark: boolean): JSX.CSSProperties {
  return { width: '15px', height: '15px', filter: shellPalette(dark).iconF, opacity: 0.7 }
}

/**
 * Props every site-shell variant receives. Pre-built `themeToggle`/`langToggle` elements are
 * passed down so the two layouts render byte-identical chrome.
 */
export interface ShellProps {
  readonly mode: Mode
  readonly lang: Lang
  readonly dark: boolean
  readonly c: ShellPalette
  readonly business: BusinessSettings
  readonly themeToggle: JSX.Element
  readonly langToggle: JSX.Element
  readonly chromeIconStyle: JSX.CSSProperties
}

// Shared site-shell palette + derived chrome values. Centralises the source `App`'s `c`/`mob*`
// computations so DesktopSite and MobileSite read identical values (no per-file drift). Every
// literal is copied verbatim from index.html lines 585-636.

import type { JSX } from 'preact'
import type { Lang } from '../i18n/index'

export type Mode = 'light' | 'dark'

/**
 * Which of the three mutually-exclusive site states is showing. The homepage is `'home'` (static
 * hero); pressing "Boka tid" animates to `'booking'`, "Om oss" animates to `'about'` — each its own
 * fold, same animation. A single closed union means no invalid "booking AND about" inhabitant.
 */
export type View = 'home' | 'booking' | 'about'

/** Site-shell palette for a given mode (source `c = dark ? {...} : {...}`). */
export interface ShellPalette {
  bg: string
  text: string
  line: string
  navBg: string
  footer: string
  accent: string
  accentText: string
  iconF: string
}

const DARK: ShellPalette = {
  bg: '#1c1c1e',
  text: '#f5f5f7',
  line: 'rgba(255,255,255,.1)',
  navBg: '#262629',
  footer: '#161618',
  accent: '#f5f5f7',
  accentText: '#1c1c1e',
  iconF: 'invert(1)',
}

const LIGHT: ShellPalette = {
  bg: '#ffffff',
  text: '#1c1c1e',
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

export function mobMuted(dark: boolean): string {
  return dark ? 'rgba(255,255,255,.55)' : 'rgba(0,0,0,.5)'
}

export function mobBtnBg(dark: boolean): string {
  return dark ? 'rgba(255,255,255,.10)' : 'rgba(0,0,0,.06)'
}

/** EASE timing token (source `EASE`). */
export const EASE = 'cubic-bezier(.32,.72,0,1)'
export const MOBILE_MQ = '(max-width: 768px)'
export const PANEL_FULL = '100dvh'
export const PANEL_COMPACT = '112px'

/** Shared chrome icon style (source `chromeIcon`). */
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
  readonly mapsHref: string
  readonly themeToggle: JSX.Element
  readonly langToggle: JSX.Element
  readonly chromeIconStyle: JSX.CSSProperties
}

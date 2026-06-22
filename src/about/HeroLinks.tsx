// The two small underlined hero links rendered under the "Boka tid" button on BOTH layouts:
//   LEFT  = "Om oss"     → smooth-scrolls to the About section (a real <a href="#om-oss">)
//   RIGHT = "Avbokning"  → opens the cancellation popup (a <button>, an action, not navigation)
// Subtle, muted, underlined, theme-aware. Centered, side by side.

import type { JSX } from 'preact'
import { ABOUT_SECTION_ID } from './AboutSection'

export interface HeroLinksProps {
  readonly aboutLabel: string
  readonly cancelLabel: string
  /** Resolved link colour for the current theme (muted text). */
  readonly color: string
  readonly onOpenCancel: () => void
  /** Optional extra top margin (the layouts space this differently). */
  readonly marginTop?: string
}

/** Smooth-scroll to the About section; falls back to the default anchor jump if it's not mounted. */
function scrollToAbout(e: JSX.TargetedMouseEvent<HTMLAnchorElement>): void {
  const el = document.getElementById(ABOUT_SECTION_ID)
  if (el) {
    e.preventDefault()
    el.scrollIntoView({ behavior: 'smooth' })
  }
}

export function HeroLinks(props: HeroLinksProps): JSX.Element {
  const linkStyle: JSX.CSSProperties = {
    color: props.color,
    fontFamily: 'inherit',
    fontSize: '13px',
    fontWeight: 500,
    textDecoration: 'underline',
    textUnderlineOffset: '3px',
    textDecorationThickness: '0.5px',
    background: 'transparent',
    border: 'none',
    padding: 0,
    cursor: 'pointer',
    opacity: 0.75,
  }
  const wrapStyle: JSX.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '18px',
    marginTop: props.marginTop ?? '18px',
  }
  return (
    <div style={wrapStyle}>
      <a href={`#${ABOUT_SECTION_ID}`} onClick={scrollToAbout} style={linkStyle}>
        {props.aboutLabel}
      </a>
      <span aria-hidden="true" style={{ opacity: 0.3, color: props.color }}>
        ·
      </span>
      <button type="button" onClick={props.onOpenCancel} style={linkStyle}>
        {props.cancelLabel}
      </button>
    </div>
  )
}

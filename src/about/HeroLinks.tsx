// The two small underlined hero links rendered under the "Boka tid" button on BOTH layouts:
//   LEFT  = "Om oss"     → animates to the About state  (onOpenAbout, an action — like Boka tid)
//   RIGHT = "Avbokning"  → opens the cancellation popup (onOpenCancel, an action)
// Both are <button>s (state changes, not navigation). Subtle, muted, underlined, theme-aware.

import type { JSX } from 'preact'

export interface HeroLinksProps {
  readonly aboutLabel: string
  readonly cancelLabel: string
  /** Resolved link colour for the current theme (muted text). */
  readonly color: string
  /** Animate to the About state (homepage → about fold). */
  readonly onOpenAbout: () => void
  readonly onOpenCancel: () => void
  /** Optional extra top margin (the layouts space this differently). */
  readonly marginTop?: string
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
      <button type="button" onClick={props.onOpenAbout} style={linkStyle}>
        {props.aboutLabel}
      </button>
      <span aria-hidden="true" style={{ opacity: 0.3, color: props.color }}>
        ·
      </span>
      <button type="button" onClick={props.onOpenCancel} style={linkStyle}>
        {props.cancelLabel}
      </button>
    </div>
  )
}

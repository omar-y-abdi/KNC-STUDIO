// The shared chrome for every screen in the `/login` area — sign-in, change password, forgot
// password, and the `/reset` recovery landing. It centres a single card with the brand title and a
// per-screen subtitle, so the card styling lives in ONE place instead of being copied into four
// components. Presentational only (reads the theme; no state, no effects).

import type { ComponentChildren, JSX } from 'preact'
import { palette } from '../booking/bookingStyles'
import { useTheme } from './useTheme'

export interface AuthCardProps {
  /** The line under the "Blade & Blend Studio" title, e.g. "Adminpanel — logga in". */
  readonly subtitle: string
  /** The screen's body (a form or a status message). */
  readonly children: ComponentChildren
}

/** A borderless text button styled as an inline link (view switches + "back to sign-in"). Shared so
 *  every auth screen renders the same affordance. `accent` is the palette accent colour. */
export function authLinkStyle(accent: string): JSX.CSSProperties {
  return {
    background: 'transparent',
    border: 'none',
    padding: 0,
    color: accent,
    fontFamily: 'inherit',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
  }
}

export function AuthCard(props: AuthCardProps): JSX.Element {
  const { dark } = useTheme()
  const c = palette(dark)

  const wrapStyle: JSX.CSSProperties = {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
    background: c.bg,
    color: c.text,
    fontFamily: "'Inter Variable',-apple-system,system-ui,sans-serif",
    WebkitFontSmoothing: 'antialiased',
  }
  const cardStyle: JSX.CSSProperties = {
    width: '100%',
    maxWidth: '380px',
    border: '0.5px solid ' + c.line,
    borderRadius: '16px',
    background: c.card,
    padding: '28px 26px',
    boxShadow: '0 24px 60px rgba(0,0,0,.18)',
  }
  const titleStyle: JSX.CSSProperties = {
    fontFamily: "'Inter Variable',-apple-system,system-ui,sans-serif",
    fontSize: '22px',
    fontWeight: 700,
    letterSpacing: '-0.3px',
    margin: '0 0 6px',
  }
  const leadStyle: JSX.CSSProperties = {
    fontSize: '13.5px',
    opacity: 0.62,
    margin: '0 0 20px',
    lineHeight: 1.5,
  }

  return (
    <div style={wrapStyle}>
      <div style={cardStyle}>
        <h1 style={titleStyle}>Blade & Blend Studio</h1>
        <p style={leadStyle}>{props.subtitle}</p>
        {props.children}
      </div>
    </div>
  )
}

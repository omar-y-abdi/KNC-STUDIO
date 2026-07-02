// Style bundle for the admin panel. Reuses the booking flow's `Palette` (same SF Pro look, same
// light/dark tokens) so the admin chrome matches the marketing site exactly, but lays out a
// FUNCTIONAL admin surface: a sidebar/tab nav + content area, data tables, and forms. Pure style
// objects — no effects, no rendered-output logic.

import type { JSX } from 'preact'
import type { Palette } from '../booking/bookingStyles'

const FONT_TEXT = "'SF Pro Text',-apple-system,system-ui,sans-serif"
const FONT_DISPLAY = "'SF Pro Display',-apple-system,system-ui,sans-serif"

/** The full set of admin style objects, derived from the active palette + dark flag. */
export interface AdminStyles {
  appShell: JSX.CSSProperties
  sidebar: JSX.CSSProperties
  brand: JSX.CSSProperties
  navList: JSX.CSSProperties
  content: JSX.CSSProperties
  topbar: JSX.CSSProperties
  whoBanner: JSX.CSSProperties
  card: JSX.CSSProperties
  sectionTitle: JSX.CSSProperties
  sectionLead: JSX.CSSProperties
  table: JSX.CSSProperties
  th: JSX.CSSProperties
  td: JSX.CSSProperties
  label: JSX.CSSProperties
  input: JSX.CSSProperties
  textarea: JSX.CSSProperties
  select: JSX.CSSProperties
  primaryBtn: JSX.CSSProperties
  ghostBtn: JSX.CSSProperties
  dangerBtn: JSX.CSSProperties
  iconBtn: JSX.CSSProperties
  pill: JSX.CSSProperties
  emptyState: JSX.CSSProperties
  fieldRow: JSX.CSSProperties
  successText: JSX.CSSProperties
  errorText: JSX.CSSProperties
  mutedText: JSX.CSSProperties
}

/** Apple-system red (light/dark), reused for destructive actions + errors. */
function adminRed(dark: boolean): string {
  return dark ? '#ff453a' : '#ff3b30'
}

/** Apple-system green (light/dark) for "saved" confirmations. */
function adminGreen(dark: boolean): string {
  return dark ? '#30d158' : '#34c759'
}

/** Build the admin style bundle from the palette. */
export function buildAdminStyles(c: Palette, dark: boolean): AdminStyles {
  const red = adminRed(dark)
  const green = adminGreen(dark)
  const subtleLine = '0.5px solid ' + c.line
  return {
    appShell: {
      display: 'flex',
      minHeight: '100vh',
      background: c.bg,
      color: c.text,
      fontFamily: FONT_TEXT,
      WebkitFontSmoothing: 'antialiased',
    },
    sidebar: {
      width: '232px',
      flex: 'none',
      borderRight: subtleLine,
      background: c.card,
      padding: '18px 14px',
      display: 'flex',
      flexDirection: 'column',
      gap: '6px',
      position: 'sticky',
      top: 0,
      alignSelf: 'flex-start',
      height: '100vh',
      boxSizing: 'border-box',
    },
    brand: {
      fontFamily: FONT_DISPLAY,
      fontSize: '17px',
      fontWeight: 700,
      letterSpacing: '-0.2px',
      padding: '4px 8px 14px',
      display: 'flex',
      alignItems: 'center',
      gap: '9px',
    },
    navList: { display: 'flex', flexDirection: 'column', gap: '2px', flex: 1 },
    content: {
      flex: 1,
      minWidth: 0,
      padding: '0 0 64px',
      display: 'flex',
      flexDirection: 'column',
    },
    topbar: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '12px',
      padding: '16px 24px',
      borderBottom: subtleLine,
      position: 'sticky',
      top: 0,
      background: c.bg,
      zIndex: 5,
      flexWrap: 'wrap',
    },
    whoBanner: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      padding: '10px 24px',
      background: c.subtle,
      borderBottom: subtleLine,
      fontSize: '13px',
      fontWeight: 500,
    },
    card: {
      border: subtleLine,
      borderRadius: '14px',
      background: c.card,
      padding: '18px 20px',
      boxShadow: '0 1px 2px rgba(0,0,0,.04)',
      margin: '20px 24px 0',
    },
    sectionTitle: {
      fontFamily: FONT_DISPLAY,
      fontSize: '20px',
      fontWeight: 700,
      letterSpacing: '-0.3px',
      margin: '0 0 4px',
    },
    sectionLead: { fontSize: '13.5px', opacity: 0.62, margin: '0 0 2px', lineHeight: 1.5 },
    table: {
      width: '100%',
      borderCollapse: 'collapse',
      fontSize: '13.5px',
    },
    th: {
      textAlign: 'left',
      fontWeight: 600,
      fontSize: '11px',
      letterSpacing: '0.4px',
      textTransform: 'uppercase',
      opacity: 0.5,
      padding: '8px 10px',
      borderBottom: subtleLine,
      whiteSpace: 'nowrap',
    },
    td: {
      padding: '11px 10px',
      borderBottom: subtleLine,
      verticalAlign: 'middle',
    },
    label: {
      display: 'block',
      fontSize: '12px',
      fontWeight: 600,
      opacity: 0.75,
      margin: '0 0 6px',
    },
    input: {
      width: '100%',
      boxSizing: 'border-box',
      border: '0.5px solid ' + c.inputLine,
      borderRadius: '9px',
      padding: '9px 12px',
      fontFamily: 'inherit',
      fontSize: '14px',
      outline: 'none',
      background: c.input,
      color: c.text,
    },
    textarea: {
      width: '100%',
      boxSizing: 'border-box',
      border: '0.5px solid ' + c.inputLine,
      borderRadius: '9px',
      padding: '10px 12px',
      fontFamily: 'inherit',
      fontSize: '14px',
      lineHeight: 1.5,
      outline: 'none',
      background: c.input,
      color: c.text,
      resize: 'vertical',
      minHeight: '84px',
    },
    select: {
      boxSizing: 'border-box',
      border: '0.5px solid ' + c.inputLine,
      borderRadius: '9px',
      padding: '8px 10px',
      fontFamily: 'inherit',
      fontSize: '14px',
      outline: 'none',
      background: c.input,
      color: c.text,
      cursor: 'pointer',
    },
    primaryBtn: {
      border: 'none',
      borderRadius: '10px',
      padding: '10px 16px',
      fontFamily: 'inherit',
      fontSize: '14px',
      fontWeight: 600,
      cursor: 'pointer',
      background: c.accent,
      color: c.accentText,
    },
    ghostBtn: {
      border: '0.5px solid ' + c.inputLine,
      borderRadius: '10px',
      padding: '9px 14px',
      fontFamily: 'inherit',
      fontSize: '14px',
      fontWeight: 600,
      cursor: 'pointer',
      background: 'transparent',
      color: c.text,
    },
    dangerBtn: {
      border: '0.5px solid ' + red,
      borderRadius: '10px',
      padding: '9px 14px',
      fontFamily: 'inherit',
      fontSize: '14px',
      fontWeight: 600,
      cursor: 'pointer',
      background: 'transparent',
      color: red,
    },
    iconBtn: {
      border: 'none',
      background: c.closeBg,
      width: '30px',
      height: '30px',
      borderRadius: '8px',
      cursor: 'pointer',
      color: c.text,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '14px',
    },
    pill: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '5px',
      padding: '3px 9px',
      borderRadius: '999px',
      fontSize: '11.5px',
      fontWeight: 600,
      background: c.subtle,
      border: subtleLine,
    },
    emptyState: {
      padding: '28px 18px',
      textAlign: 'center',
      fontSize: '13.5px',
      opacity: 0.55,
      lineHeight: 1.5,
    },
    fieldRow: { display: 'flex', flexDirection: 'column', gap: '0', marginBottom: '14px' },
    successText: { color: green, fontSize: '12.5px', fontWeight: 600 },
    errorText: { color: red, fontSize: '12.5px', fontWeight: 600 },
    mutedText: { opacity: 0.55, fontSize: '12.5px' },
  }
}

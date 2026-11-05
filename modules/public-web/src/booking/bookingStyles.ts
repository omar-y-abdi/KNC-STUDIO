// Pure style bundle for the booking flow. Extracted from BookingFlow to keep that file under the
// size budget. Every style object/literal mirrors the original mock; nothing here changes rendered
// output. The per-item styles that depend on selection state (barber card, calendar cell, service
// row, time chip) stay inline in BookingFlow.

import type { JSX } from 'preact'

/** Palette for a given mode. */
export interface Palette {
  bg: string
  card: string
  subtle: string
  line: string
  text: string
  accent: string
  accentText: string
  input: string
  inputLine: string
  closeBg: string
  dot: string
  iconF: string
}

const DARK: Palette = {
  bg: '#1c1c1e',
  card: '#262629',
  subtle: '#2c2c2e',
  line: 'rgba(255,255,255,.13)',
  text: '#f5f5f7',
  accent: '#f5f5f7',
  accentText: '#1c1c1e',
  input: '#2c2c2e',
  inputLine: 'rgba(255,255,255,.22)',
  closeBg: 'rgba(255,255,255,.12)',
  dot: 'rgba(255,255,255,.18)',
  iconF: 'invert(1)',
}

const LIGHT: Palette = {
  bg: '#ffffff',
  card: '#ffffff',
  subtle: '#f6f6f4',
  line: 'rgba(0,0,0,.1)',
  text: '#1c1c1e',
  accent: '#1c1c1e',
  accentText: '#ffffff',
  input: '#ffffff',
  inputLine: 'rgba(0,0,0,.18)',
  closeBg: '#eceae5',
  dot: '#e3e2dd',
  iconF: 'none',
}

export function palette(dark: boolean): Palette {
  return dark ? DARK : LIGHT
}

/** Icon sizing/filter helper. */
function makeIc(c: Palette): (sz: number, op?: number) => JSX.CSSProperties {
  return (sz, op) => ({
    width: sz + 'px',
    height: sz + 'px',
    filter: c.iconF,
    opacity: op === undefined ? 1 : op,
  })
}

/** Calendar prev/next nav button. */
export function makeNavBtn(c: Palette): (on: boolean) => JSX.CSSProperties {
  return (on) => ({
    border: 'none',
    background: on ? c.subtle : 'transparent',
    width: '28px',
    height: '28px',
    borderRadius: '8px',
    cursor: on ? 'pointer' : 'default',
    opacity: on ? 1 : 0.3,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  })
}

/** The static style objects (those not dependent on per-item selection state). */
export interface BookingStyles {
  badgeStyle: JSX.CSSProperties
  rootStyle: JSX.CSSProperties
  checkIconStyle: JSX.CSSProperties
  panelStyle: JSX.CSSProperties
  panelStyleFlush: JSX.CSSProperties
  timePlaceholderStyle: JSX.CSSProperties
  navIconStyle: JSX.CSSProperties
  legendChosenDot: JSX.CSSProperties
  legendClosedDot: JSX.CSSProperties
  chevronStyle: JSX.CSSProperties
  overlayCardStyle: JSX.CSSProperties
  confirmCloseStyle: JSX.CSSProperties
  overlayHeaderStyle: JSX.CSSProperties
  closeBtnStyle: JSX.CSSProperties
  summaryBoxStyle: JSX.CSSProperties
  dividerStyle: JSX.CSSProperties
  inputStyle: JSX.CSSProperties
  bookBtnStyle: JSX.CSSProperties
  successCircleStyle: JSX.CSSProperties
  successCheckStyle: JSX.CSSProperties
  confirmSummaryStyle: JSX.CSSProperties
  calRowStyle: JSX.CSSProperties
  calIconStyle: JSX.CSSProperties
  resetBtnStyle: JSX.CSSProperties
  /** Secondary full-width button — same geometry as `resetBtnStyle`, softer shade (subtle bg +
   * border). Used for the "Mina bokningar" action on the confirmation screen. */
  secondaryBtnStyle: JSX.CSSProperties
  /** Invalid-input variant of `inputStyle`: same geometry, red border + subtle red ring. */
  inputErrorStyle: JSX.CSSProperties
  /** Red note rendered under an invalid field (label geometry, full-opacity red). */
  fieldErrorNoteStyle: JSX.CSSProperties
  /** Generic system/submit-error line shown above the Book button (red, full opacity). */
  submitErrorStyle: JSX.CSSProperties
}

/** Apple-system red, mode-aware (light `#ff3b30`, dark `#ff453a`). */
export function systemRed(dark: boolean): string {
  return dark ? '#ff453a' : '#ff3b30'
}

/**
 * Build the static style bundle. `bookDisabled` only affects `bookBtnStyle`; all other objects
 * depend solely on the palette + dark flag.
 */
export function buildBookingStyles(
  c: Palette,
  dark: boolean,
  bookDisabled: boolean,
): BookingStyles {
  const ic = makeIc(c)
  const red = systemRed(dark)
  return {
    badgeStyle: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '21px',
      height: '21px',
      borderRadius: '50%',
      background: c.accent,
      color: c.accentText,
      fontSize: '12px',
      fontWeight: 700,
      flex: 'none',
    },
    rootStyle: {
      fontFamily: "'Inter Variable',-apple-system,system-ui,sans-serif",
      color: c.text,
      background: c.bg,
      position: 'relative',
      width: '100%',
      boxSizing: 'border-box',
      WebkitFontSmoothing: 'antialiased',
    },
    checkIconStyle: {
      ...ic(17),
      marginLeft: '6px',
      flexShrink: 0,
      filter: dark ? 'invert(1)' : 'none',
    },
    panelStyle: {
      border: '0.5px solid ' + c.line,
      borderRadius: '14px',
      padding: '14px 16px 16px',
      background: c.card,
      boxShadow: '0 1px 2px rgba(0,0,0,.04)',
      width: '100%',
      boxSizing: 'border-box',
    },
    panelStyleFlush: {
      border: '0.5px solid ' + c.line,
      borderRadius: '12px',
      overflow: 'hidden',
      background: c.card,
    },
    timePlaceholderStyle: {
      border: '0.5px dashed ' + c.inputLine,
      borderRadius: '12px',
      padding: '22px 18px',
      fontSize: '13px',
      opacity: 0.5,
      lineHeight: 1.45,
    },
    navIconStyle: ic(11, 0.7),
    legendChosenDot: { width: '8px', height: '8px', borderRadius: '50%', background: c.accent },
    legendClosedDot: { width: '8px', height: '8px', borderRadius: '50%', background: c.dot },
    chevronStyle: ic(11, 0.3),
    overlayCardStyle: {
      width: '100%',
      maxWidth: '400px',
      maxHeight: '100%',
      overflow: 'auto',
      boxSizing: 'border-box',
      position: 'relative',
      background: c.bg,
      color: c.text,
      // The card declares its own font so the popup matches the site WHEREVER it mounts. The booking
      // popup renders inside the font-bearing booking root and would inherit this anyway; the
      // cancellation popup renders at app level (outside that root), so without this its text falls
      // back to the browser default serif. Inputs/buttons inherit from here via `fontFamily:inherit`.
      fontFamily: "'Inter Variable',-apple-system,system-ui,sans-serif",
      WebkitFontSmoothing: 'antialiased',
      borderRadius: '16px',
      boxShadow: '0 24px 60px rgba(0,0,0,.4),0 0 0 .5px ' + c.line,
      animation: 'kncPop .3s cubic-bezier(.32,.72,0,1) both',
    },
    confirmCloseStyle: {
      position: 'absolute',
      top: '12px',
      right: '12px',
      border: 'none',
      background: c.closeBg,
      width: '26px',
      height: '26px',
      borderRadius: '50%',
      fontSize: '15px',
      color: c.text,
      opacity: 0.7,
      cursor: 'pointer',
      lineHeight: 1,
      zIndex: 2,
    },
    overlayHeaderStyle: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '16px 18px 12px',
      borderBottom: '.5px solid ' + c.line,
    },
    closeBtnStyle: {
      border: 'none',
      background: c.closeBg,
      width: '26px',
      height: '26px',
      borderRadius: '50%',
      fontSize: '15px',
      color: 'inherit',
      opacity: 0.7,
      cursor: 'pointer',
      lineHeight: 1,
    },
    summaryBoxStyle: {
      background: c.subtle,
      border: '.5px solid ' + c.line,
      borderRadius: '12px',
      padding: '12px 14px',
      marginBottom: '16px',
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
    },
    dividerStyle: { height: '.5px', background: c.line, margin: '2px 0' },
    inputStyle: {
      border: '.5px solid ' + c.inputLine,
      borderRadius: '9px',
      padding: '10px 12px',
      fontFamily: 'inherit',
      outline: 'none',
      background: c.input,
      color: c.text,
    },
    bookBtnStyle: {
      width: '100%',
      padding: '13px',
      border: 'none',
      borderRadius: '11px',
      fontFamily: 'inherit',
      fontSize: '15px',
      fontWeight: 600,
      cursor: bookDisabled ? 'default' : 'pointer',
      background: bookDisabled ? c.subtle : c.accent,
      color: bookDisabled ? c.text : c.accentText,
      opacity: bookDisabled ? 0.5 : 1,
      transition: 'opacity .15s',
    },
    successCircleStyle: {
      width: '54px',
      height: '54px',
      borderRadius: '50%',
      background: c.subtle,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      margin: '0 auto 14px',
    },
    successCheckStyle: ic(26),
    confirmSummaryStyle: {
      margin: '0 18px',
      background: c.subtle,
      borderRadius: '12px',
      padding: '13px 15px',
      display: 'flex',
      flexDirection: 'column',
      gap: '7px',
    },
    calRowStyle: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      padding: '11px 13px',
      border: '.5px solid ' + c.line,
      borderRadius: '10px',
      textDecoration: 'none',
      color: c.text,
      fontSize: '14px',
      fontWeight: 500,
    },
    calIconStyle: ic(18, 0.8),
    resetBtnStyle: {
      width: '100%',
      padding: '12px',
      border: 'none',
      background: c.accent,
      color: c.accentText,
      borderRadius: '10px',
      fontSize: '15px',
      fontWeight: 600,
      fontFamily: 'inherit',
      cursor: 'pointer',
    },
    secondaryBtnStyle: {
      width: '100%',
      padding: '12px',
      border: '.5px solid ' + c.line,
      background: c.subtle,
      color: c.text,
      borderRadius: '10px',
      fontSize: '15px',
      fontWeight: 600,
      fontFamily: 'inherit',
      cursor: 'pointer',
    },
    // Invalid-input variant: identical geometry to `inputStyle` (same .5px width, radius, padding,
    // font, background, text color) so flagging a field causes NO layout shift — only the border
    // COLOR swaps to the system red, plus a subtle red focus-style ring (mirrors FOCUS_CLS).
    inputErrorStyle: {
      border: '.5px solid ' + red,
      borderRadius: '9px',
      padding: '10px 12px',
      fontFamily: 'inherit',
      outline: 'none',
      background: c.input,
      color: c.text,
      boxShadow: '0 0 0 3px ' + (dark ? 'rgba(255,69,58,.28)' : 'rgba(255,59,48,.28)'),
    },
    // Note under an invalid field: same geometry as the field labels (12px / weight 600) but full
    // opacity and the system red. Rendered only after a failed submit.
    fieldErrorNoteStyle: {
      fontSize: '12px',
      fontWeight: 600,
      color: red,
      lineHeight: 1.45,
    },
    // Generic system/submit-error line above the Book button: on-brand red, full opacity, label
    // geometry. Rendered only when a port submission fails (never on field-validation failure).
    submitErrorStyle: {
      fontSize: '12px',
      fontWeight: 600,
      color: red,
      margin: '0 0 10px',
      lineHeight: 1.45,
    },
  }
}

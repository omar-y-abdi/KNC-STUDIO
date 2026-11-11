import type { JSX } from 'preact'
import type { Palette } from '../booking/bookingStyles'

export interface GuideStyles {
  readonly hero: JSX.CSSProperties
  readonly tile: JSX.CSSProperties
  readonly name: JSX.CSSProperties
  readonly title: JSX.CSSProperties
  readonly sub: JSX.CSSProperties
  readonly steps: JSX.CSSProperties
  readonly step: JSX.CSSProperties
  /** Every step after the first: the same, with the rule above it. */
  readonly nextStep: JSX.CSSProperties
  readonly text: JSX.CSSProperties
  readonly label: JSX.CSSProperties
  readonly glyphTile: JSX.CSSProperties
  readonly glyph: JSX.CSSProperties
  readonly footnote: JSX.CSSProperties
  readonly footer: JSX.CSSProperties
}

export function buildGuideStyles(c: Palette): GuideStyles {
  const step: JSX.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '12px 14px',
  }
  return {
    hero: { padding: '28px 22px 18px', textAlign: 'center' },
    tile: {
      width: '64px',
      height: '64px',
      borderRadius: '15px',
      boxShadow: '0 6px 16px rgba(0,0,0,.18), 0 0 0 .5px ' + c.line,
      display: 'block',
      margin: '0 auto',
    },
    name: { fontSize: '11px', fontWeight: 500, opacity: 0.75, margin: '6px 0 16px' },
    title: {
      fontFamily: "'Inter Variable'",
      fontWeight: 600,
      fontSize: '20px',
      marginBottom: '6px',
    },
    sub: {
      fontSize: '13.5px',
      opacity: 0.6,
      lineHeight: 1.45,
      maxWidth: '300px',
      margin: '0 auto',
    },
    // `padding` and `listStyle` only undo the list element's own.
    steps: {
      margin: '0 18px',
      padding: 0,
      listStyle: 'none',
      background: c.subtle,
      borderRadius: '12px',
      overflow: 'hidden',
    },
    step,
    nextStep: { ...step, borderTop: '.5px solid ' + c.line },
    text: { flex: 1, fontSize: '14px', fontWeight: 500, lineHeight: 1.35, textAlign: 'left' },
    label: { fontWeight: 600 },
    glyphTile: {
      width: '30px',
      height: '30px',
      borderRadius: '8px',
      background: c.bg,
      boxShadow: '0 0 0 .5px ' + c.line,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flex: 'none',
    },
    glyph: { color: c.text },
    footnote: {
      margin: '10px 22px 0',
      fontSize: '12px',
      lineHeight: 1.45,
      opacity: 0.55,
      textAlign: 'center',
      textWrap: 'balance',
    },
    footer: { padding: '16px 18px 18px' },
  }
}

/** When a step row rises in (`.knc-guide-step`): the first at 180 ms, then every 70 ms. */
export function stepDelay(index: number): string {
  return `${180 + 70 * index}ms`
}

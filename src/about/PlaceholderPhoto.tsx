// ============================================================================================
// PLACEHOLDER PHOTO — the single swap point for real imagery.
//
// No real photos exist yet, so this renders a tasteful monochrome surface: a subtle theme-aware
// gradient (Material-ish) + a centered inline-SVG glyph (camera / scissors / person). It is sized
// like a real photo via `aspectRatio`, so dropping in a real image later causes NO layout shift.
//
// CSP NOTE: `img-src 'self'` forbids `data:` URIs and external URLs — so placeholders are pure CSS
// + inline SVG (allowed by `style-src 'unsafe-inline'`), never an <img> with a data/remote source.
//
// TO SWAP IN A REAL IMAGE: self-host the file under `public/photos/…` and replace the inner glyph
// block with:  <img src="/photos/your-file.jpg" alt={alt} style={{width:'100%',height:'100%',
// objectFit:'cover',display:'block'}} />  — keep the same wrapper + `alt`. That's the whole change.
// ============================================================================================

import type { JSX } from 'preact'
import type { Palette } from '../booking/bookingStyles'

/** Which monochrome glyph to center in the placeholder surface. */
export type PlaceholderGlyph = 'camera' | 'scissors' | 'person'

export interface PlaceholderPhotoProps {
  readonly c: Palette
  readonly dark: boolean
  /** Accessible description of what the real photo will show. */
  readonly alt: string
  /** Glyph hint for the placeholder (purely decorative). */
  readonly glyph: PlaceholderGlyph
  /** CSS `aspect-ratio` (e.g. '4 / 3', '1 / 1'). Defaults to a landscape photo. */
  readonly ratio?: string
  /** Optional border radius override (defaults to the 14px booking-card radius). */
  readonly radius?: string
}

/** Inline glyph paths — simple, monochrome, drawn with `currentColor` so they follow the theme. */
function Glyph(props: { glyph: PlaceholderGlyph }): JSX.Element {
  const common = {
    width: '34px',
    height: '34px',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  if (props.glyph === 'scissors') {
    return (
      <svg viewBox="0 0 24 24" {...common} aria-hidden="true">
        <circle cx="6" cy="6" r="3" />
        <circle cx="6" cy="18" r="3" />
        <line x1="20" y1="4" x2="8.12" y2="15.88" />
        <line x1="14.47" y1="14.48" x2="20" y2="20" />
        <line x1="8.12" y1="8.12" x2="12" y2="12" />
      </svg>
    )
  }
  if (props.glyph === 'person') {
    return (
      <svg viewBox="0 0 24 24" {...common} aria-hidden="true">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" />
      </svg>
    )
  }
  // camera
  return (
    <svg viewBox="0 0 24 24" {...common} aria-hidden="true">
      <path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <circle cx="12" cy="12.5" r="3.2" />
    </svg>
  )
}

/**
 * A photo-shaped placeholder surface. Monochrome gradient + centered glyph; theme-aware via the
 * booking palette. Swap the inner block for a real self-hosted `<img>` when imagery exists.
 */
export function PlaceholderPhoto(props: PlaceholderPhotoProps): JSX.Element {
  const { c, dark } = props
  // A soft diagonal gradient between the card and the slightly-deeper subtle surface — reads as a
  // Material "surface" tile rather than a flat grey box.
  const gradient = dark
    ? `linear-gradient(135deg, ${c.subtle} 0%, #1f1f21 100%)`
    : `linear-gradient(135deg, ${c.subtle} 0%, #ecebe6 100%)`
  const wrapStyle: JSX.CSSProperties = {
    position: 'relative',
    width: '100%',
    aspectRatio: props.ratio ?? '4 / 3',
    borderRadius: props.radius ?? '14px',
    overflow: 'hidden',
    background: gradient,
    border: '0.5px solid ' + c.line,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    // The glyph is a low-contrast watermark — present but quiet, on-brand.
    color: dark ? 'rgba(255,255,255,.22)' : 'rgba(0,0,0,.18)',
  }
  return (
    <div style={wrapStyle} role="img" aria-label={props.alt}>
      <Glyph glyph={props.glyph} />
    </div>
  )
}

// Decorative neutral avatar when a barber has no published portrait; the adjacent name labels them.
import type { JSX } from 'preact'
import type { Palette } from '../booking/bookingStyles'

interface PlaceholderPhotoProps {
  readonly c: Palette
  readonly dark: boolean
}

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
    aspectRatio: '1 / 1',
    borderRadius: '14px',
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
    <div style={wrapStyle} aria-hidden="true">
      <svg
        width="34"
        height="34"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" />
      </svg>
    </div>
  )
}

import { useNativeChild } from '../../cms/NativeSurface'
import type { JSX } from 'preact'

export interface CornerMarkProps {
  readonly height: number
  readonly style?: JSX.CSSProperties
}

// Compact horizontal corner lockup — a small "BNB" emblem (thin rule above and below) followed by the
// "BLADE & BLEND" wordmark. Playfair Display, self-hosted, `currentColor` (theme-following). Used at
// the top-left corner of both surfaces: the desktop nav, and the mobile compact header that appears
// once a booking/section opens.
//
// SVG presentation attributes are kebab-case (Preact does not translate camelCase → SVG attributes).
export function CornerMark({ height, style }: CornerMarkProps): JSX.Element {
  const present = useNativeChild()
  return present(
    <svg
      viewBox="0 0 322 48"
      height={height}
      width={(322 / 48) * height}
      role="img"
      aria-label="Blade & Blend Studio"
      fill="currentColor"
      style={style}
    >
      <line x1="6" y1="9" x2="52" y2="9" stroke="currentColor" stroke-width="1.6" />
      <text
        x="29"
        y="33"
        text-anchor="middle"
        font-family="'Playfair Display'"
        font-weight={400}
        font-size={21}
        letter-spacing="4"
      >
        BNB
      </text>
      <line x1="6" y1="40" x2="52" y2="40" stroke="currentColor" stroke-width="1.6" />
      <text
        x="70"
        y="32"
        text-anchor="start"
        font-family="'Playfair Display'"
        font-weight={700}
        font-size={22}
        letter-spacing="3"
      >
        BLADE &amp; BLEND
      </text>
    </svg>,
  )
}

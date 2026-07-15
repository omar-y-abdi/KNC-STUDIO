import type { JSX } from 'preact'

export interface MonogramProps {
  readonly height: number
  readonly style?: JSX.CSSProperties
}

// Standalone "B&B" monogram — two serif B's with an interlocking italic ampersand (Playfair Display,
// self-hosted). Renders in `currentColor` to follow the theme. Used as the centered desktop-home mark
// (fills the hero without repeating the wordmark, which already sits in the nav corner).
//
// SVG presentation attributes are kebab-case on purpose (Preact does not translate camelCase → SVG
// attribute names).
export function Monogram({ height, style }: MonogramProps): JSX.Element {
  return (
    <svg
      viewBox="0 0 224 165"
      height={height}
      width={(224 / 165) * height}
      role="img"
      aria-label="Blade & Blend Studio"
      fill="currentColor"
      style={style}
    >
      <text x="56" y="128" text-anchor="middle" font-family="'Playfair Display'" font-weight={700} font-size={150}>
        B
      </text>
      <text x="168" y="128" text-anchor="middle" font-family="'Playfair Display'" font-weight={700} font-size={150}>
        B
      </text>
      <text
        x="112"
        y="134"
        text-anchor="middle"
        font-family="'Playfair Display'"
        font-weight={700}
        font-style="italic"
        font-size={122}
      >
        &amp;
      </text>
    </svg>
  )
}

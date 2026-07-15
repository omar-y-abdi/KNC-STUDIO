import type { JSX } from 'preact'

export interface DeskLockupProps {
  readonly height: number
  readonly style?: JSX.CSSProperties
}

// Desktop-home hero mark — B&B monogram + ─ STUDIO ─ + tagline. Deliberately omits the "BLADE & BLEND"
// wordmark, which already sits in the nav corner (CornerMark), so the centre doesn't repeat the name.
// Elegant high-contrast serif (Playfair Display, self-hosted), `currentColor` (theme-following, no gold).
//
// SVG presentation attributes are kebab-case (Preact does not translate camelCase → SVG attributes).
export function DeskLockup({ height, style }: DeskLockupProps): JSX.Element {
  return (
    <svg
      viewBox="0 0 460 258"
      height={height}
      width={(460 / 258) * height}
      role="img"
      aria-label="Blade & Blend Studio"
      fill="currentColor"
      style={style}
    >
      <text x="174" y="150" text-anchor="middle" font-family="'Playfair Display'" font-weight={700} font-size={150}>
        B
      </text>
      <text x="286" y="150" text-anchor="middle" font-family="'Playfair Display'" font-weight={700} font-size={150}>
        B
      </text>
      <text
        x="230"
        y="156"
        text-anchor="middle"
        font-family="'Playfair Display'"
        font-weight={700}
        font-style="italic"
        font-size={122}
      >
        &amp;
      </text>
      <line x1="70" y1="196" x2="150" y2="196" stroke="currentColor" stroke-width="1.4" />
      <text
        x="230"
        y="203"
        text-anchor="middle"
        font-family="'Playfair Display'"
        font-weight={400}
        font-size={20}
        letter-spacing="10"
      >
        STUDIO
      </text>
      <line x1="310" y1="196" x2="390" y2="196" stroke="currentColor" stroke-width="1.4" />
      <text
        x="230"
        y="246"
        text-anchor="middle"
        font-family="'Playfair Display'"
        font-weight={400}
        font-size={12.5}
        letter-spacing="2"
      >
        SHARPEN YOUR LOOK. ELEVATE YOUR STANDARD.
      </text>
    </svg>
  )
}

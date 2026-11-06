import { useNativeChild } from '../../cms/NativeSurface'
import type { JSX } from 'preact'

export interface HeroLockupProps {
  readonly height: number
  readonly style?: JSX.CSSProperties
}

// Full brand lockup — B&B monogram + "BLADE & BLEND" wordmark + ─ STUDIO ─ + tagline.
// Elegant high-contrast serif (Playfair Display, self-hosted in /fonts). Renders in `currentColor`
// so it follows the theme (near-black in light, off-white in dark) — no gold; the site palette owns
// the colour. Used as the centered mobile-home hero mark.
//
// NOTE: SVG presentation attributes are written kebab-case (`text-anchor`, `font-family`, …). Preact
// does not translate camelCase prop names to these SVG attribute names, so camelCase would be dropped
// and the glyphs would fall back to a default font / lose alignment.
export function HeroLockup({ height, style }: HeroLockupProps): JSX.Element {
  const present = useNativeChild()
  return present(
    <svg
      viewBox="0 0 460 330"
      height={height}
      width={(460 / 330) * height}
      role="img"
      aria-label="Blade & Blend Studio"
      fill="currentColor"
      style={style}
    >
      <text
        x="174"
        y="150"
        text-anchor="middle"
        font-family="'Playfair Display'"
        font-weight={700}
        font-size={150}
      >
        B
      </text>
      <text
        x="286"
        y="150"
        text-anchor="middle"
        font-family="'Playfair Display'"
        font-weight={700}
        font-size={150}
      >
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
      <text
        x="230"
        y="216"
        text-anchor="middle"
        font-family="'Playfair Display'"
        font-weight={400}
        font-size={36}
        letter-spacing="7"
      >
        BLADE &amp; BLEND
      </text>
      <line x1="70" y1="244" x2="150" y2="244" stroke="currentColor" stroke-width="1.4" />
      <text
        x="230"
        y="251"
        text-anchor="middle"
        font-family="'Playfair Display'"
        font-weight={400}
        font-size={20}
        letter-spacing="10"
      >
        STUDIO
      </text>
      <line x1="310" y1="244" x2="390" y2="244" stroke="currentColor" stroke-width="1.4" />
      <text
        x="230"
        y="296"
        text-anchor="middle"
        font-family="'Playfair Display'"
        font-weight={400}
        font-size={12.5}
        letter-spacing="2"
      >
        SHARPEN YOUR LOOK · ELEVATE YOUR STANDARDS
      </text>
    </svg>,
  )
}

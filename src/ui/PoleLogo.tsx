import type { JSX } from 'preact'

export interface PoleLogoProps {
  /** Unique suffix so the internal clipPath id doesn't collide between instances. */
  readonly uid: string
  readonly style?: JSX.CSSProperties
}

// Inline barber-pole logo. Rendered inline (not via <img>) so it stays a crisp vector on Retina
// — an <img> + CSS `filter` is rasterized at low resolution by iOS Safari and looks blurry.
// Colour follows the theme through `currentColor` (set `color` on it via `style`); the stripe
// scroll comes from the global `.knc-stripes` keyframes (which respect prefers-reduced-motion).
export function PoleLogo(props: PoleLogoProps): JSX.Element {
  const clip = `kncPole-${props.uid}`
  return (
    <svg
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={props.style}
      aria-hidden="true"
    >
      <defs>
        <clipPath id={clip}>
          <rect x="25" y="15" width="14" height="34" rx="3" />
        </clipPath>
      </defs>
      <rect x="22" y="10" width="20" height="5" rx="2.5" fill="currentColor" stroke="none" />
      <rect x="22" y="49" width="20" height="5" rx="2.5" fill="currentColor" stroke="none" />
      <rect x="25" y="15" width="14" height="34" rx="3" />
      <g clip-path={`url(#${clip})`}>
        <g class="knc-stripes" strokeWidth={3.4}>
          <line x1="5" y1="31" x2="59" y2="-23" />
          <line x1="5" y1="38" x2="59" y2="-16" />
          <line x1="5" y1="45" x2="59" y2="-9" />
          <line x1="5" y1="52" x2="59" y2="-2" />
          <line x1="5" y1="59" x2="59" y2="5" />
          <line x1="5" y1="66" x2="59" y2="12" />
          <line x1="5" y1="73" x2="59" y2="19" />
          <line x1="5" y1="80" x2="59" y2="26" />
          <line x1="5" y1="87" x2="59" y2="33" />
        </g>
      </g>
    </svg>
  )
}

import type { JSX } from 'preact'

export type Glyph = 'page-menu' | 'more' | 'share' | 'add-to-home-screen'

function drawing(glyph: Glyph): JSX.Element {
  switch (glyph) {
    case 'page-menu':
      return <path d="M4 7h16M4 12h16M4 17h10" />
    case 'more':
      return (
        <>
          {[5, 12, 19].map((cx) => (
            <circle key={cx} cx={cx} cy="12" r="1.4" fill="currentColor" stroke="none" />
          ))}
        </>
      )
    case 'share':
      return (
        <>
          <path d="M8 10H7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2h-1" />
          <path d="M12 14V3M8.5 6.5 12 3l3.5 3.5" />
        </>
      )
    case 'add-to-home-screen':
      return (
        <>
          <rect x="4" y="4" width="16" height="16" rx="4" />
          <path d="M12 8.5v7M8.5 12h7" />
        </>
      )
  }
}

export function GlyphIcon(props: {
  readonly glyph: Glyph
  readonly style: JSX.CSSProperties
}): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      stroke-width="1.5"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      style={props.style}
    >
      {drawing(props.glyph)}
    </svg>
  )
}

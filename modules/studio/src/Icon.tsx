import type { JSX } from 'preact'

const paths = {
  home: 'm3 10 9-7 9 7M5 9v12h14V9M9 21v-8h6v8',
  page: 'M14 3H5v18h14V8Zm0 0v5h5M8 12h8M8 16h6',
  image: 'M3 3h18v18H3ZM3 16l5-5 5 5 3-3 5 5M16 7h.01',
  palette:
    'M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 1-3.7 1.4 1.4 0 0 1 .7-2.6H18A3 3 0 0 0 21 12a9 9 0 0 0-9-9ZM7 9h.01M11 6h.01M16 8h.01M6 14h.01',
  business: 'M4 21V4h11v17M15 10h5v11M8 8h3M8 12h3M8 16h3M2 21h20',
  mail: 'M3 5h18v14H3ZM3 6l9 7 9-7',
  history: 'M3 11a9 9 0 1 1 2.7 7M3 4v7h7M12 7v5l3 2',
  backup: 'M4 4h14l3 3v14H3V4ZM7 4v6h10V4M7 21v-7h10v7',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  close: 'm6 6 12 12M6 18 18 6',
  external: 'M14 3h7v7M21 3 10 14M10 3H3v18h18v-7',
  desktop: 'M3 4h18v13H3ZM8 21h8M12 17v4',
  mobile: 'M7 2h10v20H7ZM11 18h2',
  compare: 'M3 4h7v16H3ZM14 4h7v16h-7',
  fit: 'M3 9V3h6M15 3h6v6M21 15v6h-6M9 21H3v-6',
  undo: 'M8 4 3 9l5 5M3 9h11a7 7 0 0 1 0 14',
  redo: 'm16 4 5 5-5 5M21 9H10a7 7 0 0 0 0 14',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Zm10-3a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
  edit: 'm15 4 5 5M4 20l4-1L21 6l-5-5L3 14Zm0 0 4-1',
  sliders: 'M4 3v8m0 6v4M12 3v3m0 6v9M20 3v11m0 6v1M1 11h6v6H1ZM9 6h6v6H9ZM17 14h6v6h-6Z',
  layers: 'm12 3 10 5-10 5L2 8Zm-10 9 10 5 10-5M2 16l10 5 10-5',
  check: 'm5 12 4 4L19 6',
  arrowLeft: 'M20 12H4m6-6-6 6 6 6',
  arrowRight: 'M4 12h16m-6-6 6 6-6 6',
  arrowUp: 'M12 20V4m-6 6 6-6 6 6',
  arrowDown: 'M12 4v16m-6-6 6 6 6-6',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM12 11v6M12 7h.01',
  search: 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm5 12 6 6',
} as const

/** Decorative icons share a single stroke; the adjacent label owns the accessible name. */
export function CmsIcon({ name }: { name: keyof typeof paths }): JSX.Element {
  return (
    <svg
      class="cms-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[name]} />
    </svg>
  )
}

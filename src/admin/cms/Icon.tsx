import type { JSX } from 'preact'

const paths = {
  pages: 'M5 3h9l5 5v13H5V3Zm9 0v5h5M8 12h8M8 16h6',
  home: 'm3 10 9-7 9 7M5 9v12h5v-7h4v7h5V9',
  settings: 'M4 7h16M4 17h16M8 4v6M16 14v6',
  mail: 'M3 5h18v14H3V5Zm0 1 9 7 9-7',
  backup: 'M4 4h16v5H4V4Zm1 5v12h14V9M9 13h6',
  history: 'M3 11a9 9 0 1 1 3 8M3 4v7h7M12 7v5l3 2',
  undo: 'M4 5v6h6M4 11l4-4a7 7 0 0 1 12 5v6',
  redo: 'M20 5v6h-6M20 11l-4-4a7 7 0 0 0-12 5v6',
  publish: 'm5 12 4 4L19 6',
  preview: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Zm7 0a3 3 0 1 0 6 0 3 3 0 0 0-6 0',
  close: 'm6 6 12 12M18 6 6 18',
  desktop: 'M3 4h18v13H3V4Zm9 13v4M8 21h8',
  mobile: 'M7 2h10v20H7V2Zm4 17h2',
  arrow: 'M19 12H5m6-6-6 6 6 6',
} as const

/** One stroke vocabulary for editor chrome; canvas artwork remains owned by the site. */
export function CmsIcon({ name }: { name: keyof typeof paths }): JSX.Element {
  return (
    <svg
      class="cms-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={paths[name]} />
    </svg>
  )
}

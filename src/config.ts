// Single source of truth for business facts + deploy-time configuration.
// Effects (env, time) are isolated here so the domain layer stays pure + referentially transparent.

/** Immutable business facts (mirrors the salon's real details). */
export const BUSINESS = {
  name: 'KNC Studio',
  street: 'Geijersgatan 10',
  postalCode: '411 34',
  city: 'Göteborg',
  phoneDisplay: '079‑304 36 71',
  phoneTel: '0793043671',
  mapsHref: 'https://maps.apple.com/?q=Geijersgatan%2010,%20G%C3%B6teborg',
} as const

// --- Injectable clock (effect at the edge) -------------------------------------------------
// Production uses the real current day. The visual-regression run pins the original mock's
// "today" (2026-06-19) so the calendar baseline matches ../project/index.html exactly.

export type Clock = () => Date

const FIXED_DEMO_DAY = Object.freeze({ year: 2026, monthIndex: 5, day: 19 })

export const realClock: Clock = () => new Date()
export const fixedClock: Clock = () =>
  new Date(FIXED_DEMO_DAY.year, FIXED_DEMO_DAY.monthIndex, FIXED_DEMO_DAY.day)

/** Default clock selected by build-time env; `fixed` only for the baseline run. */
export const defaultClock: Clock = import.meta.env.VITE_CLOCK === 'fixed' ? fixedClock : realClock

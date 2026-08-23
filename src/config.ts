// Shipped fallbacks + deploy-time configuration.
// Effects (env, time) are isolated here so the domain layer stays pure + referentially transparent.

export { DEFAULT_BUSINESS } from './site/business'

// --- Injectable clock (effect at the edge) -------------------------------------------------
// Production uses the real current day. The visual-regression run pins a fixed "today"
// (2026-06-19) so the calendar baseline stays reproducible.

export type Clock = () => Date

const FIXED_DEMO_DAY = Object.freeze({ year: 2026, monthIndex: 5, day: 19 })

const realClock: Clock = () => new Date()
const fixedClock: Clock = () =>
  new Date(FIXED_DEMO_DAY.year, FIXED_DEMO_DAY.monthIndex, FIXED_DEMO_DAY.day)

/** Default clock selected by build-time env; `fixed` only for the baseline run. */
export const defaultClock: Clock = import.meta.env.VITE_CLOCK === 'fixed' ? fixedClock : realClock

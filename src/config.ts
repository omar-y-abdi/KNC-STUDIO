// Shipped fallbacks + deploy-time configuration.
// Effects (env, time) are isolated here so the domain layer stays pure + referentially transparent.

/**
 * Safe public-site fallback values used only before CMS settings load and in offline/local mode.
 * Backend-configured runtime UI resolves the owner-managed `site_settings` rows instead.
 */
export const DEFAULT_BUSINESS = {
  name: 'Blade & Blend Studio',
  email: 'booking@mail.bladeblendstudio.se',
  street: 'Geijersgatan 10',
  postalCode: '411 34',
  city: 'Göteborg',
  phoneDisplay: '079‑304 36 71',
  phoneTel: '0793043671',
  mapsHref: 'https://maps.apple.com/?q=Geijersgatan%2010,%20G%C3%B6teborg',
  cancellationPolicyHours: 24,
  seo: {
    sv: {
      title: 'Blade & Blend Studio – Barbershop i Göteborg | Boka tid online',
      description:
        'Blade & Blend Studio – barbershop på Geijersgatan 10 i Göteborg. Boka tid online hos Hassan, Victor eller Salman. Öppet mån–lör 09–18, klippning från 200 kr.',
    },
    en: {
      title: 'Blade & Blend Studio – Barbershop in Gothenburg | Book online',
      description:
        'Blade & Blend Studio – barbershop at Geijersgatan 10 in Gothenburg. Book online with Hassan, Victor or Salman. Open Monday to Saturday 09:00–18:00, cuts from 200 kr.',
    },
  },
} as const

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

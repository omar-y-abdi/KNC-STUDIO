import type { Lang } from '../i18n/index'

export const BUSINESS_SETTING_KEYS = {
  name: 'business_name',
  email: 'business_email',
  phoneDisplay: 'business_phone_display',
  phoneTel: 'business_phone_tel',
  street: 'business_street',
  postalCode: 'business_postal_code',
  city: 'business_city',
  mapsHref: 'business_maps_href',
  cancellationPolicyHours: 'cancellation_policy_hours',
  seo: {
    sv: { title: 'seo_title_sv', description: 'seo_description_sv' },
    en: { title: 'seo_title_en', description: 'seo_description_en' },
  },
} as const

export interface SeoSettings {
  readonly title: string
  readonly description: string
}

export interface BusinessSettings {
  readonly name: string
  readonly email: string
  readonly phoneDisplay: string
  readonly phoneTel: string
  readonly street: string
  readonly postalCode: string
  readonly city: string
  readonly mapsHref: string
  readonly cancellationPolicyHours: number
  readonly seo: Readonly<Record<Lang, SeoSettings>>
}

export interface BusinessDiscoveryFacts {
  readonly barbers: readonly { readonly id: string; readonly name: string }[]
  readonly services: readonly {
    readonly id: string
    readonly barberId: string
    readonly price: number
  }[]
  readonly schedules: readonly {
    readonly barberId: string
    readonly weekday: number
    readonly startMin: number
    readonly endMin: number
  }[]
}

export const EMPTY_BUSINESS_FACTS: BusinessDiscoveryFacts = {
  barbers: [],
  services: [],
  schedules: [],
}

const DEFAULT_SEO_TEMPLATES: Readonly<Record<Lang, SeoSettings>> = {
  sv: {
    title: '{business_name} – Barbershop i {city} | Boka tid online',
    description:
      '{business_name} är en barbershop i {city}. Välj barberare, behandling och tid och boka online.',
  },
  en: {
    title: '{business_name} – Barbershop in {city} | Book online',
    description:
      '{business_name} is a barbershop in {city}. Choose a barber, service, and time and book online.',
  },
}

const DEFAULT_BUSINESS_NAME = 'Blade & Blend Studio'
const DEFAULT_BUSINESS_CITY = 'Göteborg'

export const DEFAULT_BUSINESS: BusinessSettings = {
  name: DEFAULT_BUSINESS_NAME,
  email: 'booking@mail.bladeblendstudio.se',
  street: 'Geijersgatan 10',
  postalCode: '411 34',
  city: DEFAULT_BUSINESS_CITY,
  phoneDisplay: '079‑304 36 71',
  phoneTel: '0793043671',
  mapsHref: 'https://maps.apple.com/?q=Geijersgatan%2010,%20G%C3%B6teborg',
  cancellationPolicyHours: 24,
  seo: {
    sv: {
      title: interpolateSeo(DEFAULT_SEO_TEMPLATES.sv.title, {
        name: DEFAULT_BUSINESS_NAME,
        city: DEFAULT_BUSINESS_CITY,
      }),
      description: interpolateSeo(DEFAULT_SEO_TEMPLATES.sv.description, {
        name: DEFAULT_BUSINESS_NAME,
        city: DEFAULT_BUSINESS_CITY,
      }),
    },
    en: {
      title: interpolateSeo(DEFAULT_SEO_TEMPLATES.en.title, {
        name: DEFAULT_BUSINESS_NAME,
        city: DEFAULT_BUSINESS_CITY,
      }),
      description: interpolateSeo(DEFAULT_SEO_TEMPLATES.en.description, {
        name: DEFAULT_BUSINESS_NAME,
        city: DEFAULT_BUSINESS_CITY,
      }),
    },
  },
}

function textOrDefault(value: string | undefined, fallback: string): string {
  return value?.trim() === '' || value === undefined ? fallback : value
}

function validEmail(value: string, fallback: string): string {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : fallback
}

function optionalTelephone(value: string): string {
  return /^[+0-9][0-9(). -]{2,39}$/.test(value) ? value : ''
}

function optionalHttpUrl(value: string): string {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? value : ''
  } catch {
    return ''
  }
}

function settingText(settings: ReadonlyMap<string, string>, key: string, fallback: string): string {
  return textOrDefault(settings.get(key), fallback)
}

export function parseCancellationPolicyHours(value: string | null | undefined): number {
  if (value === null || value === undefined || !/^\d{1,3}$/.test(value)) {
    return DEFAULT_BUSINESS.cancellationPolicyHours
  }
  const hours = Number(value)
  return hours >= 1 && hours <= 168 ? hours : DEFAULT_BUSINESS.cancellationPolicyHours
}

function interpolateSeo(value: string, business: Pick<BusinessSettings, 'name' | 'city'>): string {
  return value.split('{business_name}').join(business.name).split('{city}').join(business.city)
}

export function resolveBusinessSettings(settings: ReadonlyMap<string, string>): BusinessSettings {
  const name = settingText(settings, BUSINESS_SETTING_KEYS.name, DEFAULT_BUSINESS.name)
  const city = settingText(settings, BUSINESS_SETTING_KEYS.city, DEFAULT_BUSINESS.city)
  const configuredPhoneDisplay = settings.get(BUSINESS_SETTING_KEYS.phoneDisplay)
  const configuredPhoneTel = settings.get(BUSINESS_SETTING_KEYS.phoneTel)
  const rawPhoneDisplay =
    configuredPhoneDisplay === undefined
      ? DEFAULT_BUSINESS.phoneDisplay
      : configuredPhoneDisplay.trim()
  const rawPhoneTel =
    configuredPhoneTel === undefined ? DEFAULT_BUSINESS.phoneTel : configuredPhoneTel.trim()
  const phoneTel = optionalTelephone(rawPhoneTel)
  const phoneDisplay = rawPhoneDisplay === '' || phoneTel === '' ? '' : rawPhoneDisplay
  const configuredMapsHref = settings.get(BUSINESS_SETTING_KEYS.mapsHref)
  const mapsHref =
    configuredMapsHref === undefined
      ? DEFAULT_BUSINESS.mapsHref
      : optionalHttpUrl(configuredMapsHref.trim())
  const base = {
    name,
    city,
    email: validEmail(
      settingText(settings, BUSINESS_SETTING_KEYS.email, DEFAULT_BUSINESS.email),
      DEFAULT_BUSINESS.email,
    ),
    phoneDisplay,
    phoneTel: phoneDisplay === '' ? '' : phoneTel,
    street: settingText(settings, BUSINESS_SETTING_KEYS.street, DEFAULT_BUSINESS.street),
    postalCode: settingText(
      settings,
      BUSINESS_SETTING_KEYS.postalCode,
      DEFAULT_BUSINESS.postalCode,
    ),
    mapsHref,
    cancellationPolicyHours: parseCancellationPolicyHours(
      settings.get(BUSINESS_SETTING_KEYS.cancellationPolicyHours),
    ),
  }
  return {
    ...base,
    seo: {
      sv: {
        title: interpolateSeo(
          settingText(settings, BUSINESS_SETTING_KEYS.seo.sv.title, DEFAULT_SEO_TEMPLATES.sv.title),
          base,
        ),
        description: interpolateSeo(
          settingText(
            settings,
            BUSINESS_SETTING_KEYS.seo.sv.description,
            DEFAULT_SEO_TEMPLATES.sv.description,
          ),
          base,
        ),
      },
      en: {
        title: interpolateSeo(
          settingText(settings, BUSINESS_SETTING_KEYS.seo.en.title, DEFAULT_SEO_TEMPLATES.en.title),
          base,
        ),
        description: interpolateSeo(
          settingText(
            settings,
            BUSINESS_SETTING_KEYS.seo.en.description,
            DEFAULT_SEO_TEMPLATES.en.description,
          ),
          base,
        ),
      },
    },
  }
}

export function formatBusinessAddress(business: BusinessSettings): string {
  return `${business.street}, ${business.postalCode} ${business.city}`
}

const SCHEMA_DAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const

function minutesToTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

function openingHours(facts: BusinessDiscoveryFacts): readonly Record<string, unknown>[] {
  const activeIds = new Set(facts.barbers.map((barber) => barber.id))
  const byDay = new Map<number, { start: number; end: number }[]>()
  for (const row of facts.schedules) {
    if (
      !activeIds.has(row.barberId) ||
      !Number.isInteger(row.weekday) ||
      row.weekday < 0 ||
      row.weekday > 6 ||
      !Number.isInteger(row.startMin) ||
      !Number.isInteger(row.endMin) ||
      row.startMin < 0 ||
      row.endMin > 1440 ||
      row.startMin >= row.endMin
    )
      continue
    const intervals = byDay.get(row.weekday) ?? []
    intervals.push({ start: row.startMin, end: row.endMin })
    byDay.set(row.weekday, intervals)
  }

  const grouped = new Map<string, string[]>()
  for (const [weekday, intervals] of byDay) {
    intervals.sort((left, right) => left.start - right.start || left.end - right.end)
    const merged: { start: number; end: number }[] = []
    for (const interval of intervals) {
      const prior = merged.at(-1)
      if (prior !== undefined && interval.start <= prior.end)
        prior.end = Math.max(prior.end, interval.end)
      else merged.push({ ...interval })
    }
    for (const interval of merged) {
      const key = `${minutesToTime(interval.start)}-${minutesToTime(interval.end)}`
      const day = SCHEMA_DAYS[weekday]
      if (day === undefined) continue
      const days = grouped.get(key) ?? []
      days.push(day)
      grouped.set(key, days)
    }
  }

  return Array.from(grouped, ([key, dayOfWeek]) => {
    const [opens, closes] = key.split('-') as [string, string]
    return { '@type': 'OpeningHoursSpecification', dayOfWeek, opens, closes }
  })
}

export function buildBusinessStructuredData(
  business: BusinessSettings,
  facts: BusinessDiscoveryFacts,
  siteUrl: string,
): Record<string, unknown> {
  const root = siteUrl.replace(/\/$/, '')
  const structured: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'HairSalon',
    '@id': `${root}/#business`,
    name: business.name,
    url: `${root}/`,
    image: `${root}/og-image.png`,
    email: business.email,
    address: {
      '@type': 'PostalAddress',
      streetAddress: business.street,
      postalCode: business.postalCode,
      addressLocality: business.city,
      addressCountry: 'SE',
    },
    availableLanguage: ['sv', 'en'],
  }

  if (business.phoneTel !== '') structured['telephone'] = business.phoneTel
  if (business.mapsHref !== '') structured['hasMap'] = business.mapsHref

  const hours = openingHours(facts)
  if (hours.length > 0) structured['openingHoursSpecification'] = hours

  const prices = facts.services
    .map((service) => service.price)
    .filter((price) => Number.isInteger(price) && price >= 0)
  if (prices.length > 0) {
    const min = Math.min(...prices)
    const max = Math.max(...prices)
    structured['priceRange'] = min === max ? `${min} kr` : `${min}–${max} kr`
    structured['currenciesAccepted'] = 'SEK'
  }

  if (facts.barbers.length > 0) {
    structured['employee'] = facts.barbers.map((barber) => ({
      '@type': 'Person',
      name: barber.name,
    }))
  }
  return structured
}

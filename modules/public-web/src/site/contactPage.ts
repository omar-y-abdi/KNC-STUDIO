import type { CmsLang, CmsPage } from '@bladeblend/content-contracts/cms'
import {
  EMPTY_BUSINESS_FACTS,
  formatBusinessAddress,
  openingHours,
  type BusinessDiscoveryFacts,
  type BusinessSettings,
  type SchemaDay,
} from './business'
import { CONTACT_SLOTS, fillSlots } from './businessSlots'

export function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

export function escapeElementText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

const COPY: Readonly<
  Record<
    CmsLang,
    {
      readonly heading: string
      readonly address: string
      readonly phone: string
      readonly email: string
      readonly noHours: string
    }
  >
> = {
  sv: {
    heading: 'Kontakta',
    address: 'Besöksadress',
    phone: 'Telefon',
    email: 'E-post',
    noHours: '<p>Se aktuella tider i <a href="/booking">bokningen</a> eller kontakta salongen.</p>',
  },
  en: {
    heading: 'Contact',
    address: 'Visiting address',
    phone: 'Phone',
    email: 'Email',
    noHours:
      '<p>See current times in the <a href="/booking?lang=en">booking</a> or contact the salon.</p>',
  },
}

const SWEDISH_DAYS: Readonly<Record<SchemaDay, string>> = {
  Monday: 'Måndag',
  Tuesday: 'Tisdag',
  Wednesday: 'Onsdag',
  Thursday: 'Torsdag',
  Friday: 'Fredag',
  Saturday: 'Lördag',
  Sunday: 'Söndag',
}

function contactHours(facts: BusinessDiscoveryFacts, lang: CmsLang): string {
  const hours = openingHours(facts)
  if (hours.length === 0) return COPY[lang].noHours
  return (
    '<dl>' +
    hours
      .map(({ dayOfWeek, opens, closes }) => {
        const days =
          lang === 'sv'
            ? dayOfWeek.map((day) => SWEDISH_DAYS[day]).join(', ')
            : dayOfWeek.join(', ')
        return `<dt>${days}</dt><dd>${opens}–${closes}</dd>`
      })
      .join('') +
    '</dl>'
  )
}

/** The Contact body with its server-owned slots filled from the live business and schedule. */
export function renderContactFragment(
  html: string,
  business: BusinessSettings,
  lang: CmsLang,
  facts: BusinessDiscoveryFacts = EMPTY_BUSINESS_FACTS,
): string {
  const copy = COPY[lang]
  const phone = business.phoneTel
    ? `<dt>${copy.phone}</dt><dd><a href="tel:` +
      escapeAttribute(business.phoneTel) +
      '">' +
      escapeElementText(business.phoneDisplay) +
      '</a></dd>'
    : ''
  const email =
    `<dt>${copy.email}</dt><dd><a href="mailto:` +
    escapeAttribute(business.email) +
    '">' +
    escapeElementText(business.email) +
    '</a></dd>'
  const address =
    `<dt>${copy.address}</dt><dd>` + escapeElementText(formatBusinessAddress(business)) + '</dd>'
  return fillSlots(html, CONTACT_SLOTS, {
    'contact-title': escapeElementText(copy.heading + ' ' + business.name),
    'contact-details': '<dl>' + address + phone + email + '</dl>',
    'contact-hours': contactHours(facts, lang),
    'data-business-name': escapeElementText(business.name),
    'data-business-city': escapeElementText(business.city),
  })
}

/** The Contact title and description a visitor sees when the owner has set neither. */
export function contactDefaults(
  business: BusinessSettings,
  lang: CmsLang,
): { readonly title: string; readonly description: string } {
  return lang === 'sv'
    ? {
        title: 'Kontakta ' + business.name + ' – barbershop i ' + business.city,
        description:
          'Officiell kontakt, adress och bokningsinformation för ' +
          business.name +
          ' i ' +
          business.city +
          '.',
      }
    : {
        title: 'Contact ' + business.name + ' – barbershop in ' + business.city,
        description:
          'Official contact, address and booking information for ' +
          business.name +
          ' in ' +
          business.city +
          '.',
      }
}

/** A CMS Contact page for one language: its body filled from the live business, and its title and
 * description kept when the owner set them, otherwise the live defaults. */
export function renderContactPage(
  page: CmsPage,
  lang: CmsLang,
  business: BusinessSettings,
  facts: BusinessDiscoveryFacts,
): CmsPage {
  const defaults = contactDefaults(business, lang)
  return {
    ...page,
    title: { ...page.title, [lang]: page.title[lang] || defaults.title },
    description: { ...page.description, [lang]: page.description[lang] || defaults.description },
    content: {
      ...page.content,
      [lang]: {
        ...page.content[lang],
        html: renderContactFragment(page.content[lang].html, business, lang, facts),
      },
    },
  }
}

import type { CmsLang, CmsPage } from '../../shared/cms'
import { formatBusinessAddress, type BusinessSettings } from './business'
import { fillSlots, LEGAL_SLOTS, type BusinessSlots, type SlotContent } from './businessSlots'
import { escapeAttribute, escapeElementText } from './contactPage'

/** The business details list; a value the owner left empty has no row. */
function businessDetails(business: BusinessSettings, lang: CmsLang): string {
  const rows: readonly (readonly [string, string])[] = [
    [lang === 'sv' ? 'Salong' : 'Salon', business.name],
    [lang === 'sv' ? 'Juridiskt företagsnamn' : 'Legal business name', business.legalName],
    [lang === 'sv' ? 'Organisationsnummer' : 'Registration number', business.organizationNumber],
    [lang === 'sv' ? 'Adress' : 'Address', formatBusinessAddress(business)],
    [lang === 'sv' ? 'E-post' : 'Email', business.email],
    [lang === 'sv' ? 'Telefon' : 'Phone', business.phoneDisplay],
  ]
  const details = rows
    .filter(([, value]) => value !== '')
    .map(
      ([label, value]) =>
        `<dt>${escapeElementText(label)}</dt><dd>${escapeElementText(value)}</dd>`,
    )
    .join('')
  return `<dl>${details}</dl>`
}

/** A legal body, privacy or terms, with its business slots filled from the live business: every
 * one, or only those in `slots`, a subset of LEGAL_SLOTS. */
export function renderLegalFragment(
  html: string,
  business: BusinessSettings,
  slots: BusinessSlots = LEGAL_SLOTS,
): string {
  const hours = business.cancellationPolicyHours
  const content: SlotContent<typeof LEGAL_SLOTS> = {
    'data-business-name': escapeElementText(business.name),
    'data-business-controller': escapeElementText(business.legalName || business.name),
    'data-business-contact':
      business.email === ''
        ? '<a href="/">Kontakt / Contact</a>'
        : `<a href="mailto:${escapeAttribute(business.email)}">${escapeElementText(business.email)}</a>`,
    'legal-business-details-sv': businessDetails(business, 'sv'),
    'legal-business-details-en': businessDetails(business, 'en'),
    'cancellation-policy-sv': escapeElementText(
      `Avboka senast ${hours} timmar före den bokade tiden.`,
    ),
    'cancellation-policy-en': escapeElementText(
      `Cancel at least ${hours} hours before your appointment.`,
    ),
  }
  return fillSlots(html, slots, content)
}

/** A CMS legal page for one language, its body filled from the live business. */
export function renderLegalPage(page: CmsPage, lang: CmsLang, business: BusinessSettings): CmsPage {
  return {
    ...page,
    content: {
      ...page.content,
      [lang]: {
        ...page.content[lang],
        html: renderLegalFragment(page.content[lang].html, business),
      },
    },
  }
}

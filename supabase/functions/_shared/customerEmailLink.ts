import {
  buildEmailMessage,
  type EmailBusiness,
  type EmailLanguage,
  type EmailMessage,
} from './email.ts'
import { isCustomerAccessToken } from './customerAccess.ts'

/** A distinct fragment prevents scanners/navigation from exchanging this proof as a login link. */
export function customerEmailLinkUrl(token: string): string {
  if (!isCustomerAccessToken(token)) throw new Error('invalid email link token')
  return `https://bladeblendstudio.se/#email_link=${token}`
}

export function buildCustomerEmailLinkMessage(input: {
  readonly to: string
  readonly sourceEmail: string
  readonly targetEmail: string
  readonly token: string
  readonly business: EmailBusiness
  readonly lang: EmailLanguage
}): EmailMessage {
  const sv = input.lang === 'sv'
  return buildEmailMessage({
    to: input.to,
    lang: input.lang,
    business: input.business,
    ctaHref: customerEmailLinkUrl(input.token),
    copy: {
      subject: sv ? 'Bekräfta koppling av dina bokningar' : 'Confirm linking your appointments',
      preheader: sv
        ? 'Bekräfta båda mejladresserna för att koppla din historik.'
        : 'Confirm both email addresses to link your history.',
      title: sv ? 'Koppla dina bokningar' : 'Link your appointments',
      intro: sv
        ? 'Du har begärt att samla alla tidigare och framtida bokningar för dessa mejladresser i en kundprofil. Bekräfta länken i båda mejlen om adresserna tillhör dig.'
        : 'You requested to combine all past and future appointments for these email addresses in one customer profile. Confirm the link in both emails if both addresses belong to you.',
      sectionTitle: sv ? 'Mejladresser som kopplas' : 'Email addresses being linked',
      note: sv
        ? 'Länkarna gäller i 30 minuter. Öppna dem i webbläsaren där du startade kopplingen och bekräfta med knappen. Om du inte begärde detta, ignorera mejlet. Ingen koppling görs utan båda bekräftelserna.'
        : 'Links expire after 30 minutes. Open them in the browser where you started and confirm using the button. Ignore this email if you did not request it. Both confirmations are required.',
      ctaLabel: sv ? 'Granska och bekräfta' : 'Review and confirm',
      contactLead: sv ? 'Frågor? Kontakta salongen.' : 'Questions? Contact the salon.',
    },
    rows: [
      { label: sv ? 'Nuvarande mejl' : 'Current email', value: input.sourceEmail },
      { label: sv ? 'Tillagd mejl' : 'Additional email', value: input.targetEmail },
    ],
  })
}

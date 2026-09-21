import { mediaUrl, type CmsDocument, type CmsEmail } from '../../../shared/cms'
import {
  buildEmailMessage,
  type EmailBuildInput,
  type EmailMessage,
} from '../../../shared/email-render'
import { resolveBusinessSettings } from '../../site/business'
import { SUPABASE_URL } from '../../backend/config'

/** Sample values only; HTML comes from the exact renderer used by transactional delivery. */
export function emailPreviewInput(document: CmsDocument, email: CmsEmail): EmailBuildInput {
  const business = resolveBusinessSettings(new Map(Object.entries(document.settings)))
  const sv = email.lang === 'sv'
  const barber = document.barbers[0]?.name || 'Alex'
  const date = sv ? 'måndag 21 september 2026' : 'Monday 21 September 2026'
  const booking = /_(confirmation|cancellation|reminder)$/.test(email.template)
  const staff = email.template.startsWith('barber_')
  const rows = !booking
    ? []
    : staff
      ? [
          { label: 'Datum', value: date },
          { label: 'Tid', value: '14:30' },
          { label: 'Kund', value: 'Robin Andersson' },
          { label: 'Behandling', value: 'Klippning' },
          { label: 'Längd', value: '30 min' },
          { label: 'Pris', value: '350 kr' },
          { label: 'Kontakt', value: '070 123 45 67 · robin@example.com' },
        ]
      : [
          { label: sv ? 'Barberare' : 'Barber', value: barber },
          { label: sv ? 'Datum' : 'Date', value: date },
          { label: sv ? 'Tid' : 'Time', value: '14:30' },
          { label: sv ? 'Behandling' : 'Service', value: sv ? 'Klippning' : 'Haircut' },
          { label: sv ? 'Pris' : 'Price', value: sv ? '350 kr' : '350 SEK' },
        ]
  return {
    to: 'robin@example.com',
    lang: email.lang,
    copy: {
      subject: email.subject,
      preheader: email.preheader,
      title: email.title,
      intro: email.intro,
      sectionTitle: email.section_title || null,
      note: email.note,
      ctaLabel: email.cta_label,
      contactLead: email.contact_lead || null,
      design: email.design,
      ...(email.design?.logo
        ? { designLogoUrl: mediaUrl(email.design.logo, SUPABASE_URL ?? '') }
        : {}),
    },
    variables: {
      customer_name: 'Robin Andersson',
      barber_name: barber,
      booking_date: date,
      booking_time: '14:30',
      cancellation_hours: String(business.cancellationPolicyHours),
      new_email: 'robin@example.com',
    },
    rows,
    // The sandboxed preview has no navigable action or real access token.
    ctaHref: 'https://bladeblendstudio.se/#cms-email-example',
    business: {
      name: business.name,
      email: business.email,
      phoneDisplay: business.phoneDisplay || null,
      phoneHref: business.phoneTel ? `tel:${business.phoneTel}` : null,
      address: `${business.street}, ${business.postalCode} ${business.city}`,
      mapsHref: business.mapsHref || null,
      cancellationPolicyHours: business.cancellationPolicyHours,
    },
  }
}

export function renderEmailPreview(document: CmsDocument, email: CmsEmail): EmailMessage {
  return buildEmailMessage(emailPreviewInput(document, email))
}

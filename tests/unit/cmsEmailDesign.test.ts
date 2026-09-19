import { describe, expect, it } from 'vitest'
import {
  defaultEmailDesign,
  emptyDocument,
  validateCompleteDocument,
  validateDocument,
} from '../../shared/cms'
import { renderDesignedEmail } from '../../shared/cms-email'

function emailFixture() {
  return {
    template: 'customer_confirmation' as const,
    lang: 'sv' as const,
    subject: 'Bokning hos {business_name}',
    preheader: 'Hej {customer_name}',
    title: 'Bokat hos {barber_name}',
    intro: 'Hej {customer_name}',
    section_title: 'Din tid',
    note: 'Avboka senast {cancellation_hours}h före.',
    cta_label: 'Öppna',
    contact_lead: 'Ring oss',
    design: defaultEmailDesign(),
  }
}

describe('CMS email design', () => {
  it('renders the persisted design with expanded preview variables', () => {
    const email = emailFixture()
    const html = renderDesignedEmail(
      {
        lang: email.lang,
        copy: {
          subject: email.subject,
          preheader: email.preheader,
          title: email.title,
          intro: email.intro,
          sectionTitle: email.section_title,
          note: email.note,
          ctaLabel: email.cta_label,
          contactLead: email.contact_lead,
        },
        variables: {
          customer_name: 'Omar',
          barber_name: 'KNC',
          cancellation_hours: '24',
        },
        ctaHref: 'https://bladeblendstudio.se/my-bookings',
        business: {
          name: 'Blade & Blend',
          phoneDisplay: '031-123 456',
          phoneHref: 'tel:+4631123456',
          address: 'Testgatan 1, Göteborg',
          mapsHref: 'https://maps.example.com',
        },
      },
      email.design,
      'light',
    )
    expect(html).toContain('Bokning hos Blade &amp; Blend')
    expect(html).toContain('Hej Omar')
    expect(html).toContain('Bokat hos KNC')
    expect(html).toContain('24h')
    expect(html).toContain(email.design.palettes.light.background)
  })

  it('rejects unknown placeholders and preserves authoritative placeholders', () => {
    const authoritative = emptyDocument()
    authoritative.emails.push(emailFixture())

    const unknown = structuredClone(authoritative)
    const unknownEmail = unknown.emails[0]
    if (!unknownEmail) throw new Error('email fixture missing')
    unknownEmail.intro = 'Hej {totally_unknown}'
    expect(() => validateDocument(unknown)).toThrow('Unknown placeholder')

    const missing = structuredClone(authoritative)
    const missingEmail = missing.emails[0]
    if (!missingEmail) throw new Error('email fixture missing')
    missingEmail.intro = 'Hej kund'
    expect(() => validateCompleteDocument(missing, authoritative)).toThrow(
      'Required placeholder {customer_name} is missing',
    )
  })
})

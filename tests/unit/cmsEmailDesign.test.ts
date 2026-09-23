import { buildEmailMessage } from '../../shared/email-render'
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
  it('activation preserves the delivered layout, with the same renderer after the first edit', () => {
    const input = {
      to: 'owner@example.com',
      lang: 'sv' as const,
      copy: {
        subject: 'Booking',
        preheader: 'Welcome',
        title: 'Booked',
        intro: 'Hello',
        sectionTitle: 'Details',
        note: 'Thanks',
        ctaLabel: 'Open',
        contactLead: 'Call',
      },
      ctaHref: 'https://example.com/booking',
      rows: [
        { label: 'Date', value: 'Monday' },
        { label: 'Time', value: '12:00' },
      ],
      business: {
        name: 'Blade & Blend Studio',
        email: 'owner@example.com',
        phoneHref: 'tel:+4631123456',
        phoneDisplay: '031-123456',
        address: 'Test street',
        mapsHref: 'https://example.com/map',
        cancellationPolicyHours: 24,
      },
    }
    const before = buildEmailMessage(input).html
    const design = defaultEmailDesign()
    expect(buildEmailMessage({ ...input, copy: { ...input.copy, design } }).html).toBe(before)
    // These are the old delivered template's identifying layout values, not self-parity alone.
    for (const token of [
      'BLADE &amp; BLEND',
      'background:#303033',
      'border-radius:18px',
      'font-weight:650',
      'padding:40px 34px 34px',
      'border-bottom:1px solid #424245',
      'font-size:32px;font-weight:750;letter-spacing:-.04em;line-height:1.12',
    ])
      expect(before).toContain(token)
    design.width = 700
    const after = buildEmailMessage({ ...input, copy: { ...input.copy, design } }).html
    expect(after.replace('max-width:700px', 'max-width:600px')).toBe(before)
  })

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

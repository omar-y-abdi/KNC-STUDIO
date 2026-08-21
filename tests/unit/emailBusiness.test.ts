import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  buildEmailMessage,
  defaultEmailTemplate,
  loadEmailBusiness,
} from '../../supabase/functions/_shared/email'

function discoveryClient(settings: Record<string, string>) {
  return {
    rpc: async () => ({
      data: { settings, barbers: [], services: [], schedules: [] },
      error: null,
    }),
  }
}

const settings = {
  business_name: 'Current Studio',
  business_email: 'contact@current.example',
  business_phone_display: '031-12 34 56',
  business_phone_tel: '+4631123456',
  business_street: 'Current Street 7',
  business_postal_code: '411 11',
  business_city: 'Göteborg',
  business_maps_href: 'https://maps.example/current',
  cancellation_policy_hours: '36',
}

describe('transactional email business data', () => {
  it('loads every mutable contact fact from public business discovery', async () => {
    const business = await loadEmailBusiness(discoveryClient(settings) as never)
    expect(business).toEqual({
      name: 'Current Studio',
      email: 'contact@current.example',
      phoneDisplay: '031-12 34 56',
      phoneHref: 'tel:+4631123456',
      address: 'Current Street 7, 411 11 Göteborg',
      mapsHref: 'https://maps.example/current',
      cancellationPolicyHours: 36,
    })
  })

  it('renders current CMS facts and fixed booking mailbox without stale contact copy', async () => {
    const business = await loadEmailBusiness(discoveryClient(settings) as never)
    const message = buildEmailMessage({
      to: 'customer@example.com',
      lang: 'sv',
      copy: defaultEmailTemplate('customer_confirmation', 'sv'),
      variables: {
        customer_name: 'Omar',
        barber_name: 'Ada',
        cancellation_hours: String(business.cancellationPolicyHours),
      },
      ctaHref: 'https://bladeblendstudio.se',
      business,
    })

    expect(message.from).toBe('Current Studio <booking@mail.bladeblendstudio.se>')
    expect(message.replyTo).toBe('contact@current.example')
    expect(message.html).toContain('Current Street 7, 411 11 Göteborg')
    expect(message.html).toContain('031-12 34 56')
    expect(message.html).toContain('avbokningsvillkor 36h')
    expect(message.html).not.toContain('Geijersgatan 10')
    expect(message.html).not.toContain('079-304 36 71')
  })

  it('interpolates current business identity without caller-maintained duplication', async () => {
    const business = await loadEmailBusiness(discoveryClient(settings) as never)
    const message = buildEmailMessage({
      to: 'barber@example.com',
      lang: 'sv',
      copy: defaultEmailTemplate('auth_invite', 'sv'),
      ctaHref: 'https://bladeblendstudio.se/invite',
      business,
    })

    expect(message.subject).toBe('Din inbjudan till Current Studio')
    expect(message.html).toContain('barberarpanelen hos Current Studio')
    expect(message.html).not.toContain('barberarpanelen hos Blade &amp; Blend Studio')
  })

  it('fails closed when required CMS contact data is missing', async () => {
    await expect(loadEmailBusiness(discoveryClient({}) as never)).rejects.toThrow(
      'business setting missing',
    )
  })

  it('keeps native Auth fallbacks free from duplicated mutable contact facts', () => {
    for (const template of ['recovery.html', 'email-change.html']) {
      const source = readFileSync(`supabase/templates/${template}`, 'utf8')
      expect(source).toContain('{{ .SiteURL }}')
      expect(source).not.toContain('Geijersgatan')
      expect(source).not.toContain('079-304')
      expect(source).not.toContain('tel:+46793043671')
    }
  })
})

import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildEmailMessage,
  deliverEmailBatch,
  defaultEmailTemplate,
  loadEmailBusiness,
  ResendDeliveryError,
  resendDeliveryFailureCode,
  sendViaResend,
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

describe('Resend delivery failure classification', () => {
  afterEach(() => vi.unstubAllGlobals())

  const message = {
    to: 'customer@example.com',
    from: 'Studio <booking@mail.example.com>',
    replyTo: 'contact@example.com',
    subject: 'Booking confirmation',
    text: 'Booking confirmation',
    html: '<p>Booking confirmation</p>',
  }

  async function failure(status: number, name?: string): Promise<unknown> {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ name, message: 'provider rejected request' }), { status }),
      ),
    )
    try {
      await sendViaResend(message, 're_test', 'booking-confirmation/customer/test')
      throw new Error('expected Resend request to fail')
    } catch (error) {
      return error
    }
  }

  it('fails terminally for invalid requests and retryably for provider outages', async () => {
    const invalid = await failure(422, 'invalid_from_address')
    const rateLimited = await failure(429, 'rate_limit_exceeded')
    const unavailable = await failure(503, 'internal_server_error')

    expect(invalid).toBeInstanceOf(ResendDeliveryError)
    expect(resendDeliveryFailureCode(invalid)).toBe('send_failed_permanent')
    expect(resendDeliveryFailureCode(rateLimited)).toBe('send_failed_transient')
    expect(resendDeliveryFailureCode(unavailable)).toBe('send_failed_transient')
  })

  it('retries only the safe concurrent-idempotency response', async () => {
    const concurrent = await failure(409, 'concurrent_idempotent_requests')
    const conflicting = await failure(409, 'invalid_idempotent_request')

    expect(resendDeliveryFailureCode(concurrent)).toBe('send_failed_transient')
    expect(resendDeliveryFailureCode(conflicting)).toBe('send_failed_permanent')
  })

  it('retries transport failures', async () => {
    const transportError = new Error('network unavailable')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(transportError)),
    )

    await expect(
      sendViaResend(message, 're_test', 'booking-confirmation/customer/test'),
    ).rejects.toBe(transportError)
    expect(resendDeliveryFailureCode(transportError)).toBe('send_failed_transient')
  })

  it('continues to later recipients after a permanent recipient rejection', async () => {
    const delivered: string[] = []
    const persisted: string[] = []
    const result = await deliverEmailBatch(
      [{ kind: 'customer' }, { kind: 'barber' }],
      async (entry) => {
        delivered.push(entry.kind)
        if (entry.kind === 'customer')
          throw new ResendDeliveryError('permanent', 422, 'invalid customer address')
      },
      async (entry) => {
        persisted.push(entry.kind)
        return true
      },
    )

    expect(delivered).toEqual(['customer', 'barber'])
    expect(persisted).toEqual(['barber'])
    expect(result).toEqual({ sent: ['barber'], failureCode: 'send_failed_permanent' })
  })

  it('keeps sending after a delivery-ledger write failure', async () => {
    const delivered: string[] = []
    const result = await deliverEmailBatch(
      [{ kind: 'customer' }, { kind: 'barber' }],
      async (entry) => {
        delivered.push(entry.kind)
      },
      async (entry) => entry.kind === 'barber',
    )

    expect(delivered).toEqual(['customer', 'barber'])
    expect(result).toEqual({ sent: ['barber'], failureCode: 'send_failed_transient' })
  })

  it('lets permanent failure dominate mixed batch failures', async () => {
    const result = await deliverEmailBatch(
      [{ kind: 'customer' }, { kind: 'barber' }],
      async (entry) => {
        throw new ResendDeliveryError(
          entry.kind === 'customer' ? 'transient' : 'permanent',
          entry.kind === 'customer' ? 503 : 422,
          'provider failure',
        )
      },
      async () => true,
    )

    expect(result).toEqual({ sent: [], failureCode: 'send_failed_permanent' })
  })
})

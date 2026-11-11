import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildEmailMessage,
  confirmationSmallPrint,
  deliverEmailBatch,
  defaultEmailTemplate,
  loadEmailBusiness,
  prepareEmail,
  ResendDeliveryError,
  resendDeliveryFailureCode,
  sendViaResend,
  type EmailBusiness,
  type EmailLanguage,
  type EmailTemplateName,
  type PreparedEmail,
} from '../../supabase/functions/_shared/email'
import { customerAccessUrl } from '../../supabase/functions/_shared/customerAccess'
import { HIDDEN_LINK } from '../../packages/backend-contracts/src/email-send-log'
import { EMAIL_NAMES } from '../../packages/content-contracts/src/cms'
import {
  defaultEmailDesign,
  EMAIL_PARTS,
  type EmailDesign,
} from '../../packages/content-contracts/src/email-design'
import type {
  EmailBuildInput,
  EmailSmallPrint,
} from '../../packages/content-contracts/src/email-render'
import { appStrings } from '../../modules/public-web/src/i18n/index'

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
    expect(message.html).toContain('avboka senast 36 h före den bokade tiden')
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

  // The setting allows 1 to 168 hours, so the wording must also read right for one.
  it.each([
    ['sv', '36', 'senast 36 h före den bokade tiden', 'Därefter kontaktar du oss direkt.'],
    ['sv', '1', 'senast 1 h före den bokade tiden', 'Därefter kontaktar du oss direkt.'],
    ['en', '36', 'up to 36 h before your appointment', 'After that, contact us directly.'],
    ['en', '1', 'up to 1 h before your appointment', 'After that, contact us directly.'],
  ] as const)(
    'default customer notes say what the cancellation hours mean and where to cancel (%s, %s h)',
    async (lang, hours, rule, afterDeadline) => {
      const business = await loadEmailBusiness(
        discoveryClient({ ...settings, cancellation_policy_hours: hours }) as never,
      )
      const text = (template: 'customer_confirmation' | 'customer_reminder'): string =>
        buildEmailMessage({
          to: 'customer@example.com',
          lang,
          copy: defaultEmailTemplate(template, lang),
          variables: {
            customer_name: 'Omar',
            barber_name: 'Ada',
            cancellation_hours: String(business.cancellationPolicyHours),
          },
          ctaHref: 'https://bladeblendstudio.se',
          business,
        }).text
      for (const template of ['customer_confirmation', 'customer_reminder'] as const) {
        expect(text(template)).toContain(`"${appStrings(lang).myBookings}"`)
        expect(text(template)).toContain(rule)
        expect(text(template)).not.toMatch(/avbokningsvillkor|cancellation policy|\{[a-z_]+\}/i)
        // No word after the number takes a plural form.
        expect(text(template)).not.toMatch(/\d\s*(timm|hours?\b)/i)
      }
      // The reminder can arrive after the online deadline, so it also says what applies then.
      expect(text('customer_reminder')).toContain(afterDeadline)
      expect(text('customer_confirmation')).not.toContain(afterDeadline)
    },
  )

  it('fails closed when required CMS contact data is missing', async () => {
    await expect(loadEmailBusiness(discoveryClient({}) as never)).rejects.toThrow(
      'business setting missing',
    )
  })

  it('omits removed or unsafe phone and map links without breaking SV email rendering', async () => {
    const business = await loadEmailBusiness(
      discoveryClient({
        ...settings,
        business_phone_display: '',
        business_phone_tel: 'javascript:alert(1)',
        business_maps_href: 'http://unsafe.example/map',
      }) as never,
    )
    expect(business.phoneDisplay).toBeNull()
    expect(business.phoneHref).toBeNull()
    expect(business.mapsHref).toBeNull()

    const message = buildEmailMessage({
      to: 'customer@example.com',
      lang: 'sv',
      copy: defaultEmailTemplate('customer_confirmation', 'sv'),
      ctaHref: 'https://bladeblendstudio.se',
      business,
    })
    expect(message.html).not.toContain('tel:')
    expect(message.html).not.toContain('unsafe.example')
    expect(message.html).toContain('Current Street 7, 411 11 Göteborg')
  })

  it('uses validated shared map and telephone settings in English email rendering', async () => {
    const business = await loadEmailBusiness(discoveryClient(settings) as never)
    const message = buildEmailMessage({
      to: 'customer@example.com',
      lang: 'en',
      copy: defaultEmailTemplate('customer_confirmation', 'en'),
      ctaHref: 'https://bladeblendstudio.se',
      business,
    })
    expect(message.html).toContain('href="tel:+4631123456"')
    expect(message.html).toContain('href="https://maps.example/current"')
    expect(message.text).toContain('Questions? Call us on 031-12 34 56')
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

  it("gives Auth's own email-change message no way to confirm the change", () => {
    // Auth mails this template when a session calls PUT /auth/v1/user with a new email, which asks
    // for no password. A token, code or confirmation link here would move the login without one.
    const source = readFileSync('supabase/templates/email-change.html', 'utf8')
    for (const variable of ['TokenHash', 'Token', 'ConfirmationURL', 'RedirectTo']) {
      expect(source).not.toContain(variable)
    }
    const actions = [...source.matchAll(/\{\{([^}]*)\}\}/g)].map(([, action = '']) => action.trim())
    expect([...new Set(actions)].sort()).toEqual(['.NewEmail', '.SiteURL'])
    const links = [...source.matchAll(/href="([^"]*)"/g)].map(([, href]) => href)
    expect(links.length).toBeGreaterThan(0)
    expect(links.every((href) => href === '{{ .SiteURL }}')).toBe(true)
    expect(source).not.toMatch(/auth\/confirm|token_hash|type=email_change/)
    const text = source.replace(/\s+/g, ' ')
    expect(text).toContain('Adressen har inte ändrats')
    expect(text).toContain('Logga in i adminpanelen och gör ändringen under Inställningar.')
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
  const email: PreparedEmail = {
    kind: 'customer_confirmation',
    bookingId: null,
    message,
    stored: { subject: message.subject, html: message.html, text: message.text },
  }
  const sendLog = { rpc: async () => ({ error: null }) }

  async function failure(status: number, name?: string): Promise<unknown> {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ name, message: 'provider rejected request' }), { status }),
      ),
    )
    try {
      await sendViaResend(email, 're_test', 'booking-confirmation/customer/test', sendLog)
      throw new Error('expected Resend request to fail')
    } catch (error) {
      return error
    }
  }

  it('accepts only a provider message id and logs no mail PII', async () => {
    const providerId = '11111111-1111-4111-8111-111111111111'
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ id: providerId }), { status: 202 })),
    )

    try {
      await expect(
        sendViaResend(email, 're_test', 'booking-confirmation/customer/test', sendLog),
      ).resolves.toBeUndefined()
      expect(info).toHaveBeenCalledWith('email provider accepted', { id: providerId })
      const log = JSON.stringify(info.mock.calls)
      expect(log).not.toContain(message.to)
      expect(log).not.toContain(message.subject)
      expect(log).not.toContain(message.text)
      expect(log).not.toContain(message.html)
    } finally {
      info.mockRestore()
    }
  })

  it.each([
    [
      'malformed JSON id',
      () => new Response(JSON.stringify({ id: 'not-a-uuid' }), { status: 200 }),
      'transient',
    ],
    ['HTML body', () => new Response('<html>accepted</html>', { status: 200 }), 'transient'],
  ] as const)('treats a %s as a retryable send failure', async (_label, response, kind) => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response()),
    )
    try {
      const error = await failureFromSend()
      expect(error).toMatchObject({ kind, status: 200 })
      expect(info).not.toHaveBeenCalled()
    } finally {
      info.mockRestore()
    }
  })

  async function failureFromSend(): Promise<unknown> {
    try {
      await sendViaResend(email, 're_test', 'booking-confirmation/customer/test', sendLog)
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
      sendViaResend(email, 're_test', 'booking-confirmation/customer/test', sendLog),
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

describe('the small print of the customer confirmation', () => {
  const business: EmailBusiness = {
    name: 'Current Studio',
    email: 'contact@current.example',
    phoneDisplay: '031-12 34 56',
    phoneHref: 'tel:+4631123456',
    address: 'Current Street 7, 411 11 Göteborg',
    mapsHref: 'https://maps.example/current',
    cancellationPolicyHours: 36,
  }
  const reordered: EmailDesign = {
    ...defaultEmailDesign(),
    defaultMode: 'light',
    order: [...EMAIL_PARTS].reverse(),
  }
  const site = new URL(customerAccessUrl('0'.repeat(64))).origin
  const input = (
    template: EmailTemplateName,
    lang: EmailLanguage,
    design: EmailDesign | null,
  ): EmailBuildInput => ({
    to: 'customer@example.com',
    lang,
    copy: { ...defaultEmailTemplate(template, lang), design },
    variables: {
      customer_name: 'Omar <Ö>',
      barber_name: 'Ada & Co',
      booking_date: 'fredag 13 november 2026',
      booking_time: '09:00',
      cancellation_hours: '36',
      new_email: 'ny@example.com',
    },
    rows: [{ label: 'Pris', value: '350 kr' }],
    ctaHref: 'https://bladeblendstudio.se/token',
    business,
  })
  const escaped = (value: string): string =>
    value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;')
  const smallPrint = (lang: EmailLanguage): EmailSmallPrint => {
    const found = confirmationSmallPrint('customer_confirmation', lang, site)
    if (found === null) throw new Error('The confirmation has no small print')
    return found
  }

  // Digests of every template rendered before the small print existed, in both languages, with the
  // delivered design and with a light one whose parts run backwards.
  it.each([
    ['customer_confirmation', '716a89b399925d4a3585ed06129eb7177e27fc3e4f4f36b11203a00bfb49e242'],
    ['barber_confirmation', 'ffc6693d8e28e9e4c764dc6db2010d5e93fbf8918edad32b6e55b4dc93003eb6'],
    ['customer_cancellation', 'c2fe6deb45f2552ed7b66dcbb8ac6ebdf2d38d66634d51e5a041d65aa526faab'],
    ['barber_cancellation', '0d62f0f8b3dd2336f1bcd95d3c81f5db436548d95596508ae04b2b0a43c2ca30'],
    ['customer_reminder', '8b52774897e320458ae53be242dc15b31f129a7506841c821fc2a6a170a89751'],
    ['customer_booking_access', '6f9e8653225c233ae424aa9d1d653950487c6ca7fd5bbf9ee167fc730809ecf2'],
    ['auth_recovery', '37c2c51031418fc91ec29df7fcab063860e527ea9496f1f7230c5ffcabc4576f'],
    ['auth_email_change', 'ca60ae6603c880e7da8b89f4d457e03f3547ba3326d5ba8fa7fd51458bf4a4fd'],
    ['auth_invite', 'ee518e86391dad6bc6096952fde23538ae07093a276a68056b7c75fc78e2ed80'],
  ] as const)('leaves %s byte for byte as it was without small print', (template, digest) => {
    const messages = (['sv', 'en'] as const).flatMap((lang) =>
      [null, reordered].map((design) => buildEmailMessage(input(template, lang, design))),
    )
    expect(createHash('sha256').update(JSON.stringify(messages)).digest('hex')).toBe(digest)
  })

  it('belongs to the customer confirmation alone and links the terms in its language', () => {
    for (const template of EMAIL_NAMES)
      for (const lang of ['sv', 'en'] as const)
        if (template !== 'customer_confirmation')
          expect(confirmationSmallPrint(template, lang, site), `${template} ${lang}`).toBeNull()
    expect(site).toBe('https://bladeblendstudio.se')
    expect(smallPrint('sv').href).toBe('https://bladeblendstudio.se/terms')
    expect(smallPrint('en').href).toBe('https://bladeblendstudio.se/terms?lang=en')
    expect(smallPrint('sv').text).toBe('Villkor och ångerrätt hittar du på')
    expect(smallPrint('en').text).toBe('See our terms and right of withdrawal at')
    // The owner's ruling: one sentence of at most ten words, the link included.
    for (const lang of ['sv', 'en'] as const) {
      const { text, href } = smallPrint(lang)
      expect(`${text} ${href}`.split(' ').length, lang).toBeLessThanOrEqual(10)
      expect(text, lang).not.toMatch(/[.:!?]/)
    }
    const sender = readFileSync('supabase/functions/send-confirmation/index.ts', 'utf8')
    expect(sender).toContain(
      'const smallPrint = confirmationSmallPrint(templateName, lang, new URL(ctaHref).origin)',
    )
    expect(sender).toContain('...(smallPrint === null ? {} : { smallPrint }),')
  })

  it.each(['sv', 'en'] as const)(
    'adds the %s small print between the contact line and the footer, in html and text',
    (lang) => {
      const print = smallPrint(lang)
      const without = buildEmailMessage(input('customer_confirmation', lang, null))
      const message = buildEmailMessage({
        ...input('customer_confirmation', lang, null),
        smallPrint: print,
      })
      const footerText = /<td style="padding-top:22px;([^"]+)">/.exec(without.html)?.[1]
      const footerLink = /<a href="https:\/\/maps\.example\/current" style="([^"]+)">/.exec(
        without.html,
      )?.[1]
      expect(footerText).toBe('color:#737378;font-size:12px;line-height:1.65')
      expect(footerLink).toBe('color:#98989d;text-decoration:none')
      const paragraph =
        `<p style="margin:28px 0 0;${footerText}">${escaped(print.text)} ` +
        `<a href="${print.href}" style="${footerLink}">${print.href}</a></p>`
      const footer =
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin-top:38px;'
      expect(message.html).toContain(`</p>${paragraph}${footer}`)
      expect(message.html.indexOf('data-email-part="contact"')).toBeLessThan(
        message.html.indexOf(paragraph),
      )
      expect(message.html.replace(paragraph, '')).toBe(without.html)
      const line = `${print.text} ${print.href}`
      expect(message.text).toContain(`${business.phoneDisplay}\n\n${line}\n\n${business.address}`)
      expect(message.text.replace(`${line}\n\n`, '')).toBe(without.text)
      expect(message.subject).toBe(without.subject)
    },
  )

  it('keeps hostile small print escaped in the html and plain in the text', () => {
    const hostile = {
      text: `<img src=x onerror="alert('x')"> & {customer_name}`,
      href: 'https://bladeblendstudio.se/terms?a="><script>',
    }
    const message = buildEmailMessage({
      ...input('customer_confirmation', 'sv', null),
      smallPrint: hostile,
    })
    expect(message.html).not.toContain('<img src=x')
    expect(message.html).not.toContain('"><script>')
    expect(message.html).toContain(
      '&lt;img src=x onerror=&quot;alert(&#039;x&#039;)&quot;&gt; &amp; {customer_name} <a href="https://bladeblendstudio.se/terms?a=&quot;&gt;&lt;script&gt;"',
    )
    expect(message.text).toContain(`${hostile.text} ${hostile.href}`)
  })

  it('keeps the terms link in the stored copy, which hides only the access link', () => {
    const print = smallPrint('sv')
    const email = prepareEmail(
      'customer_confirmation',
      { ...input('customer_confirmation', 'sv', null), smallPrint: print },
      null,
    )
    expect(email.stored.html).toContain(`<a href="${print.href}"`)
    expect(email.stored.text).toContain(`${print.text} ${print.href}`)
    expect(email.stored.html).toBe(
      email.message.html.replace(
        'href="https://bladeblendstudio.se/token"',
        `href="${HIDDEN_LINK}"`,
      ),
    )
  })
})

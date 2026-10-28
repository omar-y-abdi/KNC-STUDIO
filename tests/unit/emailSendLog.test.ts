import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import {
  EMAIL_SEND_FAILURE_CODES,
  EMAIL_SEND_KINDS,
  HIDDEN_LINK,
  type EmailSendKind,
} from '../../shared/email-send-log'
import {
  defaultEmailTemplate,
  ResendDeliveryError,
  sendViaResend,
  type EmailBusiness,
  type EmailTemplateName,
} from '../../supabase/functions/_shared/email'
import {
  EMAIL_LINK_EXPOSURE,
  prepareEmail,
  type EmailSendLogClient,
  type PreparedEmail,
} from '../../supabase/functions/_shared/emailSendLog'
import { encryptCustomerAccessToken } from '../../supabase/functions/_shared/customerAccess'
import { buildCustomerEmailLinkMessage } from '../../supabase/functions/_shared/customerEmailLink'
import {
  settleExternalAction,
  type ExternalAction,
  type ExternalActionService,
} from '../../supabase/functions/_shared/externalActions'

const MIGRATION = 'supabase/migrations/20261025090000_email_send_log.sql'

const business: EmailBusiness = {
  name: 'Blade & Blend',
  email: 'contact@example.com',
  phoneDisplay: '031-12 34 56',
  phoneHref: 'tel:+4631123456',
  address: 'Street 1, 411 11 Göteborg',
  mapsHref: 'https://maps.example/studio',
  cancellationPolicyHours: 24,
}

/** Alphanumeric cores survive URL-encoding and HTML-escaping, so their absence covers both. */
const AUTH_CORE = 'Zq9AuthTokenCore'
const AUTH_TOKEN = `${AUTH_CORE}+/=&<"'`
const CUSTOMER_TOKEN = 'c0ffee'.repeat(10) + 'beef'

function htmlEscaped(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

/** Every form a credential can take inside a rendered email. */
function credentialForms(core: string, raw: string, href: string): readonly string[] {
  return [
    core,
    raw,
    encodeURIComponent(raw),
    htmlEscaped(raw),
    htmlEscaped(encodeURIComponent(raw)),
    href,
    htmlEscaped(href),
  ]
}

/** The real link shape each kind's sender builds, around this test's known credential. */
const LINKS: Readonly<Record<EmailSendKind, { core: string; raw: string; href: string }>> = {
  customer_confirmation: customerLink(`https://bladeblendstudio.se/${CUSTOMER_TOKEN}`),
  customer_reminder: customerLink(`https://bladeblendstudio.se/${CUSTOMER_TOKEN}`),
  customer_booking_access: customerLink(`https://bladeblendstudio.se/${CUSTOMER_TOKEN}`),
  customer_email_link: customerLink(`https://bladeblendstudio.se/#email_link=${CUSTOMER_TOKEN}`),
  auth_recovery: authLink('reset', 'recovery'),
  auth_email_change: authLink('auth/confirm', 'email_change'),
  auth_invite: authLink('invite', 'invite'),
  customer_cancellation: plainLink('https://bladeblendstudio.se'),
  barber_confirmation: plainLink('https://bladeblendstudio.se/admin'),
  barber_cancellation: plainLink('https://bladeblendstudio.se/admin'),
}

function customerLink(href: string) {
  return { core: CUSTOMER_TOKEN, raw: CUSTOMER_TOKEN, href }
}

function authLink(path: string, type: string) {
  const href = `https://bladeblendstudio.se/${path}?token_hash=${encodeURIComponent(AUTH_TOKEN)}&type=${type}`
  return { core: AUTH_CORE, raw: AUTH_TOKEN, href }
}

function plainLink(href: string) {
  return { core: href, raw: href, href }
}

function templateFor(kind: EmailSendKind): EmailTemplateName {
  return kind === 'customer_email_link' ? 'customer_booking_access' : kind
}

function prepared(kind: EmailSendKind, href: string): PreparedEmail {
  return prepareEmail(
    kind,
    {
      to: 'kund@example.com',
      lang: 'sv',
      copy: defaultEmailTemplate(templateFor(kind), 'sv'),
      variables: { customer_name: 'Ada', barber_name: 'Hassan', new_email: 'ny@example.com' },
      rows: [{ label: 'Datum', value: 'fredag 2 januari 2096' }],
      ctaHref: href,
      business,
    },
    null,
  )
}

function expectNoCredential(stored: PreparedEmail['stored'], forms: readonly string[]): void {
  for (const form of forms) {
    expect(stored.html, form).not.toContain(form)
    expect(stored.text, form).not.toContain(form)
  }
  expect(stored.html).toContain(`href="${HIDDEN_LINK}"`)
  expect(stored.text).toContain(HIDDEN_LINK)
}

const SECRET_KINDS = EMAIL_SEND_KINDS.filter((kind) => EMAIL_LINK_EXPOSURE[kind] === 'secret')
const PLAIN_KINDS = EMAIL_SEND_KINDS.filter((kind) => EMAIL_LINK_EXPOSURE[kind] === 'plain')

describe('stored copy of a sent email', () => {
  it('classifies every link that carries a bearer credential as secret', () => {
    expect([...SECRET_KINDS].sort()).toEqual([
      'auth_email_change',
      'auth_invite',
      'auth_recovery',
      'customer_booking_access',
      'customer_confirmation',
      'customer_email_link',
      'customer_reminder',
    ])
    expect(new Set(EMAIL_SEND_KINDS)).toEqual(new Set(Object.keys(EMAIL_LINK_EXPOSURE)))
  })

  it.each(SECRET_KINDS)('keeps the %s credential out of the stored html and text', (kind) => {
    const link = LINKS[kind]
    const email = prepared(kind, link.href)

    expect(email.message.html).toContain(htmlEscaped(link.href))
    expect(email.message.text).toContain(link.href)
    expectNoCredential(email.stored, credentialForms(link.core, link.raw, link.href))
    expect(email.stored.subject).toBe(email.message.subject)
  })

  it.each(SECRET_KINDS)('changes nothing but the %s link in the stored copy', (kind) => {
    const link = LINKS[kind]
    const email = prepared(kind, link.href)

    expect(email.stored.html).toBe(
      email.message.html.replace(`href="${htmlEscaped(link.href)}"`, `href="${HIDDEN_LINK}"`),
    )
    expect(email.stored.text).toBe(email.message.text.replace(link.href, HIDDEN_LINK))
  })

  it.each(PLAIN_KINDS)('stores the %s email exactly as sent', (kind) => {
    const email = prepared(kind, LINKS[kind].href)

    expect(email.stored).toEqual({
      subject: email.message.subject,
      html: email.message.html,
      text: email.message.text,
    })
  })

  it('keeps the customer email-link proof out of its stored copy', () => {
    const email = buildCustomerEmailLinkMessage({
      to: 'kund@example.com',
      sourceEmail: 'kund@example.com',
      targetEmail: 'ny@example.com',
      token: CUSTOMER_TOKEN,
      business,
      lang: 'sv',
    })

    expect(email.kind).toBe('customer_email_link')
    expect(email.message.text).toContain(CUSTOMER_TOKEN)
    expectNoCredential(email.stored, [CUSTOMER_TOKEN])
  })
})

describe('delivery log schema parity', () => {
  const migration = readFileSync(MIGRATION, 'utf8')

  function checkList(column: string): readonly string[] {
    const open = `check (${column} in (`
    const start = migration.indexOf(open)
    if (start === -1) throw new Error(`missing CHECK list for ${column}`)
    const list = migration.slice(start + open.length, migration.indexOf(')', start + open.length))
    return list.split(',').map((value) => value.trim().replace(/^'|'$/g, ''))
  }

  it('accepts exactly the kinds the senders write', () => {
    expect(checkList('kind')).toEqual([...EMAIL_SEND_KINDS])
  })

  it('accepts exactly the failure codes the senders write', () => {
    expect(checkList('error_code')).toEqual([...EMAIL_SEND_FAILURE_CODES])
  })
})

describe('sendViaResend delivery log', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const IDEMPOTENCY_KEY = `auth-recovery/${AUTH_CORE}`
  const email = prepared('auth_recovery', LINKS.auth_recovery.href)

  function recordingLog(answer: () => Promise<{ error: { code?: string } | null }>) {
    return { rpc: vi.fn<EmailSendLogClient['rpc']>(() => answer()) }
  }

  function provider(response: () => Response | Promise<Response>) {
    const fetchMock = vi.fn(async () => response())
    vi.stubGlobal('fetch', fetchMock)
    return fetchMock
  }

  const accepted = () =>
    new Response(JSON.stringify({ id: '11111111-1111-4111-8111-111111111111' }), { status: 200 })

  it('records a delivered message once, after the provider accepted it', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const fetchMock = provider(accepted)
    const log = recordingLog(async () => ({ error: null }))

    await expect(sendViaResend(email, 're_test', IDEMPOTENCY_KEY, log)).resolves.toBeUndefined()

    expect(log.rpc).toHaveBeenCalledTimes(1)
    expect(log.rpc).toHaveBeenCalledWith('internal_record_email_send', {
      p_dedupe_key: createHash('sha256').update(IDEMPOTENCY_KEY).digest('hex'),
      p_kind: 'auth_recovery',
      p_recipient: 'kund@example.com',
      p_subject: email.stored.subject,
      p_html: email.stored.html,
      p_text_body: email.stored.text,
      p_status: 'sent',
      p_error_code: null,
      p_booking_id: null,
    })
    expect(fetchMock.mock.invocationCallOrder[0]).toBeLessThan(
      log.rpc.mock.invocationCallOrder[0] ?? 0,
    )
  })

  it('never hands the raw idempotency key or the credential to the log', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    provider(accepted)
    const log = recordingLog(async () => ({ error: null }))

    await sendViaResend(email, 're_test', IDEMPOTENCY_KEY, log)

    const written = JSON.stringify(log.rpc.mock.calls)
    expect(written).not.toContain(IDEMPOTENCY_KEY)
    for (const form of credentialForms(AUTH_CORE, AUTH_TOKEN, LINKS.auth_recovery.href))
      expect(written).not.toContain(form)
  })

  it('records a rejected message with its permanent failure and rethrows the provider error', async () => {
    provider(() => new Response(JSON.stringify({ name: 'validation_error' }), { status: 422 }))
    const log = recordingLog(async () => ({ error: null }))

    const failure = sendViaResend(email, 're_test', IDEMPOTENCY_KEY, log)

    await expect(failure).rejects.toBeInstanceOf(ResendDeliveryError)
    await expect(failure).rejects.toMatchObject({ kind: 'permanent', status: 422 })
    expect(log.rpc).toHaveBeenCalledWith(
      'internal_record_email_send',
      expect.objectContaining({ p_status: 'failed', p_error_code: 'send_failed_permanent' }),
    )
  })

  it('records a transport failure as transient and rethrows the same error', async () => {
    const transportError = new Error('network unavailable')
    provider(() => Promise.reject(transportError))
    const log = recordingLog(async () => ({ error: null }))

    await expect(sendViaResend(email, 're_test', IDEMPOTENCY_KEY, log)).rejects.toBe(transportError)
    expect(log.rpc).toHaveBeenCalledWith(
      'internal_record_email_send',
      expect.objectContaining({ p_status: 'failed', p_error_code: 'send_failed_transient' }),
    )
  })

  it('records an accepted response without a message id as a transient failure', async () => {
    provider(() => new Response('{}', { status: 200 }))
    const log = recordingLog(async () => ({ error: null }))

    await expect(sendViaResend(email, 're_test', IDEMPOTENCY_KEY, log)).rejects.toMatchObject({
      kind: 'transient',
    })
    expect(log.rpc).toHaveBeenCalledWith(
      'internal_record_email_send',
      expect.objectContaining({ p_status: 'failed', p_error_code: 'send_failed_transient' }),
    )
  })

  it('keeps a delivered message delivered when the log write fails, and logs no mail content', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    provider(accepted)
    const log = recordingLog(async () => ({ error: { code: '23514' } }))

    await expect(sendViaResend(email, 're_test', IDEMPOTENCY_KEY, log)).resolves.toBeUndefined()

    expect(error).toHaveBeenCalledWith('email send log write failed', {
      kind: 'auth_recovery',
      code: '23514',
    })
    const logged = JSON.stringify(error.mock.calls)
    for (const content of [
      email.message.to,
      email.message.subject,
      email.stored.html,
      email.stored.text,
    ])
      expect(logged).not.toContain(content)
  })

  it('rethrows the provider error, not the log error, when both fail', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    provider(() => new Response(JSON.stringify({ name: 'validation_error' }), { status: 422 }))
    const log = recordingLog(() => Promise.reject(new Error('log unavailable')))

    await expect(sendViaResend(email, 're_test', IDEMPOTENCY_KEY, log)).rejects.toMatchObject({
      name: 'ResendDeliveryError',
      kind: 'permanent',
    })
  })

  // A hung log write must not hold the send: the caller still has to persist the reached recipient.
  async function sendWithHungLog(response: () => Response) {
    // Only the deadline timer is faked; the digest and the stubbed provider run for real.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    provider(response)
    let reached: () => void = () => undefined
    const logCalled = new Promise<void>((resolve) => {
      reached = resolve
    })
    const log = {
      rpc: vi.fn<EmailSendLogClient['rpc']>(() => {
        reached()
        return new Promise(() => undefined)
      }),
    }
    let outcome: 'pending' | 'resolved' | 'rejected' = 'pending'
    const sending = sendViaResend(email, 're_test', IDEMPOTENCY_KEY, log)
    void sending.then(
      () => {
        outcome = 'resolved'
      },
      () => {
        outcome = 'rejected'
      },
    )
    await logCalled
    await vi.advanceTimersByTimeAsync(2_999)
    const beforeBound = outcome
    await vi.advanceTimersByTimeAsync(1)
    return { sending, beforeBound, afterBound: outcome, error }
  }

  it('settles a delivered send 3 s into a log write that never answers', async () => {
    const { sending, beforeBound, afterBound, error } = await sendWithHungLog(accepted)

    expect([beforeBound, afterBound]).toEqual(['pending', 'resolved'])
    await expect(sending).resolves.toBeUndefined()
    expect(error).toHaveBeenCalledWith('email send log write failed', {
      kind: 'auth_recovery',
      code: 'timeout',
    })
  })

  it('rethrows the provider error 3 s into a log write that never answers', async () => {
    const { sending, beforeBound, afterBound } = await sendWithHungLog(
      () => new Response(JSON.stringify({ name: 'validation_error' }), { status: 422 }),
    )

    expect([beforeBound, afterBound]).toEqual(['pending', 'rejected'])
    await expect(sending).rejects.toMatchObject({ name: 'ResendDeliveryError', kind: 'permanent' })
  })

  it('accepts the service-role clients the senders pass', () => {
    expectTypeOf<SupabaseClient>().toExtend<EmailSendLogClient>()
    expectTypeOf<ExternalActionService>().toExtend<EmailSendLogClient>()
  })
})

describe('customer link outbox delivery log', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const SALT = 'customer-access-salt-for-unit-tests-only'
  const settings = {
    business_name: 'Blade & Blend',
    business_email: 'contact@example.com',
    business_phone_display: '031-12 34 56',
    business_phone_tel: '+4631123456',
    business_street: 'Street 1',
    business_postal_code: '411 11',
    business_city: 'Göteborg',
    business_maps_href: 'https://maps.example/studio',
    cancellation_policy_hours: '24',
  }

  function outbox() {
    const rpc = vi.fn<ExternalActionService['rpc']>(async (name) => {
      if (name === 'public_business_discovery') return { data: { settings }, error: null }
      if (name === 'email_template_for_delivery')
        return { data: null, error: { message: 'use default copy' } }
      if (name === 'internal_record_email_send') return { data: null, error: null }
      return { data: true, error: null }
    })
    const service = {
      rpc,
      storage: { from: () => ({ remove: vi.fn() }) },
      auth: { admin: { updateUserById: vi.fn(), deleteUser: vi.fn() } },
    } as unknown as ExternalActionService
    const records = () =>
      rpc.mock.calls
        .filter(([name]) => name === 'internal_record_email_send')
        .map(([, params]) => params)
    return { service, records }
  }

  async function deliver(action: ExternalAction) {
    vi.spyOn(console, 'info').mockImplementation(() => undefined)
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response(JSON.stringify({ id: '11111111-1111-4111-8111-111111111111' }), {
          status: 200,
        }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const client = outbox()
    const settlement = await settleExternalAction(action, client.service, {
      googleClientId: undefined,
      googleClientSecret: undefined,
      resendApiKey: 're_test',
      customerAccessHashSalt: SALT,
    })
    const sentBody = String(fetchMock.mock.calls[0]?.[1]?.body ?? '')
    return { settlement, records: client.records(), sentBody }
  }

  const base = {
    id: '67000000-0000-4000-8000-000000000101',
    dispatch_token: '67000000-0000-4000-8000-000000000102',
    email: 'kund@example.com',
    lang: 'sv' as const,
  }

  it.each([
    [
      'customer_email_link',
      async (): Promise<ExternalAction> => ({
        ...base,
        action_type: 'customer_email_link_send',
        source_email: 'kund@example.com',
        target_email: 'ny@example.com',
        token_ciphertext: await encryptCustomerAccessToken(CUSTOMER_TOKEN, SALT),
      }),
    ],
    [
      'customer_booking_access',
      async (): Promise<ExternalAction> => ({
        ...base,
        action_type: 'customer_access_email_send',
        challenge_id: '67000000-0000-4000-8000-000000000103',
        token_ciphertext: await encryptCustomerAccessToken(CUSTOMER_TOKEN, SALT),
      }),
    ],
  ] as const)('records the %s email without its credential', async (kind, action) => {
    const { settlement, records, sentBody } = await deliver(await action())

    expect(settlement).toEqual({ status: 'completed' })
    expect(sentBody).toContain(CUSTOMER_TOKEN)
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      p_kind: kind,
      p_recipient: 'kund@example.com',
      p_status: 'sent',
      p_booking_id: null,
    })
    expect(JSON.stringify(records[0])).not.toContain(CUSTOMER_TOKEN)
    expect(records[0]?.p_text_body).toContain(HIDDEN_LINK)
  })
})

describe('every Edge email sender records its delivery', () => {
  const FUNCTIONS = 'supabase/functions'

  function sources(dir: string): readonly string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name)
      if (statSync(path).isDirectory()) return sources(path)
      return path.endsWith('.ts') ? [path] : []
    })
  }

  /** Index just past the template literal that opens at `start`. */
  function skipTemplate(source: string, start: number): number {
    let index = start + 1
    while (source[index] !== '`') {
      if (source[index] === '\\') index += 2
      else if (source.startsWith('${', index)) index = skipBalanced(source, index + 1, '{', '}')
      else index += 1
    }
    return index + 1
  }

  /** Index just past the bracket that closes the one at `start`. */
  function skipBalanced(source: string, start: number, open: string, close: string): number {
    let depth = 0
    let index = start
    while (index < source.length) {
      const char = source[index]
      if (char === '`') {
        index = skipTemplate(source, index)
        continue
      }
      if (char === "'" || char === '"') {
        index = source.indexOf(char, index + 1) + 1
        continue
      }
      if (char === open) depth += 1
      if (char === close) {
        depth -= 1
        if (depth === 0) return index + 1
      }
      index += 1
    }
    throw new Error('unbalanced source')
  }

  /** Top-level argument count of the call whose parenthesis opens at `start`. */
  function argumentCount(source: string, start: number): number {
    const end = skipBalanced(source, start, '(', ')')
    const args: string[] = []
    let current = ''
    let index = start + 1
    while (index < end - 1) {
      const char = source[index] ?? ''
      const nested =
        char === '(' ? ')' : char === '[' ? ']' : char === '{' ? '}' : char === '`' ? '`' : null
      if (nested !== null || char === "'" || char === '"') {
        const next =
          char === '`'
            ? skipTemplate(source, index)
            : nested !== null
              ? skipBalanced(source, index, char, nested)
              : source.indexOf(char, index + 1) + 1
        current += source.slice(index, next)
        index = next
        continue
      }
      if (char === ',') {
        args.push(current)
        current = ''
      } else current += char
      index += 1
    }
    args.push(current)
    return args.filter((arg) => arg.trim() !== '').length
  }

  function calls(): readonly { path: string; args: number }[] {
    return sources(FUNCTIONS).flatMap((path) => {
      const source = readFileSync(path, 'utf8')
      return [...source.matchAll(/(?<!function )\bsendViaResend\(/g)].map((match) => ({
        path,
        args: argumentCount(source, (match.index ?? 0) + 'sendViaResend'.length),
      }))
    })
  }

  it('passes the log client to every sendViaResend call', () => {
    const found = calls()
    expect(found.map(({ path }) => path).sort()).toEqual([
      'supabase/functions/_shared/externalActions.ts',
      'supabase/functions/_shared/externalActions.ts',
      'supabase/functions/admin-create-barber/index.ts',
      'supabase/functions/send-confirmation/index.ts',
      'supabase/functions/send-email-change/index.ts',
      'supabase/functions/send-recovery-email/index.ts',
    ])
    for (const call of found) expect(call.args, call.path).toBe(4)
  })

  it.each([
    ['supabase/functions/send-recovery-email/index.ts', 'auth_recovery'],
    ['supabase/functions/send-email-change/index.ts', 'auth_email_change'],
    ['supabase/functions/admin-create-barber/index.ts', 'auth_invite'],
    ['supabase/functions/_shared/externalActions.ts', 'customer_booking_access'],
    ['supabase/functions/_shared/customerEmailLink.ts', 'customer_email_link'],
  ])('%s prepares its email as %s', (path, kind) => {
    const source = readFileSync(path, 'utf8').replace(/\(\s+/g, '(')
    expect(source).toContain(`prepareEmail('${kind}',`)
    expect(source).not.toContain('buildEmailMessage(')
  })

  it('prepares each booking email under its own template kind', () => {
    const source = readFileSync('supabase/functions/send-confirmation/index.ts', 'utf8')
    expect(source).toMatch(/prepareEmail\(\s*templateName,/)
    expect(source).not.toContain('buildEmailMessage(')
    for (const template of [
      'customer_confirmation',
      'barber_confirmation',
      'customer_cancellation',
      'barber_cancellation',
      'customer_reminder',
    ])
      expect(source).toContain(`'${template}'`)
  })

  it('writes the delivery log from one place only', () => {
    const writers = sources(FUNCTIONS).filter((path) =>
      readFileSync(path, 'utf8').includes("'internal_record_email_send'"),
    )
    expect(writers).toEqual(['supabase/functions/_shared/email.ts'])
  })
})

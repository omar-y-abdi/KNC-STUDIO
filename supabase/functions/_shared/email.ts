import {
  defaultEmailTemplate,
  type EmailLanguage,
  type EmailTemplateName,
  type EmailTemplateCopy,
  type EmailMessage,
  type EmailBusiness,
} from '../../../shared/email.ts'
export * from '../../../shared/email.ts'
import { validateEmailDesign, mediaUrl } from '../../../shared/cms.ts'
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.112.2'

export type ResendFailureKind = 'transient' | 'permanent'

export class ResendDeliveryError extends Error {
  readonly kind: ResendFailureKind
  readonly status: number

  constructor(kind: ResendFailureKind, status: number, message: string) {
    super(message)
    this.name = 'ResendDeliveryError'
    this.kind = kind
    this.status = status
  }
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function httpUrl(value: unknown): value is string {
  if (!nonEmpty(value)) return false
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:'
  } catch {
    return false
  }
}

function requiredSetting(settings: Record<string, unknown>, key: string): string {
  const value = settings[key]
  if (!nonEmpty(value)) throw new Error(`business setting missing: ${key}`)
  return value
}

function optionalSetting(settings: Record<string, unknown>, key: string): string | null {
  const value = settings[key]
  return nonEmpty(value) ? value.trim() : null
}

export async function loadEmailBusiness(client: SupabaseClient): Promise<EmailBusiness> {
  const { data, error } = await client.rpc('public_business_discovery')
  if (error || typeof data !== 'object' || data === null) {
    throw new Error('business discovery unavailable')
  }
  const settingsValue = (data as Record<string, unknown>).settings
  if (typeof settingsValue !== 'object' || settingsValue === null) {
    throw new Error('business settings unavailable')
  }
  const settings = settingsValue as Record<string, unknown>
  const email = requiredSetting(settings, 'business_email').trim().toLowerCase()
  const policy = requiredSetting(settings, 'cancellation_policy_hours')
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('business email invalid')
  if (!/^\d{1,3}$/.test(policy) || Number(policy) < 1 || Number(policy) > 168) {
    throw new Error('cancellation policy invalid')
  }
  const phoneDisplay = optionalSetting(settings, 'business_phone_display')
  const phone = optionalSetting(settings, 'business_phone_tel')?.replace(/[^+0-9]/g, '') ?? null
  const canUsePhone = phoneDisplay !== null && phone !== null && /^\+?\d{3,20}$/.test(phone)
  const mapsHref = optionalSetting(settings, 'business_maps_href')
  return {
    name: requiredSetting(settings, 'business_name'),
    email,
    phoneDisplay: canUsePhone ? phoneDisplay : null,
    phoneHref: canUsePhone ? `tel:${phone}` : null,
    address: `${requiredSetting(settings, 'business_street')}, ${requiredSetting(settings, 'business_postal_code')} ${requiredSetting(settings, 'business_city')}`,
    mapsHref: mapsHref !== null && httpUrl(mapsHref) ? mapsHref : null,
    cancellationPolicyHours: Number(policy),
  }
}

export async function loadEmailTemplate(
  client: SupabaseClient,
  template: EmailTemplateName,
  lang: EmailLanguage,
): Promise<EmailTemplateCopy> {
  const fallback = defaultEmailTemplate(template, lang)
  const { data, error } = await client.rpc('email_template_for_delivery', {
    p_template: template,
    p_lang: lang,
  })
  if (error || typeof data !== 'object' || data === null) return fallback
  const row = data as Record<string, unknown>
  if (
    !nonEmpty(row.subject) ||
    !nonEmpty(row.preheader) ||
    !nonEmpty(row.title) ||
    !nonEmpty(row.intro) ||
    !nonEmpty(row.note) ||
    !nonEmpty(row.cta_label)
  )
    return fallback
  return {
    subject: row.subject,
    preheader: row.preheader,
    title: row.title,
    intro: row.intro,
    sectionTitle: nonEmpty(row.section_title) ? row.section_title : null,
    note: row.note,
    ctaLabel: row.cta_label,
    contactLead: nonEmpty(row.contact_lead) ? row.contact_lead : null,
    ...deliveryDesign(row.design, client),
  }
}

export async function sendViaResend(
  message: EmailMessage,
  apiKey: string,
  idempotencyKey: string,
): Promise<void> {
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({
      from: message.from,
      reply_to: message.replyTo,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    }),
  })
  if (response.ok) {
    const accepted: unknown = await response.json().catch(() => null)
    const id =
      typeof accepted === 'object' && accepted !== null
        ? (accepted as Record<string, unknown>)['id']
        : null
    if (typeof id !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) {
      throw new ResendDeliveryError(
        'transient',
        response.status,
        'Resend response missing message identifier',
      )
    }
    // A provider ID permits delivery diagnosis without logging recipients, message text or links.
    console.info('email provider accepted', { id })
    return
  }
  const payload: unknown = await response.json().catch(() => null)
  const providerCode =
    typeof payload === 'object' &&
    payload !== null &&
    typeof (payload as Record<string, unknown>).name === 'string'
      ? String((payload as Record<string, unknown>).name)
      : null
  const retryable =
    response.status === 408 ||
    response.status === 425 ||
    response.status === 429 ||
    response.status >= 500 ||
    (response.status === 409 && providerCode === 'concurrent_idempotent_requests')
  throw new ResendDeliveryError(
    retryable ? 'transient' : 'permanent',
    response.status,
    // Provider text may echo recipients or message content; no caller should log those details.
    `Resend API returned ${response.status}`,
  )
}

export function resendDeliveryFailureCode(
  error: unknown,
): 'send_failed_transient' | 'send_failed_permanent' {
  return error instanceof ResendDeliveryError && error.kind === 'permanent'
    ? 'send_failed_permanent'
    : 'send_failed_transient'
}

export type EmailDeliveryFailureCode = 'send_failed_transient' | 'send_failed_permanent'

export interface EmailDeliveryBatchResult<Kind extends string> {
  readonly sent: readonly Kind[]
  readonly failureCode: EmailDeliveryFailureCode | null
}

function combineDeliveryFailure(
  current: EmailDeliveryFailureCode | null,
  next: EmailDeliveryFailureCode,
): EmailDeliveryFailureCode {
  return current === 'send_failed_permanent' || next === 'send_failed_permanent'
    ? 'send_failed_permanent'
    : 'send_failed_transient'
}

export async function deliverEmailBatch<Entry extends { readonly kind: string }>(
  entries: readonly Entry[],
  deliver: (entry: Entry) => Promise<void>,
  persistDelivered: (entry: Entry) => Promise<boolean>,
): Promise<EmailDeliveryBatchResult<Entry['kind']>> {
  const sent: Entry['kind'][] = []
  let failureCode: EmailDeliveryFailureCode | null = null

  for (const entry of entries) {
    try {
      await deliver(entry)
    } catch (error) {
      failureCode = combineDeliveryFailure(failureCode, resendDeliveryFailureCode(error))
      continue
    }

    try {
      if (!(await persistDelivered(entry))) {
        failureCode = combineDeliveryFailure(failureCode, 'send_failed_transient')
        continue
      }
    } catch {
      failureCode = combineDeliveryFailure(failureCode, 'send_failed_transient')
      continue
    }

    sent.push(entry.kind)
  }

  return { sent, failureCode }
}

function deliveryDesign(raw: unknown, client: SupabaseClient): Partial<EmailTemplateCopy> {
  if (raw === null || raw === undefined) return {}
  try {
    validateEmailDesign(raw)
    if (!raw.logo) return { design: raw }
    const origin =
      typeof Deno !== 'undefined'
        ? Deno.env.get('PUBLIC_SUPABASE_URL') || Deno.env.get('SUPABASE_URL')
        : undefined
    const url = origin
      ? mediaUrl(raw.logo, origin)
      : client.storage.from(raw.logo.bucket).getPublicUrl(raw.logo.path).data.publicUrl
    return { design: raw, designLogoUrl: url }
  } catch {
    // A corrupt legacy design never creates executable mail or drops a transactional message.
    return {}
  }
}

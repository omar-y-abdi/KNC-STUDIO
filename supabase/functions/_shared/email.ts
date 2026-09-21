import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.112.2'
import { validateEmailDesign, type EmailDesign } from '../../../shared/cms.ts'

import type {
  EmailLanguage,
  EmailTemplateName,
  EmailTemplateCopy,
  EmailBusiness,
  EmailMessage,
} from '../../../shared/email-render.ts'
export { buildEmailMessage } from '../../../shared/email-render.ts'
export type {
  EmailLanguage,
  EmailTemplateName,
  EmailTemplateCopy,
  EmailBusiness,
  EmailMessage,
  EmailDetailRow,
} from '../../../shared/email-render.ts'

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

const DEFAULTS: Record<EmailTemplateName, Record<EmailLanguage, EmailTemplateCopy>> = {
  customer_confirmation: {
    sv: {
      subject: 'Bokningsbekräftelse',
      preheader: 'Din tid hos {barber_name} är bokad.',
      title: 'Din tid är bokad',
      intro: 'Hej {customer_name},\nTack för din bokning, du är varmt välkommen till oss!',
      sectionTitle: 'Din bokade tid',
      note: 'Din tid kan följas under "Mina bokningar", avbokningsvillkor {cancellation_hours}h.',
      ctaLabel: 'Mina bokningar',
      contactLead: 'Om du har frågor, kontakta oss på',
    },
    en: {
      subject: 'Booking confirmation',
      preheader: 'Your appointment with {barber_name} is confirmed.',
      title: 'Your appointment is confirmed',
      intro: 'Hi {customer_name},\nThank you for your booking. You are warmly welcome to visit us!',
      sectionTitle: 'Your appointment',
      note: 'Follow your appointment under "My appointments". Cancellation policy: {cancellation_hours} hours.',
      ctaLabel: 'My appointments',
      contactLead: 'Questions? Call us on',
    },
  },
  barber_confirmation: {
    sv: {
      subject: 'Ny bokning',
      preheader: 'Ny bokning {booking_date} {booking_time}.',
      title: 'En ny tid är bokad',
      intro: '{customer_name} har bokat en tid hos {barber_name}.',
      sectionTitle: 'Bokningsuppgifter',
      note: 'Bokningen finns i adminpanelen tillsammans med kundens kontaktuppgifter.',
      ctaLabel: 'Öppna adminpanelen',
      contactLead: 'Vid frågor, kontakta studion på',
    },
    en: {
      subject: 'New booking',
      preheader: 'New booking.',
      title: 'A new appointment is booked',
      intro: '{customer_name} booked an appointment.',
      sectionTitle: 'Booking details',
      note: 'The booking is available in the admin panel.',
      ctaLabel: 'Open admin panel',
      contactLead: 'Questions? Call the studio on',
    },
  },
  customer_cancellation: {
    sv: {
      subject: 'Avbokningsbekräftelse',
      preheader: 'Din tid hos {barber_name} är avbokad.',
      title: 'Din tid är avbokad',
      intro: 'Hej {customer_name},\nDin avbokning är bekräftad.',
      sectionTitle: 'Din avbokade tid',
      note: 'Tiden är inte längre aktiv under "Mina bokningar".',
      ctaLabel: 'Boka en ny tid',
      contactLead: 'Om du har frågor, kontakta oss på',
    },
    en: {
      subject: 'Cancellation confirmation',
      preheader: 'Your appointment with {barber_name} is cancelled.',
      title: 'Your appointment is cancelled',
      intro: 'Hi {customer_name},\nYour cancellation is confirmed.',
      sectionTitle: 'Your cancelled appointment',
      note: 'The appointment is no longer active under "My appointments".',
      ctaLabel: 'Book a new appointment',
      contactLead: 'Questions? Call us on',
    },
  },
  barber_cancellation: {
    sv: {
      subject: 'Avbokad tid',
      preheader: 'Avbokad tid {booking_date} {booking_time}.',
      title: 'En tid har avbokats',
      intro: '{customer_name}s tid hos {barber_name} har avbokats.',
      sectionTitle: 'Avbokningsuppgifter',
      note: 'Tiden har tagits bort från kommande bokningar.',
      ctaLabel: 'Öppna adminpanelen',
      contactLead: 'Vid frågor, kontakta studion på',
    },
    en: {
      subject: 'Cancelled appointment',
      preheader: 'An appointment was cancelled.',
      title: 'An appointment was cancelled',
      intro: '{customer_name} cancelled an appointment.',
      sectionTitle: 'Cancellation details',
      note: 'The appointment was removed from upcoming bookings.',
      ctaLabel: 'Open admin panel',
      contactLead: 'Questions? Call the studio on',
    },
  },
  customer_reminder: {
    sv: {
      subject: 'Påminnelse inför din bokning',
      preheader: 'Din tid hos {barber_name} är i morgon.',
      title: 'Vi ses i morgon',
      intro: 'Hej {customer_name},\nDetta är en påminnelse om din bokade tid i morgon.',
      sectionTitle: 'Din bokade tid',
      note: 'Behöver du avboka? Öppna "Mina bokningar". Avbokningsvillkor {cancellation_hours}h.',
      ctaLabel: 'Mina bokningar',
      contactLead: 'Om du har frågor, kontakta oss på',
    },
    en: {
      subject: 'Appointment reminder',
      preheader: 'Your appointment with {barber_name} is tomorrow.',
      title: 'See you tomorrow',
      intro: 'Hi {customer_name},\nThis is a reminder about your appointment tomorrow.',
      sectionTitle: 'Your appointment',
      note: 'Need to cancel? Open "My appointments". Cancellation policy: {cancellation_hours} hours.',
      ctaLabel: 'My appointments',
      contactLead: 'Questions? Call us on',
    },
  },
  customer_booking_access: {
    sv: {
      subject: 'Öppna Mina bokningar',
      preheader: 'Öppna din säkra länk till Mina bokningar.',
      title: 'Öppna Mina bokningar',
      intro: 'Använd länken för att se och hantera dina bokade tider.',
      sectionTitle: null,
      note: 'Länken gäller tills du begär en ny. Då slutar den tidigare länken att fungera.',
      ctaLabel: 'Öppna Mina bokningar',
      contactLead: 'Om du inte begärde länken kan du ignorera detta mejl.',
    },
    en: {
      subject: 'Open My appointments',
      preheader: 'Open your secure My appointments link.',
      title: 'Open My appointments',
      intro: 'Use the link to view and manage your booked appointments.',
      sectionTitle: null,
      note: 'This link remains valid until you request a new one. The previous link then stops working.',
      ctaLabel: 'Open My appointments',
      contactLead: 'Ignore this email if you did not request the link.',
    },
  },
  auth_recovery: {
    sv: {
      subject: 'Återställ lösenord',
      preheader: 'Välj ett nytt lösenord till ditt konto.',
      title: 'Återställ ditt lösenord',
      intro: 'Vi har fått en begäran om att återställa lösenordet för ditt konto.',
      sectionTitle: null,
      note: 'Länken gäller i 60 minuter. Om du inte begärde återställningen kan du ignorera mejlet.',
      ctaLabel: 'Välj nytt lösenord',
      contactLead: 'Behöver du hjälp? Kontakta oss på',
    },
    en: {
      subject: 'Reset password',
      preheader: 'Choose a new password for your account.',
      title: 'Reset your password',
      intro: 'We received a request to reset the password for your account.',
      sectionTitle: null,
      note: 'The link is valid for 60 minutes. Ignore this email if you did not request the reset.',
      ctaLabel: 'Choose new password',
      contactLead: 'Need help? Call us on',
    },
  },
  auth_email_change: {
    sv: {
      subject: 'Bekräfta ny e-postadress',
      preheader: 'Bekräfta din nya e-postadress.',
      title: 'Bekräfta din nya e-postadress',
      intro: 'Bekräfta {new_email} som ny e-postadress för ditt konto.',
      sectionTitle: null,
      note: 'Länken gäller i 60 minuter och kan bara användas en gång. Ignorera mejlet om du inte begärde ändringen.',
      ctaLabel: 'Bekräfta e-postadress',
      contactLead: 'Behöver du hjälp? Kontakta oss på',
    },
    en: {
      subject: 'Confirm new email address',
      preheader: 'Confirm your new email address.',
      title: 'Confirm your new email address',
      intro: 'Confirm {new_email} as the new email address for your account.',
      sectionTitle: null,
      note: 'The link is valid for 60 minutes and can only be used once. Ignore this email if you did not request the change.',
      ctaLabel: 'Confirm email address',
      contactLead: 'Need help? Call us on',
    },
  },
  auth_invite: {
    sv: {
      subject: 'Din inbjudan till {business_name}',
      preheader: 'Skapa ditt personliga lösenord och aktivera kontot.',
      title: 'Välkommen till teamet',
      intro: 'Du har blivit inbjuden till barberarpanelen hos {business_name}.',
      sectionTitle: null,
      note: 'Länken gäller i 60 minuter och kan bara användas en gång.',
      ctaLabel: 'Skapa mitt lösenord',
      contactLead: 'Behöver du hjälp? Kontakta oss på',
    },
    en: {
      subject: 'Your invitation to {business_name}',
      preheader: 'Create your personal password and activate the account.',
      title: 'Welcome to the team',
      intro: 'You have been invited to the barber panel at {business_name}.',
      sectionTitle: null,
      note: 'The link is valid for 60 minutes and can only be used once.',
      ctaLabel: 'Create my password',
      contactLead: 'Need help? Call us on',
    },
  },
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
  const fallback = DEFAULTS[template][lang]
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
  let design: EmailDesign | null = null
  let designLogoUrl: string | undefined
  if (row.design !== undefined && row.design !== null) {
    try {
      validateEmailDesign(row.design)
      design = row.design
      if (design.logo)
        designLogoUrl = client.storage.from(design.logo.bucket).getPublicUrl(design.logo.path)
          .data.publicUrl
    } catch {
      design = null
    }
  }
  return {
    subject: row.subject,
    preheader: row.preheader,
    title: row.title,
    intro: row.intro,
    sectionTitle: nonEmpty(row.section_title) ? row.section_title : null,
    note: row.note,
    ctaLabel: row.cta_label,
    contactLead: nonEmpty(row.contact_lead) ? row.contact_lead : null,
    design,
    ...(designLogoUrl ? { designLogoUrl } : {}),
  }
}

export function defaultEmailTemplate(
  template: EmailTemplateName,
  lang: EmailLanguage,
): EmailTemplateCopy {
  return DEFAULTS[template][lang]
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

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export type EmailLanguage = 'sv' | 'en'
export type EmailTemplateName =
  | 'customer_confirmation'
  | 'barber_confirmation'
  | 'customer_cancellation'
  | 'barber_cancellation'
  | 'customer_reminder'
  | 'auth_recovery'
  | 'auth_email_change'

export interface EmailTemplateCopy {
  readonly subject: string
  readonly preheader: string
  readonly title: string
  readonly intro: string
  readonly sectionTitle: string | null
  readonly note: string
  readonly ctaLabel: string
  readonly contactLead: string | null
}

export interface EmailDetailRow {
  readonly label: string
  readonly value: string
}

export interface EmailMessage {
  readonly to: string
  readonly subject: string
  readonly text: string
  readonly html: string
}

interface EmailBuildInput {
  readonly to: string
  readonly lang: EmailLanguage
  readonly copy: EmailTemplateCopy
  readonly variables?: Readonly<Record<string, string>>
  readonly rows?: readonly EmailDetailRow[]
  readonly ctaHref: string
}

const SITE_URL = 'https://bladeblendstudio.se'
const FROM = 'Blade & Blend Studio <booking@mail.bladeblendstudio.se>'
const PHONE_DISPLAY = '079-304 36 71'
const PHONE_HREF = 'tel:+46793043671'
const ADDRESS = 'Geijersgatan 10, 411 34 Göteborg'
const MAPS_URL =
  'https://www.google.com/maps/search/?api=1&query=Geijersgatan%2010%2C%20411%2034%20G%C3%B6teborg'

const DEFAULTS: Record<EmailTemplateName, Record<EmailLanguage, EmailTemplateCopy>> = {
  customer_confirmation: {
    sv: {
      subject: 'Bokningsbekräftelse',
      preheader: 'Din tid hos {barber_name} är bokad.',
      title: 'Din tid är bokad',
      intro: 'Hej {customer_name},\nTack för din bokning, du är varmt välkommen till oss!',
      sectionTitle: 'Din bokade tid',
      note: 'Din tid kan följas under "Mina bokningar", avbokningsvillkor 24h.',
      ctaLabel: 'Mina bokningar',
      contactLead: 'Om du har frågor, kontakta oss på',
    },
    en: {
      subject: 'Booking confirmation',
      preheader: 'Your appointment with {barber_name} is confirmed.',
      title: 'Your appointment is confirmed',
      intro: 'Hi {customer_name},\nThank you for your booking. You are warmly welcome to visit us!',
      sectionTitle: 'Your appointment',
      note: 'Follow your appointment under "My appointments". Cancellation policy: 24 hours.',
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
      note: 'Behöver du avboka? Öppna "Mina bokningar". Avbokningsvillkor 24h.',
      ctaLabel: 'Mina bokningar',
      contactLead: 'Om du har frågor, kontakta oss på',
    },
    en: {
      subject: 'Appointment reminder',
      preheader: 'Your appointment with {barber_name} is tomorrow.',
      title: 'See you tomorrow',
      intro: 'Hi {customer_name},\nThis is a reminder about your appointment tomorrow.',
      sectionTitle: 'Your appointment',
      note: 'Need to cancel? Open "My appointments". Cancellation policy: 24 hours.',
      ctaLabel: 'My appointments',
      contactLead: 'Questions? Call us on',
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
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
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
  return {
    subject: row.subject,
    preheader: row.preheader,
    title: row.title,
    intro: row.intro,
    sectionTitle: nonEmpty(row.section_title) ? row.section_title : null,
    note: row.note,
    ctaLabel: row.cta_label,
    contactLead: nonEmpty(row.contact_lead) ? row.contact_lead : null,
  }
}

export function defaultEmailTemplate(
  template: EmailTemplateName,
  lang: EmailLanguage,
): EmailTemplateCopy {
  return DEFAULTS[template][lang]
}

function interpolate(value: string, variables: Readonly<Record<string, string>>): string {
  return value.replace(/\{([a-z_]+)\}/g, (match, key: string) => variables[key] ?? match)
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

function htmlText(value: string): string {
  return escapeHtml(value).replaceAll('\n', '<br>')
}

function rowsHtml(rows: readonly EmailDetailRow[]): string {
  return rows
    .map(
      (row, index) =>
        `<tr><td style="padding:${index === 0 ? '0 0 14px' : '14px 0'};color:#98989d;font-size:14px;line-height:1.45;vertical-align:top;border-bottom:${index === rows.length - 1 ? '0' : '1px solid #424245'}">${escapeHtml(row.label)}</td><td align="right" style="padding:${index === 0 ? '0 0 14px' : '14px 0'};color:#f5f5f7;font-size:15px;font-weight:650;line-height:1.45;vertical-align:top;border-bottom:${index === rows.length - 1 ? '0' : '1px solid #424245'}">${escapeHtml(row.value)}</td></tr>`,
    )
    .join('')
}

export function buildEmailMessage(input: EmailBuildInput): EmailMessage {
  const variables = input.variables ?? {}
  const subject = interpolate(input.copy.subject, variables)
  const preheader = interpolate(input.copy.preheader, variables)
  const title = interpolate(input.copy.title, variables)
  const intro = interpolate(input.copy.intro, variables)
  const sectionTitle =
    input.copy.sectionTitle === null ? null : interpolate(input.copy.sectionTitle, variables)
  const note = interpolate(input.copy.note, variables)
  const ctaLabel = interpolate(input.copy.ctaLabel, variables)
  const contactLead =
    input.copy.contactLead === null ? null : interpolate(input.copy.contactLead, variables)
  const rows = input.rows ?? []
  const detailBlock =
    rows.length === 0
      ? ''
      : `<p style="margin:0 0 12px;color:#b5b5ba;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase">${escapeHtml(sectionTitle ?? '')}</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#303033" style="width:100%;background:#303033;border:1px solid #48484b;border-radius:18px;border-collapse:separate;padding:20px 22px">${rowsHtml(rows)}</table>`
  const contactBlock =
    contactLead === null
      ? ''
      : `<p style="margin:28px 0 0;color:#a9a9ae;font-size:13px;line-height:1.6">${htmlText(contactLead)} <a href="${PHONE_HREF}" style="color:#f5f5f7;text-decoration:underline;text-decoration-color:#68686d;text-underline-offset:3px">${PHONE_DISPLAY}</a></p>`
  const html = `<!doctype html><html lang="${input.lang}" style="color-scheme:dark;supported-color-schemes:dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>${escapeHtml(subject)}</title></head><body bgcolor="#151517" style="margin:0;padding:0;background:#151517;color:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"><div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(preheader)}&#847;&zwnj;&nbsp;&#8199;</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#151517" style="width:100%;background:#151517"><tr><td align="center" style="padding:34px 14px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#1f1f21" style="width:100%;max-width:600px;background:#1f1f21;border:1px solid #39393c;border-radius:28px;border-collapse:separate;overflow:hidden"><tr><td style="padding:32px 34px 0"><a href="${SITE_URL}" style="display:inline-block;color:#f5f5f7;text-decoration:none;font-size:18px;font-weight:750;letter-spacing:-.025em">BLADE &amp; BLEND</a></td></tr><tr><td style="padding:40px 34px 34px"><h1 style="margin:0;color:#f5f5f7;font-size:32px;font-weight:750;letter-spacing:-.04em;line-height:1.12">${htmlText(title)}</h1><p style="margin:20px 0 32px;color:#d1d1d6;font-size:16px;line-height:1.65">${htmlText(intro)}</p>${detailBlock}<p style="margin:28px 0 22px;color:#b5b5ba;font-size:14px;line-height:1.65">${htmlText(note)}</p><table role="presentation" cellspacing="0" cellpadding="0"><tr><td bgcolor="#f5f5f7" style="background:#f5f5f7;border-radius:12px"><a href="${escapeHtml(input.ctaHref)}" style="display:inline-block;padding:15px 22px;color:#171719;text-decoration:none;font-size:15px;font-weight:750">${escapeHtml(ctaLabel)}</a></td></tr></table>${contactBlock}<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin-top:38px;border-top:1px solid #39393c"><tr><td style="padding-top:22px;color:#737378;font-size:12px;line-height:1.65"><a href="${MAPS_URL}" style="color:#98989d;text-decoration:none">${ADDRESS}</a><br><a href="${PHONE_HREF}" style="color:#98989d;text-decoration:none">${PHONE_DISPLAY}</a></td></tr></table></td></tr></table></td></tr></table></body></html>`
  const text = [
    title,
    intro,
    sectionTitle,
    ...rows.map((row) => `${row.label}: ${row.value}`),
    note,
    `${ctaLabel}: ${input.ctaHref}`,
    contactLead === null ? null : `${contactLead} ${PHONE_DISPLAY}`,
    ADDRESS,
    PHONE_DISPLAY,
  ]
    .filter((value): value is string => value !== null && value.length > 0)
    .join('\n\n')
  return { to: input.to, subject, text, html }
}

export async function sendViaResend(
  message: EmailMessage,
  apiKey: string,
  idempotencyKey: string,
): Promise<void> {
  const replyTo = Deno.env.get('BOOKING_REPLY_TO')?.trim() || 'booking@mail.bladeblendstudio.se'
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({ from: FROM, reply_to: replyTo, ...message }),
  })
  if (response.ok) return
  const payload: unknown = await response.json().catch(() => null)
  const providerMessage =
    typeof payload === 'object' &&
    payload !== null &&
    typeof (payload as Record<string, unknown>).message === 'string'
      ? String((payload as Record<string, unknown>).message)
      : 'unknown provider error'
  throw new Error(`Resend API returned ${response.status}: ${providerMessage.slice(0, 240)}`)
}

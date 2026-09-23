// One renderer for delivered transactional emails and the owner's CMS preview.
import { renderDesignedEmail } from './cms-email.ts'
import type { EmailDesign } from './cms.ts'

export type EmailLanguage = 'sv' | 'en'
export type EmailTemplateName =
  | 'customer_confirmation'
  | 'barber_confirmation'
  | 'customer_cancellation'
  | 'barber_cancellation'
  | 'customer_reminder'
  | 'customer_booking_access'
  | 'auth_recovery'
  | 'auth_email_change'
  | 'auth_invite'

export interface EmailTemplateCopy {
  readonly subject: string
  readonly preheader: string
  readonly title: string
  readonly intro: string
  readonly sectionTitle: string | null
  readonly note: string
  readonly ctaLabel: string
  readonly contactLead: string | null
  readonly design?: EmailDesign | null
  readonly designLogoUrl?: string
}

export interface EmailDetailRow {
  readonly label: string
  readonly value: string
}

export interface EmailMessage {
  readonly to: string
  readonly from: string
  readonly replyTo: string
  readonly subject: string
  readonly text: string
  readonly html: string
}

export interface EmailBuildInput {
  readonly to: string
  readonly lang: EmailLanguage
  readonly copy: EmailTemplateCopy
  readonly variables?: Readonly<Record<string, string>>
  readonly rows?: readonly EmailDetailRow[]
  readonly ctaHref: string
  readonly business: EmailBusiness
}

const SENDING_MAILBOX = 'booking@mail.bladeblendstudio.se'

export interface EmailBusiness {
  readonly name: string
  readonly email: string
  /** Both are null when the owner intentionally removes phone contact from email CMS. */
  readonly phoneDisplay: string | null
  readonly phoneHref: string | null
  readonly address: string
  /** Null when map contact is intentionally removed or the value is unsafe. */
  readonly mapsHref: string | null
  readonly cancellationPolicyHours: number
}

function interpolate(value: string, variables: Readonly<Record<string, string>>): string {
  return value.replace(/\{([a-z_]+)\}/g, (match, key: string) => variables[key] ?? match)
}

export function buildEmailMessage(input: EmailBuildInput): EmailMessage {
  const variables = { business_name: input.business.name, ...input.variables }
  const subject = interpolate(input.copy.subject, variables)
  const title = interpolate(input.copy.title, variables)
  const intro = interpolate(input.copy.intro, variables)
  const sectionTitle =
    input.copy.sectionTitle === null ? null : interpolate(input.copy.sectionTitle, variables)
  const note = interpolate(input.copy.note, variables)
  const ctaLabel = interpolate(input.copy.ctaLabel, variables)
  const contactLead =
    input.copy.contactLead === null ? null : interpolate(input.copy.contactLead, variables)
  const rows = input.rows ?? []
  const business = input.business
  const html = renderDesignedEmail(input, input.copy.design ?? undefined)
  const text = [
    title,
    intro,
    sectionTitle,
    ...rows.map((row) => `${row.label}: ${row.value}`),
    note,
    `${ctaLabel}: ${input.ctaHref}`,
    contactLead === null || business.phoneDisplay === null
      ? null
      : `${contactLead} ${business.phoneDisplay}`,
    business.address,
    business.phoneDisplay,
  ]
    .filter((value): value is string => value !== null && value.length > 0)
    .join('\n\n')
  return {
    to: input.to,
    from: `${business.name} <${SENDING_MAILBOX}>`,
    replyTo: business.email,
    subject,
    text,
    html,
  }
}

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

const SITE_URL = 'https://bladeblendstudio.se'
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
  const variables = { business_name: input.business.name, ...input.variables }
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
  const business = input.business
  const phoneLink =
    business.phoneHref !== null && business.phoneDisplay !== null
      ? `<a href="${escapeHtml(business.phoneHref)}" style="color:#f5f5f7;text-decoration:underline;text-decoration-color:#68686d;text-underline-offset:3px;white-space:nowrap">${escapeHtml(business.phoneDisplay)}</a>`
      : ''
  const detailBlock =
    rows.length === 0
      ? ''
      : `<p style="margin:0 0 12px;color:#b5b5ba;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase">${escapeHtml(sectionTitle ?? '')}</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#303033" style="width:100%;background:#303033;border:1px solid #48484b;border-radius:18px;border-collapse:separate;padding:20px 22px">${rowsHtml(rows)}</table>`
  const contactBlock =
    contactLead === null || phoneLink === ''
      ? ''
      : `<p style="margin:28px 0 0;color:#a9a9ae;font-size:13px;line-height:1.6">${htmlText(contactLead)} ${phoneLink}</p>`
  const addressLink =
    business.mapsHref === null
      ? escapeHtml(business.address)
      : `<a href="${escapeHtml(business.mapsHref)}" style="color:#98989d;text-decoration:none">${escapeHtml(business.address)}</a>`
  const footerPhone =
    business.phoneHref === null || business.phoneDisplay === null
      ? ''
      : `<br><a href="${escapeHtml(business.phoneHref)}" style="color:#98989d;text-decoration:none">${escapeHtml(business.phoneDisplay)}</a>`
  const legacyHtml = `<!doctype html><html lang="${input.lang}" style="color-scheme:dark;supported-color-schemes:dark"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"><title>${escapeHtml(subject)}</title></head><body bgcolor="#151517" style="margin:0;padding:0;background:#151517;color:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"><div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escapeHtml(preheader)}&#847;&zwnj;&nbsp;&#8199;</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#151517" style="width:100%;background:#151517"><tr><td align="center" style="padding:34px 14px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#1f1f21" style="width:100%;max-width:600px;background:#1f1f21;border:1px solid #39393c;border-radius:28px;border-collapse:separate;overflow:hidden"><tr><td style="padding:32px 34px 0"><a href="${SITE_URL}" style="display:inline-block;color:#f5f5f7;text-decoration:none;font-size:18px;font-weight:750;letter-spacing:-.025em">BLADE &amp; BLEND</a></td></tr><tr><td style="padding:40px 34px 34px"><h1 style="margin:0;color:#f5f5f7;font-size:32px;font-weight:750;letter-spacing:-.04em;line-height:1.12">${htmlText(title)}</h1><p style="margin:20px 0 32px;color:#d1d1d6;font-size:16px;line-height:1.65">${htmlText(intro)}</p>${detailBlock}<p style="margin:28px 0 22px;color:#b5b5ba;font-size:14px;line-height:1.65">${htmlText(note)}</p><table role="presentation" cellspacing="0" cellpadding="0"><tr><td bgcolor="#f5f5f7" style="background:#f5f5f7;border-radius:12px"><a href="${escapeHtml(input.ctaHref)}" style="display:inline-block;padding:15px 22px;color:#171719;text-decoration:none;font-size:15px;font-weight:750">${escapeHtml(ctaLabel)}</a></td></tr></table>${contactBlock}<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin-top:38px;border-top:1px solid #39393c"><tr><td style="padding-top:22px;color:#737378;font-size:12px;line-height:1.65">${addressLink}${footerPhone}</td></tr></table></td></tr></table></td></tr></table></body></html>`
  const html = input.copy.design
    ? renderDesignedEmail(
        {
          lang: input.lang,
          copy: {
            subject: input.copy.subject,
            preheader: input.copy.preheader,
            title: input.copy.title,
            intro: input.copy.intro,
            sectionTitle: input.copy.sectionTitle,
            note: input.copy.note,
            ctaLabel: input.copy.ctaLabel,
            contactLead: input.copy.contactLead,
            ...(input.copy.designLogoUrl ? { designLogoUrl: input.copy.designLogoUrl } : {}),
          },
          ...(input.variables ? { variables: input.variables } : {}),
          ...(input.rows ? { rows: input.rows } : {}),
          ctaHref: input.ctaHref,
          business: input.business,
        },
        input.copy.design,
      )
    : legacyHtml
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

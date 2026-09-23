import {
  defaultEmailDesign,
  validateEmailDesign,
  type CmsLang,
  type CmsMode,
  type EmailDesign,
} from './cms.ts'

export interface DesignedEmailCopy {
  subject: string
  preheader: string
  title: string
  intro: string
  sectionTitle: string | null
  note: string
  ctaLabel: string
  contactLead: string | null
  designLogoUrl?: string
}
export interface DesignedEmailInput {
  lang: CmsLang
  copy: DesignedEmailCopy
  variables?: Readonly<Record<string, string>>
  rows?: readonly { label: string; value: string }[]
  ctaHref: string
  business: {
    name: string
    phoneDisplay: string | null
    phoneHref: string | null
    address: string
    mapsHref: string | null
  }
}

const escape = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
const expand = (value: string, variables: Readonly<Record<string, string>>): string =>
  value.replace(/\{([a-z_]+)\}/g, (match, key: string) => variables[key] ?? match)
const copy = (value: string, variables: Readonly<Record<string, string>>): string =>
  escape(expand(value, variables)).replaceAll('\n', '<br>')

/** The default design is the existing delivered email, not a second template.
 * Enabling controls only persists these values; all variants use this renderer. */
export function renderDesignedEmail(
  input: DesignedEmailInput,
  design: EmailDesign = defaultEmailDesign(),
  previewMode?: CmsMode,
): string {
  validateEmailDesign(design)
  const mode = previewMode ?? design.defaultMode
  const colors = design.palettes[mode]
  const variables = { business_name: input.business.name, ...input.variables }
  const font =
    design.font === 'serif'
      ? 'Georgia,serif'
      : design.font === 'sans'
        ? 'Arial,sans-serif'
        : "-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"
  const text = (value: string): string => copy(value, variables)
  const rows = input.rows ?? []
  const business = input.business
  // Preserve the delivered dark palette's inset and secondary text hierarchy.
  // Explicit palette edits still control the corresponding text/border roles.
  const defaults = defaultEmailDesign().palettes[mode]
  const secondary = colors.muted === defaults.muted && mode === 'dark' ? '#98989d' : colors.muted
  const introColor = colors.text === defaults.text && mode === 'dark' ? '#d1d1d6' : colors.text
  const contactColor = colors.muted === defaults.muted && mode === 'dark' ? '#a9a9ae' : colors.muted
  const inset = mode === 'dark' ? '#303033' : '#f5f5f7'
  const insetBorder =
    colors.border === defaults.border && mode === 'dark' ? '#48484b' : colors.border
  const divider = colors.border === defaults.border && mode === 'dark' ? '#424245' : colors.border
  const phoneLink =
    business.phoneHref !== null && business.phoneDisplay !== null
      ? `<a href="${escape(business.phoneHref)}" style="color:${colors.text};text-decoration:underline;text-decoration-color:${colors.border === defaults.border && mode === 'dark' ? '#68686d' : colors.border};text-underline-offset:3px;white-space:nowrap">${escape(business.phoneDisplay)}</a>`
      : ''
  const addressLink =
    business.mapsHref === null
      ? escape(business.address)
      : `<a href="${escape(business.mapsHref)}" style="color:${secondary};text-decoration:none">${escape(business.address)}</a>`
  const footerPhone =
    business.phoneHref === null || business.phoneDisplay === null
      ? ''
      : `<br><a href="${escape(business.phoneHref)}" style="color:${secondary};text-decoration:none">${escape(business.phoneDisplay)}</a>`
  const rowsHtml = rows
    .map((row, index) => {
      const padding = index === 0 ? '0 0 14px' : '14px 0'
      const border = index === rows.length - 1 ? '0' : `1px solid ${divider}`
      return `<tr><td style="padding:${padding};color:${secondary};font-size:${design.textSize - 2}px;line-height:1.45;vertical-align:top;border-bottom:${border}">${escape(row.label)}</td><td align="right" style="padding:${padding};color:${colors.text};font-size:${design.textSize - 1}px;font-weight:650;line-height:1.45;vertical-align:top;border-bottom:${border}">${escape(row.value)}</td></tr>`
    })
    .join('')
  const parts: Record<EmailDesign['order'][number], string> = {
    title: `<h1 data-email-part="title" style="margin:0;color:${colors.text};font-size:${design.titleSize}px;font-weight:750;letter-spacing:-.04em;line-height:1.12">${text(input.copy.title)}</h1>`,
    intro: `<p data-email-part="intro" style="margin:20px 0 32px;color:${introColor};font-size:${design.textSize}px;line-height:1.65">${text(input.copy.intro)}</p>`,
    details: !rows.length
      ? ''
      : `<p data-email-part="details" style="margin:0 0 12px;color:${colors.muted};font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase">${text(input.copy.sectionTitle ?? '')}</p><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${inset}" style="width:100%;background:${inset};border:1px solid ${insetBorder};border-radius:${Math.min(18, design.radius)}px;border-collapse:separate;padding:20px 22px">${rowsHtml}</table>`,
    note: `<p data-email-part="note" style="margin:28px 0 22px;color:${colors.muted};font-size:${design.textSize - 2}px;line-height:1.65">${text(input.copy.note)}</p>`,
    cta: `<table data-email-part="cta" role="presentation" cellspacing="0" cellpadding="0"><tr><td bgcolor="${colors.button}" style="background:${colors.button};border-radius:${Math.min(12, design.radius)}px"><a href="${escape(input.ctaHref)}" style="display:inline-block;padding:15px 22px;color:${colors.buttonText};text-decoration:none;font-size:${design.textSize - 1}px;font-weight:750">${text(input.copy.ctaLabel)}</a></td></tr></table>`,
    contact: `${input.copy.contactLead === null || !phoneLink ? '' : `<p data-email-part="contact" style="margin:28px 0 0;color:${contactColor};font-size:13px;line-height:1.6">${text(input.copy.contactLead)} ${phoneLink}</p>`}<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="width:100%;margin-top:38px;border-top:1px solid ${colors.border}"><tr><td style="padding-top:22px;color:${colors.muted === defaults.muted && mode === 'dark' ? '#737378' : colors.muted};font-size:12px;line-height:1.65">${addressLink}${footerPhone}</td></tr></table>`,
  }
  const logo =
    design.logo && input.copy.designLogoUrl
      ? `<img src="${escape(input.copy.designLogoUrl)}" width="160" alt="${escape(business.name)}" style="max-width:160px;max-height:100px;object-fit:contain;display:block">`
      : 'BLADE &amp; BLEND'
  return `<!doctype html><html lang="${input.lang}" style="color-scheme:${mode};supported-color-schemes:${mode}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="${mode}"><meta name="supported-color-schemes" content="${mode}"><title>${escape(expand(input.copy.subject, variables))}</title></head><body bgcolor="${colors.background}" style="margin:0;padding:0;background:${colors.background};color:${colors.text};font-family:${font}"><div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">${escape(expand(input.copy.preheader, variables))}&#847;&zwnj;&nbsp;&#8199;</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${colors.background}" style="width:100%;background:${colors.background}"><tr><td align="center" style="padding:34px 14px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="${colors.surface}" style="width:100%;max-width:${design.width}px;background:${colors.surface};border:1px solid ${colors.border};border-radius:${design.radius}px;border-collapse:separate;overflow:hidden"><tr><td style="padding:32px ${design.padding}px 0"><a href="https://bladeblendstudio.se" aria-label="${escape(business.name)}" style="display:inline-block;color:${colors.text};text-decoration:none;font-size:18px;font-weight:750;letter-spacing:-.025em">${logo}</a></td></tr><tr><td style="padding:40px ${design.padding}px ${design.padding}px">${design.order.map((part) => parts[part]).join('')}</td></tr></table></td></tr></table></body></html>`
}

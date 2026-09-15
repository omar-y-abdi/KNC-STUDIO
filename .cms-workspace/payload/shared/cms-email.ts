import { validateEmailDesign, type CmsMode, type EmailDesign } from './cms.ts'
import type { EmailBuildInput } from './email.ts'

const escape = (value: string): string => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;')
const expand = (value: string, variables: Readonly<Record<string, string>>): string => value.replace(/\{([a-z_]+)\}/g, (match, key: string) => variables[key] ?? match)
const copy = (value: string, variables: Readonly<Record<string, string>>): string => escape(expand(value, variables)).replaceAll('\n', '<br>')

export function renderDesignedEmail(input: EmailBuildInput, design: EmailDesign, previewMode?: CmsMode): string {
  validateEmailDesign(design)
  const mode = previewMode ?? design.defaultMode, colors = design.palettes[mode]
  const variables = { business_name: input.business.name, ...input.variables }
  const font = design.font === 'serif' ? 'Georgia,serif' : design.font === 'sans' ? 'Arial,sans-serif' : '-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif'
  const text = (value: string): string => copy(value, variables)
  const details = input.rows ?? []
  const link = (href: string, label: string): string => `<a href="${escape(href)}" style="color:${colors.text}">${escape(label)}</a>`
  const parts: Record<string, string> = {
    title: `<h1 data-email-part="title" style="margin:0 0 24px;font-size:${design.titleSize}px;line-height:1.2;color:${colors.text}">${text(input.copy.title)}</h1>`,
    intro: `<p data-email-part="intro" style="margin:0 0 24px;font-size:${design.textSize}px;line-height:1.65;color:${colors.text}">${text(input.copy.intro)}</p>`,
    details: details.length === 0 ? '' : `<section data-email-part="details"><p style="font-weight:700;font-size:12px;color:${colors.muted}">${text(input.copy.sectionTitle ?? '')}</p><table role="presentation" width="100%" cellspacing="0" cellpadding="12" style="border:1px solid ${colors.border};margin-bottom:24px">${details.map(row => `<tr><td style="font-size:${design.textSize}px;color:${colors.muted}">${escape(row.label)}</td><td align="right" style="font-size:${design.textSize}px;color:${colors.text}">${escape(row.value)}</td></tr>`).join('')}</table></section>`,
    note: `<p data-email-part="note" style="font-size:${design.textSize - 2}px;color:${colors.muted};line-height:1.65;margin:0 0 24px">${text(input.copy.note)}</p>`,
    cta: `<table data-email-part="cta" role="presentation" cellspacing="0" cellpadding="0" style="margin-bottom:24px"><tr><td bgcolor="${colors.button}" style="background:${colors.button};border-radius:${Math.min(12, design.radius)}px"><a href="${escape(input.ctaHref)}" style="display:inline-block;padding:15px 22px;color:${colors.buttonText};font-size:${design.textSize}px;font-weight:700;text-decoration:none">${text(input.copy.ctaLabel)}</a></td></tr></table>`,
    contact: `<div data-email-part="contact" style="font-size:12px;line-height:1.65;color:${colors.muted}">${input.copy.contactLead && input.business.phoneHref && input.business.phoneDisplay ? `<p>${text(input.copy.contactLead)} ${link(input.business.phoneHref, input.business.phoneDisplay)}</p>` : ''}<p>${input.business.mapsHref ? link(input.business.mapsHref, input.business.address) : escape(input.business.address)}</p></div>`,
  }
  const logo = design.logo && input.copy.designLogoUrl ? `<img src="${escape(input.copy.designLogoUrl)}" width="160" alt="${escape(input.business.name)}" style="max-width:160px;max-height:100px;object-fit:contain;display:block;margin:0 0 28px">` : `<p style="font-size:18px;font-weight:750;margin:0 0 28px">${escape(input.business.name)}</p>`
  return `<!doctype html><html lang="${input.lang}" style="color-scheme:${mode}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="${mode}"><title>${text(input.copy.subject)}</title></head><body bgcolor="${colors.background}" style="margin:0;background:${colors.background};color:${colors.text};font-family:${font}"><div style="display:none;max-height:0;overflow:hidden;opacity:0">${text(input.copy.preheader)}</div><table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="${colors.background}"><tr><td align="center" style="padding:32px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="${colors.surface}" style="width:100%;max-width:${design.width}px;background:${colors.surface};border:1px solid ${colors.border};border-radius:${design.radius}px"><tr><td style="padding:${design.padding}px">${logo}${design.order.map(part => parts[part]).join('')}</td></tr></table></td></tr></table></body></html>`
}

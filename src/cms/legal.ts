import {
  formatBusinessAddress,
  type BusinessSettings,
} from '../site/business'

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function escapeElementText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function tagBounds(
  html: string,
  id: string,
): { readonly start: number; readonly end: number } | null {
  const markerIndex = html.indexOf(`id="${id}"`)
  if (markerIndex < 0) return null
  const start = html.lastIndexOf('<', markerIndex)
  const end = html.indexOf('>', markerIndex)
  return start >= 0 && end >= 0 ? { start, end } : null
}

function replaceElementContent(html: string, id: string, value: string): string {
  const bounds = tagBounds(html, id)
  if (bounds === null) return html
  const openingTag = html.slice(bounds.start, bounds.end + 1)
  const tag = openingTag.match(/^<([a-z0-9-]+)/i)?.[1]
  if (tag === undefined) return html
  const closingStart = html.indexOf(`</${tag}>`, bounds.end + 1)
  if (closingStart < 0) return html
  return `${html.slice(0, bounds.end + 1)}${value}${html.slice(closingStart)}`
}

function replaceElementText(html: string, id: string, value: string): string {
  return replaceElementContent(html, id, escapeElementText(value))
}

export function enrichLegalMarkup(html: string, business: BusinessSettings): string {
  let rendered = html.replaceAll(
    /<span\b(?=[^>]*\bdata-business-name(?:=(?:"[^"]*"|'[^']*'))?)[^>]*>[^<]*<\/span\s*>/g,
    () => `<span data-business-name>${escapeElementText(business.name)}</span>`,
  )
  rendered = rendered.replaceAll(
    /<span\b(?=[^>]*\bdata-business-controller=(["'])(sv|en)\1)[^>]*>[^<]*<\/span\s*>/g,
    (_match, _quote: string, lang: string) =>
      `<span data-business-controller="${lang}">${escapeElementText(business.legalName || business.name)}</span>`,
  )
  const contact =
    business.email === ''
      ? '<a href="/">Kontakt / Contact</a>'
      : `<a href="mailto:${escapeAttribute(business.email)}">${escapeElementText(business.email)}</a>`
  rendered = rendered.replaceAll(
    /<span\b(?=[^>]*\bdata-business-contact(?:=(?:"[^"]*"|'[^']*'))?)[^>]*>[\s\S]*?<\/span\s*>/g,
    () => `<span data-business-contact>${contact}</span>`,
  )

  for (const lang of ['sv', 'en'] as const) {
    const rows: readonly (readonly [string, string])[] = [
      [lang === 'sv' ? 'Salong' : 'Salon', business.name],
      [lang === 'sv' ? 'Juridiskt företagsnamn' : 'Legal business name', business.legalName],
      [lang === 'sv' ? 'Organisationsnummer' : 'Registration number', business.organizationNumber],
      [lang === 'sv' ? 'Adress' : 'Address', formatBusinessAddress(business)],
      [lang === 'sv' ? 'E-post' : 'Email', business.email],
      [lang === 'sv' ? 'Telefon' : 'Phone', business.phoneDisplay],
    ]
    const details = rows
      .filter(([, value]) => value !== '')
      .map(
        ([label, value]) =>
          `<dt>${escapeElementText(label)}</dt><dd>${escapeElementText(value)}</dd>`,
      )
      .join('')
    rendered = replaceElementContent(
      rendered,
      `legal-business-details-${lang}`,
      `<dl>${details}</dl>`,
    )
    rendered = replaceElementText(
      rendered,
      `cancellation-policy-${lang}`,
      lang === 'sv'
        ? `Avboka senast ${business.cancellationPolicyHours} timmar före den bokade tiden.`
        : `Cancel at least ${business.cancellationPolicyHours} hours before your appointment.`,
    )
  }

  return rendered
}

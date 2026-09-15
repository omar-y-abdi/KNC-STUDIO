import { appStrings, aboutStrings, bookingStrings, myBookingsStrings, privacyStrings, calendarLabels } from '../../i18n'
import { customerEmailLinkStrings } from '../../i18n/customerEmailLinkStrings'
import { defaultEmailTemplate } from '../../../shared/email'
import { SITE_KEYS, ABOUT_KEYS, EMAIL_NAMES, emptyPresentation, type CmsDocument, type CmsLang, type CmsEmail, type CopyGroup, type CmsPage } from '../../../shared/cms'

export const COPY_LABELS: Record<CopyGroup, string> = { app: 'Navigation och startsida', booking: 'Bokning och bekräftelse', about: 'Om oss och omdömen', myBookings: 'Kundens bokningar', privacy: 'Integritet och samtycke', calendar: 'Kalender', customerEmailLink: 'Bokningslänk via mejl' }
export const MAIL_LABELS: Record<typeof EMAIL_NAMES[number], string> = {
  customer_confirmation: 'Bokningsbekräftelse · kund', barber_confirmation: 'Ny bokning · barberare',
  customer_cancellation: 'Avbokning · kund', barber_cancellation: 'Avbokning · barberare',
  customer_reminder: 'Påminnelse', customer_booking_access: 'Länk till mina bokningar',
  auth_recovery: 'Återställ lösenord', auth_email_change: 'Bekräfta ny mejladress', auth_invite: 'Kontoinbjudan',
}
export const SETTING_LABELS: Record<string, string> = {
  business_name: 'Visningsnamn', business_legal_name: 'Juridiskt namn', business_org_number: 'Organisationsnummer',
  business_email: 'Kontaktmejl', business_phone_display: 'Telefon · visning', business_phone_tel: 'Telefon · tel-länk',
  business_street: 'Gatuadress', business_postal_code: 'Postnummer', business_city: 'Ort', business_maps_href: 'Kartlänk',
  cancellation_policy_hours: 'Avbokningsgräns i timmar', seo_title_sv: 'SEO-titel · svenska', seo_title_en: 'SEO-titel · engelska',
  seo_description_sv: 'SEO-beskrivning · svenska', seo_description_en: 'SEO-beskrivning · engelska',
}
export function baseCopy(group: CopyGroup, lang: CmsLang): Record<string, string> {
  const source: object = group === 'app' ? appStrings(lang) : group === 'booking' ? bookingStrings(lang) : group === 'about' ? aboutStrings(lang) : group === 'myBookings' ? myBookingsStrings(lang) : group === 'privacy' ? privacyStrings(lang) : group === 'calendar' ? calendarLabels(lang) : customerEmailLinkStrings(lang)
  const rows: Record<string, string> = {}
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string') rows[key] = value
    else if (Array.isArray(value)) for (let i = 0; i < value.length; i++) if (typeof value[i] === 'string') rows[`${key}.${i}`] = value[i] as string
  }
  return rows
}
export function copyBinding(group: CopyGroup, key: string): string {
  if (group === 'about' && (ABOUT_KEYS as readonly string[]).includes(key)) return `about:${key}`
  if ((group === 'booking' || group === 'app') && (SITE_KEYS as readonly string[]).includes(key)) return `site:${key}`
  return `copy:${group}:${key}`
}
export function contentValue(document: CmsDocument, binding: string, lang: CmsLang): string {
  const [kind, key, field] = binding.split(':')
  if (kind === 'site') return document.site[key ?? '']?.[lang] ?? baseCopy(key === 'kicker' || key === 'hours' ? 'app' : 'booking', lang)[key ?? ''] ?? ''
  if (kind === 'about') return document.about[key ?? '']?.[lang] ?? baseCopy('about', lang)[key ?? ''] ?? ''
  if (kind === 'setting') return document.settings[key ?? ''] ?? ''
  if (kind === 'copy' && key && field) return document.presentation.copy[key as CopyGroup]?.[lang]?.[field] ?? baseCopy(key as CopyGroup, lang)[field] ?? ''
  if (kind === 'barber') {
    const barber = document.barbers.find(item => item.id === key)
    return barber && field && typeof barber[field as keyof typeof barber] === 'string' ? String(barber[field as keyof typeof barber]) : ''
  }
  return ''
}
export function setContent(document: CmsDocument, binding: string, lang: CmsLang, value: string): void {
  const [kind, key, field] = binding.split(':')
  if (!key) return
  if (kind === 'site' || kind === 'about') { document[kind][key] ??= {}; document[kind][key][lang] = value }
  else if (kind === 'setting') document.settings[key] = value
  else if (kind === 'copy' && field) {
    const group = key as CopyGroup
    document.presentation.copy[group] ??= {}
    const languages = document.presentation.copy[group]
    if (!languages) return
    languages[lang] ??= {}
    const cells = languages[lang]; if (cells) cells[field] = value
  } else if (kind === 'barber' && field && ['name', 'ig', 'role_sv', 'role_en', 'bio_sv', 'bio_en'].includes(field)) {
    const barber = document.barbers.find(item => item.id === key)
    if (barber) Object.assign(barber, { [field]: value })
  }
}
export function emailCopy(document: CmsDocument, template: CmsEmail['template'], lang: CmsLang): CmsEmail {
  const existing = document.emails.find(item => item.template === template && item.lang === lang)
  if (existing) return existing
  const copy = defaultEmailTemplate(template, lang)
  return { template, lang, subject: copy.subject, preheader: copy.preheader, title: copy.title, intro: copy.intro, section_title: copy.sectionTitle, note: copy.note, cta_label: copy.ctaLabel, contact_lead: copy.contactLead, design: null }
}
export function newPage(path: string, name: string): CmsPage {
  return { id: crypto.randomUUID(), kind: 'page', path, name: { sv: name, en: name }, title: { sv: name, en: name }, description: { sv: '', en: '' }, inMenu: true,
    content: Object.fromEntries((['sv', 'en'] as const).map(lang => [lang, { html: `<main class="cms-page"><h1>${name.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</h1><p>${lang === 'sv' ? 'Skriv sidans innehåll här.' : 'Write your page content here.'}</p></main>`, css: { light: '.cms-page{max-width:1000px;margin:auto;padding:64px 24px;background:#fff;color:#202124;font-family:Arial,sans-serif}h1{font-size:48px}', dark: '.cms-page{max-width:1000px;margin:auto;padding:64px 24px;background:#1c1c1e;color:#f5f5f7;font-family:Arial,sans-serif}h1{font-size:48px}' } }])) as CmsPage['content'],
  }
}
export function ensurePresentation(document: CmsDocument): void { document.presentation ??= emptyPresentation() }

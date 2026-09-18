import type { JSX } from 'preact'
import type { CmsDocument, CmsEmail, CmsLang } from '../../../shared/cms'import { EMAIL_NAMES } from '../../../shared/cms'
import { EmailTemplatePreview } from '../EmailTemplatePreview'

const businessFields = [
  ['business_name', 'Visningsnamn'],
  ['business_legal_name', 'Juridiskt namn'],
  ['business_org_number', 'Organisationsnummer'],
  ['business_email', 'E-post'],
  ['business_phone_display', 'Telefon'],
  ['business_phone_tel', 'Telefonlänk'],
  ['business_street', 'Adress'],
  ['business_postal_code', 'Postnummer'],
  ['business_city', 'Stad'],
  ['business_maps_href', 'Kartlänk'],
  ['seo_title_sv', 'SEO titel SV'],
  ['seo_description_sv', 'SEO beskrivning SV'],
  ['seo_title_en', 'SEO title EN'],
  ['seo_description_en', 'SEO description EN'],
] as const

const emailLabel: Record<(typeof EMAIL_NAMES)[number], string> = {
  customer_confirmation: 'Kundbekräftelse',
  barber_confirmation: 'Barberarbekräftelse',
  customer_cancellation: 'Kundavbokning',
  barber_cancellation: 'Barberaravbokning',
  customer_reminder: 'Påminnelse',
  customer_booking_access: 'Kundens bokningsåtkomst',
  auth_recovery: 'Återställ lösenord',
  auth_email_change: 'Ändra e-post',
  auth_invite: 'Inbjudan',
}

export function BusinessPanel({
  document,
  onChange,
}: {
  document: CmsDocument
  onChange: (document: CmsDocument) => void
}): JSX.Element {
  const set = (key: string, value: string): void => {
    const next = structuredClone(document)
    next.settings[key] = value
    onChange(next)
  }
  return (
    <div class="cms-domain-panel">
      <h2>Business & SEO</h2>
      <p>Operativa bokningsregler ligger kvar utanför CMS-historiken.</p>
      <div class="cms-domain-grid">
        {businessFields.map(([key, label]) => (
          <label>
            {label}
            <input value={document.settings[key] ?? ''} onInput={(e) => set(key, e.currentTarget.value)} />
          </label>
        ))}
      </div>
      <h3>Barberare</h3>
      {document.barbers.map((barber, index) => (
        <fieldset>
          <legend>{barber.name}</legend>
          <label>
            Namn
            <input
              value={barber.name}
              onInput={(e) => {
                const next = structuredClone(document)
                next.barbers[index].name = e.currentTarget.value
                onChange(next)
              }}
            />
          </label>
          <label>
            Roll SV
            <input
              value={barber.role_sv}
              onInput={(e) => {
                const next = structuredClone(document)
                next.barbers[index].role_sv = e.currentTarget.value
                onChange(next)
              }}
            />
          </label>
          <label>
            Roll EN
            <input
              value={barber.role_en}
              onInput={(e) => {
                const next = structuredClone(document)
                next.barbers[index].role_en = e.currentTarget.value
                onChange(next)
              }}
            />
          </label>
          <label>
            Bio SV
            <textarea
              value={barber.bio_sv}
              onInput={(e) => {
                const next = structuredClone(document)
                next.barbers[index].bio_sv = e.currentTarget.value
                onChange(next)
              }}
            />
          </label>
          <label>
            Bio EN
            <textarea
              value={barber.bio_en}
              onInput={(e) => {
                const next = structuredClone(document)
                next.barbers[index].bio_en = e.currentTarget.value
                onChange(next)
              }}
            />
          </label>
        </fieldset>
      ))}
    </div>
  )
}

function replaceEmail(document: CmsDocument, email: CmsEmail): CmsDocument {
  const next = structuredClone(document)
  const index = next.emails.findIndex(
    (item) => item.template === email.template && item.lang === email.lang,
  )
  if (index >= 0) next.emails[index] = email
  return next
}

export function EmailPanel({
  document,
  lang,
  onChange,
}: {
  document: CmsDocument
  lang: CmsLang
  onChange: (document: CmsDocument) => void
}): JSX.Element {
  const first =
    document.emails.find((email) => email.lang === lang) ??
    document.emails[0]
  if (!first) return <div class="cms-domain-panel">Inga e-postmallar är konfigurerade.</div>
  const [selectedTemplate, setSelectedTemplate] = useState(first.template)
  const email =
    document.emails.find(
      (item) => item.template === selectedTemplate && item.lang === lang,
    ) ?? first
  const patch = (key: keyof CmsEmail, value: string): void =>
    onChange(replaceEmail(document, { ...email, [key]: value }))
  return (
    <div class="cms-email-workspace">
      <aside>
        {EMAIL_NAMES.map((name) => (
          <button
            type="button"
            class={selectedTemplate === name ? 'is-active' : ''}
            onClick={() => setSelectedTemplate(name)}
          >
            {emailLabel[name]}
          </button>
        ))}
      </aside>
      <div class="cms-domain-panel">
        <h2>{emailLabel[email.template]} · {lang.toUpperCase()}</h2>
        {([
          ['subject', 'Ämne'],
          ['preheader', 'Preheader'],
          ['title', 'Rubrik'],
          ['intro', 'Intro'],
          ['note', 'Notis'],
          ['cta_label', 'CTA'],
        ] as const).map(([key, label]) => (
          <label>
            {label}
            {key === 'intro' || key === 'note' ? (
              <textarea value={email[key]} onInput={(e) => patch(key, e.currentTarget.value)} />
            ) : (
              <input value={email[key]} onInput={(e) => patch(key, e.currentTarget.value)} />
            )}
          </label>
        ))}
      </div>
      <div class="cms-email-preview">
        <EmailTemplatePreview
          template={email.template}
          lang={email.lang}
          subject={email.subject}
          preheader={email.preheader}
          title={email.title}
          intro={email.intro}
          sectionTitle={email.section_title}
          note={email.note}
          ctaLabel={email.cta_label}
          contactLead={email.contact_lead}
        />
      </div>
    </div>
  )
}

import { useState } from 'preact/hooks'

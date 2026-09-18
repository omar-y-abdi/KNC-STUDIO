import type { JSX } from 'preact'
import { useState } from 'preact/hooks'
import {
  EMAIL_NAMES,
  defaultEmailDesign,
  type CmsDocument,
  type CmsEmail,
  type CmsLang,
} from '../../../shared/cms'

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

const barberFields = [
  ['name', 'Namn', false],
  ['role_sv', 'Roll SV', false],
  ['role_en', 'Roll EN', false],
  ['bio_sv', 'Bio SV', true],
  ['bio_en', 'Bio EN', true],
] as const

const emailDesignNumberFields = [
  ['width', 'Bredd', 320, 760],
  ['radius', 'Hörnradie', 0, 48],
  ['padding', 'Padding', 12, 64],
  ['titleSize', 'Rubrikstorlek', 18, 56],
  ['textSize', 'Textstorlek', 12, 24],
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
  const setBarber = (
    index: number,
    key: (typeof barberFields)[number][0],
    value: string,
  ): void => {
    const next = structuredClone(document)
    const barber = next.barbers[index]
    if (!barber) return
    barber[key] = value
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
            <input
              value={document.settings[key] ?? ''}
              onInput={(e) => set(key, e.currentTarget.value)}
            />
          </label>
        ))}
      </div>
      <h3>Barberare</h3>
      {document.barbers.map((barber, index) => (
        <fieldset>
          <legend>{barber.name}</legend>
          {barberFields.map(([key, label, multiline]) => (
            <label>
              {label}
              {multiline ? (
                <textarea
                  value={barber[key]}
                  onInput={(e) => setBarber(index, key, e.currentTarget.value)}
                />
              ) : (
                <input
                  value={barber[key]}
                  onInput={(e) => setBarber(index, key, e.currentTarget.value)}
                />
              )}
            </label>
          ))}
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
  const first = document.emails.find((email) => email.lang === lang) ?? document.emails[0]
  if (!first) return <div class="cms-domain-panel">Inga e-postmallar är konfigurerade.</div>
  const [selectedTemplate, setSelectedTemplate] = useState(first.template)
  const email =
    document.emails.find((item) => item.template === selectedTemplate && item.lang === lang) ??
    first
  const patch = (key: keyof CmsEmail, value: string): void =>
    onChange(replaceEmail(document, { ...email, [key]: value }))
  const updateDesign = (mutate: (design: NonNullable<CmsEmail['design']>) => void): void => {
    const next = structuredClone(email)
    if (!next.design) return
    mutate(next.design)
    onChange(replaceEmail(document, next))
  }
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
        <h2>
          {emailLabel[email.template]} · {lang.toUpperCase()}
        </h2>
        {!email.design && (
          <button
            type="button"
            onClick={() =>
              onChange(replaceEmail(document, { ...email, design: defaultEmailDesign() }))
            }
          >
            Aktivera design
          </button>
        )}
        {email.design && (
          <fieldset>
            <legend>Design</legend>
            {emailDesignNumberFields.map(([key, label, min, max]) => (
              <label>
                {label}
                <input
                  type="number"
                  min={min}
                  max={max}
                  value={email.design[key]}
                  onInput={(e) =>
                    updateDesign((design) => {
                      design[key] = Number(e.currentTarget.value)
                    })
                  }
                />
              </label>
            ))}
            <label>
              Standardtema
              <select
                value={email.design.defaultMode}
                onChange={(e) =>
                  updateDesign((design) => {
                    design.defaultMode = e.currentTarget.value as 'light' | 'dark'
                  })
                }
              >
                <option value="light">Ljus</option>
                <option value="dark">Mörk</option>
              </select>
            </label>
            {(['light', 'dark'] as const).map((paletteMode) => (
              <fieldset>
                <legend>{paletteMode === 'light' ? 'Ljus palett' : 'Mörk palett'}</legend>
                {(
                  [
                    ['background', 'Bakgrund'],
                    ['surface', 'Yta'],
                    ['text', 'Text'],
                    ['muted', 'Sekundär'],
                    ['border', 'Kant'],
                    ['button', 'Knapp'],
                    ['buttonText', 'Knapptext'],
                  ] as const
                ).map(([key, label]) => (
                  <label>
                    {label}
                    <input
                      type="color"
                      value={email.design?.palettes[paletteMode][key] ?? '#000000'}
                      onInput={(e) =>
                        updateDesign((design) => {
                          design.palettes[paletteMode][key] = e.currentTarget.value
                        })
                      }
                    />
                  </label>
                ))}
              </fieldset>
            ))}
            <label>
              Typsnitt
              <select
                value={email.design.font}
                onChange={(e) =>
                  updateDesign((design) => {
                    design.font = e.currentTarget.value as 'system' | 'serif' | 'sans'
                  })
                }
              >
                <option value="system">System</option>
                <option value="sans">Sans</option>
                <option value="serif">Serif</option>
              </select>
            </label>
          </fieldset>
        )}
        {(
          [
            ['subject', 'Ämne'],
            ['preheader', 'Preheader'],
            ['title', 'Rubrik'],
            ['intro', 'Intro'],
            ['note', 'Notis'],
            ['cta_label', 'CTA'],
          ] as const
        ).map(([key, label]) => (
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
      <div
        class="cms-email-preview"
        style={{
          background: email.design?.palettes[email.design.defaultMode].background,
        }}
      >
        <div
          class="cms-email-card"
          style={{
            maxWidth: `${email.design?.width ?? 600}px`,
            padding: `${email.design?.padding ?? 28}px`,
            borderRadius: `${email.design?.radius ?? 18}px`,
            background: email.design?.palettes[email.design.defaultMode].surface,
            color: email.design?.palettes[email.design.defaultMode].text,
            fontSize: `${email.design?.textSize ?? 16}px`,
            fontFamily:
              email.design?.font === 'serif'
                ? 'Georgia,serif'
                : email.design?.font === 'sans'
                  ? 'Arial,sans-serif'
                  : 'system-ui,sans-serif',
          }}
        >
          <small>{email.preheader}</small>
          <h1 style={{ fontSize: `${email.design?.titleSize ?? 32}px` }}>{email.title}</h1>
          <p>{email.intro}</p>
          {email.section_title && <h2>{email.section_title}</h2>}
          {email.note && <p class="cms-email-note">{email.note}</p>}
          {email.cta_label && <button type="button">{email.cta_label}</button>}
          {email.contact_lead && <p>{email.contact_lead}</p>}
        </div>
      </div>
    </div>
  )
}

import { CmsTextarea } from './Textarea'
import type { JSX } from 'preact'
import { useState } from 'preact/hooks'
import {
  EMAIL_NAMES,
  EMAIL_DESIGN_LIMITS,
  type CmsAsset,
  defaultEmailDesign,
  type CmsDocument,
  type CmsEmail,
  type CmsLang,
} from '../../../shared/cms'
import { renderEmailPreview } from './emailPreview'
import { CmsIcon } from './Icon'

const businessGroups = [
  {
    title: 'Salongen',
    description: 'Namnet som möter kunden och uppgifterna i dina juridiska texter.',
    fields: [
      ['business_name', 'Visningsnamn'],
      ['business_legal_name', 'Juridiskt namn'],
      ['business_org_number', 'Organisationsnummer'],
    ],
  },
  {
    title: 'Kontakt & adress',
    description: 'Gemensamma kontaktuppgifter på webbplatsen och i utskicken.',
    fields: [
      ['business_email', 'E-post'],
      ['business_phone_display', 'Telefon'],
      ['business_phone_tel', 'Telefonlänk'],
      ['business_street', 'Adress'],
      ['business_postal_code', 'Postnummer'],
      ['business_city', 'Stad'],
      ['business_maps_href', 'Kartlänk'],
    ],
  },
  {
    title: 'Sökresultat',
    description: 'Sidans titel och beskrivning när webbplatsen visas i ett sökresultat.',
    fields: [
      ['seo_title_sv', 'SEO titel SV'],
      ['seo_description_sv', 'SEO beskrivning SV'],
      ['seo_title_en', 'SEO title EN'],
      ['seo_description_en', 'SEO description EN'],
    ],
  },
] as const

const barberFields = [
  ['name', 'Namn', false],
  ['role_sv', 'Roll SV', false],
  ['role_en', 'Roll EN', false],
  ['bio_sv', 'Bio SV', true],
  ['bio_en', 'Bio EN', true],
] as const

const emailDesignNumberFields = [
  ['width', 'Bredd'],
  ['radius', 'Hörnradie'],
  ['padding', 'Padding'],
  ['titleSize', 'Rubrikstorlek'],
  ['textSize', 'Textstorlek'],
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
  const setBarber = (index: number, key: (typeof barberFields)[number][0], value: string): void => {
    const next = structuredClone(document)
    const barber = next.barbers[index]
    if (!barber) return
    barber[key] = value
    onChange(next)
  }
  return (
    <div class="cms-domain-panel cms-business-panel">
      {businessGroups.map((group) => (
        <fieldset class="cms-business-group" key={group.title}>
          <legend>{group.title}</legend>
          <p>{group.description}</p>
          <div class="cms-domain-grid">
            {group.fields.map(([key, label]) => (
              <label key={key}>
                {label}
                {key.includes('description') ? (
                  <CmsTextarea
                    value={document.settings[key] ?? ''}
                    onInput={(event) => set(key, event.currentTarget.value)}
                  />
                ) : (
                  <input
                    type={
                      key === 'business_email'
                        ? 'email'
                        : key.includes('phone')
                          ? 'tel'
                          : key === 'business_maps_href'
                            ? 'url'
                            : 'text'
                    }
                    value={document.settings[key] ?? ''}
                    onInput={(event) => set(key, event.currentTarget.value)}
                  />
                )}
              </label>
            ))}
          </div>
        </fieldset>
      ))}
      <h2>Barberare</h2>
      {document.barbers.length === 0 && (
        <p class="cms-inline-empty">
          Barberare läggs till i Admin. Här redigerar du deras namn, roller och presentation.
        </p>
      )}
      {document.barbers.map((barber, index) => (
        <fieldset>
          <legend>{barber.name}</legend>
          {barberFields.map(([key, label, multiline]) => (
            <label>
              {label}
              {multiline ? (
                <CmsTextarea
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
      <p class="cms-form-note">
        <CmsIcon name="info" />
        Operativa bokningsregler ligger kvar utanför CMS-historiken.
      </p>
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
  assets,
  onChange,
}: {
  document: CmsDocument
  lang: CmsLang
  assets: readonly CmsAsset[]
  onChange: (document: CmsDocument) => void
}): JSX.Element {
  const [previewWidth, setPreviewWidth] = useState<'desktop' | 'mobile'>('desktop')
  const [selectedTemplate, setSelectedTemplate] =
    useState<CmsEmail['template']>('customer_confirmation')
  const [mobileView, setMobileView] = useState<'edit' | 'preview'>('edit')
  const first = document.emails.find((email) => email.lang === lang) ?? document.emails[0]
  if (!first)
    return (
      <div class="cms-resource-empty">
        <CmsIcon name="mail" />
        <strong>Inga e-postmallar är konfigurerade.</strong>
        <p>
          Mallarna behöver finnas på servern innan de kan redigeras här. Inga mejl skickas från
          studion.
        </p>
      </div>
    )
  const email =
    document.emails.find((item) => item.template === selectedTemplate && item.lang === lang) ??
    first
  const patch = (
    key: Exclude<keyof CmsEmail, 'template' | 'lang' | 'design'>,
    value: string,
  ): void =>
    onChange(
      replaceEmail(document, {
        ...email,
        [key]: value === '' && (key === 'section_title' || key === 'contact_lead') ? null : value,
      }),
    )
  const updateDesign = (mutate: (design: NonNullable<CmsEmail['design']>) => void): void => {
    const next = structuredClone(email)
    if (!next.design) return
    mutate(next.design)
    onChange(replaceEmail(document, next))
  }
  let preview: ReturnType<typeof renderEmailPreview> | null = null
  try {
    preview = renderEmailPreview(document, email)
  } catch {
    // Incomplete number/color edits remain in the form; invalid CSS is never rendered.
  }
  return (
    <div class="cms-email-workspace" data-email-view={mobileView}>
      <div class="cms-email-mobile-toolbar">
        <label>
          Mejlmall
          <select
            aria-label="Mejlmall"
            value={email.template}
            onChange={(event) =>
              setSelectedTemplate(event.currentTarget.value as CmsEmail['template'])
            }
          >
            {EMAIL_NAMES.map((name) => (
              <option value={name}>{emailLabel[name]}</option>
            ))}
          </select>
        </label>
        <div class="cms-segment" role="group" aria-label="Mejlverktyg">
          <button
            type="button"
            aria-pressed={mobileView === 'edit'}
            onClick={() => setMobileView('edit')}
          >
            <CmsIcon name="edit" />
            Redigera
          </button>
          <button
            type="button"
            aria-pressed={mobileView === 'preview'}
            onClick={() => setMobileView('preview')}
          >
            <CmsIcon name="eye" />
            Förhandsvisa
          </button>
        </div>
      </div>
      <aside aria-label="Mejlmallar">
        {EMAIL_NAMES.map((name) => (
          <button
            type="button"
            class={email.template === name ? 'is-active' : ''}
            aria-pressed={email.template === name}
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
          <details class="cms-email-design">
            <summary>Utseende</summary>
            <fieldset>
              <legend>Design</legend>
              {emailDesignNumberFields.map(([key, label]) => (
                <label>
                  {label}
                  <input
                    type="number"
                    min={EMAIL_DESIGN_LIMITS[key][0]}
                    max={EMAIL_DESIGN_LIMITS[key][1]}
                    value={email.design?.[key]}
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
                Logotyp
                <select
                  value={
                    email.design.logo ? `${email.design.logo.bucket}/${email.design.logo.path}` : ''
                  }
                  onChange={(event) =>
                    updateDesign((design) => {
                      const asset = assets.find(
                        (item) => `${item.bucket}/${item.path}` === event.currentTarget.value,
                      )
                      design.logo = asset ? { bucket: asset.bucket, path: asset.path } : null
                    })
                  }
                >
                  <option value="">Verksamhetens namn</option>
                  {assets
                    .filter(
                      (asset) =>
                        asset.mime.startsWith('image/') && !asset.archived && !asset.trashed_at,
                    )
                    .map((asset) => (
                      <option value={`${asset.bucket}/${asset.path}`}>{asset.name}</option>
                    ))}
                </select>
              </label>
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
          </details>
        )}
        {(
          [
            ['subject', 'Ämne'],
            ['preheader', 'Preheader'],
            ['title', 'Rubrik'],
            ['intro', 'Intro'],
            ['section_title', 'Rubrik för bokningsuppgifter'],
            ['note', 'Notis'],
            ['contact_lead', 'Kontakttext'],
            ['cta_label', 'Knapptext'],
          ] as const
        ).map(([key, label]) => (
          <label>
            {label}
            {key === 'intro' || key === 'note' ? (
              <CmsTextarea
                value={email[key] ?? ''}
                onInput={(e) => patch(key, e.currentTarget.value)}
              />
            ) : (
              <input value={email[key] ?? ''} onInput={(e) => patch(key, e.currentTarget.value)} />
            )}
          </label>
        ))}
      </div>
      <section class="cms-email-preview" aria-label="Förhandsvisning av mejl">
        <div class="cms-email-preview-toolbar">
          <div class="cms-segment" role="group" aria-label="Mejlbredd">
            <button
              type="button"
              aria-pressed={previewWidth === 'desktop'}
              onClick={() => setPreviewWidth('desktop')}
            >
              Dator
            </button>
            <button
              type="button"
              aria-pressed={previewWidth === 'mobile'}
              onClick={() => setPreviewWidth('mobile')}
            >
              Mobil
            </button>
          </div>
          <small>Exempeluppgifter · samma mall som utskicket</small>
        </div>
        {preview ? (
          <>
            <div class="cms-email-envelope">
              <strong>Ämne</strong>
              <span>{preview.subject}</span>
              <small>{preview.from}</small>
            </div>
            <iframe
              title="Mejl som skickas"
              sandbox=""
              srcDoc={preview.html}
              style={{ width: previewWidth === 'mobile' ? '360px' : '100%' }}
            />
          </>
        ) : (
          <p role="status">Fyll i giltiga designvärden för att visa mejlet.</p>
        )}
      </section>
    </div>
  )
}

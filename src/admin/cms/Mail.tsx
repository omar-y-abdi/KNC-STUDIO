import type { JSX } from 'preact'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import { buildEmailMessage, type EmailBusiness } from '../../../shared/email'
import {
  defaultEmailDesign,
  mediaUrl,
  type CmsDocument,
  type CmsEmail,
  type CmsMode,
  type EmailDesign,
  type CmsAsset,
} from '../../../shared/cms'
import { resolveBusinessSettings, formatBusinessAddress } from '../../site/siteChrome'
import { SUPABASE_URL } from '../../backend/config'
import {
  listFailedBookingEmailDeliveries,
  retryFailedBookingEmailDelivery,
  discardFailedBookingEmailDelivery,
  type FailedBookingEmailDelivery,
} from '../adapters/emailTemplatesAdmin'
import { Field, Notice, Select } from './controls'

export function emailPreview(
  document: CmsDocument,
  email: CmsEmail,
  mode: CmsMode,
): { html: string; text: string; subject: string } {
  const settings = resolveBusinessSettings(new Map(Object.entries(document.settings)))
  const business: EmailBusiness = {
    name: settings.name,
    email: settings.email,
    phoneDisplay: settings.phoneDisplay || null,
    phoneHref: settings.phoneTel || null,
    address: formatBusinessAddress(settings),
    mapsHref: settings.mapsHref || null,
    cancellationPolicyHours: settings.cancellationPolicyHours,
  }
  return buildEmailMessage({
    to: 'preview@example.invalid',
    lang: email.lang,
    business,
    previewMode: mode,
    copy: {
      subject: email.subject,
      preheader: email.preheader,
      title: email.title,
      intro: email.intro,
      sectionTitle: email.section_title,
      note: email.note,
      ctaLabel: email.cta_label,
      contactLead: email.contact_lead,
      design: email.design,
      designLogoUrl:
        email.design?.logo && SUPABASE_URL ? mediaUrl(email.design.logo, SUPABASE_URL) : null,
    },
    variables: {
      business_name: business.name,
      customer_name: email.lang === 'sv' ? 'Exempelkund' : 'Example customer',
      barber_name: document.barbers[0]?.name ?? 'Barber',
      booking_date: '2026-10-15',
      booking_time: '14:30',
      cancellation_hours: String(business.cancellationPolicyHours),
      email: 'preview@example.invalid',
    },
    rows: [
      { label: email.lang === 'sv' ? 'Tid' : 'Time', value: '15 okt 2026 · 14:30' },
      {
        label: email.lang === 'sv' ? 'Tjänst' : 'Service',
        value: email.lang === 'sv' ? 'Exempel på en bokning' : 'Example appointment',
      },
    ],
    ctaHref: 'https://bladeblendstudio.se/#preview-only',
  })
}
export function EmailCanvas({
  document,
  email,
  mode,
  onSelect,
}: {
  document: CmsDocument
  email: CmsEmail
  mode: CmsMode
  onSelect: (field: string) => void
}): JSX.Element {
  const value = useMemo(() => emailPreview(document, email, mode), [document, email, mode])
  const ref = useRef<HTMLIFrameElement>(null)
  return (
    <div class="cms-email-canvas">
      <div class="cms-email-subject">
        <strong>{value.subject}</strong>
        <span>Exempeldata · inga mejl skickas</span>
      </div>
      <iframe
        ref={ref}
        title="Mejlförhandsvisning"
        sandbox="allow-same-origin"
        srcDoc={value.html}
        onLoad={() => {
          const body = ref.current?.contentDocument?.body
          if (!body) return
          body.addEventListener('click', (event) => {
            event.preventDefault()
            const element = (event.target as Element | null)?.closest<HTMLElement>(
              '[data-email-part]',
            )
            if (element) onSelect(element.dataset['emailPart'] ?? 'title')
          })
        }}
      />
    </div>
  )
}
export function EmailInspector({
  email,
  mode,
  onChange,
  pickLogo,
}: {
  email: CmsEmail
  mode: CmsMode
  onChange: (value: CmsEmail, group?: string) => void
  pickLogo: (select: (asset: CmsAsset) => void) => void
}): JSX.Element {
  const [tab, setTab] = useState<'copy' | 'design'>('copy')
  const design = email.design ?? defaultEmailDesign()
  const changeDesign = (operation: (draft: EmailDesign) => void): void => {
    const next = structuredClone(design)
    operation(next)
    onChange({ ...email, design: next })
  }
  return (
    <>
      <div class="cms-segment">
        <button type="button" aria-pressed={tab === 'copy'} onClick={() => setTab('copy')}>
          Text
        </button>
        <button type="button" aria-pressed={tab === 'design'} onClick={() => setTab('design')}>
          Utseende
        </button>
      </div>
      {tab === 'copy' ? (
        <>
          {(
            [
              ['subject', 'Ämnesrad', 120],
              ['preheader', 'Förhandsrad', 180],
              ['title', 'Rubrik', 120],
              ['intro', 'Inledning', 800],
              ['section_title', 'Rubrik för bokningsuppgifter', 120],
              ['note', 'Notering', 800],
              ['cta_label', 'Knapptext', 80],
              ['contact_lead', 'Kontakttext', 200],
            ] as const
          ).map(([key, label, max]) => (
            <Field
              key={key}
              label={label}
              value={email[key] ?? ''}
              maxLength={max}
              multiline={key === 'intro' || key === 'note'}
              onChange={(value) =>
                onChange(
                  {
                    ...email,
                    [key]:
                      value === '' && (key === 'section_title' || key === 'contact_lead')
                        ? null
                        : value,
                  },
                  `email:${email.template}:${email.lang}:${key}`,
                )
              }
            />
          ))}
          <p class="cms-help">
            Variabler som {'{customer_name}'}, {'{barber_name}'}, {'{booking_date}'},{' '}
            {'{booking_time}'} och {'{cancellation_hours}'} ersätts vid utskick. Mottagare,
            bokningsuppgifter och säkra länkar bestäms av servern.
          </p>
        </>
      ) : (
        <>
          <Notice>
            {email.design
              ? `Du redigerar ${mode === 'light' ? 'den ljusa' : 'den mörka'} paletten.`
              : 'Originalmallens utseende används. Den första ändringen skapar en egen design; texterna och utskickslogiken behålls.'}
          </Notice>
          <Select
            label="Utskickets standardläge"
            value={design.defaultMode}
            options={[
              ['dark', 'Mörkt'],
              ['light', 'Ljust'],
            ]}
            onChange={(value) =>
              changeDesign((d) => {
                d.defaultMode = value as CmsMode
              })
            }
          />
          <Select
            label="Typsnitt"
            value={design.font}
            options={[
              ['system', 'System'],
              ['sans', 'Sans serif'],
              ['serif', 'Serif'],
            ]}
            onChange={(value) =>
              changeDesign((d) => {
                d.font = value as EmailDesign['font']
              })
            }
          />
          {(
            [
              ['background', 'Bakgrund'],
              ['surface', 'Kortbakgrund'],
              ['text', 'Text'],
              ['muted', 'Sekundär text'],
              ['border', 'Kantlinjer'],
              ['button', 'Knapp'],
              ['buttonText', 'Knapptext'],
            ] as const
          ).map(([key, label]) => (
            <Field
              key={key}
              label={label}
              type="color"
              value={design.palettes[mode][key]}
              onChange={(value) =>
                changeDesign((d) => {
                  d.palettes[mode][key] = value
                })
              }
            />
          ))}
          {(
            [
              ['width', 'Bredd', 320, 800],
              ['radius', 'Hörnradie', 0, 40],
              ['padding', 'Invändig marginal', 12, 60],
              ['titleSize', 'Rubrikstorlek', 20, 48],
              ['textSize', 'Textstorlek', 12, 24],
            ] as const
          ).map(([key, label, min, max]) => (
            <label class="cms-field" key={key}>
              <span>
                {label} · {design[key]} px
              </span>
              <input
                type="range"
                min={min}
                max={max}
                value={design[key]}
                onInput={(event) =>
                  changeDesign((d) => {
                    d[key] = Number(event.currentTarget.value)
                  })
                }
              />
            </label>
          ))}
          <h3>Sektionernas ordning</h3>
          {design.order.map((part, index) => (
            <div class="cms-list-row" key={part}>
              <span>{part}</span>
              <button
                type="button"
                aria-label={`Flytta ${part} uppåt`}
                disabled={index === 0}
                onClick={() =>
                  changeDesign((d) => {
                    const other = d.order[index - 1]
                    if (other) {
                      d.order[index - 1] = part
                      d.order[index] = other
                    }
                  })
                }
              >
                ↑
              </button>
              <button
                type="button"
                aria-label={`Flytta ${part} nedåt`}
                disabled={index === design.order.length - 1}
                onClick={() =>
                  changeDesign((d) => {
                    const other = d.order[index + 1]
                    if (other) {
                      d.order[index + 1] = part
                      d.order[index] = other
                    }
                  })
                }
              >
                ↓
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              pickLogo((asset) => {
                if (!asset.mime.startsWith('image/'))
                  throw new Error('Välj en bild till logotypen.')
                changeDesign((d) => {
                  d.logo = { bucket: asset.bucket, path: asset.path }
                })
              })
            }
          >
            Välj logotyp
          </button>
          {design.logo && (
            <button
              type="button"
              onClick={() =>
                changeDesign((d) => {
                  d.logo = null
                })
              }
            >
              Ta bort logotyp
            </button>
          )}
          <button type="button" onClick={() => onChange({ ...email, design: null })}>
            Återställ originalutseendet
          </button>
        </>
      )}
    </>
  )
}
export function EmailDeliveryPanel(): JSX.Element {
  const [items, setItems] = useState<readonly FailedBookingEmailDelivery[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false)
  const alive = useRef(true)
  const load = async (): Promise<void> => {
    setBusy(true)
    setError('')
    const result = await listFailedBookingEmailDeliveries()
    if (!alive.current) return
    if (result.ok) {
      setItems(result.value)
      setLoaded(true)
    } else setError(result.error.message)
    setBusy(false)
  }
  useEffect(() => {
    alive.current = true
    void load()
    return () => {
      alive.current = false
    }
  }, [])
  const act = async (id: string, discard: boolean): Promise<void> => {
    if (
      busy ||
      !window.confirm(
        discard
          ? 'Markera detta misslyckade utskick som avslutat utan att skicka igen?'
          : 'Lägg detta utskick i kön för ett nytt leveransförsök?',
      )
    )
      return
    setBusy(true)
    setError('')
    const result = await (discard
      ? discardFailedBookingEmailDelivery(id)
      : retryFailedBookingEmailDelivery(id))
    if (!alive.current) return
    if (!result.ok) {
      setError(result.error.message)
      setBusy(false)
    } else await load()
  }
  return (
    <div class="cms-delivery-panel">
      <h2>Mejlleveranser</h2>
      <p>Åtgärder här påverkar utskicksjobben direkt. De är inte en del av sidans utkast.</p>
      {error && <Notice error>{error}</Notice>}
      <button type="button" disabled={busy} onClick={() => void load()}>
        Uppdatera
      </button>
      {loaded && items.length === 0 && <Notice>Inga misslyckade bokningsmejl.</Notice>}
      {items.map((item) => (
        <article class="cms-delivery" key={item.id}>
          <strong>
            {item.event === 'booking_confirmed' ? 'Bokningsbekräftelse' : 'Avbokningsmejl'}
          </strong>
          <p>
            Bokning {item.bookingId} · {item.attemptCount} försök · {item.errorCode ?? 'okänt fel'}
          </p>
          <small>{item.failedAt ?? ''}</small>
          <div>
            <button type="button" disabled={busy} onClick={() => void act(item.id, false)}>
              Försök igen
            </button>
            <button type="button" disabled={busy} onClick={() => void act(item.id, true)}>
              Avsluta utan utskick
            </button>
          </div>
        </article>
      ))}
    </div>
  )
}

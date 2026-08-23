import type { JSX } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import type { Lang } from '../../i18n/index'
import { adminText } from '../../i18n/adminStrings'
import {
  listFailedBookingEmailDeliveries,
  listEmailTemplates,
  retryFailedBookingEmailDelivery,
  saveEmailTemplate,
  type EditableEmailTemplate,
  type EmailTemplateName,
  type FailedBookingEmailDelivery,
} from '../adapters/emailTemplatesAdmin'
import type { AdminStylesBundle } from './viewTypes'

interface MailViewProps {
  readonly lang: Lang
  readonly s: AdminStylesBundle
}

interface TemplateDefinition {
  readonly id: EmailTemplateName
  readonly sv: string
  readonly en: string
  readonly languages: readonly Lang[]
  readonly hasSection: boolean
  readonly placeholders: string
}

const DEFINITIONS: readonly TemplateDefinition[] = [
  {
    id: 'customer_confirmation',
    sv: 'Bokningsbekräftelse · kund',
    en: 'Booking confirmation · customer',
    languages: ['sv', 'en'],
    hasSection: true,
    placeholders: '{business_name}, {customer_name}, {barber_name}, {cancellation_hours}',
  },
  {
    id: 'barber_confirmation',
    sv: 'Ny bokning · barberare',
    en: 'New booking · barber',
    languages: ['sv'],
    hasSection: true,
    placeholders: '{business_name}, {customer_name}, {barber_name}, {booking_date}, {booking_time}',
  },
  {
    id: 'customer_cancellation',
    sv: 'Avbokning · kund',
    en: 'Cancellation · customer',
    languages: ['sv', 'en'],
    hasSection: true,
    placeholders: '{business_name}, {customer_name}, {barber_name}',
  },
  {
    id: 'barber_cancellation',
    sv: 'Avbokning · barberare',
    en: 'Cancellation · barber',
    languages: ['sv'],
    hasSection: true,
    placeholders: '{business_name}, {customer_name}, {barber_name}, {booking_date}, {booking_time}',
  },
  {
    id: 'customer_reminder',
    sv: '24h-påminnelse · kund',
    en: '24h reminder · customer',
    languages: ['sv', 'en'],
    hasSection: true,
    placeholders: '{business_name}, {customer_name}, {barber_name}, {cancellation_hours}',
  },
  {
    id: 'customer_booking_access',
    sv: 'Säker länk · kund',
    en: 'Secure link · customer',
    languages: ['sv', 'en'],
    hasSection: false,
    placeholders: '',
  },
  {
    id: 'auth_recovery',
    sv: 'Återställ lösenord',
    en: 'Reset password',
    languages: ['sv', 'en'],
    hasSection: false,
    placeholders: '{business_name}',
  },
  {
    id: 'auth_email_change',
    sv: 'Bekräfta ny e-post',
    en: 'Confirm new email',
    languages: ['sv', 'en'],
    hasSection: false,
    placeholders: '{business_name}, {new_email}',
  },
  {
    id: 'auth_invite',
    sv: 'Inbjudan · barberare',
    en: 'Invitation · barber',
    languages: ['sv', 'en'],
    hasSection: false,
    placeholders: '{business_name}',
  },
]

const rowKey = (template: EmailTemplateName, lang: Lang): string => `${template}:${lang}`

export function MailView(props: MailViewProps): JSX.Element {
  const { s } = props
  const t = adminText(props.lang)
  const [rows, setRows] = useState<Map<string, EditableEmailTemplate>>(new Map())
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<{ key: string; message: string } | null>(null)
  const [failedDeliveries, setFailedDeliveries] = useState<readonly FailedBookingEmailDelivery[]>(
    [],
  )
  const [deliveryError, setDeliveryError] = useState<string | null>(null)
  const [retryingDelivery, setRetryingDelivery] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void (async () => {
      const [result, failedResult] = await Promise.all([
        listEmailTemplates(),
        listFailedBookingEmailDeliveries(),
      ])
      if (!active) return
      if (!result.ok) setLoadError(result.error.message)
      else setRows(new Map(result.value.map((row) => [rowKey(row.template, row.lang), row])))
      if (!failedResult.ok) setDeliveryError(failedResult.error.message)
      else setFailedDeliveries(failedResult.value)
      setLoaded(true)
    })()
    return () => {
      active = false
    }
  }, [])

  const update = (
    template: EmailTemplateName,
    lang: Lang,
    field: keyof Omit<EditableEmailTemplate, 'template' | 'lang'>,
    value: string,
  ): void => {
    const key = rowKey(template, lang)
    setRows((previous) => {
      const current = previous.get(key)
      if (current === undefined) return previous
      const next = new Map(previous)
      next.set(key, { ...current, [field]: value })
      return next
    })
    setSaved(null)
    setSaveError(null)
  }

  const save = async (template: EmailTemplateName, lang: Lang): Promise<void> => {
    const key = rowKey(template, lang)
    const row = rows.get(key)
    if (row === undefined) return
    setSaving(key)
    setSaveError(null)
    const result = await saveEmailTemplate(row)
    setSaving(null)
    if (!result.ok) {
      setSaveError({ key, message: result.error.message })
      return
    }
    setRows((previous) => new Map(previous).set(key, result.value))
    setSaved(key)
  }

  const retryDelivery = async (id: string): Promise<void> => {
    setRetryingDelivery(id)
    setDeliveryError(null)
    const result = await retryFailedBookingEmailDelivery(id)
    setRetryingDelivery(null)
    if (!result.ok) {
      setDeliveryError(result.error.message)
      return
    }
    setFailedDeliveries((previous) => previous.filter((delivery) => delivery.id !== id))
  }

  const field = (
    row: EditableEmailTemplate,
    name: keyof Omit<EditableEmailTemplate, 'template' | 'lang'>,
    label: string,
    multiline = false,
  ): JSX.Element => {
    const value = row[name] ?? ''
    return (
      <label style={{ display: 'block' }}>
        <span style={s.label}>{label}</span>
        {multiline ? (
          <textarea
            style={s.textarea}
            rows={name === 'intro' || name === 'note' ? 4 : 3}
            maxLength={800}
            value={value}
            onInput={(event) => update(row.template, row.lang, name, event.currentTarget.value)}
          />
        ) : (
          <input
            style={s.input}
            maxLength={name === 'preheader' ? 180 : 120}
            value={value}
            onInput={(event) => update(row.template, row.lang, name, event.currentTarget.value)}
          />
        )}
      </label>
    )
  }

  return (
    <section style={s.card} aria-labelledby="mail-heading">
      <h2 id="mail-heading" style={s.sectionTitle}>
        {t.mailTitle}
      </h2>
      <p style={s.sectionLead}>{t.mailLead}</p>
      {loadError !== null ? (
        <div style={{ ...s.emptyState, color: s.errorText.color }}>{loadError}</div>
      ) : !loaded ? (
        <div style={s.emptyState}>{t.mailLoading}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '26px', marginTop: '24px' }}>
          <article style={{ borderTop: s.card.border, paddingTop: '22px' }}>
            <h3 style={{ margin: '0 0 5px', fontSize: '17px' }}>
              {props.lang === 'sv' ? 'Misslyckade mejlleveranser' : 'Failed email deliveries'}
            </h3>
            <p style={{ ...s.mutedText, margin: '0 0 16px' }}>
              {props.lang === 'sv'
                ? 'Misslyckade mejl stoppas efter fem försök eller vid permanent konfigurationsfel. Du kan försöka igen manuellt.'
                : 'Failed emails stop after five attempts or a permanent configuration error. You can retry them manually.'}
            </p>
            {deliveryError !== null ? <p style={s.errorText}>{deliveryError}</p> : null}
            {failedDeliveries.length === 0 ? (
              <p style={{ ...s.mutedText, margin: 0 }}>
                {props.lang === 'sv'
                  ? 'Inga misslyckade mejlleveranser.'
                  : 'No failed email deliveries.'}
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {failedDeliveries.map((delivery) => (
                  <div
                    key={delivery.id}
                    style={{
                      border: s.input.border,
                      borderRadius: '13px',
                      padding: '14px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '14px',
                    }}
                  >
                    <span style={{ ...s.mutedText, margin: 0 }}>
                      {delivery.event} · {delivery.errorCode ?? 'unknown'} · {delivery.attemptCount}{' '}
                      {props.lang === 'sv' ? 'försök' : 'attempts'}
                    </span>
                    <button
                      type="button"
                      style={{
                        ...s.primaryBtn,
                        opacity: retryingDelivery === delivery.id ? 0.6 : 1,
                      }}
                      disabled={retryingDelivery === delivery.id}
                      onClick={() => void retryDelivery(delivery.id)}
                    >
                      {retryingDelivery === delivery.id
                        ? props.lang === 'sv'
                          ? 'Försöker …'
                          : 'Retrying …'
                        : props.lang === 'sv'
                          ? 'Försök igen'
                          : 'Retry'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </article>
          {DEFINITIONS.map((definition) => (
            <article key={definition.id} style={{ borderTop: s.card.border, paddingTop: '22px' }}>
              <h3 style={{ margin: '0 0 5px', fontSize: '17px' }}>
                {props.lang === 'sv' ? definition.sv : definition.en}
              </h3>
              {definition.placeholders === '' ? null : (
                <p style={{ ...s.mutedText, margin: '0 0 16px' }}>
                  {t.mailPlaceholderHelp}: <code>{definition.placeholders}</code>
                </p>
              )}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))',
                  gap: '18px',
                }}
              >
                {definition.languages.map((lang) => {
                  const key = rowKey(definition.id, lang)
                  const row = rows.get(key)
                  if (row === undefined) return null
                  return (
                    <div
                      key={key}
                      style={{
                        border: s.input.border,
                        borderRadius: '13px',
                        padding: '16px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '13px',
                      }}
                    >
                      <strong style={{ fontSize: '13px' }}>
                        {lang === 'sv' ? t.mailSwedish : t.mailEnglish}
                      </strong>
                      {field(row, 'subject', t.mailSubject)}
                      {field(row, 'preheader', t.mailPreheader)}
                      {field(row, 'title', t.mailHeading)}
                      {field(row, 'intro', t.mailIntro, true)}
                      {definition.hasSection
                        ? field(row, 'sectionTitle', t.mailSectionTitle)
                        : null}
                      {field(row, 'note', t.mailNote, true)}
                      {field(row, 'ctaLabel', t.mailButton)}
                      {field(row, 'contactLead', t.mailContact, true)}
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <button
                          type="button"
                          style={{ ...s.primaryBtn, opacity: saving === key ? 0.6 : 1 }}
                          disabled={saving === key}
                          onClick={() => void save(definition.id, lang)}
                        >
                          {saving === key ? t.mailSaving : t.mailSave}
                        </button>
                        <span aria-live="polite">
                          {saved === key ? <span style={s.successText}>{t.mailSaved}</span> : null}
                          {saveError?.key === key ? (
                            <span style={s.errorText}>{saveError.message}</span>
                          ) : null}
                        </span>
                      </div>
                    </div>
                  )
                })}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { Lang } from '../../i18n/index'
import { adminText } from '../../i18n/adminStrings'
import { ConfirmDialog } from '../ConfirmDialog'
import {
  discardFailedBookingEmailDelivery,
  listFailedBookingEmailDeliveries,
  listEmailTemplates,
  retryFailedBookingEmailDelivery,
  saveEmailTemplate,
  type EditableEmailTemplate,
  type EmailTemplateName,
  type FailedBookingEmailDelivery,
} from '../adapters/emailTemplatesAdmin'
import { listSiteSettings, saveSiteSettings } from '../adapters/siteAdmin'
import { BUSINESS_SETTING_KEYS, DEFAULT_SITE_SETTINGS } from '../../site/siteChrome'
import type { AdminStylesBundle } from './viewTypes'

interface MailViewProps {
  readonly dark: boolean
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
  const editGeneration = useRef(new Map<string, number>())
  const [failedDeliveries, setFailedDeliveries] = useState<readonly FailedBookingEmailDelivery[]>(
    [],
  )
  const [deliveryError, setDeliveryError] = useState<string | null>(null)
  const [retryingDelivery, setRetryingDelivery] = useState<string | null>(null)
  const [discardingDelivery, setDiscardingDelivery] = useState<string | null>(null)
  const [discardTarget, setDiscardTarget] = useState<FailedBookingEmailDelivery | null>(null)
  const [contactSettings, setContactSettings] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  )
  const contactGeneration = useRef(new Map<string, number>())
  const [contactSaving, setContactSaving] = useState<'phone' | 'map' | null>(null)
  const [contactStatus, setContactStatus] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void (async () => {
      const [result, failedResult, settingsResult] = await Promise.all([
        listEmailTemplates(),
        listFailedBookingEmailDeliveries(),
        listSiteSettings(),
      ])
      if (!active) return
      if (!result.ok) setLoadError(result.error.message)
      else setRows(new Map(result.value.map((row) => [rowKey(row.template, row.lang), row])))
      if (!failedResult.ok) setDeliveryError(failedResult.error.message)
      else setFailedDeliveries(failedResult.value)
      if (!settingsResult.ok) setLoadError(settingsResult.error.message)
      else setContactSettings(settingsResult.value)
      setLoaded(true)
    })()
    return () => {
      active = false
    }
  }, [])

  const contactValue = (key: string): string =>
    contactSettings.get(key) ??
    (key in DEFAULT_SITE_SETTINGS
      ? DEFAULT_SITE_SETTINGS[key as keyof typeof DEFAULT_SITE_SETTINGS]
      : '')

  const setContactValue = (key: string, value: string): void => {
    contactGeneration.current.set(key, (contactGeneration.current.get(key) ?? 0) + 1)
    setContactSettings((previous) => new Map(previous).set(key, value))
    setContactStatus(null)
  }

  const saveContact = async (kind: 'phone' | 'map', clear = false): Promise<void> => {
    const values =
      kind === 'phone'
        ? [
            {
              key: BUSINESS_SETTING_KEYS.phoneDisplay,
              value: clear ? '' : contactValue(BUSINESS_SETTING_KEYS.phoneDisplay),
            },
            {
              key: BUSINESS_SETTING_KEYS.phoneTel,
              value: clear ? '' : contactValue(BUSINESS_SETTING_KEYS.phoneTel),
            },
          ]
        : [
            {
              key: BUSINESS_SETTING_KEYS.mapsHref,
              value: clear ? '' : contactValue(BUSINESS_SETTING_KEYS.mapsHref),
            },
          ]
    const generations = new Map<string, number>(
      values.map(({ key }) => [key, contactGeneration.current.get(key) ?? 0]),
    )
    const draftIsCurrent = (): boolean =>
      values.every(({ key }) => (contactGeneration.current.get(key) ?? 0) === generations.get(key))
    setContactSaving(kind)
    setContactStatus(null)
    const result = await saveSiteSettings(values)
    setContactSaving(null)
    if (!result.ok) {
      if (draftIsCurrent()) setContactStatus(result.error.message)
      return
    }
    setContactSettings((previous) => {
      const next = new Map(previous)
      for (const [key, value] of result.value) {
        if ((contactGeneration.current.get(key) ?? 0) === generations.get(key)) {
          next.set(key, value)
        }
      }
      return next
    })
    if (!draftIsCurrent()) return
    setContactStatus(
      props.lang === 'sv'
        ? clear
          ? 'Borttaget från kommande mejl.'
          : 'Sparat. Kommande mejl använder uppgifterna.'
        : clear
          ? 'Removed from future emails.'
          : 'Saved. Future emails use these details.',
    )
  }

  const update = (
    template: EmailTemplateName,
    lang: Lang,
    field: keyof Omit<EditableEmailTemplate, 'template' | 'lang'>,
    value: string,
  ): void => {
    const key = rowKey(template, lang)
    editGeneration.current.set(key, (editGeneration.current.get(key) ?? 0) + 1)
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
    const generation = editGeneration.current.get(key) ?? 0
    setSaving(key)
    setSaveError(null)
    const result = await saveEmailTemplate(row)
    setSaving(null)
    if (!result.ok) {
      if ((editGeneration.current.get(key) ?? 0) === generation) {
        setSaveError({ key, message: result.error.message })
      }
      return
    }
    if ((editGeneration.current.get(key) ?? 0) !== generation) return
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

  const discardDelivery = async (id: string): Promise<void> => {
    setDiscardingDelivery(id)
    setDeliveryError(null)
    const result = await discardFailedBookingEmailDelivery(id)
    setDiscardingDelivery(null)
    if (!result.ok) {
      setDeliveryError(result.error.message)
      return
    }
    setFailedDeliveries((previous) => previous.filter((delivery) => delivery.id !== id))
    setDiscardTarget(null)
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
              {props.lang === 'sv' ? 'Kontaktuppgifter i mejl' : 'Email contact details'}
            </h3>
            <p style={{ ...s.mutedText, margin: '0 0 16px' }}>
              {props.lang === 'sv'
                ? 'Delas med Startsida. Tomma värden tas bort från nya mejl; länkar valideras på servern.'
                : 'Shared with Startsida. Empty values are removed from new emails; links are validated server-side.'}
            </p>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))',
                gap: '14px',
              }}
            >
              <label>
                <span style={s.label}>
                  {props.lang === 'sv' ? 'Telefon (visas)' : 'Phone (display)'}
                </span>
                <input
                  style={s.input}
                  type="tel"
                  maxLength={40}
                  value={contactValue(BUSINESS_SETTING_KEYS.phoneDisplay)}
                  onInput={(event) =>
                    setContactValue(BUSINESS_SETTING_KEYS.phoneDisplay, event.currentTarget.value)
                  }
                />
              </label>
              <label>
                <span style={s.label}>{props.lang === 'sv' ? 'Telefonlänk' : 'Phone link'}</span>
                <input
                  style={s.input}
                  type="tel"
                  maxLength={40}
                  value={contactValue(BUSINESS_SETTING_KEYS.phoneTel)}
                  onInput={(event) =>
                    setContactValue(BUSINESS_SETTING_KEYS.phoneTel, event.currentTarget.value)
                  }
                />
              </label>
              <label>
                <span style={s.label}>{props.lang === 'sv' ? 'Kartlänk' : 'Maps link'}</span>
                <input
                  style={s.input}
                  type="url"
                  maxLength={500}
                  value={contactValue(BUSINESS_SETTING_KEYS.mapsHref)}
                  onInput={(event) =>
                    setContactValue(BUSINESS_SETTING_KEYS.mapsHref, event.currentTarget.value)
                  }
                />
              </label>
            </div>
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: '8px',
                marginTop: '14px',
              }}
            >
              <button
                type="button"
                style={{ ...s.primaryBtn, opacity: contactSaving === 'phone' ? 0.6 : 1 }}
                disabled={contactSaving !== null}
                onClick={() => void saveContact('phone')}
              >
                {props.lang === 'sv' ? 'Spara telefon' : 'Save phone'}
              </button>
              <button
                type="button"
                style={s.ghostBtn}
                disabled={contactSaving !== null}
                onClick={() => void saveContact('phone', true)}
              >
                {props.lang === 'sv' ? 'Ta bort telefon' : 'Remove phone'}
              </button>
              <button
                type="button"
                style={{ ...s.primaryBtn, opacity: contactSaving === 'map' ? 0.6 : 1 }}
                disabled={contactSaving !== null}
                onClick={() => void saveContact('map')}
              >
                {props.lang === 'sv' ? 'Spara karta' : 'Save map'}
              </button>
              <button
                type="button"
                style={s.ghostBtn}
                disabled={contactSaving !== null}
                onClick={() => void saveContact('map', true)}
              >
                {props.lang === 'sv' ? 'Ta bort karta' : 'Remove map'}
              </button>
              {contactStatus === null ? null : <span style={s.mutedText}>{contactStatus}</span>}
            </div>
          </article>
          <article style={{ borderTop: s.card.border, paddingTop: '22px' }}>
            <h3 style={{ margin: '0 0 5px', fontSize: '17px' }}>
              {props.lang === 'sv' ? 'Misslyckade mejlleveranser' : 'Failed email deliveries'}
            </h3>
            <p style={{ ...s.mutedText, margin: '0 0 16px' }}>
              {props.lang === 'sv'
                ? 'Misslyckade mejl stoppas efter fem tillfälliga fel eller direkt vid permanenta leverans- och konfigurationsfel. Försök igen eller markera leveransen som hanterad.'
                : 'Emails stop after five transient failures or immediately on permanent delivery and configuration errors. Retry or mark the delivery handled.'}
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
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        style={{
                          ...s.primaryBtn,
                          opacity: retryingDelivery === delivery.id ? 0.6 : 1,
                        }}
                        disabled={
                          retryingDelivery === delivery.id || discardingDelivery === delivery.id
                        }
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
                      <button
                        type="button"
                        style={{
                          ...s.ghostBtn,
                          opacity: discardingDelivery === delivery.id ? 0.6 : 1,
                        }}
                        disabled={
                          retryingDelivery === delivery.id || discardingDelivery === delivery.id
                        }
                        onClick={() => setDiscardTarget(delivery)}
                      >
                        {discardingDelivery === delivery.id
                          ? props.lang === 'sv'
                            ? 'Hanterar …'
                            : 'Handling …'
                          : props.lang === 'sv'
                            ? 'Markera hanterad'
                            : 'Mark handled'}
                      </button>
                    </div>
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
                          disabled={saving !== null}
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
      {discardTarget === null ? null : (
        <ConfirmDialog
          dark={props.dark}
          title={props.lang === 'sv' ? 'Markera mejlet som hanterat?' : 'Mark email handled?'}
          body={
            props.lang === 'sv'
              ? `Leveransen för bokning ${discardTarget.bookingId} kommer inte att skickas igen. Bokningen kan därefter raderas.`
              : `Delivery for booking ${discardTarget.bookingId} will not be retried. The booking can then be deleted.`
          }
          confirmLabel={props.lang === 'sv' ? 'Markera hanterad' : 'Mark handled'}
          cancelLabel={props.lang === 'sv' ? 'Avbryt' : 'Cancel'}
          danger={true}
          busy={discardingDelivery === discardTarget.id}
          onConfirm={() => void discardDelivery(discardTarget.id)}
          onClose={() => {
            if (discardingDelivery === null) setDiscardTarget(null)
          }}
        />
      )}
    </section>
  )
}

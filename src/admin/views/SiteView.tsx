// Startsida view (OWNER only) — edit business identity, runtime SEO, homepage text, every non-button
// string in the booking details/confirmation dialogs, and two font-size presets. Unsaved cells use
// shipped defaults; saves upsert one row and reach open public pages via Realtime. All writes are
// owner-only at the RLS layer.

import type { JSX } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import type { Lang } from '../../i18n/index'
import { adminText } from '../../i18n/adminStrings'
import {
  listSiteContent,
  listSiteSettings,
  saveSiteContent,
  saveSiteSetting,
} from '../adapters/siteAdmin'
import {
  ABOUT_SCALE_KEY,
  BOOKING_CONFIRMATION_TEXT_KEYS,
  BOOKING_DETAILS_TEXT_KEYS,
  BUSINESS_SETTING_KEYS,
  DEFAULT_SITE_SETTINGS,
  HOMEPAGE_SCALE_KEY,
  HOMEPAGE_TEXT_KEYS,
  SITE_TEXT_KEYS,
  SIZE_PRESETS,
  defaultSiteSettings,
  defaultSiteText,
  parseScale,
  resolveBusinessSettings,
  type SizePreset,
  type SiteSettingKey,
  type SiteTextKey,
} from '../../site/siteChrome'
import type { AdminStylesBundle } from './viewTypes'

const LANGS: readonly Lang[] = ['sv', 'en']
type TextField = SiteTextKey
type SettingInputType = 'email' | 'number' | 'tel' | 'text' | 'url'

interface SettingField {
  readonly key: SiteSettingKey
  readonly label: string
  readonly maxLength: number
  readonly type?: SettingInputType
  readonly multiline?: boolean
  readonly inputMode?: 'numeric'
}

const cellKey = (key: string, lang: Lang): string => `${key}:${lang}`

export interface SiteViewProps {
  readonly dark: boolean
  readonly lang: Lang
  readonly s: AdminStylesBundle
}

export function SiteView(props: SiteViewProps): JSX.Element {
  const { s, lang } = props
  const t = adminText(lang)

  const [cells, setCells] = useState<Map<string, string>>(new Map())
  const [settings, setSettings] = useState<ReadonlyMap<string, string>>(() => defaultSiteSettings())
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [savedKey, setSavedKey] = useState<string | null>(null)
  const [errorFor, setErrorFor] = useState<{ key: string; message: string } | null>(null)

  useEffect(() => {
    let active = true
    void (async () => {
      const [content, siteSettings] = await Promise.all([listSiteContent(), listSiteSettings()])
      if (!active) return
      if (!content.ok) {
        setLoadError(content.error.message)
        setLoaded(true)
        return
      }
      if (!siteSettings.ok) {
        setLoadError(siteSettings.error.message)
        setLoaded(true)
        return
      }
      const map = new Map<string, string>()
      const business = resolveBusinessSettings(siteSettings.value)
      for (const cellLang of LANGS) {
        const defaults = defaultSiteText(cellLang, business.cancellationPolicyHours, business.name)
        for (const key of SITE_TEXT_KEYS) map.set(cellKey(key, cellLang), defaults[key])
      }
      for (const row of content.value) {
        if (row.value.trim() !== '') map.set(cellKey(row.key, row.lang), row.value)
      }
      setCells(map)
      setSettings(new Map(siteSettings.value))
      setLoaded(true)
    })()
    return () => {
      active = false
    }
  }, [])

  const valueFor = (key: TextField, l: Lang): string => cells.get(cellKey(key, l)) ?? ''
  const settingValue = (key: SiteSettingKey): string =>
    settings.get(key) ?? DEFAULT_SITE_SETTINGS[key]
  const business = resolveBusinessSettings(settings)

  const setValue = (key: TextField, l: Lang, value: string): void => {
    setCells((prev) => {
      const next = new Map(prev)
      next.set(cellKey(key, l), value)
      return next
    })
    setSavedKey(null)
    setErrorFor(null)
  }

  const saveCell = async (key: TextField, l: Lang): Promise<void> => {
    const ck = cellKey(key, l)
    const value = valueFor(key, l)
    setSavingKey(ck)
    setErrorFor(null)
    const result = await saveSiteContent(key, l, value)
    setSavingKey(null)
    if (!result.ok) {
      setErrorFor({ key: ck, message: result.error.message })
      return
    }
    if (value.trim() === '') {
      setCells((prev) =>
        new Map(prev).set(
          ck,
          defaultSiteText(l, business.cancellationPolicyHours, business.name)[key],
        ),
      )
    }
    setSavedKey(ck)
  }

  const setSettingValue = (key: SiteSettingKey, value: string): void => {
    setSettings((previous) => {
      const next = new Map(previous)
      next.set(key, value)
      return next
    })
    if (
      key === BUSINESS_SETTING_KEYS.cancellationPolicyHours ||
      key === BUSINESS_SETTING_KEYS.name
    ) {
      const nextSettings = new Map(settings)
      nextSettings.set(key, value)
      const nextBusiness = resolveBusinessSettings(nextSettings)
      setCells((previous) => {
        const next = new Map(previous)
        for (const cellLang of LANGS) {
          const policyKey = cellKey('policy', cellLang)
          if (
            next.get(policyKey) ===
            defaultSiteText(cellLang, business.cancellationPolicyHours, business.name).policy
          ) {
            next.set(
              policyKey,
              defaultSiteText(cellLang, nextBusiness.cancellationPolicyHours, nextBusiness.name)
                .policy,
            )
          }
        }
        return next
      })
    }
    setSavedKey(null)
    setErrorFor(null)
  }

  const saveSetting = async (
    key: SiteSettingKey,
    value: string = settingValue(key),
  ): Promise<void> => {
    setSavingKey(key)
    setErrorFor(null)
    const result = await saveSiteSetting(key, value)
    setSavingKey(null)
    if (!result.ok) {
      setErrorFor({ key, message: result.error.message })
      return
    }
    setSavedKey(key)
  }

  const onScale = async (which: 'homepage' | 'about', value: SizePreset): Promise<void> => {
    const key = which === 'homepage' ? HOMEPAGE_SCALE_KEY : ABOUT_SCALE_KEY
    setSettingValue(key, value)
    await saveSetting(key, value)
  }

  const fieldLabels: Record<TextField, string> = {
    kicker: t.siteFieldKicker,
    hours: t.siteFieldHours,
    yourDetails: t.siteFieldYourDetails,
    summary: t.siteFieldSummary,
    fBarber: t.siteFieldBarberLabel,
    fWhen: t.siteFieldWhenLabel,
    fService: t.siteFieldServiceLabel,
    fTotal: t.siteFieldTotalLabel,
    name: t.siteFieldNameLabel,
    namePh: t.siteFieldNamePlaceholder,
    phone: t.siteFieldPhoneLabel,
    phonePh: t.siteFieldPhonePlaceholder,
    policy: t.siteFieldPolicy,
    bookedTitle: t.siteFieldBookedTitle,
    confirmSent: t.siteFieldConfirmSent,
    addToCal: t.siteFieldAddToCal,
  }

  const sizeLabel: Record<SizePreset, string> = {
    sm: t.siteSizeSm,
    md: t.siteSizeMd,
    lg: t.siteSizeLg,
    xl: t.siteSizeXl,
  }

  const homepageScale = parseScale(settingValue(HOMEPAGE_SCALE_KEY))
  const aboutScale = parseScale(settingValue(ABOUT_SCALE_KEY))

  const scaleSelect = (
    which: 'homepage' | 'about',
    label: string,
    value: SizePreset,
  ): JSX.Element => (
    <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: '1 1 200px' }}>
      <span style={s.label}>{label}</span>
      <select
        style={s.select}
        value={value}
        onChange={(e) => void onScale(which, parseScale(e.currentTarget.value))}
      >
        {SIZE_PRESETS.map((p) => (
          <option key={p} value={p}>
            {sizeLabel[p]}
          </option>
        ))}
      </select>
    </label>
  )

  const settingEditor = (field: SettingField): JSX.Element => {
    const value = settingValue(field.key)
    const status =
      savedKey === field.key ? t.aboutSaved : errorFor?.key === field.key ? errorFor.message : null
    return (
      <div key={field.key}>
        <label style={s.label} htmlFor={`setting-${field.key}`}>
          {field.label}
        </label>
        {field.multiline ? (
          <textarea
            id={`setting-${field.key}`}
            style={s.textarea}
            rows={4}
            maxLength={field.maxLength}
            value={value}
            onInput={(event) => setSettingValue(field.key, event.currentTarget.value)}
          />
        ) : (
          <input
            id={`setting-${field.key}`}
            style={s.input}
            type={field.type ?? 'text'}
            inputMode={field.inputMode}
            min={field.type === 'number' ? 1 : undefined}
            max={field.type === 'number' ? 168 : undefined}
            maxLength={field.maxLength}
            value={value}
            onInput={(event) => setSettingValue(field.key, event.currentTarget.value)}
          />
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '6px' }}>
          <button
            type="button"
            style={{ ...s.ghostBtn, opacity: savingKey === field.key ? 0.6 : 1 }}
            onClick={() => void saveSetting(field.key)}
            disabled={savingKey === field.key}
          >
            {savingKey === field.key ? t.aboutSaving : t.aboutSave}
          </button>
          <span aria-live="polite">
            {status !== null ? (
              <span style={savedKey === field.key ? s.successText : s.errorText}>{status}</span>
            ) : null}
          </span>
        </div>
      </div>
    )
  }

  const businessFields: readonly SettingField[] = [
    { key: BUSINESS_SETTING_KEYS.name, label: t.siteFieldBusinessName, maxLength: 120 },
    {
      key: BUSINESS_SETTING_KEYS.email,
      label: t.siteFieldBusinessEmail,
      maxLength: 254,
      type: 'email',
    },
    {
      key: BUSINESS_SETTING_KEYS.phoneDisplay,
      label: t.siteFieldBusinessPhoneDisplay,
      maxLength: 40,
      type: 'tel',
    },
    {
      key: BUSINESS_SETTING_KEYS.phoneTel,
      label: t.siteFieldBusinessPhoneTel,
      maxLength: 40,
      type: 'tel',
    },
    { key: BUSINESS_SETTING_KEYS.street, label: t.siteFieldBusinessStreet, maxLength: 160 },
    { key: BUSINESS_SETTING_KEYS.postalCode, label: t.siteFieldBusinessPostalCode, maxLength: 24 },
    { key: BUSINESS_SETTING_KEYS.city, label: t.siteFieldBusinessCity, maxLength: 120 },
    {
      key: BUSINESS_SETTING_KEYS.mapsHref,
      label: t.siteFieldBusinessMapsUrl,
      maxLength: 500,
      type: 'url',
    },
    {
      key: BUSINESS_SETTING_KEYS.cancellationPolicyHours,
      label: t.siteFieldCancellationPolicyHours,
      maxLength: 3,
      type: 'number',
      inputMode: 'numeric',
    },
  ]

  const seoFields = (seoLang: Lang): readonly SettingField[] => [
    {
      key: BUSINESS_SETTING_KEYS.seo[seoLang].title,
      label: t.siteFieldSeoTitle,
      maxLength: 160,
    },
    {
      key: BUSINESS_SETTING_KEYS.seo[seoLang].description,
      label: t.siteFieldSeoDescription,
      maxLength: 500,
      multiline: true,
    },
  ]

  const textEditors = (fields: readonly TextField[]): JSX.Element => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginTop: '12px' }}>
      {fields.map((field) => (
        <div key={field}>
          <h3 style={{ ...s.label, fontSize: '13px' }}>{fieldLabels[field]}</h3>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))',
              gap: '12px',
            }}
          >
            {LANGS.map((cellLang) => {
              const ck = cellKey(field, cellLang)
              return (
                <div key={ck}>
                  <label style={s.label} htmlFor={`site-${ck}`}>
                    {cellLang === 'sv' ? t.aboutLangSwedish : t.aboutLangEnglish}
                  </label>
                  {field === 'policy' || field === 'confirmSent' ? (
                    <textarea
                      id={`site-${ck}`}
                      style={s.textarea}
                      rows={5}
                      maxLength={400}
                      value={valueFor(field, cellLang)}
                      onInput={(e) => setValue(field, cellLang, e.currentTarget.value)}
                    />
                  ) : (
                    <input
                      id={`site-${ck}`}
                      style={s.input}
                      maxLength={400}
                      value={valueFor(field, cellLang)}
                      onInput={(e) => setValue(field, cellLang, e.currentTarget.value)}
                    />
                  )}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      marginTop: '6px',
                    }}
                  >
                    <button
                      type="button"
                      style={{ ...s.ghostBtn, opacity: savingKey === ck ? 0.6 : 1 }}
                      onClick={() => void saveCell(field, cellLang)}
                      disabled={savingKey === ck}
                    >
                      {savingKey === ck ? t.aboutSaving : t.aboutSave}
                    </button>
                    <span aria-live="polite">
                      {savedKey === ck ? <span style={s.successText}>{t.aboutSaved}</span> : null}
                      {errorFor?.key === ck ? (
                        <span style={s.errorText}>{errorFor.message}</span>
                      ) : null}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )

  return (
    <>
      <section style={s.card} aria-labelledby="site-business-heading">
        <h2 id="site-business-heading" style={s.sectionTitle}>
          {t.siteBusinessTitle}
        </h2>
        <p style={s.sectionLead}>{t.siteBusinessLead}</p>
        {loadError !== null ? (
          <div style={{ ...s.emptyState, color: s.errorText.color }}>{loadError}</div>
        ) : !loaded ? (
          <div style={s.emptyState}>{t.siteLoading}</div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))',
              gap: '20px',
              marginTop: '12px',
            }}
          >
            {businessFields.map(settingEditor)}
          </div>
        )}
      </section>

      <section style={s.card} aria-labelledby="site-seo-heading">
        <h2 id="site-seo-heading" style={s.sectionTitle}>
          {t.siteSeoTitle}
        </h2>
        <p style={s.sectionLead}>{t.siteSeoLead}</p>
        {loadError !== null ? (
          <div style={{ ...s.emptyState, color: s.errorText.color }}>{loadError}</div>
        ) : !loaded ? (
          <div style={s.emptyState}>{t.siteLoading}</div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))',
              gap: '24px',
              marginTop: '12px',
            }}
          >
            <div>
              <h3 style={{ ...s.label, fontSize: '13px' }}>{t.aboutLangSwedish}</h3>
              <div
                style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginTop: '12px' }}
              >
                {seoFields('sv').map(settingEditor)}
              </div>
            </div>
            <div>
              <h3 style={{ ...s.label, fontSize: '13px' }}>{t.aboutLangEnglish}</h3>
              <div
                style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginTop: '12px' }}
              >
                {seoFields('en').map(settingEditor)}
              </div>
            </div>
          </div>
        )}
      </section>

      <section style={s.card} aria-labelledby="site-text-heading">
        <h2 id="site-text-heading" style={s.sectionTitle}>
          {t.siteTextTitle}
        </h2>
        <p style={s.sectionLead}>{t.siteTextLead}</p>

        {loadError !== null ? (
          <div style={{ ...s.emptyState, color: s.errorText.color }}>{loadError}</div>
        ) : !loaded ? (
          <div style={s.emptyState}>{t.siteLoading}</div>
        ) : (
          textEditors(HOMEPAGE_TEXT_KEYS)
        )}
      </section>

      <section style={s.card} aria-labelledby="site-booking-text-heading">
        <h2 id="site-booking-text-heading" style={s.sectionTitle}>
          {t.siteBookingTextTitle}
        </h2>
        <p style={s.sectionLead}>{t.siteBookingTextLead}</p>

        {loadError !== null ? (
          <div style={{ ...s.emptyState, color: s.errorText.color }}>{loadError}</div>
        ) : !loaded ? (
          <div style={s.emptyState}>{t.siteLoading}</div>
        ) : (
          <>
            <h3 style={{ ...s.sectionTitle, fontSize: '16px', marginTop: '18px' }}>
              {t.siteBookingDetailsGroup}
            </h3>
            {textEditors(BOOKING_DETAILS_TEXT_KEYS)}
            <h3 style={{ ...s.sectionTitle, fontSize: '16px', marginTop: '28px' }}>
              {t.siteBookingConfirmationGroup}
            </h3>
            {textEditors(BOOKING_CONFIRMATION_TEXT_KEYS)}
          </>
        )}
      </section>

      <section style={s.card} aria-labelledby="site-font-heading">
        <h2 id="site-font-heading" style={s.sectionTitle}>
          {t.siteFontTitle}
        </h2>
        <p style={s.sectionLead}>{t.siteFontLead}</p>
        <div
          style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', marginTop: '12px' }}
          aria-live="polite"
        >
          {scaleSelect('homepage', t.siteFontHomepage, homepageScale)}
          {scaleSelect('about', t.siteFontAbout, aboutScale)}
        </div>
      </section>
    </>
  )
}

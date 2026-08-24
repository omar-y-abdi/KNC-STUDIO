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
  homepageLogoPublicUrl,
  removeHomepageLogo,
  uploadHomepageLogo,
} from '../adapters/homepageLogoAdmin'
import { HomepageLogo } from '../../site/HomepageLogo'
import {
  ABOUT_SCALE_KEY,
  BOOKING_CONFIRMATION_TEXT_KEYS,
  BOOKING_DETAILS_TEXT_KEYS,
  BUSINESS_SETTING_KEYS,
  DEFAULT_SITE_SETTINGS,
  HOMEPAGE_SCALE_KEY,
  HOMEPAGE_LOGO_PATH_KEY,
  HOMEPAGE_LOGO_SCALE_KEY,
  HOMEPAGE_LOGO_STYLE_KEY,
  HOMEPAGE_TEXT_KEYS,
  SITE_TEXT_KEYS,
  SIZE_PRESETS,
  defaultSiteSettings,
  defaultSiteText,
  parseScale,
  parseHomepageLogoPath,
  parseHomepageLogoStyle,
  resolveBusinessSettings,
  type HomepageLogo as HomepageLogoConfig,
  type HomepageLogoStyle,
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
  const [pendingLogo, setPendingLogo] = useState<File | null>(null)
  const [pendingLogoUrl, setPendingLogoUrl] = useState<string | null>(null)
  const [logoBusy, setLogoBusy] = useState<'upload' | 'remove' | null>(null)
  const [logoStatus, setLogoStatus] = useState<string | null>(null)

  useEffect(
    () => () => {
      if (pendingLogoUrl?.startsWith('blob:')) URL.revokeObjectURL(pendingLogoUrl)
    },
    [pendingLogoUrl],
  )

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
    setSettings((previous) =>
      previous.get(key) === value ? new Map(previous).set(key, result.value) : previous,
    )
    setSavedKey(key)
  }

  const onScale = async (
    which: 'homepage' | 'about' | 'logo',
    value: SizePreset,
  ): Promise<void> => {
    const key =
      which === 'homepage'
        ? HOMEPAGE_SCALE_KEY
        : which === 'about'
          ? ABOUT_SCALE_KEY
          : HOMEPAGE_LOGO_SCALE_KEY
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
  const logoScale = parseScale(settingValue(HOMEPAGE_LOGO_SCALE_KEY))
  const logoStyle = parseHomepageLogoStyle(settingValue(HOMEPAGE_LOGO_STYLE_KEY))
  const logoPath = parseHomepageLogoPath(settingValue(HOMEPAGE_LOGO_PATH_KEY))
  const logo: HomepageLogoConfig = {
    path: logoPath,
    url: pendingLogoUrl ?? (logoPath === null ? null : homepageLogoPublicUrl(logoPath)),
    scale: logoScale,
    style: logoStyle,
  }

  const selectLogo = (file: File | null): void => {
    if (pendingLogoUrl?.startsWith('blob:')) URL.revokeObjectURL(pendingLogoUrl)
    setPendingLogo(file)
    setPendingLogoUrl(file === null ? null : URL.createObjectURL(file))
    setLogoStatus(
      file === null
        ? null
        : props.lang === 'sv'
          ? 'Förhandsvisning lokal. Spara för att publicera.'
          : 'Preview is local. Save to publish.',
    )
  }

  const saveLogo = async (): Promise<void> => {
    if (pendingLogo === null) return
    setLogoBusy('upload')
    setLogoStatus(null)
    const result = await uploadHomepageLogo(pendingLogo, logoPath ?? '')
    setLogoBusy(null)
    if (!result.ok) {
      setLogoStatus(result.error.message)
      return
    }
    setSettings((previous) => new Map(previous).set(HOMEPAGE_LOGO_PATH_KEY, result.value.path))
    setPendingLogo(null)
    setPendingLogoUrl(result.value.url)
    setLogoStatus(
      result.value.cleanupPending
        ? props.lang === 'sv'
          ? 'Logotyp sparad. Tidigare fil rensas i bakgrunden.'
          : 'Logo saved. Previous file will be cleaned up in the background.'
        : props.lang === 'sv'
          ? 'Logotyp sparad.'
          : 'Logo saved.',
    )
  }

  const deleteLogo = async (): Promise<void> => {
    if (logoPath === null) return
    setLogoBusy('remove')
    setLogoStatus(null)
    const result = await removeHomepageLogo(logoPath)
    setLogoBusy(null)
    if (!result.ok) {
      setLogoStatus(result.error.message)
      return
    }
    setSettings((previous) => new Map(previous).set(HOMEPAGE_LOGO_PATH_KEY, ''))
    selectLogo(null)
    setLogoStatus(
      result.value.pending
        ? props.lang === 'sv'
          ? 'Logotyp borttagen. Filen rensas i bakgrunden.'
          : 'Logo removed. File cleanup continues in the background.'
        : props.lang === 'sv'
          ? 'Logotyp borttagen.'
          : 'Logo removed.',
    )
  }

  const setLogoStyle = async (style: HomepageLogoStyle): Promise<void> => {
    setSettingValue(HOMEPAGE_LOGO_STYLE_KEY, style)
    await saveSetting(HOMEPAGE_LOGO_STYLE_KEY, style)
  }

  const scaleSelect = (
    which: 'homepage' | 'about' | 'logo',
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
      maxLength: 120,
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
      <section style={s.card} aria-labelledby="site-logo-heading">
        <h2 id="site-logo-heading" style={s.sectionTitle}>
          {props.lang === 'sv' ? 'Startsidelogotyp' : 'Homepage logo'}
        </h2>
        <p style={s.sectionLead}>
          {props.lang === 'sv'
            ? 'Byt logotyp, skala den och förhandsvisa före publicering. Standard behåller nuvarande vektorlogotyp.'
            : 'Replace, scale, and preview before publishing. Standard keeps the current vector lockup.'}
        </p>
        {loadError !== null ? (
          <div style={{ ...s.emptyState, color: s.errorText.color }}>{loadError}</div>
        ) : !loaded ? (
          <div style={s.emptyState}>{t.siteLoading}</div>
        ) : (
          <>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit,minmax(230px,1fr))',
                gap: '14px',
                marginTop: '16px',
              }}
            >
              <label>
                <span style={s.label}>
                  {props.lang === 'sv' ? 'Ersätt logotyp' : 'Replace logo'}
                </span>
                <input
                  style={s.input}
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif"
                  onInput={(event) => selectLogo(event.currentTarget.files?.item(0) ?? null)}
                />
              </label>
              {scaleSelect(
                'logo',
                props.lang === 'sv' ? 'Logotypstorlek' : 'Logo scale',
                logoScale,
              )}
              {scaleSelect(
                'homepage',
                props.lang === 'sv' ? 'Text under logotyp' : 'Text below logo',
                homepageScale,
              )}
              <label
                style={{ display: 'flex', flexDirection: 'column', gap: '6px', flex: '1 1 200px' }}
              >
                <span style={s.label}>{props.lang === 'sv' ? 'Bildstil' : 'Image style'}</span>
                <select
                  style={s.select}
                  value={logoStyle}
                  disabled={savingKey === HOMEPAGE_LOGO_STYLE_KEY}
                  onChange={(event) =>
                    void setLogoStyle(parseHomepageLogoStyle(event.currentTarget.value))
                  }
                >
                  <option value="classic">{props.lang === 'sv' ? 'Standard' : 'Standard'}</option>
                  <option value="monochrome">
                    {props.lang === 'sv' ? 'Monokrom' : 'Monochrome'}
                  </option>
                </select>
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
                style={{
                  ...s.primaryBtn,
                  opacity: pendingLogo === null || logoBusy !== null ? 0.6 : 1,
                }}
                disabled={pendingLogo === null || logoBusy !== null}
                onClick={() => void saveLogo()}
              >
                {logoBusy === 'upload'
                  ? props.lang === 'sv'
                    ? 'Sparar …'
                    : 'Saving …'
                  : props.lang === 'sv'
                    ? 'Spara logotyp'
                    : 'Save logo'}
              </button>
              <button
                type="button"
                style={s.ghostBtn}
                disabled={logoPath === null || logoBusy !== null}
                onClick={() => void deleteLogo()}
              >
                {logoBusy === 'remove'
                  ? props.lang === 'sv'
                    ? 'Tar bort …'
                    : 'Removing …'
                  : props.lang === 'sv'
                    ? 'Återställ standard'
                    : 'Restore default'}
              </button>
              {logoStatus === null ? null : <span style={s.mutedText}>{logoStatus}</span>}
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit,minmax(280px,1fr))',
                gap: '14px',
                marginTop: '20px',
              }}
            >
              <div>
                <h3 style={{ ...s.label, fontSize: '13px' }}>
                  {props.lang === 'sv' ? 'Fokuserad förhandsvisning' : 'Focused preview'}
                </h3>
                <div
                  style={{
                    minHeight: '245px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                    border: s.input.border,
                    borderRadius: '13px',
                    background: props.dark ? '#242427' : '#f4f3f0',
                    color: props.dark ? '#f5f5f7' : '#1c1c1e',
                  }}
                >
                  <HomepageLogo logo={logo} layout="desktop" height={150} />
                </div>
              </div>
              <div>
                <h3 style={{ ...s.label, fontSize: '13px' }}>
                  {props.lang === 'sv' ? 'Simulerad startsida' : 'Simulated homepage'}
                </h3>
                <div
                  style={{
                    height: '320px',
                    overflowY: 'auto',
                    border: s.input.border,
                    borderRadius: '13px',
                    background: props.dark ? '#1c1c1e' : '#ffffff',
                    color: props.dark ? '#f5f5f7' : '#1c1c1e',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '10px 14px',
                      borderBottom: props.dark
                        ? '0.5px solid rgba(255,255,255,.1)'
                        : '0.5px solid rgba(0,0,0,.08)',
                      fontSize: '10px',
                      letterSpacing: '1.1px',
                    }}
                  >
                    <span>BLADE &amp; BLEND</span>
                    <span>{props.lang === 'sv' ? 'BOKA TID' : 'BOOK'}</span>
                  </div>
                  <div style={{ padding: '34px 20px 28px', textAlign: 'center' }}>
                    <div
                      style={{ display: 'flex', justifyContent: 'center', marginBottom: '14px' }}
                    >
                      <HomepageLogo logo={logo} layout="mobile" height={86} />
                    </div>
                    <p style={{ margin: '0 0 16px', fontSize: '11px', opacity: 0.58 }}>
                      {props.lang === 'sv' ? 'SHARPEN YOUR LOOK' : 'SHARPEN YOUR LOOK'}
                    </p>
                    <span
                      style={{
                        display: 'inline-block',
                        borderRadius: '8px',
                        padding: '9px 14px',
                        background: props.dark ? '#f5f5f7' : '#1c1c1e',
                        color: props.dark ? '#1c1c1e' : '#ffffff',
                        fontSize: '11px',
                        fontWeight: 700,
                      }}
                    >
                      {props.lang === 'sv' ? 'Boka tid' : 'Book now'}
                    </span>
                  </div>
                  <div
                    style={{
                      padding: '28px 20px',
                      borderTop: props.dark
                        ? '0.5px solid rgba(255,255,255,.1)'
                        : '0.5px solid rgba(0,0,0,.08)',
                      background: props.dark ? '#242427' : '#f4f3f0',
                    }}
                  >
                    <p
                      style={{
                        margin: '0 0 6px',
                        fontSize: '10px',
                        letterSpacing: '1px',
                        opacity: 0.58,
                      }}
                    >
                      {props.lang === 'sv' ? 'OM OSS' : 'ABOUT US'}
                    </p>
                    <h4
                      style={{
                        margin: '0 0 8px',
                        fontFamily: "'Playfair Display',serif",
                        fontSize: '20px',
                      }}
                    >
                      {props.lang === 'sv'
                        ? 'Din stil, vår precision.'
                        : 'Your style, our precision.'}
                    </h4>
                    <p style={{ margin: 0, fontSize: '12px', lineHeight: 1.55, opacity: 0.68 }}>
                      {props.lang === 'sv'
                        ? 'Bläddra i denna kompakta förhandsvisning innan du publicerar.'
                        : 'Scroll this compact preview before publishing.'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </section>

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

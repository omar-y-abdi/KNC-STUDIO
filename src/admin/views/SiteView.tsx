// Startsida view (OWNER only) — edit homepage text (kicker / hours / address) and booking-popup
// copy (policy / confirmation heading), all per language, plus two font-size presets. Text cells
// save independently (upsert) like AboutView; each font select saves on change. The public site
// overlays these values onto i18n defaults, so owner edits reach open public pages. All writes are
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
  HOMEPAGE_SCALE_KEY,
  SIZE_PRESETS,
  parseScale,
  type SizePreset,
  type SiteTextKey,
} from '../../site/siteChrome'
import type { AdminStylesBundle } from './viewTypes'

const LANGS: readonly Lang[] = ['sv', 'en']
const HOMEPAGE_TEXT_FIELDS: readonly SiteTextKey[] = ['kicker', 'hours', 'addr']
const BOOKING_TEXT_FIELDS: readonly SiteTextKey[] = ['policy', 'bookedTitle']
type TextField = SiteTextKey

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
  const [homepageScale, setHomepageScale] = useState<SizePreset>('md')
  const [aboutScale, setAboutScale] = useState<SizePreset>('md')
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [savedKey, setSavedKey] = useState<string | null>(null)
  const [errorFor, setErrorFor] = useState<{ key: string; message: string } | null>(null)

  useEffect(() => {
    let active = true
    void (async () => {
      const [content, settings] = await Promise.all([listSiteContent(), listSiteSettings()])
      if (!active) return
      if (!content.ok) {
        setLoadError(content.error.message)
        setLoaded(true)
        return
      }
      const map = new Map<string, string>()
      for (const row of content.value) map.set(cellKey(row.key, row.lang), row.value)
      setCells(map)
      if (settings.ok) {
        setHomepageScale(parseScale(settings.value.get(HOMEPAGE_SCALE_KEY)))
        setAboutScale(parseScale(settings.value.get(ABOUT_SCALE_KEY)))
      }
      setLoaded(true)
    })()
    return () => {
      active = false
    }
  }, [])

  const valueFor = (key: TextField, l: Lang): string => cells.get(cellKey(key, l)) ?? ''

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
    setSavingKey(ck)
    setErrorFor(null)
    const result = await saveSiteContent(key, l, valueFor(key, l))
    setSavingKey(null)
    if (!result.ok) {
      setErrorFor({ key: ck, message: result.error.message })
      return
    }
    setSavedKey(ck)
  }

  const onScale = async (which: 'homepage' | 'about', value: SizePreset): Promise<void> => {
    const key = which === 'homepage' ? HOMEPAGE_SCALE_KEY : ABOUT_SCALE_KEY
    if (which === 'homepage') setHomepageScale(value)
    else setAboutScale(value)
    setErrorFor(null)
    const result = await saveSiteSetting(key, value)
    if (!result.ok) setErrorFor({ key, message: t.siteSaveError })
    else setSavedKey(key)
  }

  const fieldLabels: Record<TextField, string> = {
    kicker: t.siteFieldKicker,
    hours: t.siteFieldHours,
    addr: t.siteFieldAddr,
    policy: t.siteFieldPolicy,
    bookedTitle: t.siteFieldBookedTitle,
  }

  const sizeLabel: Record<SizePreset, string> = {
    sm: t.siteSizeSm,
    md: t.siteSizeMd,
    lg: t.siteSizeLg,
    xl: t.siteSizeXl,
  }

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
                  {field === 'policy' ? (
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
          textEditors(HOMEPAGE_TEXT_FIELDS)
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
          textEditors(BOOKING_TEXT_FIELDS)
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

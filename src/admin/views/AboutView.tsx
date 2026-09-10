// About view (OWNER only). Two parts:
//   1. "Om oss"-text — every editable about_content cell, per key, per language (SV/EN side by side).
//      Each cell saves independently (upsert) with its own saved/error state.
//   2. Gallery — manage the two galleries (salon / cuts): upload an image (Storage + row) and delete
//      one (row + object). Thumbnails use the public Storage URL.
// All writes are owner-only at the RLS / Storage-policy layer.
//
// Data effects isolated here; the forms/tables are otherwise pure. The public About section overlays
// these DB values onto its i18n defaults, so edits here show up on the public site.

import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { Lang } from '../../i18n/index'
import { adminText } from '../../i18n/adminStrings'
import { listAbout, saveAbout } from '../adapters/aboutAdmin'
import { deleteImage, listGallery, uploadImage } from '../adapters/galleryAdmin'
import { ConfirmDialog } from '../ConfirmDialog'
import type { AboutKey, AdminStylesBundle, GalleryImage, GalleryKind } from './viewTypes'

export interface AboutViewProps {
  readonly dark: boolean
  readonly lang: Lang
  readonly s: AdminStylesBundle
}

/** The 7 editable keys, in display order. Labels are resolved per-language from the dictionary. */
const ABOUT_FIELDS: readonly { key: AboutKey; multiline: boolean }[] = [
  { key: 'eyebrow', multiline: false },
  { key: 'heading', multiline: false },
  { key: 'intro', multiline: true },
  { key: 'galleryTitle', multiline: false },
  { key: 'cutsTitle', multiline: false },
  { key: 'stylistsTitle', multiline: false },
  { key: 'reviewsTitle', multiline: false },
]

const LANGS: readonly Lang[] = ['sv', 'en']

/** A `(key,lang)` -> value map for fast lookup + local edits. */
type CellMap = Map<string, string>
const cellKey = (key: AboutKey, lang: Lang): string => `${key}:${lang}`

export function AboutView(props: AboutViewProps): JSX.Element {
  const { s, lang } = props
  const t = adminText(lang)
  return (
    <>
      <AboutTextEditor s={s} lang={lang} />
      <GalleryManager
        dark={props.dark}
        s={s}
        lang={lang}
        kind="salon"
        title={t.aboutGallerySalonTitle}
      />
      <GalleryManager
        dark={props.dark}
        s={s}
        lang={lang}
        kind="cuts"
        title={t.aboutGalleryCutsTitle}
      />
    </>
  )
}

// --- About text -----------------------------------------------------------------------------------

function AboutTextEditor(props: {
  readonly s: AdminStylesBundle
  readonly lang: Lang
}): JSX.Element {
  const { s, lang } = props
  const t = adminText(lang)
  const [cells, setCells] = useState<CellMap>(new Map())
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [savedKey, setSavedKey] = useState<string | null>(null)
  const [errorFor, setErrorFor] = useState<{ key: string; message: string } | null>(null)
  const editGeneration = useRef(new Map<string, number>())

  useEffect(() => {
    let active = true
    void (async () => {
      const result = await listAbout()
      if (!active) return
      if (!result.ok) {
        setLoadError(result.error.message)
        setLoaded(true)
        return
      }
      const map: CellMap = new Map()
      for (const row of result.value) map.set(cellKey(row.key, row.lang), row.value)
      setCells(map)
      setLoaded(true)
    })()
    return () => {
      active = false
    }
  }, [])

  const valueFor = (key: AboutKey, lang: Lang): string => cells.get(cellKey(key, lang)) ?? ''

  const setValue = (key: AboutKey, lang: Lang, value: string): void => {
    const ck = cellKey(key, lang)
    editGeneration.current.set(ck, (editGeneration.current.get(ck) ?? 0) + 1)
    setCells((prev) => {
      const next = new Map(prev)
      next.set(ck, value)
      return next
    })
    setSavedKey(null)
    setErrorFor(null)
  }

  const save = async (key: AboutKey, lang: Lang): Promise<void> => {
    const ck = cellKey(key, lang)
    const generation = editGeneration.current.get(ck) ?? 0
    setSavingKey(ck)
    setErrorFor(null)
    const result = await saveAbout(key, lang, valueFor(key, lang))
    setSavingKey(null)
    if (!result.ok) {
      if ((editGeneration.current.get(ck) ?? 0) === generation) {
        setErrorFor({ key: ck, message: result.error.message })
      }
      return
    }
    if ((editGeneration.current.get(ck) ?? 0) !== generation) return
    setSavedKey(ck)
  }

  const fieldLabels: Record<AboutKey, string> = {
    eyebrow: t.aboutFieldEyebrow,
    heading: t.aboutFieldHeading,
    intro: t.aboutFieldIntro,
    galleryTitle: t.aboutFieldGalleryTitle,
    cutsTitle: t.aboutFieldCutsTitle,
    stylistsTitle: t.aboutFieldStylistsTitle,
    reviewsTitle: t.aboutFieldReviewsTitle,
  }

  return (
    <section style={s.card} aria-labelledby="about-heading">
      <h2 id="about-heading" style={s.sectionTitle}>
        {t.aboutTextTitle}
      </h2>
      <p style={s.sectionLead}>{t.aboutTextLead}</p>

      {loadError !== null ? (
        <div style={{ ...s.emptyState, color: s.errorText.color }}>{loadError}</div>
      ) : !loaded ? (
        <div style={s.emptyState}>{t.aboutLoading}</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginTop: '12px' }}>
          {ABOUT_FIELDS.map((field) => (
            <div key={field.key}>
              <h3 style={{ ...s.label, fontSize: '13px' }}>{fieldLabels[field.key]}</h3>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))',
                  gap: '12px',
                }}
              >
                {LANGS.map((cellLang) => {
                  const ck = cellKey(field.key, cellLang)
                  return (
                    <div key={ck}>
                      <label style={s.label} htmlFor={`about-${ck}`}>
                        {cellLang === 'sv' ? t.aboutLangSwedish : t.aboutLangEnglish}
                      </label>
                      {field.multiline ? (
                        <textarea
                          id={`about-${ck}`}
                          style={s.textarea}
                          maxLength={2000}
                          value={valueFor(field.key, cellLang)}
                          onInput={(e) => setValue(field.key, cellLang, e.currentTarget.value)}
                        />
                      ) : (
                        <input
                          id={`about-${ck}`}
                          style={s.input}
                          maxLength={2000}
                          value={valueFor(field.key, cellLang)}
                          onInput={(e) => setValue(field.key, cellLang, e.currentTarget.value)}
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
                          onClick={() => void save(field.key, cellLang)}
                          disabled={savingKey !== null}
                        >
                          {savingKey === ck ? t.aboutSaving : t.aboutSave}
                        </button>
                        <span aria-live="polite">
                          {savedKey === ck ? (
                            <span style={s.successText}>{t.aboutSaved}</span>
                          ) : null}
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
      )}
    </section>
  )
}

// --- Gallery --------------------------------------------------------------------------------------

function GalleryManager(props: {
  readonly dark: boolean
  readonly s: AdminStylesBundle
  readonly lang: Lang
  readonly kind: GalleryKind
  readonly title: string
}): JSX.Element {
  const { s, kind, lang } = props
  const t = adminText(lang)
  const [images, setImages] = useState<readonly GalleryImage[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [alt, setAlt] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<GalleryImage | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const altGeneration = useRef(0)

  const reload = async (): Promise<void> => {
    const result = await listGallery(kind)
    if (result.ok) {
      setImages(result.value)
      setLoadError(null)
    } else {
      setLoadError(result.error.message)
    }
    setLoaded(true)
  }

  useEffect(() => {
    void reload()
    // Only `kind` is fixed per instance; reload is intentionally run once on mount.
  }, [])

  const onUpload = async (file: File): Promise<void> => {
    const generation = altGeneration.current
    setBusy(true)
    setNotice(null)
    const nextSort = images.length === 0 ? 0 : Math.max(...images.map((i) => i.sortOrder)) + 1
    const result = await uploadImage(kind, file, alt.trim(), nextSort)
    setBusy(false)
    if (fileRef.current !== null) fileRef.current.value = ''
    if (!result.ok) {
      setNotice({ kind: 'err', text: result.error.message })
      return
    }
    if (altGeneration.current === generation) setAlt('')
    setNotice({ kind: 'ok', text: t.aboutGalleryUploadedOk })
    setImages((prev) => [...prev, result.value])
  }

  const onDelete = async (): Promise<void> => {
    const target = pendingDelete
    if (target === null) return
    setDeleteBusy(true)
    const result = await deleteImage(target)
    setDeleteBusy(false)
    setPendingDelete(null)
    if (!result.ok) {
      setNotice({ kind: 'err', text: result.error.message })
      return
    }
    setNotice({
      kind: 'ok',
      text: result.value.pending ? t.aboutGalleryDeletionPending : t.aboutGalleryDeletedOk,
    })
    setImages((prev) => prev.filter((i) => i.id !== target.id))
  }

  return (
    <section style={s.card} aria-labelledby={`gallery-${kind}`}>
      <h2 id={`gallery-${kind}`} style={s.sectionTitle}>
        {props.title}
      </h2>
      <p style={s.sectionLead}>{t.aboutGalleryLead}</p>

      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'flex-end',
          gap: '12px',
          margin: '14px 0 6px',
        }}
      >
        <div style={{ flex: '1 1 220px', minWidth: '180px' }}>
          <label htmlFor={`alt-${kind}`} style={s.label}>
            {t.aboutGalleryAltLabel}
          </label>
          <input
            id={`alt-${kind}`}
            type="text"
            style={s.input}
            maxLength={2000}
            value={alt}
            onInput={(e) => {
              altGeneration.current += 1
              setAlt(e.currentTarget.value)
            }}
          />
        </div>
        <div>
          <label htmlFor={`file-${kind}`} style={s.label}>
            {t.aboutGalleryFileLabel}
          </label>
          <input
            ref={fileRef}
            id={`file-${kind}`}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif"
            style={{ ...s.input, padding: '7px' }}
            disabled={busy}
            onChange={(e) => {
              const file = e.currentTarget.files?.[0]
              if (file !== undefined) void onUpload(file)
            }}
          />
        </div>
      </div>

      <div aria-live="polite" style={{ minHeight: '18px', marginBottom: '8px' }}>
        {busy ? <span style={s.mutedText}>{t.aboutGalleryUploading}</span> : null}
        {notice !== null ? (
          <span style={notice.kind === 'ok' ? s.successText : s.errorText}>{notice.text}</span>
        ) : null}
      </div>

      {loadError !== null ? (
        <div style={{ ...s.emptyState, color: s.errorText.color }}>{loadError}</div>
      ) : !loaded ? (
        <div style={s.emptyState}>{t.aboutGalleryLoading}</div>
      ) : images.length === 0 ? (
        <div style={s.emptyState}>{t.aboutGalleryEmpty}</div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))',
            gap: '12px',
            marginTop: '8px',
          }}
        >
          {images.map((img) => (
            <figure
              key={img.id}
              style={{ margin: 0, border: s.card.border, borderRadius: '12px', overflow: 'hidden' }}
            >
              <img
                src={img.url}
                alt={img.alt}
                style={{
                  width: '100%',
                  aspectRatio: '1 / 1',
                  objectFit: 'cover',
                  display: 'block',
                }}
                loading="lazy"
              />
              <figcaption
                style={{
                  padding: '8px 10px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '6px',
                }}
              >
                <span style={{ fontSize: '12px', opacity: 0.7, wordBreak: 'break-word' }}>
                  {img.alt === '' ? '—' : img.alt}
                </span>
                <button type="button" style={s.dangerBtn} onClick={() => setPendingDelete(img)}>
                  {t.aboutGalleryRemove}
                </button>
              </figcaption>
            </figure>
          ))}
        </div>
      )}

      {pendingDelete !== null ? (
        <ConfirmDialog
          dark={props.dark}
          title={t.aboutGalleryDeleteTitle}
          body={t.aboutGalleryDeleteBody}
          confirmLabel={t.aboutGalleryRemove}
          cancelLabel={t.aboutGalleryDeleteCancel}
          danger
          busy={deleteBusy}
          onConfirm={() => void onDelete()}
          onClose={() => {
            if (!deleteBusy) setPendingDelete(null)
          }}
        />
      ) : null}
    </section>
  )
}

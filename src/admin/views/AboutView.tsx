// About view (OWNER only). Two parts:
//   1. "Om oss"-text — every editable about_content cell, per key, per language (SV/EN side by side).
//      Each cell saves independently (upsert) with its own saved/error state.
//   2. Gallery — manage the two galleries (salon / cuts): upload an image (Storage + row) and delete
//      one (row + object). Thumbnails use the public Storage URL.
// All writes are owner-only at the RLS / Storage-policy layer.
//
// Data effects isolated here; the forms/tables are otherwise pure. The public site still renders the
// i18n constants (wiring the DB into the public About is §5, out of scope) — this edits the source of
// truth for that future migration.

import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { Lang } from '../../i18n/index'
import { listAbout, saveAbout } from '../adapters/aboutAdmin'
import { deleteImage, listGallery, uploadImage } from '../adapters/galleryAdmin'
import { ConfirmDialog } from '../ConfirmDialog'
import type { AboutKey, AdminStylesBundle, GalleryImage, GalleryKind } from './viewTypes'

export interface AboutViewProps {
  readonly dark: boolean
  readonly s: AdminStylesBundle
}

/** The 7 editable keys, in display order, with a human label. */
const ABOUT_FIELDS: readonly { key: AboutKey; label: string; multiline: boolean }[] = [
  { key: 'eyebrow', label: 'Etikett (eyebrow)', multiline: false },
  { key: 'heading', label: 'Rubrik', multiline: false },
  { key: 'intro', label: 'Intro', multiline: true },
  { key: 'galleryTitle', label: 'Galleri-titel (salong)', multiline: false },
  { key: 'cutsTitle', label: 'Galleri-titel (klippningar)', multiline: false },
  { key: 'stylistsTitle', label: 'Barberar-titel', multiline: false },
  { key: 'reviewsTitle', label: 'Omdömen-titel', multiline: false },
]

const LANGS: readonly Lang[] = ['sv', 'en']

/** A `(key,lang)` -> value map for fast lookup + local edits. */
type CellMap = Map<string, string>
const cellKey = (key: AboutKey, lang: Lang): string => `${key}:${lang}`

export function AboutView(props: AboutViewProps): JSX.Element {
  const { s } = props
  return (
    <>
      <AboutTextEditor s={s} />
      <GalleryManager dark={props.dark} s={s} kind="salon" title="Galleri · I salongen" />
      <GalleryManager dark={props.dark} s={s} kind="cuts" title="Galleri · Jobb vi gjort" />
    </>
  )
}

// --- About text -----------------------------------------------------------------------------------

function AboutTextEditor(props: { readonly s: AdminStylesBundle }): JSX.Element {
  const { s } = props
  const [cells, setCells] = useState<CellMap>(new Map())
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [savedKey, setSavedKey] = useState<string | null>(null)
  const [errorFor, setErrorFor] = useState<{ key: string; message: string } | null>(null)

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
    setCells((prev) => {
      const next = new Map(prev)
      next.set(cellKey(key, lang), value)
      return next
    })
    setSavedKey(null)
    setErrorFor(null)
  }

  const save = async (key: AboutKey, lang: Lang): Promise<void> => {
    const ck = cellKey(key, lang)
    setSavingKey(ck)
    setErrorFor(null)
    const result = await saveAbout(key, lang, valueFor(key, lang))
    setSavingKey(null)
    if (!result.ok) {
      setErrorFor({ key: ck, message: result.error.message })
      return
    }
    setSavedKey(ck)
  }

  return (
    <section style={s.card} aria-labelledby="about-heading">
      <h2 id="about-heading" style={s.sectionTitle}>
        Om oss · text
      </h2>
      <p style={s.sectionLead}>
        Redigera sektionstexterna på svenska och engelska. Varje fält sparas för sig.
      </p>

      {loadError !== null ? (
        <div style={{ ...s.emptyState, color: s.errorText.color }}>{loadError}</div>
      ) : !loaded ? (
        <div style={s.emptyState}>Laddar innehåll …</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', marginTop: '12px' }}>
          {ABOUT_FIELDS.map((field) => (
            <div key={field.key}>
              <h3 style={{ ...s.label, fontSize: '13px' }}>{field.label}</h3>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))',
                  gap: '12px',
                }}
              >
                {LANGS.map((lang) => {
                  const ck = cellKey(field.key, lang)
                  return (
                    <div key={ck}>
                      <label style={s.label} htmlFor={`about-${ck}`}>
                        {lang === 'sv' ? 'Svenska' : 'Engelska'}
                      </label>
                      {field.multiline ? (
                        <textarea
                          id={`about-${ck}`}
                          style={s.textarea}
                          maxLength={2000}
                          value={valueFor(field.key, lang)}
                          onInput={(e) => setValue(field.key, lang, e.currentTarget.value)}
                        />
                      ) : (
                        <input
                          id={`about-${ck}`}
                          style={s.input}
                          maxLength={2000}
                          value={valueFor(field.key, lang)}
                          onInput={(e) => setValue(field.key, lang, e.currentTarget.value)}
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
                          onClick={() => void save(field.key, lang)}
                          disabled={savingKey === ck}
                        >
                          {savingKey === ck ? 'Sparar …' : 'Spara'}
                        </button>
                        <span aria-live="polite">
                          {savedKey === ck ? <span style={s.successText}>Sparat</span> : null}
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
  readonly kind: GalleryKind
  readonly title: string
}): JSX.Element {
  const { s, kind } = props
  const [images, setImages] = useState<readonly GalleryImage[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [alt, setAlt] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [pendingDelete, setPendingDelete] = useState<GalleryImage | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

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
    setAlt('')
    setNotice({ kind: 'ok', text: 'Bild uppladdad.' })
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
    setNotice({ kind: 'ok', text: 'Bild borttagen.' })
    setImages((prev) => prev.filter((i) => i.id !== target.id))
  }

  return (
    <section style={s.card} aria-labelledby={`gallery-${kind}`}>
      <h2 id={`gallery-${kind}`} style={s.sectionTitle}>
        {props.title}
      </h2>
      <p style={s.sectionLead}>
        Ladda upp bilder till galleriet och ta bort dem du inte vill visa.
      </p>

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
            Alt-text (beskrivning)
          </label>
          <input
            id={`alt-${kind}`}
            type="text"
            style={s.input}
            value={alt}
            onInput={(e) => setAlt(e.currentTarget.value)}
          />
        </div>
        <div>
          <label htmlFor={`file-${kind}`} style={s.label}>
            Bildfil
          </label>
          <input
            ref={fileRef}
            id={`file-${kind}`}
            type="file"
            accept="image/*"
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
        {busy ? <span style={s.mutedText}>Laddar upp …</span> : null}
        {notice !== null ? (
          <span style={notice.kind === 'ok' ? s.successText : s.errorText}>{notice.text}</span>
        ) : null}
      </div>

      {loadError !== null ? (
        <div style={{ ...s.emptyState, color: s.errorText.color }}>{loadError}</div>
      ) : !loaded ? (
        <div style={s.emptyState}>Laddar galleri …</div>
      ) : images.length === 0 ? (
        <div style={s.emptyState}>Inga bilder ännu.</div>
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
                  Ta bort
                </button>
              </figcaption>
            </figure>
          ))}
        </div>
      )}

      {pendingDelete !== null ? (
        <ConfirmDialog
          dark={props.dark}
          title="Ta bort bilden?"
          body="Bilden tas bort från galleriet och lagringen. Detta går inte att ångra."
          confirmLabel="Ta bort"
          cancelLabel="Avbryt"
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

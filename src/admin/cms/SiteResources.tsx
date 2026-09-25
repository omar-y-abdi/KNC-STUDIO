import type { JSX } from 'preact'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import {
  siteResources,
  editSiteResource,
  replaceSiteResource,
} from '../../../shared/cms-site-resources'
import type { CmsAsset, CmsDocument, CmsLang } from '../../../shared/cms'
import { CMS_BUILT_ASSETS } from '../../../shared/cms-built-assets'
import { resourceReference } from '../../../shared/cms-markup'
import { SUPABASE_URL } from '../../backend/config'
import { BusinessPanel } from './DomainPanels'
import { CmsIcon } from './Icon'

interface Props {
  document: CmsDocument
  assets: CmsAsset[]
  onDocument: (
    update: CmsDocument | ((current: CmsDocument) => CmsDocument),
  ) => void | Promise<void>
  onError: (message: string) => void
}
const storageOrigin = SUPABASE_URL ?? 'https://unconfigured.invalid'
const policy = {
  siteOrigin: window.location.origin,
  storageOrigin: new URL(storageOrigin).origin,
  builtAssets: CMS_BUILT_ASSETS,
}
const safeImage = (src: string): string | undefined => {
  if (!src) return undefined
  try {
    resourceReference(src, policy)
    return src
  } catch {
    return undefined
  }
}

/** Source-owned graphics and functional controls are not fake uploaded files. */
export function SiteResources(props: Props): JSX.Element {
  const [lang, setLang] = useState<CmsLang>('sv')
  const [selected, setSelected] = useState('')
  const [query, setQuery] = useState('')
  const [description, setDescription] = useState('')
  const [texts, setTexts] = useState<string[]>([])
  const [replacement, setReplacement] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const pending = useRef(false)
  const latest = useRef(props)
  latest.current = props
  const entries = useMemo(() => siteResources(props.document, lang), [props.document, lang])
  const current = entries.find((entry) => entry.key === selected)
  useEffect(() => {
    setDescription(current?.description ?? '')
    setTexts(current?.texts ?? [])
    setReplacement('')
    setNotice('')
  }, [selected, lang])
  const apply = async (change: (document: CmsDocument) => CmsDocument): Promise<void> => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    try {
      await latest.current.onDocument(change)
      setNotice('Komponenten är uppdaterad i utkastet. Publicera för att visa ändringen.')
    } catch (error) {
      latest.current.onError(
        error instanceof Error ? error.message : 'Komponenten kunde inte ändras.',
      )
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  return (
    <section class="cms-resource-surface cms-site-resources" aria-busy={busy}>
      <header class="cms-resource-toolbar">
        <input
          type="search"
          aria-label="Sök komponenter"
          placeholder="Logotyp, telefon, språk…"
          value={query}
          onInput={(e) => setQuery(e.currentTarget.value)}
        />
        <label>
          Språk{' '}
          <select
            aria-label="Komponentspråk"
            value={lang}
            onChange={(e) => setLang(e.currentTarget.value as CmsLang)}
          >
            <option value="sv">Svenska</option>
            <option value="en">English</option>
          </select>
        </label>
      </header>
      <div class="cms-resource-body">
        <div class="cms-resource-grid">
          {entries
            .filter((entry) =>
              `${entry.label} ${entry.pageName}`
                .toLocaleLowerCase()
                .includes(query.toLocaleLowerCase()),
            )
            .map((entry) => (
              <article
                key={entry.key}
                class={`cms-resource-card${entry.key === selected ? ' is-selected' : ''}`}
              >
                <button
                  type="button"
                  aria-label={`${entry.label} · ${entry.pageName}`}
                  onClick={() => setSelected(entry.key)}
                >
                  {safeImage(entry.src) ? (
                    <img src={safeImage(entry.src)} alt="" />
                  ) : (
                    <span class="cms-site-resource-symbol">
                      <CmsIcon name={entry.tag === 'button' ? 'sliders' : 'image'} />
                      {entry.texts[0] && <span>{entry.texts[0]}</span>}
                    </span>
                  )}
                  <strong>{entry.label}</strong>
                  <small>
                    {entry.pageName} · {entry.tag.toUpperCase()}
                  </small>
                </button>
              </article>
            ))}
          {!entries.length && (
            <p>
              Inga komponenter finns i sidutkastet ännu. Öppna Startsida för att läsa in
              webbplatsen.
            </p>
          )}
        </div>
        <aside class="cms-resource-detail">
          {current ? (
            <>
              <h2>{current.label}</h2>
              <p>{current.pageName}</p>
              <label>
                Beskrivning
                <input
                  value={description}
                  maxLength={160}
                  onInput={(e) => setDescription(e.currentTarget.value)}
                />
              </label>
              {texts.map((value, i) => (
                <label key={i}>
                  Logotyptext {i + 1}
                  <input
                    value={value}
                    maxLength={400}
                    onInput={(e) =>
                      setTexts((values) =>
                        values.map((v, j) => (j === i ? e.currentTarget.value : v)),
                      )
                    }
                  />
                </label>
              ))}
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void apply((doc) => editSiteResource(doc, current, lang, description, texts))
                }
              >
                Spara komponent
              </button>
              {current.replaceable ? (
                <>
                  <label>
                    Ersätt med bild
                    <select
                      value={replacement}
                      onChange={(e) => setReplacement(e.currentTarget.value)}
                    >
                      <option value="">Välj ur biblioteket…</option>
                      {props.assets
                        .filter((a) => a.mime === 'image/webp' && !a.archived && !a.trashed_at)
                        .map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.name}
                          </option>
                        ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    disabled={busy || !replacement}
                    onClick={() => {
                      const asset = latest.current.assets.find((a) => a.id === replacement)
                      if (asset)
                        void apply((doc) => replaceSiteResource(doc, current, asset, storageOrigin))
                    }}
                  >
                    Ersätt komponentbild
                  </button>
                  <p>Bildbytet gäller båda språken. Knappens eller länkens funktion behålls.</p>
                </>
              ) : (
                <p>
                  Detta är en funktionell kontroll. Beskrivningen kan ändras utan att dess handling
                  försvinner.
                </p>
              )}
              {notice && <p role="status">{notice}</p>}
            </>
          ) : (
            <>
              <h2>Webbplatsens komponenter</h2>
              <p>
                Välj en befintlig logotyp, ikon eller kontroll. Ändringar sparas i utkastet, inte
                direkt på webbplatsen.
              </p>
            </>
          )}
        </aside>
      </div>
      <details class="cms-site-resource-section">
        <summary>Kontakt & karta</summary>
        <p>Telefon, adress och kartlänk delar webbplatsens företagsuppgifter.</p>
        <BusinessPanel document={props.document} onChange={(next) => void apply(() => next)} />
      </details>
      <details class="cms-site-resource-section">
        <summary>Inbyggda filer</summary>
        <p>
          Dessa filer levereras med webbplatsen. Ersätt deras placeringar ovan; originalen ligger
          kvar.
        </p>
        <ul>
          {CMS_BUILT_ASSETS.map((path) => (
            <li key={path}>
              <code>{path}</code>
            </li>
          ))}
        </ul>
      </details>
    </section>
  )
}

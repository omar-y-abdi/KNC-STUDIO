import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import type { CmsDocument, CmsLang, CmsMode, CmsRevision } from '../../../shared/cms'
import { mediaUrl } from '../../../shared/cms'
import { SUPABASE_URL } from '../../backend/config'
import { cmsApi } from './api'
import { CmsModal } from './Modal'
import { LivePreview } from './LivePreview'

export function HistoryPanel({
  history,
  revision,
  lang,
  mode,
  onRestore,
  onError,
}: {
  history: CmsRevision[]
  revision: number
  lang: CmsLang
  mode: CmsMode
  onRestore: (document: CmsDocument) => void
  onError: (message: string) => void
}): JSX.Element {
  const [review, setReview] = useState<{ revision: number; document: CmsDocument } | null>(null)
  const [path, setPath] = useState('/')
  const [busy, setBusy] = useState<number | null>(null)
  const request = useRef(0)
  useEffect(
    () => () => {
      request.current++
    },
    [],
  )
  const read = async (value: number, restore: boolean): Promise<void> => {
    const id = ++request.current
    setBusy(value)
    try {
      const old = await cmsApi.revision(value)
      if (request.current !== id) return
      if (restore) onRestore(old.document)
      else {
        setPath('/')
        setReview({ revision: value, document: old.document })
      }
    } catch (reason) {
      if (request.current === id)
        onError(reason instanceof Error ? reason.message : 'Versionen kunde inte läsas.')
    } finally {
      if (request.current === id) setBusy(null)
    }
  }
  const page =
    review?.document.presentation.pages.find((item) => item.path === path) ??
    review?.document.presentation.pages[0]
  return (
    <>
      <div class="cms-history-list">
        {history.length === 0 && <p>Inga publicerade versioner ännu.</p>}
        {history.map((item) => (
          <div class="cms-history-row">
            <strong class={`cms-version-badge${item.revision === revision ? ' is-current' : ''}`}>
              v{item.revision}
            </strong>
            <span>
              <strong>
                {item.revision === revision ? 'Publicerad just nu' : `Version ${item.revision}`}
              </strong>
              <small>
                {new Date(item.created_at).toLocaleString('sv-SE', {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </small>
              <small>{item.summary}</small>
            </span>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void read(item.revision, false)}
            >
              {busy === item.revision ? 'Läser…' : 'Granska'}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void read(item.revision, true)}
            >
              Återställ till utkast
            </button>
          </div>
        ))}
      </div>
      {review && (
        <CmsModal
          wide
          title={`Granska version ${review.revision}`}
          onClose={() => setReview(null)}
          footer={
            <>
              <span>Granskning ändrar ingenting på webbplatsen.</span>
              <button type="button" class="cms-primary" onClick={() => onRestore(review.document)}>
                Återställ till utkast
              </button>
            </>
          }
        >
          <label class="cms-history-page-select">
            Sida{' '}
            <select value={path} onChange={(event) => setPath(event.currentTarget.value)}>
              {review.document.presentation.pages.map((item) => (
                <option value={item.path}>{item.name[lang]}</option>
              ))}
            </select>
          </label>
          {page ? (
            <div class="cms-history-preview">
              <LivePreview
                page={page}
                presentation={review.document.presentation}
                lang={lang}
                mode={mode}
                device="Desktop"
                fontCss={Object.entries(review.document.presentation.fonts ?? {})
                  .map(
                    ([id, font]) =>
                      `@font-face{font-family:"CMSFont-${id}";src:url("${mediaUrl(font.ref, SUPABASE_URL ?? '')}") format("woff2");font-display:swap}`,
                  )
                  .join('\n')}
                onNavigate={setPath}
              />
            </div>
          ) : (
            <p>
              Den här versionen saknar sidinnehåll. Företagsuppgifter och mejl kan fortfarande
              återställas.
            </p>
          )}
        </CmsModal>
      )}
    </>
  )
}

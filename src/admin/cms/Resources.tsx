import type { JSX } from 'preact'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { CmsAsset, CmsDocument } from '../../../shared/cms'
import { mediaUrl } from '../../../shared/cms'
import { replaceDocumentResource, resourceUsage } from '../../../shared/cms-resources'
import { CMS_BUILT_ASSETS } from '../../../shared/cms-built-assets'
import { SUPABASE_URL } from '../../backend/config'
import { cmsApi, type AssetUsage } from './api'

type State = 'active' | 'archived' | 'trash'
type Purpose = 'library' | 'salon' | 'cuts' | 'logo' | 'profile'

const storageOrigin = SUPABASE_URL ?? 'https://unconfigured.invalid'
const policy = {
  siteOrigin: window.location.origin,
  storageOrigin: new URL(storageOrigin).origin,
  builtAssets: CMS_BUILT_ASSETS,
}

function stateOf(asset: CmsAsset): State {
  if (asset.trashed_at) return 'trash'
  return asset.archived ? 'archived' : 'active'
}

function purposeOf(asset: CmsAsset): { purpose: Purpose; barberId?: string } {
  if (asset.bucket === 'barber-photos') {
    const barberId = asset.path.split('/')[0]
    return barberId ? { purpose: 'profile', barberId } : { purpose: 'profile' }
  }
  if (asset.bucket === 'gallery') {
    if (asset.path.startsWith('salon/')) return { purpose: 'salon' }
    if (asset.path.startsWith('cuts/')) return { purpose: 'cuts' }
    if (asset.path.startsWith('logo/')) return { purpose: 'logo' }
  }
  return { purpose: 'library' }
}

interface Props {
  assets: CmsAsset[]
  document: CmsDocument
  onAssets: (assets: CmsAsset[]) => void
  onDocument: (document: CmsDocument) => void
  onError: (message: string) => void
}

export function CmsResources(props: Props): JSX.Element {
  const [state, setState] = useState<State>('active')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [usage, setUsage] = useState<AssetUsage | null>(null)
  const [purpose, setPurpose] = useState<Purpose>('library')
  const [barberId, setBarberId] = useState(props.document.barbers[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const upload = useRef<HTMLInputElement>(null)
  const replace = useRef<HTMLInputElement>(null)
  const asset = props.assets.find((item) => item.id === selectedId) ?? null
  const visible = useMemo(
    () =>
      props.assets.filter(
        (item) =>
          stateOf(item) === state &&
          `${item.name} ${item.alt} ${item.mime}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [props.assets, query, state],
  )

  useEffect(() => {
    if (!asset) return setUsage(null)
    let active = true
    void cmsApi
      .assetUsage(asset.id)
      .then((value) => active && setUsage(value))
      .catch(
        (reason) =>
          active &&
          props.onError(
            reason instanceof Error ? reason.message : 'Referenserna kunde inte läsas.',
          ),
      )
    return () => {
      active = false
    }
  }, [asset?.id, asset?.version])

  const updateAsset = (next: CmsAsset): void =>
    props.onAssets(props.assets.map((item) => (item.id === next.id ? next : item)))

  const transition = async (
    target: CmsAsset,
    action: 'archive' | 'restore' | 'trash' | 'delete',
  ): Promise<void> => {
    setBusy(true)
    try {
      const result = await cmsApi.assetLifecycle(target, action)
      if (action === 'delete') {
        props.onAssets(props.assets.filter((item) => item.id !== target.id))
        if (selectedId === target.id) setSelectedId(null)
      } else if (result.asset) updateAsset(result.asset)
      setUsage(result.usage ?? null)
    } catch (reason) {
      props.onError(reason instanceof Error ? reason.message : 'Resursåtgärden misslyckades.')
    } finally {
      setBusy(false)
    }
  }

  const uploadFile = async (file: File, replacement?: CmsAsset): Promise<void> => {
    setBusy(true)
    try {
      const target = replacement
        ? purposeOf(replacement)
        : { purpose, ...(purpose === 'profile' ? { barberId } : {}) }
      const nextAsset = await cmsApi.uploadAsset(file, target.purpose, target.barberId)
      props.onAssets([nextAsset, ...props.assets])
      setSelectedId(nextAsset.id)
      if (replacement) {
        const nextDocument = structuredClone(props.document)
        replaceDocumentResource(nextDocument, replacement, nextAsset, policy)
        props.onDocument(nextDocument)
      }
    } catch (reason) {
      props.onError(reason instanceof Error ? reason.message : 'Filen kunde inte laddas upp.')
    } finally {
      setBusy(false)
    }
  }

  const saveMetadata = async (): Promise<void> => {
    if (!asset) return
    setBusy(true)
    try {
      const next = await cmsApi.asset(asset)
      updateAsset(next)
    } catch (reason) {
      props.onError(reason instanceof Error ? reason.message : 'Metadata kunde inte sparas.')
    } finally {
      setBusy(false)
    }
  }

  const bulk = async (action: 'archive' | 'restore' | 'trash'): Promise<void> => {
    for (const id of selectedIds) {
      const target = props.assets.find((item) => item.id === id)
      if (target) await transition(target, action)
    }
    setSelectedIds(new Set())
  }

  const draftUsage = asset ? resourceUsage(props.document, asset, policy) : []
  return (
    <div class="cms-resource-surface">
      <header class="cms-resource-toolbar">
        <div class="cms-segment">
          {(['active', 'archived', 'trash'] as const).map((value) => (
            <button type="button" aria-pressed={state === value} onClick={() => setState(value)}>
              {value === 'active' ? 'Aktiva' : value === 'archived' ? 'Arkiverade' : 'Papperskorg'}
            </button>
          ))}
        </div>
        <input
          type="search"
          placeholder="Sök resurser"
          value={query}
          onInput={(event) => setQuery(event.currentTarget.value)}
        />
        <select
          value={purpose}
          onChange={(event) => setPurpose(event.currentTarget.value as Purpose)}
        >
          <option value="library">Bibliotek / WOFF2</option>
          <option value="salon">Salongsgalleri</option>
          <option value="cuts">Klippgalleri</option>
          <option value="logo">Logotyp</option>
          <option value="profile">Profilbild</option>
        </select>
        {purpose === 'profile' && (
          <select value={barberId} onChange={(event) => setBarberId(event.currentTarget.value)}>
            {props.document.barbers.map((barber) => (
              <option value={barber.id}>{barber.name}</option>
            ))}
          </select>
        )}
        <button type="button" disabled={busy} onClick={() => upload.current?.click()}>
          + Ladda upp
        </button>
        <input
          ref={upload}
          type="file"
          accept="image/*,.woff2,font/woff2"
          hidden
          onChange={(event) => {
            const file = event.currentTarget.files?.[0]
            if (file) void uploadFile(file)
            event.currentTarget.value = ''
          }}
        />
      </header>
      {selectedIds.size > 0 && (
        <div class="cms-resource-bulk">
          <strong>{selectedIds.size} valda</strong>
          {state === 'active' && (
            <button type="button" onClick={() => void bulk('archive')}>
              Arkivera valda
            </button>
          )}
          {state !== 'active' && (
            <button type="button" onClick={() => void bulk('restore')}>
              Återställ valda
            </button>
          )}
          {state !== 'trash' && (
            <button type="button" onClick={() => void bulk('trash')}>
              Till papperskorg
            </button>
          )}
          <button type="button" onClick={() => setSelectedIds(new Set())}>
            Rensa val
          </button>
        </div>
      )}
      <div class="cms-resource-body">
        <div class="cms-resource-grid">
          {visible.map((item) => {
            const checked = selectedIds.has(item.id)
            return (
              <article class={`cms-resource-card${item.id === selectedId ? ' is-selected' : ''}`}>
                <label class="cms-resource-check">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => {
                      const next = new Set(selectedIds)
                      if (checked) next.delete(item.id)
                      else next.add(item.id)
                      setSelectedIds(next)
                    }}
                  />
                </label>
                <button type="button" onClick={() => setSelectedId(item.id)}>
                  {item.mime.startsWith('image/') ? (
                    <img src={mediaUrl(item, storageOrigin)} alt={item.alt} />
                  ) : (
                    <span class="cms-font-preview">Aa</span>
                  )}
                  <strong>{item.name}</strong>
                  <small>{item.mime}</small>
                </button>
              </article>
            )
          })}
        </div>
        {asset && (
          <aside class="cms-resource-detail">
            <h2>{asset.name}</h2>
            <label>
              Namn
              <input
                value={asset.name}
                onInput={(event) => updateAsset({ ...asset, name: event.currentTarget.value })}
              />
            </label>
            <label>
              Alternativtext
              <textarea
                value={asset.alt}
                onInput={(event) => updateAsset({ ...asset, alt: event.currentTarget.value })}
              />
            </label>
            <p>
              {asset.width && asset.height ? `${asset.width} × ${asset.height} · ` : ''}
              {(asset.bytes / 1024).toFixed(1)} KB · v{asset.version}
            </p>
            <p>
              Utkast: {draftUsage.length} placeringar · Publicerat:{' '}
              {usage?.currentReferences ?? '…'} · Historik: {usage?.historyReferences ?? '…'}
            </p>
            {draftUsage.length > 0 && (
              <ul>
                {draftUsage.map((place) => (
                  <li>{place}</li>
                ))}
              </ul>
            )}
            <button
              type="button"
              disabled={busy || !asset.name.trim()}
              onClick={() => void saveMetadata()}
            >
              Spara metadata
            </button>
            <button type="button" disabled={busy} onClick={() => replace.current?.click()}>
              Ersätt fil immutabelt
            </button>
            <input
              ref={replace}
              type="file"
              accept={asset.mime === 'font/woff2' ? '.woff2,font/woff2' : 'image/*'}
              hidden
              onChange={(event) => {
                const file = event.currentTarget.files?.[0]
                if (file) void uploadFile(file, asset)
                event.currentTarget.value = ''
              }}
            />
            {state === 'active' && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void transition(asset, 'archive')}
              >
                Arkivera
              </button>
            )}
            {state === 'archived' && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void transition(asset, 'restore')}
                >
                  Återställ
                </button>
                <button
                  type="button"
                  disabled={busy || (usage?.currentReferences ?? 1) > 0}
                  onClick={() => void transition(asset, 'trash')}
                >
                  Flytta till papperskorg
                </button>
              </>
            )}
            {state === 'trash' && (
              <>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void transition(asset, 'restore')}
                >
                  Återställ
                </button>
                <button
                  type="button"
                  disabled={
                    busy ||
                    (usage?.currentReferences ?? 1) > 0 ||
                    (usage?.historyReferences ?? 1) > 0
                  }
                  onClick={() => void transition(asset, 'delete')}
                >
                  Radera permanent
                </button>
              </>
            )}
          </aside>
        )}
      </div>
    </div>
  )
}

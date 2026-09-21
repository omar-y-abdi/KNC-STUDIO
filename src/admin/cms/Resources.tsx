import { CmsTextarea } from './Textarea'
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
  onAssets: (assets: CmsAsset[] | ((current: CmsAsset[]) => CmsAsset[])) => void
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
    if (!asset) {
      setUsage(null)
      return
    }
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
    props.onAssets((current) => current.map((item) => (item.id === next.id ? next : item)))

  const transition = async (
    target: CmsAsset,
    action: 'archive' | 'restore' | 'trash' | 'delete',
  ): Promise<void> => {
    setBusy(true)
    try {
      const result = await cmsApi.assetLifecycle(target, action)
      if (action === 'delete') {
        props.onAssets((current) => current.filter((item) => item.id !== target.id))
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
      props.onAssets((current) => [nextAsset, ...current])
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
    setBusy(true)
    const remaining = new Set(selectedIds)
    try {
      for (const id of selectedIds) {
        const target = props.assets.find((item) => item.id === id)
        if (!target) continue
        const result = await cmsApi.assetLifecycle(target, action)
        if (result.asset) updateAsset(result.asset)
        remaining.delete(id)
      }
    } catch (reason) {
      props.onError(
        reason instanceof Error
          ? reason.message
          : 'Resursåtgärden misslyckades. Kvarvarande filer är fortfarande markerade.',
      )
    } finally {
      setSelectedIds(remaining)
      setBusy(false)
    }
  }

  const draftUsage = asset ? resourceUsage(props.document, asset, policy) : []
  return (
    <div class="cms-resource-surface" aria-busy={busy}>
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
          aria-label="Sök resurser"
          placeholder="Sök resurser"
          value={query}
          onInput={(event) => setQuery(event.currentTarget.value)}
        />
        <select
          aria-label="Användning vid uppladdning"
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
          <select
            aria-label="Barberare för profilbild"
            value={barberId}
            onChange={(event) => setBarberId(event.currentTarget.value)}
          >
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
            <button type="button" disabled={busy} onClick={() => void bulk('archive')}>
              Arkivera valda
            </button>
          )}
          {state !== 'active' && (
            <button type="button" disabled={busy} onClick={() => void bulk('restore')}>
              Återställ valda
            </button>
          )}
          {state !== 'trash' && (
            <button type="button" disabled={busy} onClick={() => void bulk('trash')}>
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
          {visible.length === 0 && (
            <div class="cms-resource-empty">
              <strong>
                {query
                  ? 'Inga träffar'
                  : state === 'active'
                    ? 'Ditt bibliotek börjar här.'
                    : state === 'trash'
                      ? 'Papperskorgen är tom.'
                      : 'Inga arkiverade resurser.'}
              </strong>
              <p>
                {query
                  ? 'Prova ett annat namn eller filformat.'
                  : state === 'active'
                    ? 'Ladda upp bilder, logotyper eller typsnitt till webbplatsen.'
                    : 'Du kan gå tillbaka till Aktiva för att se dina filer.'}
              </p>
            </div>
          )}
          {visible.map((item) => {
            const checked = selectedIds.has(item.id)
            return (
              <article class={`cms-resource-card${item.id === selectedId ? ' is-selected' : ''}`}>
                <label class="cms-resource-check">
                  <input
                    type="checkbox"
                    aria-label={`Markera ${item.name}`}
                    disabled={busy}
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
                  <strong title={item.name}>{item.name.split('/').at(-1)}</strong>
                  <small>
                    {item.width && item.height ? `${item.width} × ${item.height} · ` : ''}
                    {item.mime.split('/')[1]?.toUpperCase()}
                  </small>
                </button>
              </article>
            )
          })}
        </div>
        {asset ? (
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
              <CmsTextarea
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
              Ersätt fil
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
        ) : (
          <aside class="cms-resource-detail">
            <h2>Resursdetaljer</h2>
            <p>
              Välj en bild eller ett typsnitt. Här hittar du namn, alternativtext och användning på
              webbplatsen.
            </p>
            <p>
              Uppladdade filer sparas direkt i biblioteket. Ändringar på sidor publiceras med Save /
              Publicera.
            </p>
          </aside>
        )}
      </div>
    </div>
  )
}

import { CmsTextarea } from './Textarea'
import type { JSX } from 'preact'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks'
import type { CmsAsset, CmsDocument } from '../../../shared/cms'
import { mediaUrl } from '../../../shared/cms'
import { replaceDocumentResource, resourceUsage } from '../../../shared/cms-resources'
import { CMS_BUILT_ASSETS } from '../../../shared/cms-built-assets'
import { SUPABASE_URL } from '../../backend/config'
import { cmsApi, type AssetUsage } from './api'
import { CmsIcon } from './Icon'
import { compactWorkspace } from './useResponsivePanels'

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

function resourceLabel(asset: CmsAsset): string {
  const filename = asset.name.split('/').at(-1) ?? asset.name
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,}\.[a-z0-9]+$/i.test(filename)) return filename
  const names = {
    library: 'Bild',
    salon: 'Salongsbild',
    cuts: 'Klippbild',
    logo: 'Logotyp',
    profile: 'Profilbild',
  }
  return asset.alt.trim() || `${names[purposeOf(asset).purpose]} · ${asset.id.slice(0, 4)}`
}

interface Props {
  assets: CmsAsset[]
  document: CmsDocument
  onAssets: (assets: CmsAsset[] | ((current: CmsAsset[]) => CmsAsset[])) => void
  onDocument: (update: CmsDocument | ((current: CmsDocument) => CmsDocument)) => void
  onError: (message: string) => void
}

export function CmsResources(props: Props): JSX.Element {
  const [state, setState] = useState<State>('active')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [usageResult, setUsageResult] = useState<{
    id: string
    version: number
    value: AssetUsage
  } | null>(null)
  const [purpose, setPurpose] = useState<Purpose>('library')
  const [barberId, setBarberId] = useState(props.document.barbers[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const latest = useRef(props)
  latest.current = props
  const detail = useRef<HTMLHeadingElement>(null)
  const selectedButton = useRef<HTMLButtonElement | null>(null)
  const upload = useRef<HTMLInputElement>(null)
  const replace = useRef<HTMLInputElement>(null)
  const asset = props.assets.find((item) => item.id === selectedId) ?? null
  const usage =
    asset && usageResult?.id === asset.id && usageResult.version === asset.version
      ? usageResult.value
      : null
  const visible = useMemo(
    () =>
      props.assets.filter(
        (item) =>
          stateOf(item) === state &&
          `${item.name} ${item.alt} ${item.mime}`.toLowerCase().includes(query.toLowerCase()),
      ),
    [props.assets, query, state],
  )

  useLayoutEffect(() => {
    if (selectedId && compactWorkspace()) {
      detail.current?.scrollIntoView({ block: 'start' })
      detail.current?.focus({ preventScroll: true })
    }
  }, [selectedId])

  useEffect(() => {
    setUsageResult(null)
    if (!asset) return
    let active = true
    void cmsApi
      .assetUsage(asset.id)
      .then((value) => active && setUsageResult({ id: asset.id, version: asset.version, value }))
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

  // State updates from async work must use the current owner draft, not the render
  // that started the request. The lock is synchronous; disabled buttons alone race.
  const perform = async (work: () => Promise<void>, fallback: string): Promise<void> => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    try {
      await work()
    } catch (reason) {
      latest.current.onError(reason instanceof Error ? reason.message : fallback)
    } finally {
      pending.current = false
      setBusy(false)
    }
  }

  const updateAsset = (id: string, patch: Partial<Pick<CmsAsset, 'name' | 'alt'>>): void =>
    latest.current.onAssets((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    )

  const acknowledgeAsset = (saved: CmsAsset, submitted?: CmsAsset): void =>
    latest.current.onAssets((current) =>
      current.map((item) => {
        if (item.id !== saved.id || item.version > saved.version) return item
        return {
          ...saved,
          // Lifecycle responses did not submit metadata. Metadata responses only
          // acknowledge fields which have not been edited again in the meantime.
          name: submitted && item.name === submitted.name ? saved.name : item.name,
          alt: submitted && item.alt === submitted.alt ? saved.alt : item.alt,
        }
      }),
    )

  const currentAsset = (id: string): CmsAsset => {
    const current = latest.current.assets.find((item) => item.id === id)
    if (!current) throw new Error('Resursen finns inte längre i biblioteket.')
    return current
  }

  const protectDraft = (target: CmsAsset): void => {
    // Parsing failures deliberately propagate: an unchecked draft is not unused.
    if (resourceUsage(latest.current.document, target, policy).length > 0)
      throw new Error('Resursen används i utkastet. Ersätt eller ta bort referenserna först.')
  }

  const transition = (
    target: CmsAsset,
    action: 'archive' | 'restore' | 'trash' | 'delete',
  ): Promise<void> =>
    perform(async () => {
      const submitted = currentAsset(target.id)
      if (action === 'trash' || action === 'delete') protectDraft(submitted)
      const result = await cmsApi.assetLifecycle(submitted, action)
      if (action === 'delete') {
        latest.current.onAssets((current) => current.filter((item) => item.id !== submitted.id))
        setSelectedId((current) => (current === submitted.id ? null : current))
        setSelectedIds((current) => new Set([...current].filter((id) => id !== submitted.id)))
      } else if (result.asset) acknowledgeAsset(result.asset)
      // Usage is fetched by asset ID/version. Never apply A's result to B's panel.
    }, 'Resursåtgärden misslyckades.')

  const uploadFile = (file: File, replacement?: CmsAsset): Promise<void> =>
    perform(async () => {
      const target = replacement
        ? purposeOf(replacement)
        : { purpose, ...(purpose === 'profile' ? { barberId } : {}) }
      const nextAsset = await cmsApi.uploadAsset(file, target.purpose, target.barberId)
      latest.current.onAssets((current) => [
        nextAsset,
        ...current.filter((item) => item.id !== nextAsset.id),
      ])
      if (replacement) {
        latest.current.onDocument((current) => {
          const next = structuredClone(current)
          replaceDocumentResource(next, replacement, nextAsset, policy)
          return next
        })
      }
      setSelectedId((current) => (current === selectedId ? nextAsset.id : current))
    }, 'Filen kunde inte laddas upp.')

  const saveMetadata = (): Promise<void> =>
    perform(async () => {
      if (!asset) return
      const submitted = currentAsset(asset.id)
      acknowledgeAsset(await cmsApi.asset(submitted), submitted)
    }, 'Metadata kunde inte sparas.')

  const bulk = (action: 'archive' | 'restore' | 'trash'): Promise<void> =>
    perform(async () => {
      const targets = [...selectedIds].map(currentAsset)
      // Preflight the entire selection before the first destructive write.
      if (action === 'trash') targets.forEach(protectDraft)
      const completed = new Set<string>()
      try {
        for (const target of targets) {
          const submitted = currentAsset(target.id)
          if (action === 'trash') protectDraft(submitted)
          const result = await cmsApi.assetLifecycle(submitted, action)
          if (result.asset) acknowledgeAsset(result.asset)
          completed.add(submitted.id)
        }
      } finally {
        setSelectedIds((current) => new Set([...current].filter((id) => !completed.has(id))))
      }
    }, 'Resursåtgärden misslyckades. Kvarvarande filer är fortfarande markerade.')

  const draftReferences = useMemo(() => {
    try {
      return { places: asset ? resourceUsage(props.document, asset, policy) : [], error: null }
    } catch (reason) {
      // A malformed local draft must not crash the library or look unreferenced.
      return {
        places: null,
        error: reason instanceof Error ? reason.message : 'Referenserna kunde inte läsas.',
      }
    }
  }, [props.document, asset?.bucket, asset?.path])
  return (
    <div class="cms-resource-surface" aria-busy={busy}>
      <header class="cms-resource-toolbar">
        <div class="cms-segment">
          {(['active', 'archived', 'trash'] as const).map((value) => (
            <button
              type="button"
              aria-pressed={state === value}
              onClick={() => {
                if (value === state) return
                setState(value)
                setSelectedId(null)
                setSelectedIds(new Set())
                setUsageResult(null)
              }}
            >
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
          <CmsIcon name="plus" /> Ladda upp
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
          <button type="button" disabled={busy} onClick={() => setSelectedIds(new Set())}>
            Rensa val
          </button>
        </div>
      )}
      <div class="cms-resource-body">
        <div class="cms-resource-grid">
          {visible.length === 0 && (
            <div class="cms-resource-empty">
              <CmsIcon name="image" />
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
              {query && (
                <button type="button" onClick={() => setQuery('')}>
                  Rensa sökning
                </button>
              )}
            </div>
          )}
          {visible.map((item) => {
            const checked = selectedIds.has(item.id)
            return (
              <article
                key={item.id}
                class={`cms-resource-card${item.id === selectedId ? ' is-selected' : ''}`}
              >
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
                <button
                  type="button"
                  onClick={(event) => {
                    selectedButton.current = event.currentTarget
                    setSelectedId(item.id)
                  }}
                >
                  {item.mime.startsWith('image/') ? (
                    <img src={mediaUrl(item, storageOrigin)} alt={item.alt} />
                  ) : (
                    <span class="cms-font-preview">Aa</span>
                  )}
                  <strong title={item.name}>{resourceLabel(item)}</strong>
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
            <button
              class="cms-resource-back"
              type="button"
              onClick={() => {
                setSelectedId(null)
                selectedButton.current?.focus()
              }}
            >
              <CmsIcon name="arrowLeft" /> Till biblioteket
            </button>
            <h2 ref={detail} tabIndex={-1}>
              {resourceLabel(asset)}
            </h2>
            <label>
              Namn
              <input
                value={asset.name}
                onInput={(event) => updateAsset(asset.id, { name: event.currentTarget.value })}
              />
            </label>
            <label>
              Alternativtext
              <CmsTextarea
                value={asset.alt}
                onInput={(event) => updateAsset(asset.id, { alt: event.currentTarget.value })}
              />
            </label>
            <p>
              {asset.width && asset.height ? `${asset.width} × ${asset.height} · ` : ''}
              {(asset.bytes / 1024).toFixed(1)} KB · v{asset.version}
            </p>
            <p>
              Utkast:{' '}
              {draftReferences.places
                ? `${draftReferences.places.length} placeringar`
                : 'ej kontrollerat'}{' '}
              · Publicerat: {usage?.currentReferences ?? '…'} · Historik:{' '}
              {usage?.historyReferences ?? '…'}
            </p>
            {draftReferences.error && (
              <p class="cms-inline-error" role="alert">
                Utkastets referenser kunde inte kontrolleras. Rätta sidans innehåll innan filer tas
                bort. {draftReferences.error}
              </p>
            )}
            {draftReferences.places && draftReferences.places.length > 0 && (
              <ul>
                {draftReferences.places.map((place) => (
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
            {stateOf(asset) === 'active' && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void transition(asset, 'archive')}
              >
                Arkivera
              </button>
            )}
            {stateOf(asset) === 'archived' && (
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
                    (draftReferences.places?.length ?? 1) > 0 ||
                    (usage?.currentReferences ?? 1) > 0
                  }
                  onClick={() => void transition(asset, 'trash')}
                >
                  Flytta till papperskorg
                </button>
              </>
            )}
            {stateOf(asset) === 'trash' && (
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
                    (draftReferences.places?.length ?? 1) > 0 ||
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
              Uppladdade filer sparas direkt i biblioteket. Ändringar på sidor publiceras med
              Publicera.
            </p>
          </aside>
        )}
      </div>
    </div>
  )
}

import type { JSX } from 'preact'
import { useEffect, useRef, useState } from 'preact/hooks'
import { mediaUrl, type CmsAsset, type CmsDocument } from '../../../shared/cms'
import { resourceUsage } from '../../../shared/cms-resources'
import { CMS_BUILT_ASSETS } from '../../../shared/cms-built-assets'
import { SUPABASE_URL } from '../../backend/config'
import { cmsApi, type CmsApi } from './api'
import { Field, Notice, Select } from './controls'

export type UploadPurpose = 'library' | 'salon' | 'cuts' | 'logo' | 'profile'
export function AssetLibrary({ assets, document, onAssets, choose, replace, purpose = 'library', barberId, api = cmsApi }: { assets: CmsAsset[]; document: CmsDocument; onAssets: (assets: CmsAsset[]) => void; choose?: (asset: CmsAsset) => void; replace?: (asset: CmsAsset) => void; purpose?: UploadPurpose; barberId?: string; api?: CmsApi }): JSX.Element {
  const [query, setQuery] = useState(''), [archived, setArchived] = useState(false), [kind, setKind] = useState('all')
  const [selected, setSelected] = useState<string | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [name, setName] = useState(''), [alt, setAlt] = useState('')
  const alive = useRef(true), input = useRef<HTMLInputElement>(null), latest = useRef(assets); latest.current = assets
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const asset = assets.find(item => item.id === selected)
  useEffect(() => { setName(asset?.name ?? ''); setAlt(asset?.alt ?? '') }, [asset?.id, asset?.version])
  const setAsset = (value: CmsAsset): void => onAssets([value, ...latest.current.filter(item => item.id !== value.id)])
  const upload = async (file: File): Promise<void> => {
    if (busy) return
    if (file.size > 5 * 1024 * 1024 || file.size === 0) { setError('Välj en fil större än 0 byte och högst 5 MiB.'); return }
    setBusy(true); setError('')
    try {
      const result = await api.upload(file, purpose, barberId)
      if (alive.current) { setAsset(result); setSelected(result.id); setArchived(false) }
    } catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : 'Uppladdningen misslyckades.') }
    finally { if (alive.current) { setBusy(false); if (input.current) input.current.value = '' } }
  }
  const save = async (archive: boolean): Promise<void> => {
    if (!asset || busy) return
    setBusy(true); setError('')
    try {
      const result = await api.asset({ ...asset, name, alt, archived: archive })
      if (alive.current) { setAsset(result); setArchived(archive) }
    } catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : 'Filuppgifterna kunde inte sparas.') }
    finally { if (alive.current) setBusy(false) }
  }
  const eligible = (item: CmsAsset): boolean => purpose === 'library' || purpose === 'logo' ? purpose !== 'logo' || item.bucket === 'gallery' && item.path.startsWith('logo/') : purpose === 'profile' ? item.bucket === 'barber-photos' && item.path.startsWith(`${barberId ?? ''}/`) : item.bucket === 'gallery' && item.path.startsWith(`${purpose}/`)
  const visible = assets.filter(item => item.archived === archived && (kind === 'all' || item.mime.startsWith(kind === 'fonts' ? 'font/' : 'image/')) && `${item.name} ${item.alt}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()) && (!choose || eligible(item)))
  let uses: string[] = []
  if (asset) {
    try { uses = resourceUsage(document, { bucket: asset.bucket, path: asset.path }, { siteOrigin: location.origin, storageOrigin: new URL(SUPABASE_URL ?? 'https://unconfigured.invalid').origin, builtAssets: CMS_BUILT_ASSETS }) }
    catch { uses = ['En ofärdig sida behöver valideras innan hela användningen kan räknas.'] }
  }
  return <div class="cms-asset-library" aria-busy={busy}>
    <div class="cms-panel-heading"><div><h2>Bilder och typsnitt</h2><p>Filer laddas upp separat. Placeringar på hemsidan ändras först när utkastet publiceras.</p></div><button type="button" disabled={busy} onClick={() => input.current?.click()}>Ladda upp</button><input ref={input} class="cms-visually-hidden" type="file" accept="image/jpeg,image/png,image/webp,image/avif,image/heic,image/heif,.heic,.heif,.woff2" aria-label="Ladda upp till filbiblioteket" onChange={event => { const file = event.currentTarget.files?.[0]; if (file) void upload(file) }} /></div>
    {error && <Notice error>{error}</Notice>}
    <div class="cms-asset-toolbar"><input type="search" aria-label="Sök filer" placeholder="Sök namn eller alttext" value={query} onInput={event => setQuery(event.currentTarget.value)} /><Select label="Filtyp" value={kind} options={[["all", "Alla"], ["images", "Bilder"], ["fonts", "Typsnitt"]]} onChange={setKind} /><label><input type="checkbox" checked={archived} onChange={event => setArchived(event.currentTarget.checked)} /> Arkiverade</label></div>
    <div class="cms-assets-body"><div class="cms-asset-grid">{visible.map(item => <button type="button" key={item.id} class={selected === item.id ? 'cms-asset is-selected' : 'cms-asset'} onClick={() => setSelected(item.id)} aria-pressed={selected === item.id}>{item.mime.startsWith('image/') ? <img src={mediaUrl(item, SUPABASE_URL ?? '')} alt={item.alt} loading="lazy" /> : <span class="cms-font-swatch">Aa</span>}<span>{item.name}</span></button>)}{visible.length === 0 && <p>Inga filer matchar urvalet.</p>}</div>
    {asset && <aside class="cms-asset-details"><h3>{asset.name}</h3><p>{asset.mime} · {Math.round(asset.bytes / 1024)} KiB{asset.width ? ` · ${asset.width} × ${asset.height}` : ''}</p><Field label="Filnamn i biblioteket" value={name} onChange={setName} maxLength={160} /><Field label="Beskrivning / alttext" value={alt} onChange={setAlt} multiline /><button type="button" disabled={busy || !name.trim()} onClick={() => void save(asset.archived)}>Spara filuppgifter</button>{choose && <button type="button" class="cms-primary" disabled={busy || asset.archived || !eligible(asset)} onClick={() => choose(asset)}>Använd filen</button>}{replace && <button type="button" disabled={busy || asset.archived} onClick={() => replace(asset)}>Ersätt i hela utkastet</button>}<button type="button" disabled={busy} onClick={() => void save(!asset.archived)}>{asset.archived ? 'Återställ till biblioteket' : 'Arkivera filen'}</button><h4>Användning i utkastet</h4>{uses.length ? <ul>{uses.map(place => <li key={place}>{place}</li>)}</ul> : <p>Inte placerad i det aktuella utkastet.</p>}<small>Arkivering döljer filen i biblioteket men raderar inte publicerade bilder eller historiska versioner. Filer i befintliga publika buckets kan nås av den som känner till adressen.</small></aside>}</div>
  </div>
}

import type { JSX } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { isPagePath, mediaUrl, type CmsDocument, type CmsLang, type CmsAsset, type CmsPage } from '../../../shared/cms'
import { SUPABASE_URL } from '../../backend/config'
import { Field, Notice } from './controls'
import type { UploadPurpose } from './Assets'

type Change = (operation: (document: CmsDocument) => void, group?: string) => void
export type PickAsset = (choose: (asset: CmsAsset) => void, purpose?: UploadPurpose, barberId?: string) => void
export function BarberInspector({ id, document, lang, edit, pick, manage }: { id: string; document: CmsDocument; lang: CmsLang; edit: Change; pick: PickAsset; manage: () => void }): JSX.Element {
  const barber = document.barbers.find(item => item.id === id)
  if (!barber) return <Notice>Profilen finns inte längre. Uppdatera innehållet innan du fortsätter.</Notice>
  const update = (key: 'name' | 'ig' | 'role_sv' | 'role_en' | 'bio_sv' | 'bio_en', value: string): void => edit(draft => { const target = draft.barbers.find(item => item.id === id); if (target) target[key] = value }, `profile:${id}:${key}`)
  return <><h2>{barber.name}</h2><Field label="Namn" value={barber.name} onChange={value => update('name', value)} maxLength={80} /><Field label="Instagram" value={barber.ig} onChange={value => update('ig', value)} maxLength={60} /><Field label={`Roll · ${lang.toUpperCase()}`} value={barber[lang === 'sv' ? 'role_sv' : 'role_en']} onChange={value => update(lang === 'sv' ? 'role_sv' : 'role_en', value)} maxLength={80} /><Field label={`Presentation · ${lang.toUpperCase()}`} value={barber[lang === 'sv' ? 'bio_sv' : 'bio_en']} onChange={value => update(lang === 'sv' ? 'bio_sv' : 'bio_en', value)} multiline />
    <label class="cms-check"><input type="checkbox" checked={barber.active} onChange={event => { const active = event.currentTarget.checked; edit(draft => { const item = draft.barbers.find(row => row.id === id); if (item) item.active = active }) }} /> Synlig och bokningsbar</label>
    <Field label="Visningsordning" type="number" value={String(barber.sort_order)} onChange={value => { const order = Number(value); if (Number.isSafeInteger(order)) edit(draft => { const item = draft.barbers.find(row => row.id === id); if (item) item.sort_order = order }) }} />
    {document.photos[id] && <img class="cms-profile-photo" alt={barber.name} src={mediaUrl({ bucket: 'barber-photos', path: document.photos[id] ?? '' }, SUPABASE_URL ?? '')} />}
    <button type="button" onClick={() => pick(asset => edit(draft => { draft.photos[id] = asset.path }), 'profile', id)}>Välj eller ladda upp profilbild</button>{document.photos[id] && <button type="button" onClick={() => edit(draft => { delete draft.photos[id] })}>Ta bort profilbild från sidan</button>}
    <hr /><button type="button" onClick={manage}>Konton, inbjudningar och personalhantering</button><p class="cms-help">Profilens texter och bilder ingår i utkastet. Inloggningskonton och personalradering hanteras separat med befintliga säkerhetskontroller.</p>
  </>
}
export function GalleryInspector({ kind, document, edit, pick }: { kind: 'salon' | 'cuts'; document: CmsDocument; edit: Change; pick: PickAsset }): JSX.Element {
  const images = document.gallery.filter(image => image.kind === kind).sort((a, b) => a.sort_order - b.sort_order)
  const reorder = (id: string, direction: -1 | 1): void => edit(draft => {
    const group = draft.gallery.filter(image => image.kind === kind).sort((a, b) => a.sort_order - b.sort_order)
    const index = group.findIndex(image => image.id === id), target = index + direction
    const selected = group[index], adjacent = group[target]
    if (!selected || !adjacent) return
    group[index] = adjacent; group[target] = selected
    group.forEach((image, position) => { image.sort_order = position })
  })
  return <><h2>{kind === 'salon' ? 'Salongen' : 'Klippningar'}</h2><button type="button" onClick={() => pick(asset => edit(draft => { draft.gallery.push({ id: crypto.randomUUID(), kind, storage_path: asset.path, alt: asset.alt, sort_order: images.length ? Math.max(...images.map(image => image.sort_order)) + 1 : 0 }) }), kind)}>Lägg till bild</button><p class="cms-help">Bilderna och deras ordning publiceras med resten av utkastet. Borttagning här raderar inte filen ur lagringen.</p>{images.map((image, index) => <article class="cms-gallery-entry" key={image.id}><img src={mediaUrl({ bucket: 'gallery', path: image.storage_path }, SUPABASE_URL ?? '')} alt={image.alt} /><Field label="Alttext" value={image.alt} onChange={value => edit(draft => { const target = draft.gallery.find(row => row.id === image.id); if (target) target.alt = value }, `gallery:${image.id}:alt`)} /><div><button type="button" aria-label="Flytta bild uppåt" disabled={index === 0} onClick={() => reorder(image.id, -1)}>↑</button><button type="button" aria-label="Flytta bild nedåt" disabled={index === images.length - 1} onClick={() => reorder(image.id, 1)}>↓</button><button type="button" onClick={() => pick(asset => edit(draft => { const target = draft.gallery.find(row => row.id === image.id); if (target) { target.storage_path = asset.path; target.alt = asset.alt } }), kind)}>Byt bild</button><button type="button" onClick={() => { if (window.confirm('Ta bort den här bildens placering från utkastet? Filen behålls i biblioteket.')) edit(draft => { draft.gallery = draft.gallery.filter(row => row.id !== image.id) }) }}>Ta bort</button></div></article>)}</>
}
export function PageProperties({ page, lang, update, remove, duplicate }: { page: CmsPage; lang: CmsLang; update: (next: CmsPage) => void; remove: () => void; duplicate: () => void }): JSX.Element {
  const [path, setPath] = useState(page.path), [error, setError] = useState('')
  useEffect(() => { setPath(page.path); setError('') }, [page.id, page.path])
  return <><h2>Sidans uppgifter</h2><Field label={`Namn i biblioteket · ${lang.toUpperCase()}`} value={page.name[lang]} onChange={value => update({ ...page, name: { ...page.name, [lang]: value } })} maxLength={80} /><Field label={`Sidtitel · ${lang.toUpperCase()}`} value={page.title[lang]} onChange={value => update({ ...page, title: { ...page.title, [lang]: value } })} maxLength={120} /><Field label={`Sökbeskrivning · ${lang.toUpperCase()}`} value={page.description[lang]} onChange={value => update({ ...page, description: { ...page.description, [lang]: value } })} maxLength={300} multiline />
    <Field label="Adress" value={path} onChange={setPath} maxLength={100} disabled={page.kind !== 'page'} />{path !== page.path && <button type="button" onClick={() => { if (!isPagePath(path)) { setError('Välj en adress som /ny-sida. Systemets adresser kan inte ersättas.'); return } setError(''); update({ ...page, path }) }}>Använd adressen</button>}{error && <Notice error>{error}</Notice>}
    <label class="cms-check"><input type="checkbox" checked={page.inMenu} onChange={event => update({ ...page, inMenu: event.currentTarget.checked })} /> Visa i sidmenyn</label><button type="button" onClick={duplicate}>Duplicera sidan</button><button type="button" onClick={remove}>{page.kind === 'page' ? 'Ta bort sidan ur utkastet' : 'Återställ den inbyggda sidan'}</button>
  </>
}

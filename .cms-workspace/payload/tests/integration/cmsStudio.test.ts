import { beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { readAdminStackEnv, signedInClient, OWNER_EMAIL, OWNER_PASSWORD, BARBER_EMAIL, BARBER_PASSWORD, type AdminStackEnv } from './_adminHelpers'
import { withClient } from './_helpers'
import { validateDocument, defaultEmailDesign, type CmsState } from '../../shared/cms'

let env: AdminStackEnv, owner: SupabaseClient, barber: SupabaseClient, service: SupabaseClient
let ownerToken = '', barberToken = '', ownerId = ''
const origin = 'http://127.0.0.1:4173'
async function call(body: unknown, token = ownerToken): Promise<Response> {
  return fetch(`${env.url}/functions/v1/cms-studio`, { method: 'POST', headers: { apikey: env.anonKey, authorization: `Bearer ${token}`, origin, 'content-type': 'application/json' }, body: JSON.stringify(body) })
}
async function state(): Promise<CmsState> {
  const result = await call({ operation: 'state' })
  expect(result.status, await result.clone().text()).toBe(200)
  const value = await result.json() as CmsState
  validateDocument(value.document)
  return value
}
const publication = (base: CmsState, document = structuredClone(base.document)) => ({ operation: 'publish', baseRevision: base.revision, baseFingerprint: base.fingerprint, requestId: crypto.randomUUID(), document })
async function upload(kind: string, token = ownerToken, bytes: Uint8Array = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aNDsAAAAASUVORK5CYII=', 'base64')): Promise<Response> {
  const form = new FormData()
  form.set('kind', kind); form.set('file', new File([new Uint8Array(bytes)], 'fixture.png', { type: 'image/png' }))
  if (kind === 'cms_asset') form.set('purpose', 'library')
  else { form.set('galleryKind', 'salon'); form.set('alt', 'Legacy fixture'); form.set('sortOrder', '0') }
  return fetch(`${env.url}/functions/v1/upload-image`, { method: 'POST', headers: { apikey: env.anonKey, authorization: `Bearer ${token}`, origin }, body: form })
}

beforeAll(async () => {
  const configured = readAdminStackEnv()
  if (!configured || !['localhost', '127.0.0.1'].includes(new URL(configured.url).hostname) || !['localhost', '127.0.0.1'].includes(new URL(configured.dbUrl).hostname)) throw new Error('CMS integration requires an isolated local Supabase stack; remote testing is forbidden.')
  env = configured
  owner = await signedInClient(env, OWNER_EMAIL, OWNER_PASSWORD)
  barber = await signedInClient(env, BARBER_EMAIL, BARBER_PASSWORD)
  service = createClient(env.url, env.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const first = (await owner.auth.getSession()).data.session, second = (await barber.auth.getSession()).data.session
  if (!first || !second) throw new Error('Missing authenticated integration identities')
  ownerToken = first.access_token; barberToken = second.access_token; ownerId = first.user.id
}, 30000)

describe.sequential('real CMS Edge, Auth and database boundary', () => {
  it('rejects anonymous and barber requests without exposing the owner document', async () => {
    expect((await call({ operation: 'state' }, env.anonKey)).status).toBe(401)
    expect((await call({ operation: 'state' }, barberToken)).status).toBe(403)
    const bypass = await owner.rpc('internal_cms_state', { p_actor: ownerId })
    expect(bypass.error).not.toBeNull()
  })
  it('rechecks account status and the forced-password gate at the server', async () => {
    try {
      await withClient(env.dbUrl, db => db.query('update public.profiles set must_change_password=true where id=$1', [ownerId]))
      expect((await call({ operation: 'state' })).status).toBe(403)
      await withClient(env.dbUrl, db => db.query('update public.profiles set must_change_password=false,account_enabled=false where id=$1', [ownerId]))
      expect((await call({ operation: 'state' })).status).toBe(403)
    } finally { await withClient(env.dbUrl, db => db.query('update public.profiles set must_change_password=false,account_enabled=true where id=$1', [ownerId])) }
  })
  it('accepts exactly one competing publication and replays the committed identity', async () => {
    const base = await state()
    const first = publication(base), second = publication(base)
    first.document.site['kicker'] = { sv: 'CMS concurrent first', en: 'First' }
    second.document.site['kicker'] = { sv: 'CMS concurrent second', en: 'Second' }
    const replies = await Promise.all([call(first), call(second)])
    expect(replies.map(reply => reply.status).sort()).toEqual([200, 409])
    const winner = replies[0]?.status === 200 ? first : second
    const result = replies.find(reply => reply.status === 200)
    if (!result) throw new Error('No publication committed')
    expect(await (await call(winner)).json()).toEqual(await result.json())
    const sameIdDifferentContent = structuredClone(winner)
    sameIdDifferentContent.document.site['kicker'] = { sv: 'Different' }
    expect((await call(sameIdDifferentContent)).status).toBe(422)
    const latest = await state()
    expect(latest.revision).toBe(base.revision + 1)
    const restore = await call(publication(latest, base.document))
    expect(restore.status, await restore.text()).toBe(200)
  })
  it('detects writes made through the retained legacy editor even without a CMS revision change', async () => {
    const base = await state()
    const legacy = await owner.from('site_content').upsert({ key: 'kicker', lang: 'sv', value: 'Changed through old editor' })
    expect(legacy.error).toBeNull()
    const stale = await call(publication(base))
    expect(stale.status).toBe(409)
    const latest = await state()
    expect(latest.revision).toBe(base.revision)
    expect(latest.document.site['kicker']?.sv).toBe('Changed through old editor')
    expect((await call(publication(latest, base.document))).status).toBe(200)
  })
  it('rejects active markup without committing any content or history', async () => {
    const base = await state(), attempt = publication(base)
    attempt.document.presentation.pages.push({ id: crypto.randomUUID(), kind: 'page', path: '/cms-unsafe-test', name: { sv: 'Unsafe', en: 'Unsafe' }, title: { sv: 'Unsafe', en: 'Unsafe' }, description: { sv: '', en: '' }, inMenu: false, content: { sv: { html: '<script>alert(1)</script>', css: { light: '', dark: '' } }, en: { html: '<p>Safe</p>', css: { light: '', dark: '' } } } })
    expect((await call(attempt)).status).toBe(422)
    expect(await state()).toEqual(base)
  })
  it('stores a decoded image in the library without assigning it to public content', async () => {
    const before = await state()
    const response = await upload('cms_asset')
    expect(response.status, await response.clone().text()).toBe(200)
    const value = await response.json() as { asset: { id: string; bucket: string; path: string; mime: string; width: number; height: number } }
    expect(value.asset.mime).toBe('image/webp')
    expect(value.asset.width).toBeGreaterThan(0)
    const after = await state()
    expect(after.document).toEqual(before.document)
    expect(after.revision).toBe(before.revision)
    expect(after.assets.some(asset => asset.id === value.asset.id)).toBe(true)
    const downloaded = await fetch(`${env.url}/storage/v1/object/public/${value.asset.bucket}/${value.asset.path}`)
    expect(downloaded.status).toBe(200)
    expect(Buffer.from(await downloaded.arrayBuffer()).subarray(8, 12).toString()).toBe('WEBP')
    const archive = await call({ operation: 'asset', id: value.asset.id, version: 0, name: 'Library fixture', alt: 'Description', archived: true })
    expect(archive.status).toBe(200)
    expect((await call({ operation: 'asset', id: value.asset.id, version: 0, name: 'Stale', alt: '', archived: false })).status).toBe(409)
    expect((await call({ operation: 'asset', id: value.asset.id, version: 1, name: 'Library fixture', alt: 'Description', archived: false })).status).toBe(200)
  }, 30000)
  it('rejects invalid image bytes and barber library writes before registering an asset', async () => {
    const before = await state()
    expect((await upload('cms_asset', ownerToken, new Uint8Array([1, 2, 3]))).status).toBe(422)
    expect((await upload('cms_asset', barberToken)).status).toBe(403)
    expect((await state()).assets).toEqual(before.assets)
  })
  it('makes newly uploaded legacy media available to the new editor without a second migration', async () => {
    const before = await state(), response = await upload('gallery')
    expect(response.ok, await response.clone().text()).toBe(true)
    const after = await state()
    const newImage = after.document.gallery.find(image => !before.document.gallery.some(previous => previous.id === image.id))
    expect(newImage).toBeDefined()
    if (!newImage) throw new Error('Missing legacy gallery assignment')
    expect(after.assets.some(asset => asset.bucket === 'gallery' && asset.path === newImage.storage_path)).toBe(true)
    const original = publication(after, before.document)
    expect((await call(original)).status).toBe(200)
  }, 30000)
  it('publishes actual email designs to the server-only delivery RPC and preserves old forms', async () => {
    const base = await state(), request = publication(base)
    const email = request.document.emails.find(item => item.template === 'customer_confirmation' && item.lang === 'sv')
    if (!email) throw new Error('The seeded transactional email template is missing')
    email.subject = 'CMS mail integration'; email.design = defaultEmailDesign()
    const result = await call(request)
    expect(result.status, await result.text()).toBe(200)
    const delivery = await service.rpc('email_template_for_delivery', { p_template: email.template, p_lang: email.lang })
    expect(delivery.error).toBeNull()
    expect(delivery.data.subject).toBe('CMS mail integration')
    expect(delivery.data.design).toEqual(email.design)
    expect((await owner.rpc('email_template_for_delivery', { p_template: email.template, p_lang: email.lang })).error).not.toBeNull()
    const legacy = await owner.from('email_templates').update({ subject: 'Saved by old Mail tab' }).eq('template', email.template).eq('lang', email.lang)
    expect(legacy.error).toBeNull()
    expect((await state()).document.emails.find(item => item.template === email.template && item.lang === email.lang)?.subject).toBe('Saved by old Mail tab')
    expect((await call(publication(await state(), base.document))).status).toBe(200)
  })
})

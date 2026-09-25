import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'
import { loadStackEnv } from '../../tests/integration/loadStackEnv.ts'
const env = loadStackEnv()
for (const key of ['API_URL', 'DB_URL'])
  assert.ok(
    env[key] && ['127.0.0.1', 'localhost'].includes(new URL(env[key]).hostname),
    'Asset-copy acceptance is local-stack only',
  )
assert.ok(env.ANON_KEY && env.SERVICE_ROLE_KEY, 'Local stack credentials are missing')
const authOptions = { auth: { persistSession: false, autoRefreshToken: false } }
const service = createClient(env.API_URL, env.SERVICE_ROLE_KEY, authOptions)
const owner = createClient(env.API_URL, env.ANON_KEY, authOptions)
const db = new pg.Client({ connectionString: env.DB_URL })
await db.connect()
let userId, token
const created = new Map()
const origin = process.env.CMS_TEST_ORIGIN ?? 'http://127.0.0.1:4173'
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(origin).hostname), 'Local origin required')
const call = async (body, authorized = true) =>
  fetch(`${env.API_URL}/functions/v1/cms-studio`, {
    method: 'POST',
    headers: {
      apikey: env.ANON_KEY,
      ...(authorized ? { authorization: `Bearer ${token}` } : {}),
      origin,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: globalThis.AbortSignal.timeout(20000),
  })
const checked = async (response) => {
  const body = await response.json()
  assert.equal(response.status, 200, JSON.stringify(body))
  return body
}
try {
  const email = `cms-copy-${randomUUID()}@example.invalid`,
    password = `Aa1!${randomUUID()}`
  const account = await service.auth.admin.createUser({ email, password, email_confirm: true })
  assert.equal(account.error, null)
  userId = account.data.user?.id
  assert.ok(userId)
  await db.query(
    'insert into public.profiles(id,role,account_enabled,must_change_password) values($1,$2,true,false)',
    [userId, 'owner'],
  )
  const session = await owner.auth.signInWithPassword({ email, password })
  assert.equal(session.error, null)
  token = session.data.session?.access_token
  assert.ok(token)
  const before = await checked(await call({ operation: 'state' }))
  const form = new globalThis.FormData()
  form.set('kind', 'cms_asset')
  form.set('purpose', 'library')
  form.set(
    'file',
    new globalThis.File(
      [
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4AWMAgv8AAQQBAP8H9UQAAAAASUVORK5CYII=',
          'base64',
        ),
      ],
      'copy-acceptance.png',
      { type: 'image/png' },
    ),
  )
  const upload = await fetch(`${env.API_URL}/functions/v1/upload-image`, {
    method: 'POST',
    headers: { apikey: env.ANON_KEY, authorization: `Bearer ${token}`, origin },
    body: form,
    signal: globalThis.AbortSignal.timeout(30000),
  })
  const source = (await checked(upload)).asset
  created.set(source.id, source)
  const request = {
    operation: 'asset_copy',
    id: source.id,
    version: source.version,
    purpose: 'cuts',
  }
  assert.equal((await call(request, false)).status, 401)
  const copies = await Promise.all([call(request), call(request)]).then((responses) =>
    Promise.all(responses.map(checked)),
  )
  assert.equal(copies[0].id, copies[1].id, 'Concurrent requests reuse one immutable file')
  for (const asset of copies) created.set(asset.id, asset)
  const copy = copies[0]
  assert.equal(copy.bucket, 'gallery')
  assert.equal(copy.path, `cuts/${source.id}.webp`)
  const originalBytes = await service.storage.from(source.bucket).download(source.path)
  const copiedBytes = await service.storage.from(copy.bucket).download(copy.path)
  assert.equal(originalBytes.error, null)
  assert.equal(copiedBytes.error, null)
  assert.deepEqual(
    Buffer.from(await copiedBytes.data.arrayBuffer()),
    Buffer.from(await originalBytes.data.arrayBuffer()),
  )
  const reused = await checked(await call(request))
  assert.equal(reused.id, copy.id)
  const barberId = (await db.query('select id from public.barbers order by id limit 1')).rows[0]?.id
  assert.ok(barberId)
  for (const destination of [
    { purpose: 'salon' },
    { purpose: 'logo' },
    { purpose: 'profile', barberId },
  ]) {
    const response = await call({ ...request, ...destination })
    console.log('Copy destination:', destination.purpose, 'status:', response.status)
    const asset = await checked(response)
    created.set(asset.id, asset)
    assert.equal(asset.bucket, destination.purpose === 'profile' ? 'barber-photos' : 'gallery')
    assert.ok(asset.path.startsWith(`${destination.barberId ?? destination.purpose}/`))
  }
  assert.equal(
    (await call({ ...request, purpose: 'profile', barberId: 'missing-person' })).status,
    422,
  )
  const archived = await checked(
    await call({
      operation: 'asset_lifecycle',
      id: source.id,
      version: source.version,
      action: 'archive',
    }),
  )
  created.set(source.id, archived.asset)
  assert.equal((await call(request)).status, 409)
  const after = await checked(await call({ operation: 'state' }))
  assert.equal(after.revision, before.revision)
  assert.deepEqual(
    after.document,
    before.document,
    'Copying registers assets without publishing or changing booking/content data',
  )
  console.log(
    'PASS real Edge/Storage copy: authenticated upload, byte parity, concurrent reuse, all destinations, denied unauthorized/stale requests, unchanged document',
  )
} finally {
  if (token) {
    for (const asset of created.values()) {
      const state = await checked(await call({ operation: 'state' }))
      const current = state.assets.find((item) => item.id === asset.id)
      if (!current) continue
      const trashed = await checked(
        await call({
          operation: 'asset_lifecycle',
          id: current.id,
          version: current.version,
          action: 'trash',
        }),
      )
      await checked(
        await call({
          operation: 'asset_lifecycle',
          id: current.id,
          version: trashed.asset.version,
          action: 'delete',
        }),
      )
    }
  }
  if (userId) await service.auth.admin.deleteUser(userId)
  await owner.auth.signOut()
  await db.end()
}

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  readAdminStackEnv,
  signedInClient,
  OWNER_EMAIL,
  OWNER_PASSWORD,
  type AdminStackEnv,
} from './_adminHelpers'

// An explicit owner delete ("Radera" in the media library) must remove the stored bytes as well as the
// library row. Legacy removals through upload-image deliberately keep registered bytes (cms_assets
// comment, 20261024010000_stop_orphan_sweeper.sql); only cms-studio asset_lifecycle delete erases them.

let env: AdminStackEnv
let service: SupabaseClient
let ownerToken = ''
const origin = 'http://127.0.0.1:4173'

interface Asset {
  readonly id: string
  readonly bucket: 'cms-library'
  readonly path: string
}
interface Transition {
  readonly asset: { readonly version: number }
}

async function call(body: unknown): Promise<Response> {
  return fetch(`${env.url}/functions/v1/cms-studio`, {
    method: 'POST',
    headers: {
      apikey: env.anonKey,
      authorization: `Bearer ${ownerToken}`,
      origin,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  })
}

async function uploadAsset(): Promise<Asset & { readonly version: number }> {
  const form = new FormData()
  form.set('kind', 'cms_asset')
  form.set('purpose', 'library')
  form.set(
    'file',
    new File(
      [
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4AWMAgv8AAQQBAP8H9UQAAAAASUVORK5CYII=',
          'base64',
        ),
      ],
      'explicit-delete.png',
      { type: 'image/png' },
    ),
  )
  const response = await fetch(`${env.url}/functions/v1/upload-image`, {
    method: 'POST',
    headers: { apikey: env.anonKey, authorization: `Bearer ${ownerToken}`, origin },
    body: form,
  })
  expect(response.status, await response.clone().text()).toBe(200)
  return ((await response.json()) as { asset: Asset & { version: number } }).asset
}

async function transition(id: string, version: number, action: 'trash' | 'delete') {
  const response = await call({ operation: 'asset_lifecycle', id, version, action })
  expect(response.status, await response.clone().text()).toBe(200)
  return (await response.json()) as Transition
}

beforeAll(async () => {
  const configured = readAdminStackEnv()
  if (
    !configured ||
    !['localhost', '127.0.0.1'].includes(new URL(configured.url).hostname) ||
    !['localhost', '127.0.0.1'].includes(new URL(configured.dbUrl).hostname)
  )
    throw new Error(
      'CMS integration requires an isolated local Supabase stack; remote testing is forbidden.',
    )

  env = configured
  service = createClient(env.url, env.serviceRoleKey, { auth: { persistSession: false } })
  const owner = await signedInClient(env, OWNER_EMAIL, OWNER_PASSWORD)
  const session = (await owner.auth.getSession()).data.session
  if (!session) throw new Error('Missing authenticated owner identity')
  ownerToken = session.access_token
}, 30000)

describe.sequential('CMS explicit asset delete', () => {
  it('removes the stored bytes and the library row once the owner deletes a trashed asset', async () => {
    const uploaded = await uploadAsset()
    const stored = await service.storage.from(uploaded.bucket).download(uploaded.path)
    expect(stored.error).toBeNull()

    const trashed = await transition(uploaded.id, uploaded.version, 'trash')
    const stillStored = await service.storage.from(uploaded.bucket).download(uploaded.path)
    expect(stillStored.error).toBeNull()

    await transition(uploaded.id, trashed.asset.version, 'delete')

    const removed = await service.storage.from(uploaded.bucket).download(uploaded.path)
    expect(removed.error).not.toBeNull()
    const row = await service.from('cms_assets').select('id').eq('id', uploaded.id).maybeSingle()
    expect(row.error).toBeNull()
    expect(row.data).toBeNull()
  }, 30000)
})

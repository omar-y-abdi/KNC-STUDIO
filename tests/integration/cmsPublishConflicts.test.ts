import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  readAdminStackEnv,
  signedInClient,
  OWNER_EMAIL,
  OWNER_PASSWORD,
  type AdminStackEnv,
} from './_adminHelpers'
import { withClient } from './_helpers'
import {
  validateDocument,
  type CmsAsset,
  type CmsDocument,
  type CmsPage,
  type CmsState,
  type MediaRef,
} from '../../shared/cms'

// Real Edge, PostgREST and Postgres: the archived-media rule, conflict status codes and
// request idempotency as the owner's browser meets them.
let env: AdminStackEnv
let ownerToken = ''
let original: CmsDocument
const origin = 'http://127.0.0.1:4173'
const PAGE_A = '7a000000-0000-4000-8000-00000000000a'
const PAGE_B = '7a000000-0000-4000-8000-00000000000b'
const GALLERY_ROW = '7a000000-0000-4000-8000-0000000000c1'
const HERO_KEY = 'test.archivedHero'
let assets: Record<'shifted' | 'active' | 'salon' | 'unknown', CmsAsset>

async function call(body: unknown, signal?: AbortSignal): Promise<Response> {
  return fetch(`${env.url}/functions/v1/cms-studio`, {
    method: 'POST',
    headers: {
      apikey: env.anonKey,
      authorization: `Bearer ${ownerToken}`,
      origin,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    ...(signal ? { signal } : {}),
  })
}

async function state(): Promise<CmsState> {
  const response = await call({ operation: 'state' })
  expect(response.status, await response.clone().text()).toBe(200)
  const value = (await response.json()) as CmsState
  validateDocument(value.document)
  return value
}

const publication = (base: CmsState, document: CmsDocument) => ({
  operation: 'publish',
  baseRevision: base.revision,
  baseFingerprint: base.fingerprint,
  requestId: crypto.randomUUID(),
  document,
})

async function publish(document: (current: CmsDocument) => CmsDocument): Promise<Response> {
  const base = await state()
  return call(publication(base, document(structuredClone(base.document))))
}

async function expectPublished(response: Response): Promise<void> {
  expect(response.status, await response.clone().text()).toBe(200)
}

async function expectRejected(response: Response, file: string): Promise<void> {
  expect(response.status, await response.clone().text()).toBe(422)
  const body = (await response.json()) as { error: string; message: string }
  expect(body.error).toBe('invalid_content')
  expect(body.message).toContain(file)
  expect(body.message).toContain('arkiverad')
}

async function upload(purpose: 'library' | 'salon', name: string): Promise<CmsAsset> {
  const form = new FormData()
  form.set('kind', 'cms_asset')
  form.set('purpose', purpose)
  form.set(
    'file',
    new File(
      [
        Buffer.from(
          'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4AWMAgv8AAQQBAP8H9UQAAAAASUVORK5CYII=',
          'base64',
        ),
      ],
      name,
      { type: 'image/png' },
    ),
  )
  const response = await fetch(`${env.url}/functions/v1/upload-image`, {
    method: 'POST',
    headers: { apikey: env.anonKey, authorization: `Bearer ${ownerToken}`, origin },
    body: form,
  })
  expect(response.status, await response.clone().text()).toBe(200)
  return ((await response.json()) as { asset: CmsAsset }).asset
}

async function currentAsset(id: string): Promise<CmsAsset> {
  const asset = (await state()).assets.find((candidate) => candidate.id === id)
  if (!asset) throw new Error(`CMS asset ${id} is missing`)
  return asset
}

async function setArchived(id: string, archived: boolean): Promise<void> {
  const asset = await currentAsset(id)
  const response = await call({
    operation: 'asset',
    id: asset.id,
    version: asset.version,
    name: asset.name,
    alt: asset.alt,
    archived,
  })
  expect(response.status, await response.clone().text()).toBe(200)
}

const image = (ref: MediaRef): string =>
  `<img src="${env.url}/storage/v1/object/public/${ref.bucket}/${ref.path}" alt="">`

const page = (id: string, path: string, images: string): CmsPage => {
  const variant = () => ({
    html: `<main><p>Arkivtest</p>${images}</main>`,
    css: { light: '', dark: '' },
  })
  return {
    id,
    kind: 'page',
    path,
    inMenu: false,
    name: { sv: 'Arkivtest', en: 'Archive test' },
    title: { sv: 'Arkivtest', en: 'Archive test' },
    description: { sv: '', en: '' },
    content: { sv: variant(), en: variant() },
  }
}

const withPage = (document: CmsDocument, value: CmsPage): CmsDocument => {
  document.presentation.pages = [
    ...document.presentation.pages.filter((item) => item.id !== value.id),
    value,
  ]
  return document
}

// PostgREST connects as `authenticator`; a retried CMS RPC stays visible in pg_stat_activity.
async function retryingCmsBackends(): Promise<number[]> {
  return withClient(env.dbUrl, async (client) => {
    const result = await client.query<{ pid: number }>(
      `select pid from pg_stat_activity
       where usename = 'authenticator' and pid <> pg_backend_pid()
         and state in ('active', 'idle in transaction') and query ilike '%internal_cms_%'`,
    )
    return result.rows.map((row) => row.pid)
  })
}

async function terminateRetryingBackends(): Promise<void> {
  const pids = await retryingCmsBackends()
  if (pids.length === 0) return
  await withClient(env.dbUrl, (client) =>
    client.query('select pg_terminate_backend(pid) from unnest($1::int[]) as pid', [pids]),
  )
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
  const owner = await signedInClient(env, OWNER_EMAIL, OWNER_PASSWORD)
  const session = (await owner.auth.getSession()).data.session
  if (!session) throw new Error('Missing authenticated owner identity')
  ownerToken = session.access_token

  original = (await state()).document
  assets = {
    shifted: await upload('library', 'arkiv-forskjuten.png'),
    active: await upload('library', 'aktiv-ny.png'),
    salon: await upload('salon', 'salong-galleri.png'),
    unknown: await upload('library', 'okand-arkiverad.png'),
  }

  // The head shows `shifted` in markup and on a structured key, and `salon` only as a gallery row.
  await expectPublished(
    await publish((document) => {
      withPage(document, page(PAGE_A, '/it-arkiv-a', image(assets.shifted)))
      document.presentation.images[HERO_KEY] = {
        ref: { bucket: assets.shifted.bucket, path: assets.shifted.path },
        alt: { sv: 'Arkiverad', en: 'Archived' },
      }
      document.gallery.push({
        id: GALLERY_ROW,
        kind: 'salon',
        storage_path: assets.salon.path,
        alt: '',
        sort_order: 900,
      })
      return document
    }),
  )
  for (const asset of [assets.shifted, assets.salon, assets.unknown])
    await setArchived(asset.id, true)
}, 120_000)

afterAll(async () => {
  if (!original) return
  await terminateRetryingBackends()
  await expectPublished(await publish(() => structuredClone(original)))
})

describe.sequential('CMS publication: hybrid archived-media rule', () => {
  it('accepts archived markup images whose ordinal shifted after a new image was inserted', async () => {
    await expectPublished(
      await publish((document) =>
        withPage(
          document,
          page(PAGE_A, '/it-arkiv-a', image(assets.active) + image(assets.shifted)),
        ),
      ),
    )
  }, 30_000)

  it('accepts a duplicated page that repeats archived images the head already shows', async () => {
    await expectPublished(
      await publish((document) =>
        withPage(document, page(PAGE_B, '/it-arkiv-b', image(assets.shifted))),
      ),
    )
  }, 30_000)

  it('accepts markup showing an archived image the head references only as a gallery row', async () => {
    await expectPublished(
      await publish((document) =>
        withPage(document, page(PAGE_B, '/it-arkiv-b', image(assets.salon))),
      ),
    )
  }, 30_000)

  it('rejects an archived image the head never references, in Swedish and naming the file', async () => {
    await expectRejected(
      await publish((document) =>
        withPage(document, page(PAGE_B, '/it-arkiv-b', image(assets.unknown))),
      ),
      'okand-arkiverad.png',
    )
    const validation = await call({
      operation: 'validate',
      document: withPage(
        structuredClone((await state()).document),
        page(PAGE_B, '/it-arkiv-b', image(assets.unknown)),
      ),
    })
    await expectRejected(validation, 'okand-arkiverad.png')
  }, 30_000)

  it('rejects a percent-encoded spelling that would hide an archived image from the rule', async () => {
    const encoded = image(assets.unknown).replace('/images/', '/%69mages/')
    expect(encoded).toContain('%69mages')
    const response = await publish((document) =>
      withPage(document, page(PAGE_B, '/it-arkiv-b', encoded)),
    )
    expect(response.status, await response.clone().text()).toBe(422)
    const body = (await response.json()) as { error: string; message: string }
    expect(body.error).toBe('invalid_content')
    expect(body.message).toContain('Bildadressen måste vara bibliotekets egen adress')
  }, 30_000)

  it('rejects an escaped url() function that would load an archived image unseen', async () => {
    const hidden = `${env.url}/storage/v1/object/public/${assets.unknown.bucket}/${assets.unknown.path.replace('images/', '\\69mages/')}`
    const response = await publish((document) => {
      const value = page(PAGE_B, '/it-arkiv-b', '<div class="it-escaped"></div>')
      value.content.sv.css.light = `.it-escaped{background:u\\72l("${hidden}")}`
      return withPage(document, value)
    })
    expect(response.status, await response.clone().text()).toBe(422)
    const body = (await response.json()) as { error: string; message: string }
    expect(body.error).toBe('invalid_content')
    expect(body.message).toContain('Unsafe CSS function')
  }, 30_000)

  it('keeps an archived image on its existing structured key', async () => {
    await expectPublished(await publish((document) => document))
  }, 30_000)

  it('rejects the same archived image moved to a new structured key', async () => {
    await expectRejected(
      await publish((document) => {
        const hero = document.presentation.images[HERO_KEY]
        if (!hero) throw new Error('Fixture hero is missing from the head')
        Reflect.deleteProperty(document.presentation.images, HERO_KEY)
        document.presentation.images[`${HERO_KEY}.moved`] = hero
        return document
      }),
      'arkiv-forskjuten.png',
    )
  }, 30_000)
})

describe.sequential('CMS publication: conflicts and idempotency', () => {
  it('answers a stale base with 409 within 2 s and leaves no backend retrying', async () => {
    const base = await state()
    await expectPublished(await call(publication(base, structuredClone(base.document))))
    const started = performance.now()
    try {
      const stale = await call(
        publication(base, structuredClone(base.document)),
        AbortSignal.timeout(2000),
      )
      expect(stale.status, await stale.clone().text()).toBe(409)
      expect(((await stale.json()) as { error: string }).error).toBe('conflict')
      expect(performance.now() - started).toBeLessThan(2000)
      expect(await retryingCmsBackends()).toEqual([])
    } finally {
      await terminateRetryingBackends()
    }
  }, 30_000)

  it('answers stale asset metadata and lifecycle versions with 409', async () => {
    const asset = await currentAsset(assets.active.id)
    const metadata = (version: number) => ({
      operation: 'asset',
      id: asset.id,
      version,
      name: asset.name,
      alt: 'Ny alternativtext',
      archived: false,
    })
    const saved = await call(metadata(asset.version))
    expect(saved.status, await saved.clone().text()).toBe(200)
    try {
      const staleMetadata = await call(metadata(asset.version), AbortSignal.timeout(2000))
      expect(staleMetadata.status, await staleMetadata.clone().text()).toBe(409)
      const staleLifecycle = await call(
        { operation: 'asset_lifecycle', id: asset.id, version: asset.version, action: 'archive' },
        AbortSignal.timeout(2000),
      )
      expect(staleLifecycle.status, await staleLifecycle.clone().text()).toBe(409)
      expect(await retryingCmsBackends()).toEqual([])
    } finally {
      await terminateRetryingBackends()
    }
  }, 30_000)

  it('replays the same request identity and document as the original revision', async () => {
    const base = await state()
    const request = publication(base, structuredClone(base.document))
    const first = await call(request)
    expect(first.status, await first.clone().text()).toBe(200)
    const committed = (await first.json()) as { revision: number; fingerprint: string }
    const replay = await call(request)
    expect(replay.status, await replay.clone().text()).toBe(200)
    expect(await replay.json()).toMatchObject(committed)
    expect((await state()).revision).toBe(committed.revision)
  }, 30_000)

  it('rejects the same request identity with a different document', async () => {
    const base = await state()
    const request = publication(base, structuredClone(base.document))
    await expectPublished(await call(request))
    const changed = structuredClone(request.document)
    changed.settings['business_name'] = 'Annat innehåll med samma identitet'
    const reused = await call({ ...request, document: changed })
    expect(reused.status, await reused.clone().text()).toBe(422)
    expect(((await reused.json()) as { error: string }).error).toBe('invalid_content')
  }, 30_000)
})

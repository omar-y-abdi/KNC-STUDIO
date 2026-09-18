import { beforeAll, describe, expect, it } from 'vitest'
import {
  readAdminStackEnv,
  signedInClient,
  OWNER_EMAIL,
  OWNER_PASSWORD,
  type AdminStackEnv,
} from './_adminHelpers'
import { validateDocument, type CmsState } from '../../shared/cms'

let env: AdminStackEnv
let ownerToken = ''
const origin = 'http://127.0.0.1:4173'
const nodeId = 'test.archiveRace'

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

async function state(): Promise<CmsState> {
  const response = await call({ operation: 'state' })
  expect(response.status, await response.clone().text()).toBe(200)
  const value = (await response.json()) as CmsState
  validateDocument(value.document)
  return value
}

const publication = (base: CmsState, document = structuredClone(base.document)) => ({
  operation: 'publish',
  baseRevision: base.revision,
  baseFingerprint: base.fingerprint,
  requestId: crypto.randomUUID(),
  document,
})

async function uploadAsset(): Promise<{
  id: string
  bucket: 'cms-library'
  path: string
}> {
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
      'archive-race.png',
      { type: 'image/png' },
    ),
  )
  const response = await fetch(`${env.url}/functions/v1/upload-image`, {
    method: 'POST',
    headers: {
      apikey: env.anonKey,
      authorization: `Bearer ${ownerToken}`,
      origin,
    },
    body: form,
  })
  expect(response.status, await response.clone().text()).toBe(200)
  const value = (await response.json()) as {
    asset: { id: string; bucket: 'cms-library'; path: string }
  }
  return value.asset
}

async function setArchived(
  asset: {
    id: string
    version: number
    name: string
    alt: string
  },
  archived: boolean,
): Promise<void> {
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
}, 30000)

describe.sequential('CMS archived asset publication boundary', () => {
  it('rejects a newly placed asset archived by another tab without invalidating the stale content CAS', async () => {
    const uploaded = await uploadAsset()
    const base = await state()
    const stale = publication(base)
    stale.document.presentation.images[nodeId] = {
      ref: { bucket: uploaded.bucket, path: uploaded.path },
      alt: { sv: 'Arkivtest', en: 'Archive test' },
    }

    const asset = base.assets.find((candidate) => candidate.id === uploaded.id)
    expect(asset).toBeDefined()
    if (!asset) throw new Error('Uploaded asset is missing from CMS state')

    try {
      await setArchived(asset, true)

      const afterArchive = await state()
      expect(afterArchive.revision).toBe(base.revision)
      expect(afterArchive.fingerprint).toBe(base.fingerprint)
      expect(afterArchive.document).toEqual(base.document)

      const validation = await call({ operation: 'validate', document: stale.document })
      expect(validation.status, await validation.clone().text()).toBe(422)

      const rejected = await call(stale)
      expect(rejected.status, await rejected.clone().text()).toBe(422)

      const afterRejected = await state()
      expect(afterRejected.revision).toBe(base.revision)
      expect(afterRejected.document.presentation.images[nodeId]).toBeUndefined()
    } finally {
      const latest = await state()
      const current = latest.assets.find((candidate) => candidate.id === uploaded.id)
      if (current?.archived) await setArchived(current, false)
    }
  }, 30000)

  it('allows an archived asset that is already in the public head to remain referenced', async () => {
    const uploaded = await uploadAsset()
    const base = await state()
    const first = publication(base)
    first.document.presentation.images[nodeId] = {
      ref: { bucket: uploaded.bucket, path: uploaded.path },
      alt: { sv: 'Befintlig referens', en: 'Existing reference' },
    }

    const published = await call(first)
    expect(published.status, await published.clone().text()).toBe(200)

    try {
      const referenced = await state()
      const asset = referenced.assets.find((candidate) => candidate.id === uploaded.id)
      expect(asset).toBeDefined()
      if (!asset) throw new Error('Published asset is missing from CMS state')

      await setArchived(asset, true)

      const afterArchive = await state()
      expect(afterArchive.revision).toBe(referenced.revision)
      expect(afterArchive.fingerprint).toBe(referenced.fingerprint)

      const validation = await call({
        operation: 'validate',
        document: structuredClone(afterArchive.document),
      })
      expect(validation.status, await validation.clone().text()).toBe(200)

      const keepExisting = await call(publication(afterArchive))
      expect(keepExisting.status, await keepExisting.clone().text()).toBe(200)
    } finally {
      const latest = await state()
      if (latest.document.presentation.images[nodeId]) {
        const cleanedDocument = structuredClone(latest.document)
        Reflect.deleteProperty(cleanedDocument.presentation.images, nodeId)
        const cleanup = await call(publication(latest, cleanedDocument))
        expect(cleanup.status, await cleanup.clone().text()).toBe(200)
      }

      const cleaned = await state()
      const current = cleaned.assets.find((candidate) => candidate.id === uploaded.id)
      if (current?.archived) await setArchived(current, false)
    }
  }, 30000)
})

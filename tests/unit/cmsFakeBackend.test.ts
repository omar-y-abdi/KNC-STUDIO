import { describe, expect, it } from 'vitest'
import { emptyDocument, type CmsDocument } from '../../shared/cms'
import { nativeBackend } from '../../tools/e2e/cms-backend.mjs'

// The e2e fake must reject what the deployed cms-studio rejects: internal_cms_missing_media
// requires both a cms_assets row and a storage object for every reference.
const STORAGE = 'https://admin-harness.invalid'
const BASE = 'http://127.0.0.1:4188'
const MISSING =
  'En refererad fil saknas eller är inte registrerad. Välj filen på nytt i biblioteket.'

type Handler = (route: FakeRoute) => Promise<void> | void
interface FakeRoute {
  request: () => {
    method: () => string
    url: () => string
    headers: () => Record<string, string>
    postDataJSON: () => unknown
    postDataBuffer: () => Buffer
  }
  fulfill: (response: { status?: number; json?: unknown }) => void
}
interface Reply {
  status: number
  json: unknown
}

function harness() {
  const routes = new Map<string, Handler>()
  const context = {
    route: async (pattern: string, handler: Handler) => routes.set(pattern, handler),
  }
  const send = async (path: string, body: FormData | object) => {
    const raw =
      body instanceof FormData
        ? new Request('https://form.invalid', { method: 'POST', body })
        : new Request('https://form.invalid', { method: 'POST', body: JSON.stringify(body) })
    const headers = { 'content-type': raw.headers.get('content-type') ?? 'application/json' }
    const buffer = Buffer.from(await raw.arrayBuffer())
    let reply: Reply = { status: 0, json: null }
    await routes.get(`${STORAGE}/**`)?.({
      request: () => ({
        method: () => 'POST',
        url: () => `${STORAGE}${path}`,
        headers: () => headers,
        postDataJSON: () => JSON.parse(buffer.toString()),
        postDataBuffer: () => buffer,
      }),
      fulfill: ({ status = 200, json }) => {
        reply = { status, json }
      },
    })
    return reply
  }
  return { context, send }
}

const asset = {
  id: '7b000000-0000-4000-8000-000000000001',
  bucket: 'gallery',
  path: 'salon/registered.webp',
  name: 'registrerad.webp',
  alt: '',
  mime: 'image/webp',
  width: 1,
  height: 1,
  bytes: 1,
  archived: false,
  version: 0,
}

const withRow = (document: CmsDocument, path: string): CmsDocument => ({
  ...document,
  gallery: [
    {
      id: '7b000000-0000-4000-8000-0000000000c1',
      kind: 'salon',
      storage_path: path,
      alt: '',
      sort_order: 0,
    },
  ],
})

async function publishRow(send: ReturnType<typeof harness>['send'], path: string) {
  const state = (await send('/functions/v1/cms-studio', { operation: 'state' })).json as {
    revision: number
    fingerprint: string
    document: CmsDocument
  }
  const document = withRow(state.document, path)
  return {
    validate: await send('/functions/v1/cms-studio', { operation: 'validate', document }),
    publish: await send('/functions/v1/cms-studio', {
      operation: 'publish',
      document,
      baseRevision: state.revision,
      baseFingerprint: state.fingerprint,
      requestId: '7b000000-0000-4000-8000-0000000000f1',
    }),
  }
}

describe('e2e fake cms-studio storage inventory', () => {
  it('rejects a registered asset whose storage object is missing, like production', async () => {
    const { context, send } = harness()
    await nativeBackend(context, emptyDocument(), [asset], BASE, { objects: [] })
    const { validate, publish } = await publishRow(send, asset.path)
    for (const reply of [validate, publish]) {
      expect(reply.status).toBe(422)
      expect(reply.json).toEqual({ error: 'invalid_content', message: `media: ${MISSING}` })
    }
  })

  it('accepts a registered asset whose object exists by default', async () => {
    const { context, send } = harness()
    await nativeBackend(context, emptyDocument(), [asset], BASE)
    const { validate, publish } = await publishRow(send, asset.path)
    expect([validate.status, publish.status]).toEqual([200, 200])
  })

  it('stores an uploaded file both as an object and as a registered asset', async () => {
    const { context, send } = harness()
    const backend = await nativeBackend(context, emptyDocument(), [], BASE, {
      objects: [],
    })
    const form = new FormData()
    form.set('kind', 'cms_asset')
    form.set('purpose', 'salon')
    form.set('file', new File([new Uint8Array([1])], 'ny.png', { type: 'image/png' }))
    const uploaded = await send('/functions/v1/upload-image', form)
    expect(uploaded.status).toBe(200)
    const [stored] = backend.assets
    const { publish } = await publishRow(send, stored.path)
    expect(publish.status, JSON.stringify(publish.json)).toBe(200)
  })
})

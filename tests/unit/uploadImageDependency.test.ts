import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const media = vi.hoisted(() => {
  const profile: { role: 'owner' | 'barber'; barber_id: string | null; account_enabled: boolean } =
    {
      role: 'owner',
      barber_id: null,
      account_enabled: true,
    }
  return {
    profile,
    storedBucket: '',
    storedPath: '',
    upload: vi.fn(),
    rpc: vi.fn(),
    initialize: vi.fn(),
    readWasm: vi.fn(),
    process: vi.fn(),
  }
})
vi.mock('@imagemagick/magick-wasm', () => ({ initializeImageMagick: media.initialize }))
vi.mock('../../supabase/functions/upload-image/processImage', () => ({
  processImage: media.process,
  ImageValidationError: class extends Error {},
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'owner' } }, error: null }) },
    rpc: media.rpc,
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        update: () => query,
        maybeSingle: async () => ({
          data: table === 'barbers' ? { id: 'hassan' } : null,
          error: null,
        }),
        single: async () => ({
          data:
            table === 'profiles'
              ? media.profile
              : {
                  id: 'asset',
                  bucket: media.storedBucket,
                  path: media.storedPath,
                  name: 'photo.png',
                  alt: '',
                  mime: 'image/webp',
                  width: 2,
                  height: 1,
                  bytes: 2,
                  archived: false,
                  trashed_at: null,
                  version: 0,
                },
          error: null,
        }),
      }
      return query
    },
    storage: {
      from: (bucket: string) => ({
        upload: (path: string, bytes: Uint8Array, options: unknown) => {
          media.storedBucket = bucket
          media.storedPath = path
          return media.upload(path, bytes, options)
        },
        getPublicUrl: () => ({ data: { publicUrl: 'https://assets.example.test/image.webp' } }),
      }),
    },
  }),
}))

describe('upload image runtime dependency', () => {
  it('keeps ImageMagick in production dependencies at the exact Deno import-map version', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      readonly dependencies: Record<string, string>
      readonly devDependencies: Record<string, string>
    }
    const deno = JSON.parse(readFileSync('supabase/functions/upload-image/deno.json', 'utf8')) as {
      imports: Record<string, string>
    }
    expect(packageJson.dependencies['@imagemagick/magick-wasm']).toBe('0.0.42')
    expect(packageJson.devDependencies['@imagemagick/magick-wasm']).toBeUndefined()
    expect(deno.imports['@imagemagick/magick-wasm']).toBe(
      `npm:@imagemagick/magick-wasm@${packageJson.dependencies['@imagemagick/magick-wasm']}`,
    )
  })
})

describe('upload-image HTTP paths', () => {
  let handler: (request: Request) => Promise<Response>
  beforeEach(async () => {
    vi.resetModules()
    media.profile = { role: 'owner', barber_id: null, account_enabled: true }
    media.storedBucket = ''
    media.storedPath = ''
    media.upload.mockReset().mockResolvedValue({ error: null })
    media.rpc.mockReset().mockImplementation(async (name: string) => {
      if (name === 'internal_cms_assert_owner')
        return { data: null, error: media.profile.role === 'owner' ? null : { code: '42501' } }
      if (name === 'internal_replace_barber_photo')
        return { data: { ok: true, previous_path: null, deletion_id: null }, error: null }
      if (name === 'internal_delete_barber_photo') return { data: null, error: null }
      throw new Error(`Unexpected RPC: ${name}`)
    })
    media.initialize.mockReset().mockResolvedValue(undefined)
    media.readWasm.mockReset().mockResolvedValue(new Uint8Array([1]))
    media.process
      .mockReset()
      .mockReturnValue({ bytes: new Uint8Array([1, 2]), width: 2, height: 1 })
    vi.stubGlobal('Deno', {
      env: { get: () => 'unit-config' },
      readFile: media.readWasm,
      serve: (callback: typeof handler) => {
        handler = callback
      },
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('Unexpected network request')
      }),
    )
    await vi.importActual('../../supabase/functions/upload-image/index.ts')
  })
  afterEach(() => vi.unstubAllGlobals())

  it('handles preflight, rejected methods, JSON deletion and invalid multipart without loading the decoder', async () => {
    const url = 'https://edge.example.test/upload-image'
    expect((await handler(new Request(url, { method: 'OPTIONS' }))).status).toBe(200)
    expect((await handler(new Request(url))).status).toBe(405)
    const deleted = await handler(
      new Request(url, {
        method: 'POST',
        headers: { authorization: 'Bearer unit-token', 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'delete',
          kind: 'barber_photo',
          barberId: 'hassan',
          storagePath: 'hassan/photo.webp',
        }),
      }),
    )
    expect(deleted.status).toBe(404)
    expect(media.rpc).toHaveBeenCalledWith('internal_delete_barber_photo', {
      p_barber_id: 'hassan',
      p_expected_path: 'hassan/photo.webp',
    })
    expect(
      (
        await handler(
          new Request(url, {
            method: 'POST',
            headers: { authorization: 'Bearer unit-token', 'content-type': 'text/plain' },
            body: 'invalid',
          }),
        )
      ).status,
    ).toBe(400)
    expect(media.readWasm).not.toHaveBeenCalled()
    expect(media.initialize).not.toHaveBeenCalled()
    expect(media.process).not.toHaveBeenCalled()
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each(['barber_photo', 'cms_asset'])(
    'stores %s uploads as immutable objects with a one-year cache lifetime',
    async (kind) => {
      const form = new FormData()
      form.set('kind', kind)
      form.set('file', new File([new Uint8Array([1])], 'photo.png', { type: 'image/png' }))
      if (kind === 'barber_photo') form.set('barberId', 'hassan')
      else form.set('purpose', 'salon')
      const response = await handler(
        new Request('https://edge.example.test/upload-image', {
          method: 'POST',
          headers: { authorization: 'Bearer unit-token' },
          body: form,
        }),
      )
      expect(response.status).toBe(200)
      expect(media.upload).toHaveBeenCalledWith(
        expect.stringMatching(
          kind === 'cms_asset' ? /^salon\/[a-f0-9-]+\.webp$/ : /^hassan\/[a-f0-9-]+\.webp$/,
        ),
        new Uint8Array([1, 2]),
        {
          contentType: 'image/webp',
          upsert: false,
          cacheControl: '31536000',
        },
      )
      expect(media.storedBucket).toBe(kind === 'cms_asset' ? 'gallery' : 'barber-photos')
      const body = await response.json()
      if (kind === 'cms_asset') {
        expect(body.asset).toMatchObject({ id: 'asset', bucket: 'gallery', path: media.storedPath })
        expect(media.rpc.mock.calls.map(([name]) => name)).toEqual(['internal_cms_assert_owner'])
      } else {
        expect(body).toMatchObject({ ok: true, kind: 'barber_photo', row: { barber_id: 'hassan' } })
        expect(media.rpc).toHaveBeenCalledWith('internal_replace_barber_photo', {
          p_barber_id: 'hassan',
          p_expected_path: null,
          p_new_path: media.storedPath,
        })
      }
      expect(media.initialize).toHaveBeenCalledOnce()
      expect(fetch).not.toHaveBeenCalled()
    },
  )

  it.each(['gallery', 'site_logo'])(
    'rejects retired %s uploads and deletes for the owner before any side effect',
    async (kind) => {
      const url = 'https://edge.example.test/upload-image'
      const form = new FormData()
      form.set('kind', kind)
      form.set('file', new File(['x'], 'photo.png', { type: 'image/png' }))
      if (kind === 'gallery') {
        form.set('galleryKind', 'salon')
        form.set('alt', '')
        form.set('sortOrder', '0')
      } else form.set('expectedPath', '')
      const uploaded = await handler(
        new Request(url, {
          method: 'POST',
          headers: { authorization: 'Bearer unit-token' },
          body: form,
        }),
      )
      expect(uploaded.status).toBe(400)
      expect(await uploaded.json()).toMatchObject({ ok: false, error: 'invalid_payload' })

      const deleted = await handler(
        new Request(url, {
          method: 'POST',
          headers: { authorization: 'Bearer unit-token', 'content-type': 'application/json' },
          body: JSON.stringify(
            kind === 'gallery'
              ? {
                  action: 'delete',
                  kind,
                  id: '54000000-0000-4000-8000-000000000001',
                  storagePath: 'salon/photo.webp',
                }
              : {
                  action: 'delete',
                  kind,
                  storagePath: 'logo/54000000-0000-4000-8000-000000000001.webp',
                },
          ),
        }),
      )
      expect(deleted.status).toBe(400)
      expect(await deleted.json()).toMatchObject({ ok: false, error: 'invalid_payload' })
      expect(media.rpc).not.toHaveBeenCalled()
      expect(media.readWasm).not.toHaveBeenCalled()
      expect(media.process).not.toHaveBeenCalled()
      expect(media.upload).not.toHaveBeenCalled()
    },
  )

  it('keeps barber-photo writes scoped to the signed-in barber', async () => {
    media.profile = { role: 'barber', barber_id: 'hassan', account_enabled: true }
    const upload = async (barberId: string) => {
      const form = new FormData()
      form.set('kind', 'barber_photo')
      form.set('barberId', barberId)
      form.set('file', new File(['x'], 'photo.png', { type: 'image/png' }))
      return handler(
        new Request('https://edge.example.test/upload-image', {
          method: 'POST',
          headers: { authorization: 'Bearer unit-token' },
          body: form,
        }),
      )
    }
    expect((await upload('victor')).status).toBe(403)
    expect(media.upload).not.toHaveBeenCalled()
    expect(media.rpc).not.toHaveBeenCalled()
    expect((await upload('hassan')).status).toBe(200)
  })
})

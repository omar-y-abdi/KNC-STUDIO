import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const media = vi.hoisted(() => ({
  upload: vi.fn(),
  rpc: vi.fn(),
  initialize: vi.fn(),
  readWasm: vi.fn(),
  process: vi.fn(),
}))
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
        single: async () => ({
          data: table === 'profiles' ? { role: 'owner', account_enabled: true } : { id: 'asset' },
          error: null,
        }),
      }
      return query
    },
    storage: {
      from: () => ({
        upload: media.upload,
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
    media.upload.mockReset().mockResolvedValue({ error: null })
    media.rpc
      .mockReset()
      .mockImplementation(async (name: string, args: Record<string, unknown>) => ({
        data:
          name === 'internal_insert_gallery_image'
            ? {
                id: 'photo',
                kind: 'salon',
                storage_path: args.p_storage_path,
                alt: '',
                sort_order: 0,
              }
            : null,
        error: null,
      }))
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
          kind: 'gallery',
          id: '54000000-0000-4000-8000-000000000001',
          storagePath: 'salon/photo.webp',
        }),
      }),
    )
    expect(deleted.status).toBe(404)
    expect(media.rpc).toHaveBeenCalledWith('internal_delete_gallery_image', expect.any(Object))
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

  it.each(['gallery', 'cms_asset'])(
    'stores %s uploads as immutable objects with a one-year cache lifetime',
    async (kind) => {
      const form = new FormData()
      form.set('kind', kind)
      form.set('file', new File([new Uint8Array([1])], 'photo.png', { type: 'image/png' }))
      if (kind === 'gallery') {
        form.set('galleryKind', 'salon')
        form.set('alt', '')
        form.set('sortOrder', '0')
      } else form.set('purpose', 'salon')
      const response = await handler(
        new Request('https://edge.example.test/upload-image', {
          method: 'POST',
          headers: { authorization: 'Bearer unit-token' },
          body: form,
        }),
      )
      expect(response.status).toBe(200)
      expect(media.upload).toHaveBeenCalledWith(
        expect.stringMatching(/^salon\/[a-f0-9-]+\.webp$/),
        new Uint8Array([1, 2]),
        {
          contentType: 'image/webp',
          upsert: false,
          cacheControl: '31536000',
        },
      )
      expect(media.initialize).toHaveBeenCalledOnce()
      expect(fetch).not.toHaveBeenCalled()
    },
  )
})

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
    /** The barber's photo row before an upload: none for a first photo. */
    previousPhoto: vi.fn(),
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
        maybeSingle: async () =>
          table === 'barber_photos'
            ? media.previousPhoto()
            : {
                data: table === 'barbers' ? { id: 'hassan' } : null,
                error: null,
              },
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
    media.previousPhoto.mockReset().mockResolvedValue({ data: null, error: null })
    media.rpc.mockReset().mockImplementation(async (name: string) => {
      if (name === 'internal_cms_assert_owner')
        return { data: null, error: media.profile.role === 'owner' ? null : { code: '42501' } }
      if (name === 'internal_replace_barber_photo')
        return { data: { ok: true, previous_path: null, deletion_id: null }, error: null }
      if (name === 'internal_delete_barber_photo') return { data: null, error: null }
      if (name === 'internal_record_admin_action') return { data: null, error: null }
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
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

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
        if (typeof body !== 'object' || body === null || Array.isArray(body) || !('asset' in body))
          throw new Error('CMS upload must return a JSON object containing its asset')
        expect(body.asset).toMatchObject({ id: 'asset', bucket: 'gallery', path: media.storedPath })
        expect(media.rpc.mock.calls.map(([name]) => name)).toEqual(['internal_cms_assert_owner'])
      } else {
        expect(body).toMatchObject({ ok: true, kind: 'barber_photo', row: { barber_id: 'hassan' } })
        expect(media.rpc).toHaveBeenCalledWith('internal_replace_barber_photo', {
          p_barber_id: 'hassan',
          p_expected_path: null,
          p_new_path: media.storedPath,
        })
        // A first photo is a new row; the admin log names the caller, the barber and no value.
        expect(media.rpc.mock.calls.map(([name]) => name)).toEqual([
          'internal_replace_barber_photo',
          'internal_record_admin_action',
        ])
        expect(media.rpc).toHaveBeenLastCalledWith('internal_record_admin_action', {
          p_actor: 'owner',
          p_action: 'insert',
          p_target_table: 'barber_photos',
          p_target_id: 'hassan',
          p_detail: null,
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

  // internal_delete_barber_photo only ever queues a barber-photos object. A deletion naming any other
  // bucket is not one the gateway asked for, so no Storage object outside barber-photos is touched.
  // The photo row is deleted before its object is: the admin log entry follows the row.
  it.each([
    [
      'barber-photos',
      202,
      ['internal_delete_barber_photo', 'internal_record_admin_action', 'claim_external_action'],
    ],
    ['gallery', 404, ['internal_delete_barber_photo']],
  ])(
    'removes a deleted barber photo only from barber-photos (the RPC names %s)',
    async (bucket, status, calls) => {
      media.rpc.mockImplementation(async (name: string) => {
        if (name === 'internal_delete_barber_photo')
          return {
            data: {
              ok: true,
              bucket,
              path: 'hassan/photo.webp',
              deletion_id: '54000000-0000-4000-8000-000000000002',
            },
            error: null,
          }
        // An unclaimed action leaves the deletion queued: the response says it is still pending.
        if (name === 'claim_external_action') return { data: null, error: null }
        if (name === 'internal_record_admin_action') return { data: null, error: null }
        throw new Error(`Unexpected RPC: ${name}`)
      })
      const deleted = await handler(
        new Request('https://edge.example.test/upload-image', {
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
      expect(deleted.status).toBe(status)
      expect(media.rpc.mock.calls.map(([name]) => name)).toEqual(calls)
    },
  )

  // --- admin log ---------------------------------------------------------------------------------
  // The photo row is written with the service role, so the function itself says in the admin log
  // who changed it: after the row is written, and never for a request that changed no row.

  const AUDIT = 'internal_record_admin_action'
  const auditCalls = () => media.rpc.mock.calls.filter(([name]) => name === AUDIT)

  function uploadPhoto(): Promise<Response> {
    const form = new FormData()
    form.set('kind', 'barber_photo')
    form.set('barberId', 'hassan')
    form.set('file', new File([new Uint8Array([1])], 'photo.png', { type: 'image/png' }))
    return handler(
      new Request('https://edge.example.test/upload-image', {
        method: 'POST',
        headers: { authorization: 'Bearer unit-token' },
        body: form,
      }),
    )
  }

  function deletePhoto(): Promise<Response> {
    return handler(
      new Request('https://edge.example.test/upload-image', {
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
  }

  /** The database's answers for a barber who has a photo: a replace and a delete both find it. */
  function withExistingPhoto(audit: () => unknown): void {
    media.previousPhoto.mockResolvedValue({
      data: { storage_path: 'hassan/photo.webp' },
      error: null,
    })
    media.rpc.mockImplementation(async (name: string) => {
      if (name === 'internal_replace_barber_photo')
        return {
          data: {
            ok: true,
            previous_path: 'hassan/photo.webp',
            deletion_id: '54000000-0000-4000-8000-000000000003',
          },
          error: null,
        }
      if (name === 'internal_delete_barber_photo')
        return {
          data: {
            ok: true,
            bucket: 'barber-photos',
            path: 'hassan/photo.webp',
            deletion_id: '54000000-0000-4000-8000-000000000002',
          },
          error: null,
        }
      // The queued object deletion stays queued; the answer says so.
      if (name === 'claim_external_action') return { data: null, error: null }
      if (name === AUDIT) return audit()
      throw new Error(`Unexpected RPC: ${name}`)
    })
  }

  it('records a replaced photo as a changed path, by column name only', async () => {
    withExistingPhoto(() => ({ data: null, error: null }))

    const response = await uploadPhoto()

    expect(response.status).toBe(200)
    expect(media.rpc).toHaveBeenCalledWith('internal_replace_barber_photo', {
      p_barber_id: 'hassan',
      p_expected_path: 'hassan/photo.webp',
      p_new_path: media.storedPath,
    })
    expect(auditCalls()).toEqual([
      [
        AUDIT,
        {
          p_actor: 'owner',
          p_action: 'update',
          p_target_table: 'barber_photos',
          p_target_id: 'hassan',
          p_detail: { changed: ['storage_path'] },
        },
      ],
    ])
    expect(JSON.stringify(auditCalls())).not.toContain('.webp')
  })

  it('records a deleted photo under the caller', async () => {
    withExistingPhoto(() => ({ data: null, error: null }))

    const response = await deletePhoto()

    expect(response.status).toBe(202)
    expect(auditCalls()).toEqual([
      [
        AUDIT,
        {
          p_actor: 'owner',
          p_action: 'delete',
          p_target_table: 'barber_photos',
          p_target_id: 'hassan',
          p_detail: null,
        },
      ],
    ])
  })

  it('records nothing when the photo row was not written', async () => {
    media.rpc.mockImplementation(async (name: string) => {
      if (name === 'internal_replace_barber_photo')
        return { data: { ok: false, error: 'conflict' }, error: null }
      // What becomes of the uploaded object is not this test's subject: answered as retained, the
      // function leaves it alone.
      if (name === 'internal_cms_media_retained') return { data: true, error: null }
      throw new Error(`Unexpected RPC: ${name}`)
    })

    const response = await uploadPhoto()

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ ok: false, error: 'conflict' })
    expect(auditCalls()).toEqual([])
  })

  it('records nothing when there was no photo to delete or the caller may not write it', async () => {
    expect((await deletePhoto()).status).toBe(404)
    media.profile = { role: 'barber', barber_id: 'victor', account_enabled: true }
    expect((await deletePhoto()).status).toBe(403)
    expect((await uploadPhoto()).status).toBe(403)
    expect(auditCalls()).toEqual([])
  })

  it.each([
    [
      'refuses the entry',
      () => ({ data: null, error: { code: '22023', message: 'invalid target id hassan' } }),
      '22023',
    ],
    ['cannot be reached', () => Promise.reject(new TypeError('fetch failed')), 'TypeError'],
  ])(
    'answers an upload and a delete exactly the same when the admin log %s',
    async (_, failure, code) => {
      // The object path is random; hold it still so the two answers can be compared byte for byte.
      vi.spyOn(crypto, 'randomUUID').mockReturnValue('54000000-0000-4000-8000-000000000009')
      const answers = async () => {
        const uploaded = await uploadPhoto()
        const deleted = await deletePhoto()
        return [
          [uploaded.status, [...uploaded.headers], await uploaded.text()],
          [deleted.status, [...deleted.headers], await deleted.text()],
        ]
      }
      withExistingPhoto(() => ({ data: null, error: null }))
      const expected = await answers()
      const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)

      withExistingPhoto(failure)
      const actual = await answers()

      expect(actual).toEqual(expected)
      expect(expected.map(([status]) => status)).toEqual([200, 202])
      // The claim of the queued object deletion is unanswered in both runs and logs its own line;
      // the admin log adds the function and the error code, and nothing of the row.
      expect(logged.mock.calls.filter(([text]) => String(text).includes('admin log'))).toEqual([
        ['upload-image: admin log write failed:', code],
        ['upload-image: admin log write failed:', code],
      ])
      expect(JSON.stringify(logged.mock.calls)).not.toContain('.webp')
    },
  )

  /** The database's answers for a barber who has no photo: an upload stores the first one. */
  function withNoPhoto(audit: () => unknown): void {
    media.rpc.mockImplementation(async (name: string) => {
      if (name === 'internal_replace_barber_photo')
        return { data: { ok: true, previous_path: null, deletion_id: null }, error: null }
      if (name === AUDIT) return audit()
      throw new Error(`Unexpected RPC: ${name}`)
    })
  }

  // Whether the row was created or changed is what the write itself answered. The read before it
  // can be stale: another request may have stored or removed the photo in between.
  it.each([
    [
      'a changed path when the write found a photo the earlier read did not see',
      { data: null, error: null },
      'hassan/earlier.webp',
      'update',
      { changed: ['storage_path'] },
    ],
    [
      'a new row when the write found no photo although the earlier read saw one',
      { data: { storage_path: 'hassan/photo.webp' }, error: null },
      null,
      'insert',
      null,
    ],
  ])('records %s', async (_, earlierRead, previousPath, action, detail) => {
    media.previousPhoto.mockResolvedValue(earlierRead)
    media.rpc.mockImplementation(async (name: string) => {
      if (name === 'internal_replace_barber_photo')
        return { data: { ok: true, previous_path: previousPath, deletion_id: null }, error: null }
      if (name === AUDIT) return { data: null, error: null }
      throw new Error(`Unexpected RPC: ${name}`)
    })

    expect((await uploadPhoto()).status).toBe(200)

    expect(auditCalls()).toEqual([
      [
        AUDIT,
        {
          p_actor: 'owner',
          p_action: action,
          p_target_table: 'barber_photos',
          p_target_id: 'hassan',
          p_detail: detail,
        },
      ],
    ])
  })

  /** One real turn of the event loop, also while `setTimeout` is faked. */
  const turn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))
  /**
   * Wait until the function has asked for its admin log entry. It reads the request body on the
   * way, which answers after an unknown number of turns; two seconds is given up on, and the
   * assertions that follow say what is missing.
   */
  async function untilTheEntryIsAsked(): Promise<void> {
    const deadline = Date.now() + 2000
    while (auditCalls().length === 0 && Date.now() < deadline) await turn()
  }

  it.each([
    ['a first photo', withNoPhoto, uploadPhoto, 200, ['internal_replace_barber_photo', AUDIT]],
    [
      'a replaced photo',
      withExistingPhoto,
      uploadPhoto,
      200,
      ['internal_replace_barber_photo', AUDIT],
    ],
    [
      'a deleted photo',
      withExistingPhoto,
      deletePhoto,
      202,
      ['internal_delete_barber_photo', AUDIT],
    ],
  ])(
    'answers the request for %s only once the admin log has answered',
    async (_, arrange, request, status, asked) => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined)
      let release: (answer: unknown) => void = () => undefined
      arrange(
        () =>
          new Promise((resolve) => {
            release = resolve
          }),
      )
      const answered = vi.fn()

      const response = request()
      void response.then(answered)
      await untilTheEntryIsAsked()
      await turn()

      // The entry is on its way: nothing after it has started, and the answer waits.
      expect(media.rpc.mock.calls.map(([name]) => name)).toEqual(asked)
      expect(answered).not.toHaveBeenCalled()

      release({ data: null, error: null })
      expect((await response).status).toBe(status)
    },
  )

  it.each([
    ['an upload', withNoPhoto, uploadPhoto, 200],
    ['a delete', withExistingPhoto, deletePhoto, 202],
  ])(
    'answers %s exactly the same after 3 seconds when the admin log never answers',
    async (_, arrange, request, status) => {
      // The object path is random; hold it still so the two answers can be compared byte for byte.
      vi.spyOn(crypto, 'randomUUID').mockReturnValue('54000000-0000-4000-8000-000000000009')
      const read = async (response: Response) => [
        response.status,
        [...response.headers],
        await response.text(),
      ]
      arrange(() => ({ data: null, error: null }))
      const expected = await read(await request())
      const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      media.rpc.mockClear()
      arrange(() => new Promise(() => undefined))
      const answered = vi.fn()
      // Only the clock of the admin log bound is faked; the request and its answer run as they do.
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })

      const response = request()
      void response.then(answered)
      await untilTheEntryIsAsked()
      await vi.advanceTimersByTimeAsync(2999)
      expect(answered).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      vi.useRealTimers()

      expect(await read(await response)).toEqual(expected)
      expect(expected[0]).toBe(status)
      expect(logged.mock.calls.filter(([text]) => String(text).includes('admin log'))).toEqual([
        ['upload-image: admin log write failed:', 'timeout'],
      ])
    },
  )
})

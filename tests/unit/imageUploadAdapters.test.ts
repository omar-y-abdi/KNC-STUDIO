import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))

vi.mock('../../src/admin/adminClient', () => ({
  getAdminClient: () => ({
    functions: { invoke },
    storage: {
      from: () => ({
        getPublicUrl: (path: string) => ({
          data: {
            publicUrl: `https://example.supabase.co/storage/v1/object/public/gallery/${path}`,
          },
        }),
      }),
    },
  }),
}))

import { removeBarberPhoto, uploadBarberPhoto } from '../../src/admin/adapters/barberPhotoAdmin'
import { deleteImage, uploadImage } from '../../src/admin/adapters/galleryAdmin'
import {
  homepageLogoPublicUrl,
  removeHomepageLogo,
  uploadHomepageLogo,
} from '../../src/admin/adapters/homepageLogoAdmin'

function imageFile(): File {
  return new File(['image'], 'portrait.jpg', { type: 'image/jpeg' })
}

function submittedForm(): FormData {
  const call = invoke.mock.calls[0]
  const options = call?.[1] as { body?: unknown } | undefined
  expect(options?.body).toBeInstanceOf(FormData)
  return options?.body as FormData
}

beforeEach(() => {
  invoke.mockReset()
})

describe('image upload adapters', () => {
  const image = {
    id: '4d3f88f7-5e08-4d03-abfa-9604816f5614',
    kind: 'cuts' as const,
    storagePath: 'cuts/4d3f88f7.webp',
    alt: 'Cut',
    sortOrder: 0,
    url: 'https://example.invalid/image.webp',
  }
  const operations = [
    ['gallery upload', () => uploadImage('cuts', imageFile(), '', 0)],
    ['profile upload', () => uploadBarberPhoto('hassan', imageFile())],
    ['logo upload', () => uploadHomepageLogo(imageFile(), '')],
    ['gallery delete', () => deleteImage(image)],
    ['profile delete', () => removeBarberPhoto('hassan', 'hassan/photo.webp')],
    ['logo delete', () => removeHomepageLogo('logo/current.webp')],
  ] as const

  it.each(operations)('preserves authoritative HTTP failures for %s', async (_name, operation) => {
    for (const [status, kind] of [
      [401, 'auth'],
      [403, 'forbidden'],
      [400, 'validation'],
      [413, 'validation'],
      [422, 'validation'],
      [500, 'network'],
    ] as const) {
      invoke.mockResolvedValue({ data: null, error: { context: new Response(null, { status }) } })
      await expect(operation()).resolves.toMatchObject({ ok: false, error: { kind } })
    }
  })

  it.each(operations)(
    'treats malformed gateway context as transport failure for %s',
    async (_name, operation) => {
      for (const error of [
        new Error('offline'),
        { context: null },
        { context: '401' },
        { context: { status: '401' } },
      ]) {
        invoke.mockResolvedValue({ data: null, error })
        await expect(operation()).resolves.toMatchObject({ ok: false, error: { kind: 'network' } })
      }
    },
  )

  it.each(operations.filter(([name]) => name.endsWith('delete')))(
    'does not accept a denied delete as success for %s',
    async (_name, operation) => {
      invoke.mockResolvedValue({
        data: { ok: true, pending: false },
        error: { context: { status: 403 } },
      })
      await expect(operation()).resolves.toMatchObject({ ok: false, error: { kind: 'forbidden' } })
    },
  )

  it('keeps the logo optimistic-concurrency explanation for upload and delete', async () => {
    invoke.mockResolvedValue({ data: null, error: { context: { status: 409 } } })
    for (const operation of [
      () => uploadHomepageLogo(imageFile(), ''),
      () => removeHomepageLogo('logo/current.webp'),
    ]) {
      await expect(operation()).resolves.toEqual({
        ok: false,
        error: {
          kind: 'validation',
          message: 'Logotypen ändrades i en annan flik. Ladda om sidan.',
        },
      })
    }
  })

  it('submits a gallery image through the gateway and returns its parsed response', async () => {
    invoke.mockResolvedValue({
      data: {
        ok: true,
        kind: 'gallery',
        row: {
          id: '4d3f88f7-5e08-4d03-abfa-9604816f5614',
          kind: 'cuts',
          storage_path: 'cuts/4d3f88f7.webp',
          alt: 'Close crop',
          sort_order: 3,
        },
        path: 'cuts/4d3f88f7.webp',
        publicUrl:
          'https://example.supabase.co/storage/v1/object/public/gallery/cuts/4d3f88f7.webp',
      },
      error: null,
    })

    const result = await uploadImage('cuts', imageFile(), 'Close crop', 3)

    expect(result).toEqual({
      ok: true,
      value: {
        id: '4d3f88f7-5e08-4d03-abfa-9604816f5614',
        kind: 'cuts',
        storagePath: 'cuts/4d3f88f7.webp',
        alt: 'Close crop',
        sortOrder: 3,
        url: 'https://example.supabase.co/storage/v1/object/public/gallery/cuts/4d3f88f7.webp',
      },
    })
    expect(invoke).toHaveBeenCalledWith('upload-image', { body: expect.any(FormData) })
    const form = submittedForm()
    expect(form.get('kind')).toBe('gallery')
    expect(form.get('galleryKind')).toBe('cuts')
    expect(form.get('alt')).toBe('Close crop')
    expect(form.get('sortOrder')).toBe('3')
    expect(form.get('file')).toBeInstanceOf(File)
  })

  it('submits barber photos through the gateway without client-controlled replacement state', async () => {
    invoke.mockResolvedValue({
      data: {
        ok: true,
        kind: 'barber_photo',
        row: { barber_id: 'hassan', storage_path: 'hassan/4d3f88f7.webp' },
        path: 'hassan/4d3f88f7.webp',
        publicUrl:
          'https://example.supabase.co/storage/v1/object/public/barber-photos/hassan/4d3f88f7.webp',
      },
      error: null,
    })

    const result = await uploadBarberPhoto('hassan', imageFile())

    expect(result).toEqual({
      ok: true,
      value: {
        storagePath: 'hassan/4d3f88f7.webp',
        url: 'https://example.supabase.co/storage/v1/object/public/barber-photos/hassan/4d3f88f7.webp',
      },
    })
    const form = submittedForm()
    expect(form.get('kind')).toBe('barber_photo')
    expect(form.get('barberId')).toBe('hassan')
    expect(form.has('previousPath')).toBe(false)
  })

  it('maps gateway image validation failures to a typed validation error', async () => {
    invoke.mockResolvedValue({ data: null, error: { context: { status: 422 } } })

    const result = await uploadImage('salon', imageFile(), '', 0)

    expect(result).toEqual({
      ok: false,
      error: { kind: 'validation', message: 'Bilden uppfyller inte kraven.' },
    })
  })

  it('rejects malformed success bodies rather than accepting unparsed storage data', async () => {
    invoke.mockResolvedValue({
      data: { ok: true, kind: 'barber_photo', row: { barber_id: 'hassan' } },
      error: null,
    })

    const result = await uploadBarberPhoto('hassan', imageFile())

    expect(result).toEqual({
      ok: false,
      error: { kind: 'malformed', message: 'Kunde inte ladda upp bilden. Försök igen.' },
    })
  })

  it('deletes gallery metadata and bytes through the durable gateway', async () => {
    invoke.mockResolvedValue({ data: { ok: true, pending: true }, error: null })
    const image = {
      id: '4d3f88f7-5e08-4d03-abfa-9604816f5614',
      kind: 'cuts' as const,
      storagePath: 'cuts/4d3f88f7.webp',
      alt: 'Cut',
      sortOrder: 0,
      url: 'https://example.invalid/image.webp',
    }

    const result = await deleteImage(image)

    expect(result).toEqual({ ok: true, value: { pending: true } })
    expect(invoke).toHaveBeenCalledWith('upload-image', {
      body: {
        action: 'delete',
        kind: 'gallery',
        id: image.id,
        storagePath: image.storagePath,
      },
    })
  })

  it('deletes barber photos through the same durable gateway', async () => {
    invoke.mockResolvedValue({ data: { ok: true, pending: false }, error: null })

    const result = await removeBarberPhoto('hassan', 'hassan/photo.webp')

    expect(result).toEqual({ ok: true, value: { pending: false } })
    expect(invoke).toHaveBeenCalledWith('upload-image', {
      body: {
        action: 'delete',
        kind: 'barber_photo',
        barberId: 'hassan',
        storagePath: 'hassan/photo.webp',
      },
    })
  })

  it('previews, uploads, and removes homepage logo only through the authenticated gateway', async () => {
    invoke.mockResolvedValueOnce({
      data: {
        ok: true,
        kind: 'site_logo',
        path: 'logo/123e4567-e89b-42d3-a456-426614174000.webp',
        publicUrl:
          'https://example.supabase.co/storage/v1/object/public/gallery/logo/123e4567-e89b-42d3-a456-426614174000.webp',
        cleanupPending: true,
      },
      error: null,
    })
    const upload = await uploadHomepageLogo(imageFile(), '')
    expect(upload).toEqual({
      ok: true,
      value: {
        path: 'logo/123e4567-e89b-42d3-a456-426614174000.webp',
        url: 'https://example.supabase.co/storage/v1/object/public/gallery/logo/123e4567-e89b-42d3-a456-426614174000.webp',
        cleanupPending: true,
      },
    })
    const form = submittedForm()
    expect(form.get('kind')).toBe('site_logo')
    expect(form.get('expectedPath')).toBe('')
    expect(homepageLogoPublicUrl('logo/current.webp')).toBe(
      'https://example.supabase.co/storage/v1/object/public/gallery/logo/current.webp',
    )

    invoke.mockResolvedValueOnce({ data: { ok: true, pending: false }, error: null })
    await expect(
      removeHomepageLogo('logo/123e4567-e89b-42d3-a456-426614174000.webp'),
    ).resolves.toEqual({
      ok: true,
      value: { pending: false },
    })
    expect(invoke).toHaveBeenLastCalledWith('upload-image', {
      body: {
        action: 'delete',
        kind: 'site_logo',
        storagePath: 'logo/123e4567-e89b-42d3-a456-426614174000.webp',
      },
    })
  })
})

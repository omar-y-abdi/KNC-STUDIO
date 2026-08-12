import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))

vi.mock('../../src/admin/adminClient', () => ({
  getAdminClient: () => ({ functions: { invoke } }),
}))

import { uploadBarberPhoto } from '../../src/admin/adapters/barberPhotoAdmin'
import { uploadImage } from '../../src/admin/adapters/galleryAdmin'

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
})

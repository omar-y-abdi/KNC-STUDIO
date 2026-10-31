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
  const operations = [
    ['profile upload', () => uploadBarberPhoto('hassan', imageFile())],
    ['profile delete', () => removeBarberPhoto('hassan', 'hassan/photo.webp')],
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

    const result = await uploadBarberPhoto('hassan', imageFile())

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
})

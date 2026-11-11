import { beforeEach, describe, expect, it, vi } from 'vitest'

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }))

vi.mock('../../modules/staff-admin/src/adminClient', () => ({
  getAdminClient: () => ({
    functions: { invoke },
    storage: {
      from: (bucket: string) => ({
        getPublicUrl: (path: string) => ({
          data: {
            publicUrl: `https://example.supabase.co/storage/v1/object/public/${bucket}/${path}`,
          },
        }),
      }),
    },
  }),
}))

import {
  barberWorkUrl,
  removeBarberPhoto,
  removeBarberWork,
  uploadBarberPhoto,
  uploadBarberWork,
} from '../../modules/staff-admin/src/adapters/barberPhotoAdmin'

const WORK_ID = '4d3f88f7-2c1a-4b7e-9a51-0e6f3c2b1a90'
const WORK_PATH = `hassan/${WORK_ID}.webp`

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
    ['work upload', () => uploadBarberWork('hassan', imageFile())],
    ['work delete', () => removeBarberWork('hassan', WORK_PATH)],
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

  it('submits work pictures as kind barber_work and keeps the id and path it gets back', async () => {
    invoke.mockResolvedValue({
      data: {
        ok: true,
        kind: 'barber_work',
        id: WORK_ID,
        path: WORK_PATH,
        publicUrl: `https://example.supabase.co/storage/v1/object/public/barber-work/${WORK_PATH}`,
      },
      error: null,
    })
    const file = imageFile()

    const result = await uploadBarberWork('hassan', file)

    expect(result).toEqual({ ok: true, value: { id: WORK_ID, path: WORK_PATH } })
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke.mock.calls[0]?.[0]).toBe('upload-image')
    const form = submittedForm()
    expect([...form.keys()].sort()).toEqual(['barberId', 'file', 'kind'])
    expect(form.get('kind')).toBe('barber_work')
    expect(form.get('barberId')).toBe('hassan')
    expect(form.get('file')).toBeInstanceOf(File)
    expect((form.get('file') as File).name).toBe(file.name)
  })

  it.each([
    [
      'a profile-photo answer',
      {
        ok: true,
        kind: 'barber_photo',
        row: { barber_id: 'hassan', storage_path: 'hassan/4d3f88f7.webp' },
        path: 'hassan/4d3f88f7.webp',
        publicUrl:
          'https://example.supabase.co/storage/v1/object/public/barber-photos/hassan/4d3f88f7.webp',
      },
    ],
    [
      'an id that is not a uuid',
      {
        ok: true,
        kind: 'barber_work',
        id: 'picture-1',
        path: WORK_PATH,
        publicUrl: `https://example.supabase.co/storage/v1/object/public/barber-work/${WORK_PATH}`,
      },
    ],
    ['an empty path', { ok: true, kind: 'barber_work', id: WORK_ID, path: '', publicUrl: 'x' }],
  ])('refuses %s as a work upload answer', async (_name, data) => {
    invoke.mockResolvedValue({ data, error: null })

    const result = await uploadBarberWork('hassan', imageFile())

    expect(result).toEqual({
      ok: false,
      error: { kind: 'malformed', message: 'Kunde inte ladda upp bilden. Försök igen.' },
    })
  })

  it('deletes a work picture by the path the profile read gave', async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null })

    const result = await removeBarberWork('hassan', WORK_PATH)

    expect(result).toEqual({ ok: true, value: undefined })
    expect(invoke).toHaveBeenCalledWith('upload-image', {
      body: { action: 'delete', kind: 'barber_work', barberId: 'hassan', storagePath: WORK_PATH },
    })
  })

  it.each([
    ['ok false', { ok: false }],
    ['no body', null],
  ])('refuses a work delete answer with %s', async (_name, data) => {
    invoke.mockResolvedValue({ data, error: null })

    const result = await removeBarberWork('hassan', WORK_PATH)

    expect(result).toEqual({
      ok: false,
      error: { kind: 'malformed', message: 'Kunde inte ta bort bilden. Försök igen.' },
    })
  })

  it('maps a refused work delete path to the reload message', async () => {
    invoke.mockResolvedValue({
      data: null,
      error: { context: new Response(null, { status: 400 }) },
    })

    const result = await removeBarberWork('hassan', WORK_PATH)

    expect(result).toEqual({
      ok: false,
      error: { kind: 'validation', message: 'Bilden kunde inte tas bort. Ladda om sidan.' },
    })
  })

  it('builds a work picture URL in the barber-work bucket', () => {
    expect(barberWorkUrl(WORK_PATH)).toBe(
      `https://example.supabase.co/storage/v1/object/public/barber-work/${WORK_PATH}`,
    )
  })
})

// The Profil tab's profile port against a mocked client: each function and gateway call, its
// arguments, every answer of the contract and every way it can fail.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { rpc, invoke } = vi.hoisted(() => ({ rpc: vi.fn(), invoke: vi.fn() }))

vi.mock('../../modules/staff-admin/src/adminClient', () => ({
  getAdminClient: () => ({ rpc, functions: { invoke } }),
}))

import {
  barberProfilePort,
  orderedProfileOperation,
  PROFILE_FAILED,
} from '../../modules/staff-admin/src/adapters/barberProfile'
import {
  staffBarberProfileResponse,
  staffUpdateBarberProfileResponse,
  uploadBarberWorkResponse,
} from '../../modules/staff-admin/src/adminSchemas'
import { invalidateAdminOperations } from '../../modules/staff-admin/src/orderedOperations'
import type { BarberProfileDetails, ProfileResult } from '../../modules/staff-admin/src/types'

const ID_NEW = '4d3f88f7-2b1c-4c5e-9f0a-1b2c3d4e5f60'
const ID_OLD = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'
const PATH_NEW = `hassan/${ID_NEW}.webp`
const PATH_OLD = `hassan/${ID_OLD}.webp`
const WORK_URL = `https://example.supabase.co/storage/v1/object/public/barber-work/${PATH_NEW}`

const STORED = { name: 'Hassan', ig: 'hassan.cuts', tiktok: '', bio_sv: 'Hej', bio_en: 'Hi' }
const DETAILS: BarberProfileDetails = {
  name: 'Hassan',
  ig: 'hassan.cuts',
  tiktok: '',
  bioSv: 'Hej',
  bioEn: 'Hi',
}

const answer = (data: unknown) => ({ data, error: null, status: 200 })
const withPicture = (picture: Record<string, unknown>) => ({
  ok: true,
  profile: STORED,
  work: [{ id: ID_NEW, path: PATH_NEW, hidden: false, ...picture }],
})
const CLIENT_ERRORS = [
  ['a missing function', { code: 'PGRST202', message: 'Could not find the function' }, 404],
  ['an expired session', { code: 'PGRST301', message: 'JWT expired' }, 401],
  ['a refusal', { code: '42501', message: 'permission denied' }, 403],
] as const

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0))

function imageFile(): File {
  return new File(['image'], 'cut.jpg', { type: 'image/jpeg' })
}

beforeEach(() => {
  rpc.mockReset()
  invoke.mockReset()
})

describe('profile read', () => {
  it('reads staff_barber_profile for the barber and keeps the pictures newest first', async () => {
    rpc.mockResolvedValue(
      answer({
        ok: true,
        profile: STORED,
        work: [
          { id: ID_NEW, path: PATH_NEW, hidden: false },
          { id: ID_OLD, path: PATH_OLD, hidden: true },
        ],
      }),
    )

    await expect(barberProfilePort.read('hassan')).resolves.toEqual({
      ok: true,
      value: {
        details: DETAILS,
        work: [
          { id: ID_NEW, path: PATH_NEW, hidden: false },
          { id: ID_OLD, path: PATH_OLD, hidden: true },
        ],
      },
    })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('staff_barber_profile', { p_barber_id: 'hassan' })
  })

  it('reads a barber without pictures', async () => {
    rpc.mockResolvedValue(answer({ ok: true, profile: STORED, work: [] }))

    await expect(barberProfilePort.read('hassan')).resolves.toEqual({
      ok: true,
      value: { details: DETAILS, work: [] },
    })
  })

  it('gives a refusal as forbidden', async () => {
    rpc.mockResolvedValue(answer({ ok: false, error: 'forbidden' }))

    await expect(barberProfilePort.read('victor')).resolves.toEqual({
      ok: false,
      error: 'forbidden',
    })
  })

  it.each([
    ['an unknown barber', { ok: false, error: 'not_found' }],
    ['an unknown error code', { ok: false, error: 'invalid_name' }],
    ['a profile without tiktok', { ok: true, profile: { ...STORED, tiktok: undefined }, work: [] }],
    ['a profile without work', { ok: true, profile: STORED }],
    ['a picture id that is not a uuid', withPicture({ id: '1' })],
    ['an empty picture path', withPicture({ path: '' })],
    ['a hidden flag that is not a boolean', withPicture({ hidden: 'no' })],
    ['no ok flag', { profile: STORED, work: [] }],
    ['null', null],
    ['a string', 'profile'],
  ])('%s is failed', async (_label, data) => {
    rpc.mockResolvedValue(answer(data))

    await expect(barberProfilePort.read('hassan')).resolves.toBe(PROFILE_FAILED)
  })

  it.each(CLIENT_ERRORS)('a client error (%s) is failed', async (_label, error, status) => {
    rpc.mockResolvedValue({ data: null, error, status })

    await expect(barberProfilePort.read('hassan')).resolves.toBe(PROFILE_FAILED)
  })

  it('a thrown client is failed', async () => {
    rpc.mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(barberProfilePort.read('hassan')).resolves.toBe(PROFILE_FAILED)
  })
})

describe('profile save', () => {
  const typed: BarberProfileDetails = {
    name: '  Hassan  ',
    ig: '@hassan.cuts',
    tiktok: '',
    bioSv: 'Hej',
    bioEn: 'Hi',
  }

  it('sends every field to staff_update_barber_profile and returns what was stored', async () => {
    rpc.mockResolvedValue(answer({ ok: true, profile: STORED }))

    await expect(barberProfilePort.save('hassan', typed)).resolves.toEqual({
      ok: true,
      value: DETAILS,
    })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('staff_update_barber_profile', {
      p_barber_id: 'hassan',
      p_name: '  Hassan  ',
      p_ig: '@hassan.cuts',
      p_tiktok: '',
      p_bio_sv: 'Hej',
      p_bio_en: 'Hi',
    })
  })

  it.each(['invalid_name', 'invalid_handle', 'invalid_bio', 'forbidden'] as const)(
    'gives %s as its own failure',
    async (code) => {
      rpc.mockResolvedValue(answer({ ok: false, error: code }))

      await expect(barberProfilePort.save('hassan', typed)).resolves.toEqual({
        ok: false,
        error: code,
      })
    },
  )

  it.each([
    ['an unknown barber', { ok: false, error: 'not_found' }],
    ['an unknown error code', { ok: false, error: 'rate_limited' }],
    ['a success without the stored profile', { ok: true }],
    ['a stored name that is not a string', { ok: true, profile: { ...STORED, name: 7 } }],
    ['null', null],
  ])('%s is failed', async (_label, data) => {
    rpc.mockResolvedValue(answer(data))

    await expect(barberProfilePort.save('hassan', typed)).resolves.toBe(PROFILE_FAILED)
  })

  it.each(CLIENT_ERRORS)('a client error (%s) is failed', async (_label, error, status) => {
    rpc.mockResolvedValue({ data: null, error, status })

    await expect(barberProfilePort.save('hassan', typed)).resolves.toBe(PROFILE_FAILED)
  })

  it('a thrown client is failed', async () => {
    rpc.mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(barberProfilePort.save('hassan', typed)).resolves.toBe(PROFILE_FAILED)
  })
})

describe('work picture upload', () => {
  const uploaded = {
    ok: true,
    kind: 'barber_work',
    id: ID_NEW,
    path: PATH_NEW,
    publicUrl: WORK_URL,
  }

  it('posts kind barber_work, the file and the barber to upload-image', async () => {
    invoke.mockResolvedValue({ data: uploaded, error: null })

    await expect(barberProfilePort.uploadWork('hassan', imageFile())).resolves.toEqual({
      ok: true,
      value: { id: ID_NEW, path: PATH_NEW, hidden: false },
    })
    expect(invoke).toHaveBeenCalledTimes(1)
    const [name, options] = invoke.mock.calls[0] ?? []
    expect(name).toBe('upload-image')
    const form: unknown = options?.body
    if (!(form instanceof FormData)) throw new Error('the upload is not multipart')
    expect([...form.keys()].sort()).toEqual(['barberId', 'file', 'kind'])
    expect(form.get('kind')).toBe('barber_work')
    expect(form.get('barberId')).toBe('hassan')
    const file = form.get('file')
    expect(file instanceof File && file.name).toBe('cut.jpg')
  })

  it.each([400, 401, 403, 413, 422, 500])('an HTTP %i answer is failed', async (status) => {
    invoke.mockResolvedValue({ data: null, error: { context: new Response(null, { status }) } })

    await expect(barberProfilePort.uploadWork('hassan', imageFile())).resolves.toBe(PROFILE_FAILED)
  })

  it.each([
    [
      'the profile photo answer',
      {
        ok: true,
        kind: 'barber_photo',
        row: { barber_id: 'hassan', storage_path: PATH_NEW },
        path: PATH_NEW,
        publicUrl: WORK_URL,
      },
    ],
    ['an answer without an id', { ...uploaded, id: undefined }],
    ['an id that is not a uuid', { ...uploaded, id: 'new' }],
    ['an answer without a public URL', { ...uploaded, publicUrl: undefined }],
    ['ok false', { ok: false, error: 'database_failed' }],
  ])('%s is failed', async (_label, data) => {
    invoke.mockResolvedValue({ data, error: null })

    await expect(barberProfilePort.uploadWork('hassan', imageFile())).resolves.toBe(PROFILE_FAILED)
  })

  it('a thrown client is failed', async () => {
    invoke.mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(barberProfilePort.uploadWork('hassan', imageFile())).resolves.toBe(PROFILE_FAILED)
  })
})

describe('work picture removal', () => {
  it('sends the delete for exactly the stored path', async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null })

    await expect(barberProfilePort.removeWork('hassan', PATH_NEW)).resolves.toEqual({
      ok: true,
      value: undefined,
    })
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke).toHaveBeenCalledWith('upload-image', {
      body: { action: 'delete', kind: 'barber_work', barberId: 'hassan', storagePath: PATH_NEW },
    })
  })

  it.each([400, 401, 403, 500])('an HTTP %i answer is failed', async (status) => {
    invoke.mockResolvedValue({ data: null, error: { context: new Response(null, { status }) } })

    await expect(barberProfilePort.removeWork('hassan', PATH_NEW)).resolves.toBe(PROFILE_FAILED)
  })

  it.each([
    ['ok false', { ok: false, error: 'storage_failed' }],
    ['no body', null],
  ])('%s is failed', async (_label, data) => {
    invoke.mockResolvedValue({ data, error: null })

    await expect(barberProfilePort.removeWork('hassan', PATH_NEW)).resolves.toBe(PROFILE_FAILED)
  })

  it('a thrown client is failed', async () => {
    invoke.mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(barberProfilePort.removeWork('hassan', PATH_NEW)).resolves.toBe(PROFILE_FAILED)
  })
})

describe('work picture visibility', () => {
  it.each([true, false])('sends hidden %s to the hide function', async (hidden) => {
    rpc.mockResolvedValue(answer({ ok: true }))

    await expect(barberProfilePort.setWorkHidden(ID_NEW, hidden)).resolves.toEqual({
      ok: true,
      value: undefined,
    })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('staff_set_barber_work_photo_hidden', {
      p_id: ID_NEW,
      p_hidden: hidden,
    })
  })

  it.each([
    ['a refusal', { ok: false, error: 'forbidden' }],
    ['an unknown picture', { ok: false, error: 'not_found' }],
    ['no ok flag', {}],
    ['null', null],
  ])('%s is failed', async (_label, data) => {
    rpc.mockResolvedValue(answer(data))

    await expect(barberProfilePort.setWorkHidden(ID_NEW, true)).resolves.toBe(PROFILE_FAILED)
  })

  it.each(CLIENT_ERRORS)('a client error (%s) is failed', async (_label, error, status) => {
    rpc.mockResolvedValue({ data: null, error, status })

    await expect(barberProfilePort.setWorkHidden(ID_NEW, true)).resolves.toBe(PROFILE_FAILED)
  })

  it('a thrown client is failed', async () => {
    rpc.mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(barberProfilePort.setWorkHidden(ID_NEW, true)).resolves.toBe(PROFILE_FAILED)
  })
})

describe('the response schemas', () => {
  it('drop keys the contract does not name', () => {
    expect(
      staffBarberProfileResponse.parse({
        ok: true,
        profile: { ...STORED, role_sv: 'Barberare' },
        work: [{ id: ID_NEW, path: PATH_NEW, hidden: false, created_at: '2026-11-11' }],
      }),
    ).toEqual({ ok: true, profile: STORED, work: [{ id: ID_NEW, path: PATH_NEW, hidden: false }] })
  })

  it('accept every save failure of the contract and nothing else', () => {
    for (const error of ['forbidden', 'not_found', 'invalid_name', 'invalid_handle', 'invalid_bio'])
      expect(staffUpdateBarberProfileResponse.safeParse({ ok: false, error }).success).toBe(true)
    const failed = staffUpdateBarberProfileResponse.safeParse({ ok: false, error: 'failed' })
    expect(failed.success).toBe(false)
  })

  it('require the work upload kind', () => {
    const base = { ok: true, id: ID_NEW, path: PATH_NEW, publicUrl: WORK_URL }
    expect(uploadBarberWorkResponse.safeParse({ ...base, kind: 'barber_work' }).success).toBe(true)
    const photo = uploadBarberWorkResponse.safeParse({ ...base, kind: 'barber_photo' })
    expect(photo.success).toBe(false)
  })
})

describe('profile operations in order', () => {
  it('runs after the barber’s earlier operation and passes its result through', async () => {
    const order: string[] = []
    let release: () => void = () => undefined
    const first = orderedProfileOperation(
      'hassan',
      async (): Promise<ProfileResult<number, never>> => {
        order.push('first started')
        await new Promise<void>((resolve) => {
          release = resolve
        })
        order.push('first ended')
        return { ok: true, value: 1 }
      },
    )
    const second = orderedProfileOperation(
      'hassan',
      async (): Promise<ProfileResult<number, 'forbidden'>> => {
        order.push('second started')
        return { ok: false, error: 'forbidden' }
      },
    )
    await flush()
    expect(order).toEqual(['first started'])
    release()

    await expect(first).resolves.toEqual({ ok: true, value: 1 })
    await expect(second).resolves.toEqual({ ok: false, error: 'forbidden' })
    expect(order).toEqual(['first started', 'first ended', 'second started'])
  })

  it('never starts an operation queued before the session ended, and calls both failed', async () => {
    let release: () => void = () => undefined
    const first = orderedProfileOperation(
      'hassan',
      async (): Promise<ProfileResult<number, never>> => {
        await new Promise<void>((resolve) => {
          release = resolve
        })
        return { ok: true, value: 1 }
      },
    )
    await flush()
    const second = vi.fn(async (): Promise<ProfileResult<number, never>> => ({
      ok: true,
      value: 2,
    }))
    const queued = orderedProfileOperation('hassan', second)
    invalidateAdminOperations()
    release()

    await expect(first).resolves.toBe(PROFILE_FAILED)
    await expect(queued).resolves.toBe(PROFILE_FAILED)
    expect(second).not.toHaveBeenCalled()
  })
})

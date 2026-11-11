import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const backend = vi.hoisted(() => ({
  rpc: vi.fn(),
  list: vi.fn(),
  remove: vi.fn(),
}))
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'owner' } }, error: null }) },
    rpc: backend.rpc,
    from: () => {
      const query = {
        select: () => query,
        eq: () => query,
        single: async () => ({ data: { role: 'owner', account_enabled: true }, error: null }),
      }
      return query
    },
    storage: {
      from: (bucket: string) => ({
        list: (path: string, options: unknown) => backend.list(bucket, path, options),
        remove: (paths: string[]) => backend.remove(bucket, paths),
      }),
    },
  }),
}))

const DELETED = { ok: true, deleted_bookings: 0, auth_action_id: null }
const ANSWER = { ok: true, deleted_bookings: 0, auth_cleanup_pending: false }
const entries = (names: readonly string[]) => names.map((name) => ({ name, id: name }))
const pictures = (count: number, prefix: string) =>
  entries(Array.from({ length: count }, (_, index) => `${prefix}-${index}.webp`))

describe('admin-manage-barber deletes a barber with their work pictures', () => {
  let handler: (request: Request) => Promise<Response>
  beforeEach(async () => {
    vi.resetModules()
    backend.rpc.mockReset().mockImplementation(async (name: string) => {
      if (name === 'admin_delete_barber') return { data: DELETED, error: null }
      throw new Error(`Unexpected RPC: ${name}`)
    })
    backend.list.mockReset().mockResolvedValue({ data: [], error: null })
    backend.remove.mockReset().mockResolvedValue({ data: [], error: null })
    vi.stubGlobal('Deno', {
      env: { get: () => 'unit-config' },
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
    await vi.importActual('../../supabase/functions/admin-manage-barber/index.ts')
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  const send = (body: unknown): Promise<Response> =>
    handler(
      new Request('https://edge.example.test/admin-manage-barber', {
        method: 'POST',
        headers: { authorization: 'Bearer unit-token', 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    )
  const deleteBarber = () => send({ action: 'delete', barber_id: 'hassan', purge_bookings: false })
  const read = async (response: Response) => [response.status, await response.json()]

  it('removes the barber-work objects under the barber after the barber row is deleted', async () => {
    const order: string[] = []
    backend.rpc.mockImplementation(async (name: string) => {
      order.push(name)
      if (name === 'admin_delete_barber')
        return {
          data: { ...DELETED, auth_action_id: '54000000-0000-4000-8000-000000000001' },
          error: null,
        }
      // The queued auth deletion stays queued; the answer says so, as before.
      if (name === 'claim_external_action') return { data: null, error: null }
      throw new Error(`Unexpected RPC: ${name}`)
    })
    backend.list.mockImplementation(async () => {
      order.push('list')
      return { data: entries(['a.webp', 'b.webp']), error: null }
    })
    backend.remove.mockImplementation(async (_bucket: string, paths: string[]) => {
      order.push('remove')
      return { data: entries(paths), error: null }
    })

    expect(await read(await deleteBarber())).toEqual([
      200,
      { ...ANSWER, auth_cleanup_pending: true },
    ])
    expect(order).toEqual(['admin_delete_barber', 'claim_external_action', 'list', 'remove'])
    expect(backend.list).toHaveBeenCalledExactlyOnceWith('barber-work', 'hassan', { limit: 100 })
    expect(backend.remove).toHaveBeenCalledExactlyOnceWith('barber-work', [
      'hassan/a.webp',
      'hassan/b.webp',
    ])
  })

  it('keeps removing until a page is not full', async () => {
    const first = pictures(100, 'first')
    backend.list
      .mockResolvedValueOnce({ data: first, error: null })
      .mockResolvedValueOnce({ data: entries(['last.webp']), error: null })
    backend.remove.mockImplementation(async (_bucket: string, paths: string[]) => ({
      data: entries(paths),
      error: null,
    }))

    expect(await read(await deleteBarber())).toEqual([200, ANSWER])
    expect(backend.list).toHaveBeenCalledTimes(2)
    expect(backend.remove.mock.calls).toEqual([
      ['barber-work', first.map(({ name }) => `hassan/${name}`)],
      ['barber-work', ['hassan/last.webp']],
    ])
  })

  it('removes nothing when the barber has no work pictures', async () => {
    expect(await read(await deleteBarber())).toEqual([200, ANSWER])
    expect(backend.list).toHaveBeenCalledOnce()
    expect(backend.remove).not.toHaveBeenCalled()
  })

  it.each([
    ['has bookings', { ok: false, error: 'has_bookings', count: 1, past: 1, upcoming: 0 }, 409],
    [
      'has upcoming bookings',
      { ok: false, error: 'has_upcoming', count: 1, past: 0, upcoming: 1 },
      409,
    ],
    ['is missing', { ok: false, error: 'not_found' }, 409],
    ['is refused', { ok: false, error: 'forbidden' }, 409],
    [
      'waits for calendar cleanup',
      { ok: false, error: 'external_cleanup_pending', calendar_events: 1 },
      409,
    ],
    ['answers nothing usable', null, 500],
  ])('touches no work picture when the barber %s', async (_, data, status) => {
    backend.rpc.mockResolvedValue({ data, error: null })

    expect((await deleteBarber()).status).toBe(status)
    expect(backend.list).not.toHaveBeenCalled()
    expect(backend.remove).not.toHaveBeenCalled()
  })

  it('touches no work picture when the delete transaction fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    backend.rpc.mockResolvedValue({ data: null, error: { code: '40001' } })

    expect(await read(await deleteBarber())).toEqual([500, { ok: false, error: 'database_failed' }])
    expect(backend.list).not.toHaveBeenCalled()
  })

  it('touches no work picture when access changes', async () => {
    backend.rpc.mockImplementation(async (name: string) => {
      if (name === 'admin_set_barber_account_enabled')
        return { data: { action_id: '54000000-0000-4000-8000-000000000002' }, error: null }
      if (name === 'claim_external_action') return { data: null, error: null }
      throw new Error(`Unexpected RPC: ${name}`)
    })

    const response = await send({ action: 'set_access', barber_id: 'hassan', enabled: false })

    expect(response.status).toBe(200)
    expect(backend.list).not.toHaveBeenCalled()
    expect(backend.remove).not.toHaveBeenCalled()
  })

  it.each([
    [
      'the bucket is missing',
      () => backend.list.mockResolvedValue({ data: null, error: { message: 'Bucket not found' } }),
      'admin-manage-barber: work picture listing failed',
    ],
    [
      'removal fails',
      () => {
        backend.list.mockResolvedValue({ data: entries(['a.webp']), error: null })
        backend.remove.mockResolvedValue({ data: null, error: { message: 'storage unavailable' } })
      },
      'admin-manage-barber: work picture removal failed',
    ],
    [
      'removal removes nothing from a full page',
      () => {
        backend.list.mockResolvedValue({ data: pictures(100, 'stuck'), error: null })
        backend.remove.mockResolvedValue({ data: [], error: null })
      },
      'admin-manage-barber: work picture removal made no progress',
    ],
  ])('answers a completed delete unchanged when %s and logs it', async (_, arrange, message) => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    arrange()

    expect(await read(await deleteBarber())).toEqual([200, ANSWER])
    expect(backend.list).toHaveBeenCalledOnce()
    expect(logged.mock.calls.map(([text]) => text)).toEqual([message])
  })
})

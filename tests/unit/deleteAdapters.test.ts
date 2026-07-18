// Unit tests for the delete/purge admin adapters' RESPONSE MAPPING (barbersAdmin.deleteBarber and
// bookingsAdmin.deleteBookings / purgeHistory). The Supabase client is mocked via `vi.hoisted` +
// `vi.mock`, so `getAdminClient().rpc(...)` resolves to a canned `{ data, error }` and the real
// adminClient (and `@supabase/supabase-js`) never loads. We assert three things:
//   1. Each wire payload maps to the right typed outcome / AdminResult (every branch).
//   2. Transport errors and malformed payloads FAIL CLOSED to a typed error (never throw).
//   3. Each method calls the exact deployed RPC name + param keys — the wire contract this
//      boundary layer exists to guard (mockResolvedValue ignores args, so without this a typo
//      in `admin_delete_barber` / `p_ids` / etc. would pass every mapping test).

import { describe, it, expect, beforeEach, vi } from 'vitest'

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('../../src/admin/adminClient', () => ({
  getAdminClient: () => ({ rpc }),
}))

import { deleteBarber } from '../../src/admin/adapters/barbersAdmin'
import { deleteBookings, purgeHistory } from '../../src/admin/adapters/bookingsAdmin'

beforeEach(() => {
  rpc.mockReset()
})

describe('deleteBarber', () => {
  it('maps {ok:true, deleted_bookings} to the ok outcome and calls the RPC with purge=true', async () => {
    rpc.mockResolvedValue({ data: { ok: true, deleted_bookings: 3 }, error: null })

    const res = await deleteBarber('mario', true)

    expect(res).toEqual({ kind: 'ok', deletedBookings: 3 })
    expect(rpc).toHaveBeenCalledWith('admin_delete_barber', {
      p_barber_id: 'mario',
      p_purge_bookings: true,
    })
  })

  it('maps the has_bookings refusal to a structured outcome carrying the counts (purge=false)', async () => {
    rpc.mockResolvedValue({
      data: { ok: false, error: 'has_bookings', count: 5, past: 4, upcoming: 1 },
      error: null,
    })

    const res = await deleteBarber('luca', false)

    expect(res).toEqual({ kind: 'has_bookings', count: 5, past: 4, upcoming: 1 })
    expect(rpc).toHaveBeenCalledWith('admin_delete_barber', {
      p_barber_id: 'luca',
      p_purge_bookings: false,
    })
  })

  it('maps error:forbidden to a localized forbidden error', async () => {
    rpc.mockResolvedValue({ data: { ok: false, error: 'forbidden' }, error: null })

    const res = await deleteBarber('mario', true)

    expect(res).toEqual({
      kind: 'error',
      error: { kind: 'forbidden', message: 'Bara ägaren kan radera barberare.' },
    })
  })

  it('maps error:not_found to a localized not_found error', async () => {
    rpc.mockResolvedValue({ data: { ok: false, error: 'not_found' }, error: null })

    const res = await deleteBarber('ghost', true)

    expect(res).toEqual({
      kind: 'error',
      error: { kind: 'not_found', message: 'Barberaren finns inte.' },
    })
  })

  it('maps a transport error to a network error outcome', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'connection reset' } })

    const res = await deleteBarber('mario', true)

    expect(res).toMatchObject({ kind: 'error', error: { kind: 'network' } })
  })

  it('maps a malformed payload to a malformed error outcome (fail closed)', async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null }) // missing deleted_bookings

    const res = await deleteBarber('mario', true)

    expect(res).toMatchObject({ kind: 'error', error: { kind: 'malformed' } })
  })

  it('collapses an rpc rejection to a network error outcome (never throws)', async () => {
    rpc.mockRejectedValue(new Error('boom'))

    const res = await deleteBarber('mario', true)

    expect(res).toMatchObject({ kind: 'error', error: { kind: 'network' } })
  })
})

describe('deleteBookings', () => {
  it('maps {ok:true, count} to ok(count) and forwards the ids array as p_ids', async () => {
    rpc.mockResolvedValue({ data: { ok: true, count: 2 }, error: null })

    const res = await deleteBookings(['a', 'b'])

    expect(res).toEqual({ ok: true, value: 2 })
    expect(rpc).toHaveBeenCalledWith('admin_delete_bookings', { p_ids: ['a', 'b'] })
  })

  it('maps error:forbidden to a forbidden AdminError', async () => {
    rpc.mockResolvedValue({ data: { ok: false, error: 'forbidden' }, error: null })

    const res = await deleteBookings(['a'])

    expect(res).toEqual({
      ok: false,
      error: { kind: 'forbidden', message: 'Du kan bara radera egna bokningar.' },
    })
  })

  it('maps error:has_upcoming to a validation AdminError', async () => {
    rpc.mockResolvedValue({ data: { ok: false, error: 'has_upcoming' }, error: null })

    const res = await deleteBookings(['a'])

    expect(res).toEqual({
      ok: false,
      error: { kind: 'validation', message: 'Kommande bokningar kan inte raderas.' },
    })
  })

  it('maps error:empty to a validation AdminError', async () => {
    rpc.mockResolvedValue({ data: { ok: false, error: 'empty' }, error: null })

    const res = await deleteBookings([])

    expect(res).toEqual({
      ok: false,
      error: { kind: 'validation', message: 'Inga bokningar valda.' },
    })
  })

  it('maps a transport error to a network AdminError', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'timeout' } })

    const res = await deleteBookings(['a'])

    expect(res).toMatchObject({ ok: false, error: { kind: 'network' } })
  })

  it('maps a malformed payload to a malformed AdminError (fail closed)', async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null }) // missing count

    const res = await deleteBookings(['a'])

    expect(res).toMatchObject({ ok: false, error: { kind: 'malformed' } })
  })
})

describe('purgeHistory', () => {
  it('maps {ok:true, count} to ok(count) and calls the RPC with no args', async () => {
    rpc.mockResolvedValue({ data: { ok: true, count: 10 }, error: null })

    const res = await purgeHistory()

    expect(res).toEqual({ ok: true, value: 10 })
    expect(rpc).toHaveBeenCalledWith('admin_purge_history')
  })

  it('maps error:forbidden to a forbidden AdminError', async () => {
    rpc.mockResolvedValue({ data: { ok: false, error: 'forbidden' }, error: null })

    const res = await purgeHistory()

    expect(res).toEqual({
      ok: false,
      error: { kind: 'forbidden', message: 'Bara ägaren kan tömma all historik.' },
    })
  })

  it('maps a transport error to a network AdminError', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'offline' } })

    const res = await purgeHistory()

    expect(res).toMatchObject({ ok: false, error: { kind: 'network' } })
  })

  it('maps a malformed payload to a malformed AdminError (fail closed)', async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null }) // missing count

    const res = await purgeHistory()

    expect(res).toMatchObject({ ok: false, error: { kind: 'malformed' } })
  })
})

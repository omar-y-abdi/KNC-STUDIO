import type { SupabaseClient } from '@supabase/supabase-js'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  recordAdminAction,
  recordOrLogAdminAction,
  withinAdminLogBound,
  type AdminActionRecord,
  type AdminAuditService,
} from '../../supabase/functions/_shared/adminAudit'
import { unhandledRejectionsDuring } from './helpers/unhandledRejections'

const ACTOR = '77777777-7777-4777-8777-777777777771'
const TARGET = '75000000-0000-4000-8000-000000000001'

function serviceAnswering(answer: { error: { code?: string } | null }) {
  const rpc = vi.fn<AdminAuditService['rpc']>(async () => answer)
  const service: AdminAuditService = { rpc }
  return { rpc, service }
}

const silentService: AdminAuditService = { rpc: () => new Promise(() => undefined) }

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('admin log record', () => {
  it('records an insert with no detail', async () => {
    const { rpc, service } = serviceAnswering({ error: null })

    await expect(
      recordAdminAction(service, {
        actorId: ACTOR,
        action: 'insert',
        table: 'profiles',
        targetId: TARGET,
      }),
    ).resolves.toEqual({ ok: true })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('internal_record_admin_action', {
      p_actor: ACTOR,
      p_action: 'insert',
      p_target_table: 'profiles',
      p_target_id: TARGET,
      p_detail: null,
    })
  })

  it('records a delete with no detail', async () => {
    const { rpc, service } = serviceAnswering({ error: null })

    await recordAdminAction(service, {
      actorId: ACTOR,
      action: 'delete',
      table: 'barber_photos',
      targetId: 'hassan',
    })

    expect(rpc).toHaveBeenCalledWith('internal_record_admin_action', {
      p_actor: ACTOR,
      p_action: 'delete',
      p_target_table: 'barber_photos',
      p_target_id: 'hassan',
      p_detail: null,
    })
  })

  it('records an update with the changed column names and nothing else', async () => {
    const { rpc, service } = serviceAnswering({ error: null })

    await recordAdminAction(service, {
      actorId: ACTOR,
      action: 'update',
      table: 'staff_invitations',
      targetId: TARGET,
      changedColumns: ['token_hash', 'created_at'],
    })

    expect(rpc).toHaveBeenCalledWith('internal_record_admin_action', {
      p_actor: ACTOR,
      p_action: 'update',
      p_target_table: 'staff_invitations',
      p_target_id: TARGET,
      p_detail: { changed: ['token_hash', 'created_at'] },
    })
  })

  it.each([
    ['the database error code', { error: { code: '22023' } }, '22023'],
    ['"unknown" for an error without a code', { error: {} }, 'unknown'],
    ['"unknown" for an empty code', { error: { code: '' } }, 'unknown'],
  ])('answers a refused entry with %s', async (_, answer, code) => {
    const { service } = serviceAnswering(answer)
    await expect(
      recordAdminAction(service, {
        actorId: ACTOR,
        action: 'insert',
        table: 'profiles',
        targetId: TARGET,
      }),
    ).resolves.toEqual({ ok: false, code })
  })

  it.each([
    ['an Error', new TypeError('fetch failed for https://db.example.test'), 'TypeError'],
    ['something that is no Error', 'boom', 'unknown'],
  ])('never throws: %s thrown by the client is a failed result', async (_, thrown, code) => {
    const service: AdminAuditService = {
      rpc: () => {
        throw thrown
      },
    }
    await expect(
      recordAdminAction(service, {
        actorId: ACTOR,
        action: 'delete',
        table: 'barber_photos',
        targetId: 'hassan',
      }),
    ).resolves.toEqual({ ok: false, code })
  })

  it('never throws when the request rejects', async () => {
    const service: AdminAuditService = { rpc: () => Promise.reject(new Error('offline')) }
    await expect(
      recordAdminAction(service, {
        actorId: ACTOR,
        action: 'insert',
        table: 'profiles',
        targetId: TARGET,
      }),
    ).resolves.toEqual({ ok: false, code: 'Error' })
  })
})

describe('admin log record or log line', () => {
  const record: AdminActionRecord = {
    actorId: ACTOR,
    action: 'update',
    table: 'barber_calendar_tokens',
    targetId: 'hassan',
    changedColumns: ['disconnect_requested_at'],
  }

  it('logs nothing when the entry was written', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { rpc, service } = serviceAnswering({ error: null })

    await expect(
      recordOrLogAdminAction('calendar-disconnect', service, record),
    ).resolves.toBeUndefined()

    expect(rpc).toHaveBeenCalledTimes(1)
    expect(logged).not.toHaveBeenCalled()
  })

  it('logs the function and the error code of a failed entry, and nothing of the record', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { service } = serviceAnswering({ error: { code: '22023' } })

    await expect(
      recordOrLogAdminAction('calendar-disconnect', service, record),
    ).resolves.toBeUndefined()

    expect(logged.mock.calls).toEqual([['calendar-disconnect: admin log write failed:', '22023']])
  })

  it('logs only the name of what a failing client threw', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const service: AdminAuditService = {
      rpc: () => Promise.reject(new TypeError(`could not reach the row of ${ACTOR}`)),
    }

    await recordOrLogAdminAction('upload-image', service, record)

    expect(logged.mock.calls).toEqual([['upload-image: admin log write failed:', 'TypeError']])
  })
})

describe('admin log bound', () => {
  const insert: AdminActionRecord = {
    actorId: ACTOR,
    action: 'insert',
    table: 'profiles',
    targetId: TARGET,
  }

  it('gives up on a write that never answers after 3 seconds, and not a moment before', async () => {
    vi.useFakeTimers()
    const settled = vi.fn()

    void recordAdminAction(silentService, insert).then(settled)
    await vi.advanceTimersByTimeAsync(2999)
    expect(settled).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    expect(settled.mock.calls).toEqual([[{ ok: false, code: 'timeout' }]])
  })

  it('logs a write it gave up on as its one code line', async () => {
    vi.useFakeTimers()
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    const done = recordOrLogAdminAction('upload-image', silentService, insert)
    await vi.advanceTimersByTimeAsync(3000)
    await done

    expect(logged.mock.calls).toEqual([['upload-image: admin log write failed:', 'timeout']])
  })

  it.each([
    ['answers', async () => ({ error: null }), { ok: true }],
    ['is refused', async () => ({ error: { code: '22023' } }), { ok: false, code: '22023' }],
    ['rejects', () => Promise.reject(new Error('offline')), { ok: false, code: 'Error' }],
  ])('leaves no timer running when the write %s in time', async (_, rpc, result) => {
    vi.useFakeTimers()

    await expect(recordAdminAction({ rpc }, insert)).resolves.toEqual(result)

    expect(vi.getTimerCount()).toBe(0)
  })

  it('hands on the answer of a call that settles in time, and starts it once', async () => {
    const call = vi.fn(async () => 'answer')

    await expect(withinAdminLogBound(call)).resolves.toEqual({ timedOut: false, value: 'answer' })

    expect(call).toHaveBeenCalledOnce()
  })

  it('rejects, and does not throw, for a call that throws at once', async () => {
    vi.useFakeTimers()
    let bounded: Promise<unknown> = Promise.resolve()

    expect(() => {
      bounded = withinAdminLogBound(() => {
        throw new TypeError('no connection')
      })
    }).not.toThrow()

    await expect(bounded).rejects.toBeInstanceOf(TypeError)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('leaves no unhandled rejection when a call it gave up on fails afterwards', async () => {
    const reasons = await unhandledRejectionsDuring(async () => {
      vi.useFakeTimers()
      let fail: (reason: Error) => void = () => undefined
      const late = new Promise<never>((_, reject) => {
        fail = reject
      })

      const bounded = withinAdminLogBound(() => late)
      await vi.advanceTimersByTimeAsync(3000)
      await expect(bounded).resolves.toEqual({ timedOut: true })
      // The helper waits one real task for Node to report a rejection.
      vi.useRealTimers()
      fail(new Error('answered too late'))
    })

    expect(reasons).toEqual([])
  })
})

// These cases are checked by `tsc` on the tests project; their run-time assertions always hold.
describe('admin log record type', () => {
  it('accepts the real service-role client without a cast', () => {
    const asAuditService = (client: SupabaseClient): AdminAuditService => client
    expect(typeof asAuditService).toBe('function')
  })

  it('cannot express an update without columns, or an insert or delete with columns', () => {
    const base = { actorId: ACTOR, targetId: TARGET } as const
    const records: AdminActionRecord[] = [
      // @ts-expect-error an update names the columns it changed
      { ...base, table: 'profiles', action: 'update' },
      // @ts-expect-error an update names at least one column
      { ...base, table: 'profiles', action: 'update', changedColumns: [] },
      // @ts-expect-error an insert concerns the whole row
      { ...base, table: 'profiles', action: 'insert', changedColumns: ['role'] },
      // @ts-expect-error a delete concerns the whole row
      { ...base, table: 'profiles', action: 'delete', changedColumns: ['role'] },
      // @ts-expect-error a column of another table
      { ...base, table: 'barber_photos', action: 'update', changedColumns: ['token_hash'] },
      // @ts-expect-error a table the database function does not accept
      { ...base, table: 'bookings', action: 'delete' },
    ]
    expect(records).toHaveLength(6)
  })
})

// The admin log adapter against a mocked client: the exact RPC name and parameter names, the row
// mapping (who, what, which columns), and every answer mapped to its typed result.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('../../modules/staff-admin/src/adminClient', () => ({
  getAdminClient: () => ({ rpc }),
}))

import { listAuditLog } from '../../modules/staff-admin/src/adapters/auditLogAdmin'

beforeEach(() => rpc.mockReset())

const ENTRY = '66666666-6666-4666-8666-666666666661'
const ACTOR = '77777777-7777-4777-8777-777777777771'
const REVIEW = '55555555-5555-4555-8555-555555555551'

const updateRow = {
  id: ENTRY,
  created_at: '2026-11-10T13:05:00.654321+00:00',
  actor_id: ACTOR,
  actor_role: 'owner',
  actor_barber_id: null,
  action: 'update',
  target_table: 'reviews',
  target_id: REVIEW,
  changed_columns: ['published'],
}

describe('admin log list', () => {
  it('starts at the newest entry with no cursor', async () => {
    rpc.mockResolvedValue({ data: { entries: [], has_more: false }, error: null })

    await expect(listAuditLog(null)).resolves.toEqual({
      ok: true,
      value: { entries: [], hasMore: false },
    })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('admin_list_audit_log', {
      p_before: null,
      p_before_id: null,
      p_limit: 50,
    })
  })

  it('sends both halves of the cursor for a further page, timestamp verbatim', async () => {
    rpc.mockResolvedValue({ data: { entries: [], has_more: false }, error: null })

    await listAuditLog({ before: '2026-11-10T13:05:00.654321+00:00', beforeId: ENTRY })

    expect(rpc).toHaveBeenCalledWith('admin_list_audit_log', {
      p_before: '2026-11-10T13:05:00.654321+00:00',
      p_before_id: ENTRY,
      p_limit: 50,
    })
  })

  it('maps who acted, what was done and which columns an update changed', async () => {
    rpc.mockResolvedValue({
      data: {
        entries: [
          updateRow,
          {
            ...updateRow,
            id: '66666666-6666-4666-8666-666666666662',
            actor_role: 'barber',
            actor_barber_id: 'hassan',
            action: 'insert',
            target_table: 'barber_time_off',
            target_id: '88888888-8888-4888-8888-888888888881',
            changed_columns: null,
          },
          {
            ...updateRow,
            id: '66666666-6666-4666-8666-666666666663',
            actor_role: null,
            actor_barber_id: null,
            action: 'delete',
            // A table this panel has no name for still parses; the view shows the stored name.
            target_table: 'gift_cards',
            target_id: 'card-7',
            changed_columns: null,
          },
          {
            ...updateRow,
            id: '66666666-6666-4666-8666-666666666664',
            actor_role: 'barber',
            actor_barber_id: null,
            target_table: 'barber_schedules',
            target_id: 'hassan/1',
            changed_columns: ['end_min', 'start_min'],
          },
        ],
        has_more: true,
      },
      error: null,
    })

    await expect(listAuditLog(null)).resolves.toEqual({
      ok: true,
      value: {
        entries: [
          {
            id: ENTRY,
            createdAt: '2026-11-10T13:05:00.654321+00:00',
            actor: { kind: 'owner' },
            change: { action: 'update', changedColumns: ['published'] },
            targetTable: 'reviews',
            targetId: REVIEW,
          },
          {
            id: '66666666-6666-4666-8666-666666666662',
            createdAt: '2026-11-10T13:05:00.654321+00:00',
            actor: { kind: 'barber', barberId: 'hassan' },
            change: { action: 'insert' },
            targetTable: 'barber_time_off',
            targetId: '88888888-8888-4888-8888-888888888881',
          },
          {
            id: '66666666-6666-4666-8666-666666666663',
            createdAt: '2026-11-10T13:05:00.654321+00:00',
            actor: { kind: 'removed' },
            change: { action: 'delete' },
            targetTable: 'gift_cards',
            targetId: 'card-7',
          },
          {
            id: '66666666-6666-4666-8666-666666666664',
            createdAt: '2026-11-10T13:05:00.654321+00:00',
            actor: { kind: 'barber', barberId: null },
            change: { action: 'update', changedColumns: ['end_min', 'start_min'] },
            targetTable: 'barber_schedules',
            targetId: 'hassan/1',
          },
        ],
        hasMore: true,
      },
    })
  })

  it('accepts the entry of a CMS Studio publish: a revision number, no columns', async () => {
    rpc.mockResolvedValue({
      data: {
        entries: [
          {
            ...updateRow,
            action: 'insert',
            target_table: 'cms_revisions',
            target_id: '42',
            changed_columns: null,
          },
        ],
        has_more: false,
      },
      error: null,
    })

    await expect(listAuditLog(null)).resolves.toEqual({
      ok: true,
      value: {
        entries: [
          {
            id: ENTRY,
            createdAt: '2026-11-10T13:05:00.654321+00:00',
            actor: { kind: 'owner' },
            change: { action: 'insert' },
            targetTable: 'cms_revisions',
            targetId: '42',
          },
        ],
        hasMore: false,
      },
    })
  })

  // A later migration can log an action or give an account a role this panel has no name for. Such
  // an entry is kept, with the stored name, so that it does not hide the rest of its page.
  it('keeps an entry whose action or role it has no name for, with the stored name', async () => {
    const longest = 'a'.repeat(64)
    rpc.mockResolvedValue({
      data: {
        entries: [
          { ...updateRow, action: 'truncate', changed_columns: null },
          { ...updateRow, action: 'merge', changed_columns: ['published', 'text'] },
          { ...updateRow, action: longest, actor_role: longest, changed_columns: null },
          { ...updateRow, actor_role: 'manager', actor_barber_id: 'hassan' },
          updateRow,
        ],
        has_more: false,
      },
      error: null,
    })

    const result = await listAuditLog(null)

    expect(result).toMatchObject({ ok: true })
    if (!result.ok) return
    expect(result.value.entries.map(({ actor, change }) => ({ actor, change }))).toEqual([
      {
        actor: { kind: 'owner' },
        change: { action: 'unknown', name: 'truncate', changedColumns: [] },
      },
      {
        actor: { kind: 'owner' },
        change: { action: 'unknown', name: 'merge', changedColumns: ['published', 'text'] },
      },
      {
        actor: { kind: 'unknown', role: longest },
        change: { action: 'unknown', name: longest, changedColumns: [] },
      },
      {
        actor: { kind: 'unknown', role: 'manager' },
        change: { action: 'update', changedColumns: ['published'] },
      },
      { actor: { kind: 'owner' }, change: { action: 'update', changedColumns: ['published'] } },
    ])
  })

  it('reports the refusal of a caller who is not the owner as forbidden', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'owner required' } })
    await expect(listAuditLog(null)).resolves.toEqual({
      ok: false,
      error: { kind: 'forbidden', message: 'Endast ägaren kan läsa adminloggen.' },
    })
  })

  // A request without a valid session is answered with HTTP 401: with the anonymous role's refusal
  // (42501, the code a signed-in caller who is not the owner gets too) or the token's own error.
  it.each([
    [
      'a request the API ran as the anonymous role',
      { data: null, error: { code: '42501', message: 'permission denied' }, status: 401 },
    ],
    [
      'a request whose token has expired',
      { data: null, error: { code: 'PGRST301', message: 'JWT expired' }, status: 401 },
    ],
  ])('reports %s as an ended session, not as a refusal', async (_, answer) => {
    rpc.mockResolvedValue(answer)
    await expect(listAuditLog(null)).resolves.toEqual({
      ok: false,
      error: { kind: 'auth', message: 'Din session har gått ut. Logga in igen.' },
    })
  })

  it('keeps the refusal of a signed-in caller who is not the owner apart from an ended session', async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'owner required' },
      status: 403,
    })
    await expect(listAuditLog(null)).resolves.toMatchObject({
      ok: false,
      error: { kind: 'forbidden' },
    })
  })

  it.each([
    ['another database error', { data: null, error: { code: '22023', message: 'cursor' } }],
    ['an empty answer', { data: null, error: null }],
  ])('reports %s as a failed read', async (_, answer) => {
    rpc.mockResolvedValue(answer)
    await expect(listAuditLog(null)).resolves.toEqual({
      ok: false,
      error: { kind: 'network', message: 'Kunde inte läsa adminloggen.' },
    })
  })

  it('reports a thrown request as a failed read instead of throwing', async () => {
    rpc.mockRejectedValue(new TypeError('fetch failed'))
    await expect(listAuditLog(null)).resolves.toEqual({
      ok: false,
      error: { kind: 'network', message: 'Kunde inte läsa adminloggen.' },
    })
  })

  it.each([
    ['an update that names no columns', { ...updateRow, changed_columns: null }],
    ['an update with an empty column list', { ...updateRow, changed_columns: [] }],
    ['an insert that names columns', { ...updateRow, action: 'insert' }],
    ['a delete that names columns', { ...updateRow, action: 'delete' }],
    ['an action without a name', { ...updateRow, action: '' }],
    ['an action with a name of 65 characters', { ...updateRow, action: 'a'.repeat(65) }],
    ['a role without a name', { ...updateRow, actor_role: '' }],
    ['a role with a name of 65 characters', { ...updateRow, actor_role: 'a'.repeat(65) }],
    [
      'an action it has no name for with an empty column name',
      { ...updateRow, action: 'truncate', changed_columns: [''] },
    ],
    ['an entry without its row id', { ...updateRow, target_id: '' }],
    ['an entry without its table', { ...updateRow, target_table: undefined }],
    ['a date that is no timestamp', { ...updateRow, created_at: 'yesterday' }],
  ])('reports %s as malformed and shows no entry of the page', async (_, entry) => {
    rpc.mockResolvedValue({ data: { entries: [updateRow, entry], has_more: false }, error: null })
    await expect(listAuditLog(null)).resolves.toEqual({
      ok: false,
      error: { kind: 'malformed', message: 'Kunde inte läsa adminloggen.' },
    })
  })

  it('reports a page without has_more as malformed', async () => {
    rpc.mockResolvedValue({ data: { entries: [updateRow] }, error: null })
    await expect(listAuditLog(null)).resolves.toMatchObject({
      ok: false,
      error: { kind: 'malformed' },
    })
  })
})

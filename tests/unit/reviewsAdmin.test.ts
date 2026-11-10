// The review moderation adapter against a mocked client: RPC and parameter names, rows, answers.

import { beforeEach, describe, expect, it, vi } from 'vitest'

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('../../modules/staff-admin/src/adminClient', () => ({
  getAdminClient: () => ({ rpc }),
}))

import {
  deleteReview,
  listReviews,
  setReviewPublished,
} from '../../modules/staff-admin/src/adapters/reviewsAdmin'

beforeEach(() => {
  rpc.mockReset()
})

const ID = '55555555-5555-4555-8555-555555555551'
const OTHER_ID = '55555555-5555-4555-8555-555555555552'

/** HTTP 401 answers: the anonymous role's 42501 (a signed-in non-owner's too) or a token error. */
const sessionless: [string, unknown][] = [
  [
    'a request the API ran as the anonymous role',
    { data: null, error: { code: '42501', message: 'permission denied' }, status: 401 },
  ],
  [
    'a request whose token has expired',
    { data: null, error: { code: 'PGRST301', message: 'JWT expired' }, status: 401 },
  ],
]
const signedInRefusal = {
  data: null,
  error: { code: '42501', message: 'owner required' },
  status: 403,
}

const row = (id: string, created_at: string, published: boolean) => ({
  id,
  created_at,
  name: 'Anna S.',
  rating: 4,
  text: 'Bra klippning.',
  published,
})

describe('review moderation list', () => {
  it('starts at the newest review with no cursor and maps the rows', async () => {
    rpc.mockResolvedValue({
      data: {
        entries: [
          row(ID, '2026-11-10T13:05:00.654321+00:00', true),
          row(OTHER_ID, '2026-11-09T08:00:00.123456+00:00', false),
        ],
        has_more: true,
      },
      error: null,
    })

    await expect(listReviews(null)).resolves.toEqual({
      ok: true,
      value: {
        entries: [
          {
            id: ID,
            createdAt: '2026-11-10T13:05:00.654321+00:00',
            name: 'Anna S.',
            rating: 4,
            text: 'Bra klippning.',
            published: true,
          },
          {
            id: OTHER_ID,
            createdAt: '2026-11-09T08:00:00.123456+00:00',
            name: 'Anna S.',
            rating: 4,
            text: 'Bra klippning.',
            published: false,
          },
        ],
        hasMore: true,
      },
    })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('admin_list_reviews', {
      p_before: null,
      p_before_id: null,
      p_limit: 50,
    })
  })

  it('sends both halves of the cursor for a further page, timestamp verbatim', async () => {
    rpc.mockResolvedValue({ data: { entries: [], has_more: false }, error: null })

    await expect(
      listReviews({ before: '2026-11-09T08:00:00.123456+00:00', beforeId: OTHER_ID }),
    ).resolves.toEqual({ ok: true, value: { entries: [], hasMore: false } })
    expect(rpc).toHaveBeenCalledWith('admin_list_reviews', {
      p_before: '2026-11-09T08:00:00.123456+00:00',
      p_before_id: OTHER_ID,
      p_limit: 50,
    })
  })

  it('reports the refusal of a caller who is not the owner as forbidden', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'owner required' } })
    await expect(listReviews(null)).resolves.toEqual({
      ok: false,
      error: { kind: 'forbidden', message: 'Endast ägaren kan hantera recensioner.' },
    })
  })

  it.each(sessionless)('reports %s as an ended session, not as a refusal', async (_, answer) => {
    rpc.mockResolvedValue(answer)
    await expect(listReviews(null)).resolves.toEqual({
      ok: false,
      error: { kind: 'auth', message: 'Din session har gått ut. Logga in igen.' },
    })
  })

  it('keeps the refusal of a signed-in caller who is not the owner apart from an ended session', async () => {
    rpc.mockResolvedValue(signedInRefusal)
    await expect(listReviews(null)).resolves.toMatchObject({
      ok: false,
      error: { kind: 'forbidden' },
    })
  })

  it.each([
    ['another database error', { data: null, error: { code: '22023', message: 'cursor' } }],
    ['an empty answer', { data: null, error: null }],
  ])('reports %s as a failed read', async (_, answer) => {
    rpc.mockResolvedValue(answer)
    await expect(listReviews(null)).resolves.toEqual({
      ok: false,
      error: { kind: 'network', message: 'Kunde inte läsa recensionerna.' },
    })
  })

  it('reports a thrown request as a failed read instead of throwing', async () => {
    rpc.mockRejectedValue(new TypeError('fetch failed'))
    await expect(listReviews(null)).resolves.toEqual({
      ok: false,
      error: { kind: 'network', message: 'Kunde inte läsa recensionerna.' },
    })
  })

  const valid = row(ID, '2026-11-10T13:05:00.654321+00:00', true)
  it.each([
    ['a rating above five', { entries: [{ ...valid, rating: 6 }], has_more: false }],
    ['a rating that is not whole', { entries: [{ ...valid, rating: 4.5 }], has_more: false }],
    [
      'a row without its published flag',
      { entries: [{ ...valid, published: undefined }], has_more: false },
    ],
    ['an id that is no uuid', { entries: [{ ...valid, id: 'review-1' }], has_more: false }],
    [
      'a date that is no timestamp',
      { entries: [{ ...valid, created_at: '2026-11-10' }], has_more: false },
    ],
    ['an empty name', { entries: [{ ...valid, name: '' }], has_more: false }],
    ['a page without has_more', { entries: [valid] }],
    ['a bare array', [valid]],
  ])('reports %s as malformed and shows no row of the page', async (_, data) => {
    rpc.mockResolvedValue({ data, error: null })
    await expect(listReviews(null)).resolves.toEqual({
      ok: false,
      error: { kind: 'malformed', message: 'Kunde inte läsa recensionerna.' },
    })
  })
})

describe.each([
  [
    'hide',
    () => setReviewPublished(ID, false),
    'admin_set_review_published',
    { p_id: ID, p_published: false },
    'Kunde inte ändra om recensionen visas.',
  ],
  [
    'publish again',
    () => setReviewPublished(ID, true),
    'admin_set_review_published',
    { p_id: ID, p_published: true },
    'Kunde inte ändra om recensionen visas.',
  ],
  [
    'delete',
    () => deleteReview(ID),
    'admin_delete_review',
    { p_id: ID },
    'Kunde inte ta bort recensionen.',
  ],
] as const)('review moderation action: %s', (_, act, name, args, failure) => {
  it('calls its RPC with exactly its parameters and reports success', async () => {
    rpc.mockResolvedValue({ data: { ok: true }, error: null })
    await expect(act()).resolves.toEqual({ ok: true, value: undefined })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith(name, args)
  })

  it('reports a review that is gone as not found', async () => {
    rpc.mockResolvedValue({ data: { ok: false, error: 'not_found' }, error: null })
    await expect(act()).resolves.toEqual({
      ok: false,
      error: { kind: 'not_found', message: 'Recensionen finns inte längre.' },
    })
  })

  // What failed is named for the action that was attempted: a delete never says "show".
  it('reports refused arguments as a validation failure', async () => {
    rpc.mockResolvedValue({ data: { ok: false, error: 'invalid' }, error: null })
    await expect(act()).resolves.toEqual({
      ok: false,
      error: { kind: 'validation', message: failure },
    })
  })

  it('reports the refusal of a caller who is not the owner as forbidden', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '42501', message: 'owner required' } })
    await expect(act()).resolves.toEqual({
      ok: false,
      error: { kind: 'forbidden', message: 'Endast ägaren kan hantera recensioner.' },
    })
  })

  it.each(sessionless)(
    'reports %s as an ended session, not as a refusal',
    async (_label, answer) => {
      rpc.mockResolvedValue(answer)
      await expect(act()).resolves.toEqual({
        ok: false,
        error: { kind: 'auth', message: 'Din session har gått ut. Logga in igen.' },
      })
    },
  )

  it('keeps the refusal of a signed-in caller who is not the owner apart from an ended session', async () => {
    rpc.mockResolvedValue(signedInRefusal)
    await expect(act()).resolves.toMatchObject({ ok: false, error: { kind: 'forbidden' } })
  })

  it.each([
    ['another database error', { data: null, error: { code: '57014', message: 'timeout' } }],
    ['an empty answer', { data: null, error: null }],
  ])('reports %s as a failed write', async (_label, answer) => {
    rpc.mockResolvedValue(answer)
    await expect(act()).resolves.toEqual({
      ok: false,
      error: { kind: 'network', message: failure },
    })
  })

  it('reports a thrown request as a failed write instead of throwing', async () => {
    rpc.mockRejectedValue(new TypeError('fetch failed'))
    await expect(act()).resolves.toEqual({
      ok: false,
      error: { kind: 'network', message: failure },
    })
  })

  it.each([
    ['a refusal it does not know', { ok: false, error: 'locked' }],
    ['a refusal without a reason', { ok: false }],
    ['an answer without ok', { done: true }],
    ['a bare boolean', true],
  ])('reports %s as malformed, never as success', async (_label, data) => {
    rpc.mockResolvedValue({ data, error: null })
    await expect(act()).resolves.toEqual({
      ok: false,
      error: { kind: 'malformed', message: failure },
    })
  })
})

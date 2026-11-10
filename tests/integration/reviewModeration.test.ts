// Review moderation and the admin log (migrations 20261110120100_review_moderation and
// 20261110120200_admin_audit_log), through the panel's own adapters against the real database.
//
// This is where the parameter names the adapters send meet the functions that receive them:
//   * as the owner: list every review, page by cursor, hide one and read it gone from every
//     anonymous read, publish it again, delete it; then read the admin log and find the entries the
//     database wrote for those three changes, with column names and no review text;
//   * the entry an Edge Function writes for a service-role change (_shared/adminAudit.ts), for
//     every table and column the staff functions name;
//   * as a barber, and with no session: each of the four RPCs is refused and nothing changes. A
//     barber is refused as "not the owner"; a request without a session is answered with HTTP 401,
//     which the adapters report as an ended session.
//
// The tests of a block run in order and build on each other: one review is taken through its whole
// life.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { listAuditLog } from '../../modules/staff-admin/src/adapters/auditLogAdmin'
import {
  deleteReview,
  listReviews,
  setReviewPublished,
} from '../../modules/staff-admin/src/adapters/reviewsAdmin'
import { getAdminClient } from '../../modules/staff-admin/src/adminClient'
import { recordAdminAction } from '../../supabase/functions/_shared/adminAudit'
import {
  BARBER_EMAIL,
  BARBER_LINK_ID,
  BARBER_PASSWORD,
  OWNER_EMAIL,
  OWNER_PASSWORD,
  adminBackendReady,
  readAdminStackEnv,
  type AdminStackEnv,
} from './_adminHelpers'
import { uniqueReviewMarker, withClient } from './_helpers'

const LOCAL_HOSTS = ['localhost', '127.0.0.1']
const FORBIDDEN = { ok: false, error: { kind: 'forbidden' } }
const SESSION_ENDED = { ok: false, error: { kind: 'auth' } }
const DONE = { ok: true, value: undefined }
/** The tables a staff function records a service-role change for (_shared/adminAudit.ts). */
const SERVICE_RECORDED_TABLES = [
  'profiles',
  'staff_invitations',
  'barber_photos',
  'barber_calendar_tokens',
]

interface SeededReview {
  readonly id: string
  readonly name: string
  readonly rating: number
  readonly text: string
}

describe.skipIf(!adminBackendReady())('review moderation and admin log (integration)', () => {
  let env: AdminStackEnv
  /** The stack the reviews are seeded in; `null` until `beforeAll` has found it to be local. */
  let seededIn: AdminStackEnv | null = null
  let anon: SupabaseClient
  let service: SupabaseClient
  let ownerId: string
  /** Unique to this run: the review texts carry it, so a leak into the log would be found. */
  const marker = uniqueReviewMarker()
  /** The names of the two reviews this run seeds: what tells its reviews from every other. */
  const reviewName = (label: 'older' | 'newer'): string => `${marker} ${label}`
  /** The newest review of the table, taken through hide, publish again and delete. */
  let newer: SeededReview
  /** The second newest; it is never changed. */
  let older: SeededReview
  /** The ids of the reviews this run seeded, for the admin log rows about them. */
  const seededIds: string[] = []
  /** The ids of the admin log rows the service-role block wrote; removed afterwards. */
  const recordedEntryIds: string[] = []

  /** Insert a published review `daysAhead` days in the future, so it sorts before every other. */
  async function seedReview(
    label: 'older' | 'newer',
    rating: number,
    daysAhead: number,
  ): Promise<SeededReview> {
    const name = reviewName(label)
    const text = `${marker} text of the ${label} review`
    const id = await withClient(env.dbUrl, async (client) => {
      const inserted = await client.query<{ id: string }>(
        `insert into public.reviews (name, rating, text, published, created_at)
         values ($1, $2, $3, true, pg_catalog.now() + ($4::integer * interval '1 day'))
         returning id`,
        [name, rating, text, daysAhead],
      )
      const row = inserted.rows[0]
      if (row === undefined) throw new Error('seedReview: no id returned')
      return row.id
    })
    seededIds.push(id)
    return { id, name, rating, text }
  }

  /** The id of every admin log row about a table a staff function records for. */
  async function serviceRecordedEntryIds(): Promise<readonly string[]> {
    return withClient(env.dbUrl, async (client) => {
      const found = await client.query<{ id: string }>(
        'select id from public.admin_audit_log where target_table = any($1::text[])',
        [SERVICE_RECORDED_TABLES],
      )
      return found.rows.map((row) => row.id)
    })
  }

  /** The review as the superuser sees it, or `null` when the row is gone. */
  async function storedReview(id: string): Promise<{ published: boolean } | null> {
    return withClient(env.dbUrl, async (client) => {
      const found = await client.query<{ published: boolean }>(
        'select published from public.reviews where id = $1',
        [id],
      )
      return found.rows[0] ?? null
    })
  }

  /** Whether a client without a session can read the review at all. */
  async function anonymouslyReadable(id: string): Promise<boolean> {
    const { data, error } = await anon.from('reviews').select('id,name,rating,text').eq('id', id)
    if (error !== null) throw new Error(`Anonymous review read failed: ${error.message}`)
    return data.length === 1
  }

  /** The ids the public site lists: the query of the public reviews adapter. */
  async function publishedIds(): Promise<readonly string[]> {
    const { data, error } = await anon
      .from('reviews')
      .select('id,name,rating,text')
      .eq('published', true)
      .order('created_at', { ascending: false })
    if (error !== null) throw new Error(`Public review list failed: ${error.message}`)
    return data.map((row) => String(row.id))
  }

  async function signIn(email: string, password: string): Promise<string> {
    const { data, error } = await getAdminClient().auth.signInWithPassword({ email, password })
    if (error !== null || data.user === null)
      throw new Error(`Sign-in failed for ${email}: ${error?.message ?? 'no user'}`)
    return data.user.id
  }

  beforeAll(async () => {
    const configured = readAdminStackEnv()
    if (
      configured === null ||
      !LOCAL_HOSTS.includes(new URL(configured.url).hostname) ||
      !LOCAL_HOSTS.includes(new URL(configured.dbUrl).hostname)
    )
      throw new Error(
        'The review moderation suite writes and deletes rows; it runs against a local stack only.',
      )

    env = configured
    seededIn = configured
    anon = createClient(env.url, env.anonKey, { auth: { persistSession: false } })
    service = createClient(env.url, env.serviceRoleKey, { auth: { persistSession: false } })
    older = await seedReview('older', 2, 1)
    newer = await seedReview('newer', 5, 2)
  })

  // `beforeAll` can fail part-way, with one review seeded or none: what is removed here is found
  // by what this run named and noted, never by a value that only a complete `beforeAll` sets. A
  // seeded review is published and dated in the future, so it must not be left behind.
  afterAll(async () => {
    // Nothing was written: the stack was not found to be local.
    if (seededIn === null) return
    await withClient(seededIn.dbUrl, async (client) => {
      // By name: a review whose insert was made but whose id never arrived is removed as well.
      await client.query('delete from public.reviews where name = any($1::text[])', [
        [reviewName('older'), reviewName('newer')],
      ])
      // The admin log rows of this run and no others: those about its reviews, and those the
      // service-role block wrote, by their ids.
      await client.query(
        `delete from public.admin_audit_log
         where (target_table = 'reviews' and target_id = any($1::text[]))
            or id = any($2::uuid[])`,
        [seededIds, recordedEntryIds],
      )
    })
    await getAdminClient().auth.signOut()
  })

  describe('as the owner', () => {
    beforeAll(async () => {
      ownerId = await signIn(OWNER_EMAIL, OWNER_PASSWORD)
    })

    it('lists every review newest first with exactly the stored fields', async () => {
      const page = await listReviews(null)
      if (!page.ok) throw new Error(`listReviews failed: ${page.error.kind}`)

      expect(page.value.entries.slice(0, 2)).toEqual([
        {
          id: newer.id,
          createdAt: expect.any(String),
          name: newer.name,
          rating: 5,
          text: newer.text,
          published: true,
        },
        {
          id: older.id,
          createdAt: expect.any(String),
          name: older.name,
          rating: 2,
          text: older.text,
          published: true,
        },
      ])
      const [first, second] = page.value.entries
      expect(Date.parse(first?.createdAt ?? '')).toBeGreaterThan(
        Date.parse(second?.createdAt ?? ''),
      )
    })

    it('continues after an entry when both halves of its cursor are sent', async () => {
      const page = await listReviews(null)
      if (!page.ok) throw new Error(`listReviews failed: ${page.error.kind}`)
      const first = page.value.entries[0]
      if (first === undefined) throw new Error('The seeded reviews are not listed')

      const next = await listReviews({ before: first.createdAt, beforeId: first.id })
      if (!next.ok) throw new Error(`listReviews with a cursor failed: ${next.error.kind}`)

      expect(next.value.entries[0]?.id).toBe(older.id)
      expect(next.value.entries.map((entry) => entry.id)).not.toContain(newer.id)
    })

    it('says more rows exist when the page is shorter than the table', async () => {
      // The adapter always asks for 50; one row per page shows the paging answer itself.
      const { data, error } = await getAdminClient().rpc('admin_list_reviews', {
        p_before: null,
        p_before_id: null,
        p_limit: 1,
      })

      expect(error).toBeNull()
      expect(data).toMatchObject({ entries: [{ id: newer.id }], has_more: true })
    })

    it('hides a review from every anonymous read and keeps it for the owner', async () => {
      expect(await anonymouslyReadable(newer.id)).toBe(true)
      expect(await publishedIds()).toEqual(expect.arrayContaining([newer.id, older.id]))

      expect(await setReviewPublished(newer.id, false)).toEqual(DONE)

      expect(await anonymouslyReadable(newer.id)).toBe(false)
      const listed = await publishedIds()
      expect(listed).not.toContain(newer.id)
      expect(listed).toContain(older.id)
      expect(await storedReview(newer.id)).toEqual({ published: false })

      const page = await listReviews(null)
      if (!page.ok) throw new Error(`listReviews failed: ${page.error.kind}`)
      expect(page.value.entries.find((entry) => entry.id === newer.id)).toMatchObject({
        published: false,
        text: newer.text,
      })
    })

    it('publishes a hidden review again', async () => {
      expect(await setReviewPublished(newer.id, true)).toEqual(DONE)

      expect(await anonymouslyReadable(newer.id)).toBe(true)
      expect(await publishedIds()).toContain(newer.id)
      expect(await storedReview(newer.id)).toEqual({ published: true })
    })

    it('deletes a review, and reports a deleted one as gone', async () => {
      expect(await deleteReview(newer.id)).toEqual(DONE)

      expect(await storedReview(newer.id)).toBeNull()
      expect(await anonymouslyReadable(newer.id)).toBe(false)
      const page = await listReviews(null)
      if (!page.ok) throw new Error(`listReviews failed: ${page.error.kind}`)
      expect(page.value.entries.map((entry) => entry.id)).not.toContain(newer.id)
      expect(page.value.entries[0]?.id).toBe(older.id)

      expect(await deleteReview(newer.id)).toMatchObject({
        ok: false,
        error: { kind: 'not_found' },
      })
      expect(await setReviewPublished(newer.id, false)).toMatchObject({
        ok: false,
        error: { kind: 'not_found' },
      })
    })

    it('finds the three changes in the admin log: who, what, which column, no text', async () => {
      const log = await listAuditLog(null)
      if (!log.ok) throw new Error(`listAuditLog failed: ${log.error.kind}`)
      const mine = log.value.entries.filter(
        (entry) => entry.targetTable === 'reviews' && entry.targetId === newer.id,
      )

      // Newest first: the delete, the publish, the hide.
      expect(mine.map((entry) => entry.change)).toEqual([
        { action: 'delete' },
        { action: 'update', changedColumns: ['published'] },
        { action: 'update', changedColumns: ['published'] },
      ])
      expect(mine.map((entry) => entry.actor)).toEqual([
        { kind: 'owner' },
        { kind: 'owner' },
        { kind: 'owner' },
      ])
      // Nothing was done to the other review, so the log does not name it.
      expect(log.value.entries.map((entry) => entry.targetId)).not.toContain(older.id)

      // The answer as the database sends it, and the rows as they are stored: no review text.
      const raw = await getAdminClient().rpc('admin_list_audit_log', {
        p_before: null,
        p_before_id: null,
        p_limit: 100,
      })
      expect(raw.error).toBeNull()
      expect(JSON.stringify(raw.data)).toContain(newer.id)
      expect(JSON.stringify(raw.data)).not.toContain(marker)
      const stored = await withClient(env.dbUrl, async (client) => {
        const rows = await client.query<{ row: string }>(
          `select pg_catalog.to_jsonb(l)::text as row
           from public.admin_audit_log l
           where l.target_table = 'reviews' and l.target_id = $1`,
          [newer.id],
        )
        return rows.rows.map((entry) => entry.row)
      })
      expect(stored).toHaveLength(3)
      expect(stored.join('\n')).not.toContain(marker)
      expect(stored.join('\n')).toContain(ownerId)
    })

    it('continues the admin log after an entry when both halves of its cursor are sent', async () => {
      const log = await listAuditLog(null)
      if (!log.ok) throw new Error(`listAuditLog failed: ${log.error.kind}`)
      const mine = log.value.entries.filter((entry) => entry.targetId === newer.id)
      const [deleted, published] = mine
      if (deleted === undefined || published === undefined)
        throw new Error('The review entries are not in the admin log')

      const next = await listAuditLog({ before: deleted.createdAt, beforeId: deleted.id })
      if (!next.ok) throw new Error(`listAuditLog with a cursor failed: ${next.error.kind}`)

      expect(next.value.entries[0]?.id).toBe(published.id)
      expect(next.value.entries.map((entry) => entry.id)).not.toContain(deleted.id)
    })

    it('shows what an Edge Function recorded for a service-role change, by column name', async () => {
      const earlier = await serviceRecordedEntryIds()
      // Every table, action and column the staff functions name (_shared/adminAudit.ts callers).
      const recorded = [
        await recordAdminAction(service, {
          actorId: ownerId,
          action: 'insert',
          table: 'profiles',
          targetId: ownerId,
        }),
        await recordAdminAction(service, {
          actorId: ownerId,
          action: 'insert',
          table: 'staff_invitations',
          targetId: ownerId,
        }),
        await recordAdminAction(service, {
          actorId: ownerId,
          action: 'update',
          table: 'staff_invitations',
          targetId: ownerId,
          changedColumns: ['token_hash', 'created_at'],
        }),
        await recordAdminAction(service, {
          actorId: ownerId,
          action: 'insert',
          table: 'barber_photos',
          targetId: BARBER_LINK_ID,
        }),
        await recordAdminAction(service, {
          actorId: ownerId,
          action: 'update',
          table: 'barber_photos',
          targetId: BARBER_LINK_ID,
          changedColumns: ['storage_path'],
        }),
        await recordAdminAction(service, {
          actorId: ownerId,
          action: 'delete',
          table: 'barber_photos',
          targetId: BARBER_LINK_ID,
        }),
        await recordAdminAction(service, {
          actorId: ownerId,
          action: 'update',
          table: 'barber_calendar_tokens',
          targetId: BARBER_LINK_ID,
          changedColumns: ['disconnect_requested_at'],
        }),
        // calendar-oauth-callback: a first connect, a reconnect that writes the whole link, and
        // renewed access for a link the store keeps.
        await recordAdminAction(service, {
          actorId: ownerId,
          action: 'insert',
          table: 'barber_calendar_tokens',
          targetId: BARBER_LINK_ID,
        }),
        await recordAdminAction(service, {
          actorId: ownerId,
          action: 'update',
          table: 'barber_calendar_tokens',
          targetId: BARBER_LINK_ID,
          changedColumns: [
            'refresh_token',
            'google_email',
            'calendar_id',
            'updated_at',
            'last_sync_error',
            'disconnect_requested_at',
          ],
        }),
        await recordAdminAction(service, {
          actorId: ownerId,
          action: 'update',
          table: 'barber_calendar_tokens',
          targetId: BARBER_LINK_ID,
          changedColumns: ['refresh_token', 'calendar_id', 'updated_at', 'last_sync_error'],
        }),
      ]
      // Noted before anything is asserted: the rows that are there now and were not before are the
      // ones written above (the integration files run one at a time), and are removed afterwards.
      recordedEntryIds.push(
        ...(await serviceRecordedEntryIds()).filter((id) => !earlier.includes(id)),
      )
      expect(recorded).toEqual(recorded.map(() => ({ ok: true })))
      expect(recordedEntryIds).toHaveLength(recorded.length)

      const log = await listAuditLog(null)
      if (!log.ok) throw new Error(`listAuditLog failed: ${log.error.kind}`)
      // Newest first, so the ten entries read in reverse.
      expect(
        log.value.entries.slice(0, 10).map((entry) => ({
          actor: entry.actor,
          table: entry.targetTable,
          target: entry.targetId,
          change: entry.change,
        })),
      ).toEqual(
        [
          { table: 'profiles', target: ownerId, change: { action: 'insert' } },
          { table: 'staff_invitations', target: ownerId, change: { action: 'insert' } },
          {
            table: 'staff_invitations',
            target: ownerId,
            // The database stores the names sorted.
            change: { action: 'update', changedColumns: ['created_at', 'token_hash'] },
          },
          { table: 'barber_photos', target: BARBER_LINK_ID, change: { action: 'insert' } },
          {
            table: 'barber_photos',
            target: BARBER_LINK_ID,
            change: { action: 'update', changedColumns: ['storage_path'] },
          },
          { table: 'barber_photos', target: BARBER_LINK_ID, change: { action: 'delete' } },
          {
            table: 'barber_calendar_tokens',
            target: BARBER_LINK_ID,
            change: { action: 'update', changedColumns: ['disconnect_requested_at'] },
          },
          {
            table: 'barber_calendar_tokens',
            target: BARBER_LINK_ID,
            change: { action: 'insert' },
          },
          {
            table: 'barber_calendar_tokens',
            target: BARBER_LINK_ID,
            change: {
              action: 'update',
              changedColumns: [
                'calendar_id',
                'disconnect_requested_at',
                'google_email',
                'last_sync_error',
                'refresh_token',
                'updated_at',
              ],
            },
          },
          {
            table: 'barber_calendar_tokens',
            target: BARBER_LINK_ID,
            change: {
              action: 'update',
              changedColumns: ['calendar_id', 'last_sync_error', 'refresh_token', 'updated_at'],
            },
          },
        ]
          .reverse()
          .map((entry) => ({ actor: { kind: 'owner' }, ...entry })),
      )
    })

    it('answers a refused service-role entry with the database error code', async () => {
      // No profile has this id, so there is no member of staff to name.
      expect(
        await recordAdminAction(service, {
          actorId: crypto.randomUUID(),
          action: 'insert',
          table: 'profiles',
          targetId: ownerId,
        }),
      ).toEqual({ ok: false, code: '22023' })
    })
  })

  describe('as a barber', () => {
    beforeAll(async () => {
      await signIn(BARBER_EMAIL, BARBER_PASSWORD)
    })

    it('is refused by each of the four RPCs and changes nothing', async () => {
      expect(await listReviews(null)).toMatchObject(FORBIDDEN)
      expect(await setReviewPublished(older.id, false)).toMatchObject(FORBIDDEN)
      expect(await deleteReview(older.id)).toMatchObject(FORBIDDEN)
      expect(await listAuditLog(null)).toMatchObject(FORBIDDEN)

      expect(await storedReview(older.id)).toEqual({ published: true })
      expect(await anonymouslyReadable(older.id)).toBe(true)
    })
  })

  describe('without a session', () => {
    beforeAll(async () => {
      // The barber of the block above signs out: the panel's client now carries no session.
      const { error } = await getAdminClient().auth.signOut()
      if (error !== null) throw new Error(`Sign-out failed: ${error.message}`)
    })

    it('is refused by each of the four RPCs with HTTP 401 and changes nothing', async () => {
      const calls = [
        anon.rpc('admin_list_reviews', { p_before: null, p_before_id: null, p_limit: 50 }),
        anon.rpc('admin_set_review_published', { p_id: older.id, p_published: false }),
        anon.rpc('admin_delete_review', { p_id: older.id }),
        anon.rpc('admin_list_audit_log', { p_before: null, p_before_id: null, p_limit: 50 }),
      ]
      for (const call of calls) {
        const { data, error, status } = await call
        expect(error).not.toBeNull()
        expect(data).toBeNull()
        // The status is what tells this refusal from that of a signed-in barber: the error code
        // can be the same 42501 for both.
        expect(status).toBe(401)
      }

      expect(await storedReview(older.id)).toEqual({ published: true })
    })

    it('is told through each adapter that the session has ended, not that it is not the owner', async () => {
      expect(await listReviews(null)).toMatchObject(SESSION_ENDED)
      expect(await setReviewPublished(older.id, false)).toMatchObject(SESSION_ENDED)
      expect(await deleteReview(older.id)).toMatchObject(SESSION_ENDED)
      expect(await listAuditLog(null)).toMatchObject(SESSION_ENDED)

      expect(await storedReview(older.id)).toEqual({ published: true })
      expect(await anonymouslyReadable(older.id)).toBe(true)
    })
  })
})

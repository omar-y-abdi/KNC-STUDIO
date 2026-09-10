// Reviews adapter ↔ live stack. Review writes require the short-lived customer-access session that
// proves possession of the booking email, and the submitted phone must match that session's scope.
// The tests seed the server-side session directly, then drive the real browser adapter + Edge gateway.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash, randomBytes } from 'node:crypto'
import { supabaseReviewsAdapter } from '../../src/about/reviews/adapters/supabaseReviews'
import { supabaseMyBookingsAdapter } from '../../src/mybookings/adapters/supabaseMyBookings'
import type { Phone } from '../../src/booking/validation'
import {
  backendReady,
  readStackEnv,
  TURNSTILE_TEST_TOKEN,
  truncateAll,
  uniquePhone,
  uniqueReviewMarker,
  withClient,
} from './_helpers'
import {
  installCustomerGatewayFetch,
  removeCustomerAccessFixtures,
  seedCustomerAccessSession,
  seedReviewableBooking,
} from './reviewAccessHelpers'

let sessionCookieToken: string | null = null

async function authorizeReview(dbUrl: string, phone: string, email: string): Promise<void> {
  sessionCookieToken = await seedCustomerAccessSession(dbUrl, { phone, email })
}

function submitReview(
  review: Parameters<typeof supabaseReviewsAdapter.submit>[0],
  turnstileToken: string,
): ReturnType<typeof supabaseReviewsAdapter.submit> {
  return supabaseReviewsAdapter.submit(review, turnstileToken, sessionCookieToken ?? undefined)
}

describe.skipIf(!backendReady())('supabaseReviewsAdapter (integration)', () => {
  let restoreFetch: (() => void) | undefined
  afterEach(() => restoreFetch?.())
  beforeEach(async () => {
    restoreFetch = installCustomerGatewayFetch()
    sessionCookieToken = null
    const env = readStackEnv()
    if (env) await truncateAll(env.dbUrl)
  })

  for (const mode of ['permanent', 'legacy'] as const) {
    for (const first of ['mint', 'rotate'] as const) {
      it(`${mode} session mint and rotation serialize when ${first} holds the lock first`, async () => {
        const env = readStackEnv()
        if (!env) throw new Error('Local Supabase required')
        const email = `overlap-${uniqueReviewMarker().toLowerCase()}@example.test`,
          phone = uniquePhone()
        const hash = (value: string): string => createHash('sha256').update(value).digest('hex')
        const token = randomBytes(32).toString('hex'),
          replacement = randomBytes(32).toString('hex')
        const session = randomBytes(32).toString('hex'),
          ciphertext = `v1.${'a'.repeat(80)}`
        const mintFunction =
          mode === 'permanent'
            ? 'establish_customer_booking_session'
            : 'exchange_customer_booking_access'
        try {
          await seedReviewableBooking(env.dbUrl, {
            phone,
            email,
            customerName: 'Concurrent customer',
          })
          await withClient(env.dbUrl, async (holder) => {
            await holder.query('select public.ensure_customer_booking_access_token($1,$2,$3,$4)', [
              email,
              phone,
              hash(token),
              ciphertext,
            ])
            if (mode === 'legacy')
              await holder.query(
                `insert into public.customer_booking_access_challenges(phone,email,token_hash,expires_at)
              values($1,$2,$3,now()+interval '1 day')`,
                [phone, email, hash(token)],
              )
            await withClient(env.dbUrl, async (waiter) => {
              const holderPid = (
                await holder.query<{ pid: number }>('select pg_backend_pid() as pid')
              ).rows[0]?.pid
              const waiterPid = (
                await waiter.query<{ pid: number }>('select pg_backend_pid() as pid')
              ).rows[0]?.pid
              const mint = (client: typeof holder) =>
                client.query<{ ok: boolean }>(`select public.${mintFunction}($1,$2) as ok`, [
                  hash(token),
                  hash(session),
                ])
              const rotate = (client: typeof holder) =>
                client.query<{ ok: boolean }>(
                  'select public.rotate_customer_booking_access_token($1,$2,$3,$4,$5) as ok',
                  [email, hash(replacement), ciphertext, replacement, 'sv'],
                )
              await holder.query('begin')
              let pending: ReturnType<typeof mint> | undefined
              try {
                expect((await (first === 'mint' ? mint(holder) : rotate(holder))).rows[0]?.ok).toBe(
                  true,
                )
                pending = first === 'mint' ? rotate(waiter) : mint(waiter)
                void pending.catch(() => undefined) // observed below; avoid an unhandled rejection while checking the lock
                // Observe PostgreSQL's actual blocker, not a sleep that merely hopes requests overlap.
                await expect
                  .poll(
                    async () => {
                      const row = await holder.query<{ blocked: boolean }>(
                        'select $1::int = any(pg_blocking_pids($2::int)) as blocked',
                        [holderPid, waiterPid],
                      )
                      return row.rows[0]?.blocked
                    },
                    { timeout: 5000, interval: 20 },
                  )
                  .toBe(true)
                await holder.query('commit')
                expect((await pending).rows[0]?.ok).toBe(first === 'mint')
                const scope = await holder.query<{ accepted: boolean }>(
                  'select exists(select 1 from public.customer_booking_access_scope($1)) as accepted',
                  [hash(session)],
                )
                expect(scope.rows[0]?.accepted).toBe(false)
                const current = await holder.query<{ token_hash: string }>(
                  'select token_hash from public.customer_booking_access_tokens where email=$1',
                  [email],
                )
                expect(current.rows[0]?.token_hash).toBe(hash(replacement))
              } finally {
                await holder.query('rollback')
                await pending?.catch(() => undefined)
              }
            })
          })
        } finally {
          await removeCustomerAccessFixtures(env.dbUrl, [email])
        }
      })
    }
  }

  it('ciphertext repair waits for rotation and preserves its newer token and email challenge', async () => {
    const env = readStackEnv()
    if (!env) throw new Error('Local Supabase required')
    const email = `repair-${uniqueReviewMarker().toLowerCase()}@example.test`
    const phone = uniquePhone()
    const hash = (value: string): string => createHash('sha256').update(value).digest('hex')
    const oldToken = randomBytes(32).toString('hex')
    const replacement = randomBytes(32).toString('hex')
    const repair = randomBytes(32).toString('hex')
    const ciphertext = `v1.${'a'.repeat(80)}`
    try {
      await seedReviewableBooking(env.dbUrl, { phone, email, customerName: 'Repair overlap' })
      await withClient(env.dbUrl, async (holder) => {
        await holder.query('select public.ensure_customer_booking_access_token($1,$2,$3,$4)', [
          email,
          phone,
          hash(oldToken),
          ciphertext,
        ])
        const generation = (
          await holder.query<{ generation: string }>(
            'select generation from public.customer_booking_access_tokens where email=$1',
            [email],
          )
        ).rows[0]?.generation
        expect(generation).toBeDefined()
        await withClient(env.dbUrl, async (waiter) => {
          const holderPid = (await holder.query<{ pid: number }>('select pg_backend_pid() as pid'))
            .rows[0]?.pid
          const waiterPid = (await waiter.query<{ pid: number }>('select pg_backend_pid() as pid'))
            .rows[0]?.pid
          let pending: ReturnType<typeof waiter.query<{ ok: boolean }>> | undefined
          await holder.query('begin')
          try {
            expect(
              (
                await holder.query<{ ok: boolean }>(
                  'select public.rotate_customer_booking_access_token($1,$2,$3,$4,$5) as ok',
                  [email, hash(replacement), ciphertext, replacement, 'sv'],
                )
              ).rows[0]?.ok,
            ).toBe(true)
            pending = waiter.query<{ ok: boolean }>(
              'select public.replace_customer_booking_access_token($1,$2,$3,$4,$5) as ok',
              [email, phone, hash(repair), ciphertext, generation],
            )
            void pending.catch(() => undefined)
            await expect
              .poll(
                async () =>
                  (
                    await holder.query<{ blocked: boolean }>(
                      'select $1::int = any(pg_blocking_pids($2::int)) as blocked',
                      [holderPid, waiterPid],
                    )
                  ).rows[0]?.blocked,
                { timeout: 5000, interval: 20 },
              )
              .toBe(true)
            await holder.query('commit')
            expect((await pending).rows[0]?.ok).toBe(false)
            const current = await holder.query<{ token_hash: string; challenge_hash: string }>(
              `select t.token_hash, c.token_hash as challenge_hash
               from public.customer_booking_access_tokens t
               join public.customer_booking_access_challenges c on c.email=t.email
               where t.email=$1`,
              [email],
            )
            expect(current.rows).toEqual([
              { token_hash: hash(replacement), challenge_hash: hash(replacement) },
            ])
          } finally {
            await holder.query('rollback')
            await pending?.catch(() => undefined)
          }
        })
      })
    } finally {
      await removeCustomerAccessFixtures(env.dbUrl, [email])
    }
  })

  it('permanent links establish the right cookie session, survive return visits and revoke on rotation', async () => {
    const env = readStackEnv()
    if (!env) return
    const marker = uniqueReviewMarker()
    const identities = [
      { email: `access-a-${marker}@example.test`, phone: uniquePhone() },
      { email: `access-b-${marker}@example.test`, phone: uniquePhone() },
    ]
    const tokens = identities.map(() => randomBytes(32).toString('hex'))
    const hash = (value: string): string => createHash('sha256').update(value).digest('hex')
    try {
      for (const [index, identity] of identities.entries()) {
        await seedReviewableBooking(env.dbUrl, { ...identity, customerName: `Access ${index}` })
        await withClient(env.dbUrl, (client) =>
          client.query('select public.ensure_customer_booking_access_token($1,$2,$3,$4)', [
            identity.email,
            identity.phone,
            hash(tokens[index] ?? ''),
            `v1.${'a'.repeat(80)}`,
          ]),
        )
        const result = await supabaseMyBookingsAdapter.list({
          accessToken: tokens[index] ?? '',
          lang: 'sv',
        })
        expect(result.ok).toBe(true)
        if (result.ok) {
          expect(result.profile.email).toBe(identity.email.toLowerCase())
          expect(result.bookings.past).toHaveLength(1)
        }
      }
      const restored = await supabaseMyBookingsAdapter.list({ accessToken: '', lang: 'sv' })
      expect(restored.ok).toBe(true)
      if (restored.ok) expect(restored.profile.email).toBe(identities[1]?.email.toLowerCase())
      await expect(
        supabaseMyBookingsAdapter.list({ accessToken: 'f'.repeat(64), lang: 'sv' }),
      ).resolves.toEqual({ ok: false, error: 'access_denied' })

      const replacement = randomBytes(32).toString('hex')
      await withClient(env.dbUrl, (client) =>
        client.query('select public.rotate_customer_booking_access_token($1,$2,$3,$4,$5)', [
          identities[1]?.email,
          hash(replacement),
          `v1.${'b'.repeat(80)}`,
          replacement,
          'sv',
        ]),
      )
      await expect(
        supabaseMyBookingsAdapter.list({ accessToken: '', lang: 'sv' }),
      ).resolves.toEqual({ ok: false, error: 'access_denied' })
      await expect(
        supabaseMyBookingsAdapter.list({ accessToken: tokens[1] ?? '', lang: 'sv' }),
      ).resolves.toEqual({ ok: false, error: 'access_denied' })
      const fresh = await supabaseMyBookingsAdapter.list({ accessToken: replacement, lang: 'sv' })
      expect(fresh.ok).toBe(true)
      if (fresh.ok) expect(fresh.profile.email).toBe(identities[1]?.email.toLowerCase())
    } finally {
      await removeCustomerAccessFixtures(
        env.dbUrl,
        identities.map(({ email }) => email.toLowerCase()),
      )
    }
  })

  it('an email-authorized finished booking publishes once with the server-derived name', async () => {
    const env = readStackEnv()
    if (!env) return

    const phone = uniquePhone()
    const email = `anna-${uniqueReviewMarker()}@example.test`
    await seedReviewableBooking(env.dbUrl, {
      phone,
      email,
      customerName: 'Anna Andersson',
    })
    await authorizeReview(env.dbUrl, phone, email)

    const marker = uniqueReviewMarker()
    const submitted = await submitReview(
      {
        phone: phone as Phone,
        rating: 5,
        text: `Great cut — ${marker}`,
      },
      TURNSTILE_TEST_TOKEN,
    )
    expect(submitted.ok).toBe(true)
    if (!submitted.ok) return
    expect(submitted.review.name).toBe('Anna A.')
    expect(submitted.review.rating).toBe(5)

    const list = await supabaseReviewsAdapter.list()
    const found = list.find((review) => review.id === submitted.review.id)
    expect(found).toBeDefined()
    expect(found?.name).toBe('Anna A.')

    const second = await submitReview(
      {
        phone: phone as Phone,
        rating: 4,
        text: `again — ${marker}`,
      },
      TURNSTILE_TEST_TOKEN,
    )
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.error.kind).toBe('no_booking')
  })

  it('a valid customer session without a finished matching booking → no_booking', async () => {
    const env = readStackEnv()
    if (!env) return

    const phone = uniquePhone()
    const email = `none-${uniqueReviewMarker()}@example.test`
    await authorizeReview(env.dbUrl, phone, email)

    const result = await submitReview(
      {
        phone: phone as Phone,
        rating: 5,
        text: 'No booking, no review.',
      },
      TURNSTILE_TEST_TOKEN,
    )
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe('no_booking')
  })

  it('list() returns email-authorized reviews newest-first', async () => {
    const env = readStackEnv()
    if (!env) return

    const olderPhone = uniquePhone()
    const newerPhone = uniquePhone()
    const olderEmail = `older-${uniqueReviewMarker()}@example.test`
    const newerEmail = `newer-${uniqueReviewMarker()}@example.test`
    await seedReviewableBooking(env.dbUrl, {
      phone: olderPhone,
      email: olderEmail,
      customerName: 'Olle Olsson',
    })
    await seedReviewableBooking(env.dbUrl, {
      phone: newerPhone,
      email: newerEmail,
      customerName: 'Nina Nilsson',
    })

    await authorizeReview(env.dbUrl, olderPhone, olderEmail)
    const first = await submitReview(
      { phone: olderPhone as Phone, rating: 4, text: 'old' },
      TURNSTILE_TEST_TOKEN,
    )

    await authorizeReview(env.dbUrl, newerPhone, newerEmail)
    const second = await submitReview(
      { phone: newerPhone as Phone, rating: 5, text: 'new' },
      TURNSTILE_TEST_TOKEN,
    )
    expect(first.ok && second.ok).toBe(true)

    const list = await supabaseReviewsAdapter.list()
    expect(list).toHaveLength(2)
    expect(list[0]?.name).toBe('Nina N.')
    expect(list[1]?.name).toBe('Olle O.')
  })
})

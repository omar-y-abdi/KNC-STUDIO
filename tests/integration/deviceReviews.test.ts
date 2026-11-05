// Real browser adapter -> same-origin Worker -> Edge -> Postgres; SQL seeds fixtures and proves the insert race.
import { createHash, randomBytes } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { supabaseReviewsAdapter } from '../../modules/public-web/src/about/reviews/adapters/supabaseReviews'
import type { Phone } from '../../modules/public-web/src/booking/validation'
import { CUSTOMER_RECEIPT_COOKIE } from '../../supabase/functions/_shared/customerCookies'
import {
  backendReady,
  readStackEnv,
  TURNSTILE_TEST_TOKEN,
  truncateAll,
  uniquePhone,
  uniqueReviewMarker,
  withClient,
} from './_helpers'
import { installCustomerGatewayFetch, seedReviewableBooking } from './reviewAccessHelpers'

const hash = (value: string) => createHash('sha256').update(value).digest('hex')

describe.skipIf(!backendReady())('device reviews (integration)', () => {
  let restoreFetch: (() => void) | undefined
  const receiptHashes: string[] = []
  const environment = () => {
    const env = readStackEnv()
    if (!env) throw new Error('CI Supabase stack required')
    return env
  }
  beforeEach(async () => {
    await truncateAll(environment().dbUrl)
  })
  afterEach(async () => {
    restoreFetch?.()
    restoreFetch = undefined
    await withClient(environment().dbUrl, (client) =>
      client.query(
        'delete from public.customer_booking_receipts where token_hash=any($1::text[])',
        [receiptHashes.splice(0)],
      ),
    )
  })

  async function fixture() {
    const { dbUrl } = environment()
    const phone = uniquePhone() as Phone
    const email = `device-review-${uniqueReviewMarker().toLowerCase()}@example.test`
    const booking = await seedReviewableBooking(dbUrl, {
      phone,
      email,
      customerName: 'Device Customer',
    })
    const token = randomBytes(32).toString('hex')
    const receiptHash = hash(token)
    receiptHashes.push(receiptHash)
    await withClient(dbUrl, (client) =>
      client.query('select public.append_customer_booking_receipt($1,null,$2,null)', [
        booking,
        receiptHash,
      ]),
    )
    return { phone, email, booking, token, receiptHash }
  }
  const submit = (phone: Phone, text = 'Device receipt review') =>
    supabaseReviewsAdapter.submit({ phone, rating: 5, text }, TURNSTILE_TEST_TOKEN)

  it('reviews the exact finished receipt booking without email exchange or full-history access', async () => {
    const item = await fixture()
    const other = await seedReviewableBooking(environment().dbUrl, {
      phone: item.phone,
      email: item.email,
      customerName: 'Same Contact Elsewhere',
    })
    restoreFetch = installCustomerGatewayFetch({ [CUSTOMER_RECEIPT_COOKIE]: item.token })
    const result = await submit(item.phone)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.review.name).toBe('Device C.')
    const persisted = await withClient(environment().dbUrl, (client) =>
      client.query<{
        booking_id: string
        name: string
      }>('select booking_id,name from public.reviews'),
    )
    expect(persisted.rows).toEqual([{ booking_id: item.booking, name: 'Device C.' }])
    expect(persisted.rows[0]?.booking_id).not.toBe(other)
    const again = await submit(item.phone)
    expect(again.ok).toBe(false)
    if (!again.ok) expect(again.error.kind).toBe('no_booking')
  })

  it.each(['missing', 'malformed', 'unknown', 'expired', 'revoked', 'other-device'] as const)(
    '%s receipt cannot authorize a matching phone',
    async (state) => {
      const item = await fixture()
      let token = item.token
      if (state === 'malformed') token = 'invalid'
      if (state === 'unknown') token = randomBytes(32).toString('hex')
      if (state === 'expired')
        await withClient(environment().dbUrl, (client) =>
          client.query(
            "update public.customer_booking_receipts set expires_at=now()-interval '1 second' where token_hash=$1",
            [item.receiptHash],
          ),
        )
      if (state === 'revoked')
        await withClient(environment().dbUrl, (client) =>
          client.query('select public.forget_customer_booking_receipt($1)', [item.receiptHash]),
        )
      if (state === 'other-device') token = (await fixture()).token
      restoreFetch = installCustomerGatewayFetch(
        state === 'missing' ? {} : { [CUSTOMER_RECEIPT_COOKIE]: token },
      )
      const result = await submit(item.phone)
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error.kind).toBe('no_booking')
      expect(
        (
          await withClient(environment().dbUrl, (client) =>
            client.query('select id from public.reviews where booking_id=$1', [item.booking]),
          )
        ).rows,
      ).toEqual([])
    },
  )

  it('serializes concurrent attempts for one receipt booking to one published review', async () => {
    const item = await fixture()
    const { dbUrl } = environment()
    await withClient(dbUrl, async (holder) => {
      await withClient(dbUrl, async (waiter) => {
        const holderPid = (await holder.query<{ pid: number }>('select pg_backend_pid() as pid'))
          .rows[0]?.pid
        const waiterPid = (await waiter.query<{ pid: number }>('select pg_backend_pid() as pid'))
          .rows[0]?.pid
        const write = (client: typeof holder) =>
          client.query<{ result: { ok: boolean; error?: string } }>(
            'select public.create_review_for_browser(null,$1,$2,5,$3) as result',
            [item.receiptHash, item.phone, 'Concurrent device review'],
          )
        let pending: ReturnType<typeof write> | undefined
        await holder.query('begin')
        try {
          expect((await write(holder)).rows[0]?.result.ok).toBe(true)
          pending = write(waiter)
          void pending.catch(() => undefined)
          await expect
            .poll(
              async () =>
                (
                  await holder.query<{ blocked: boolean }>(
                    'select $1::int=any(pg_blocking_pids($2::int)) as blocked',
                    [holderPid, waiterPid],
                  )
                ).rows[0]?.blocked,
              { timeout: 5000, interval: 20 },
            )
            .toBe(true)
          await holder.query('commit')
          expect((await pending).rows[0]?.result).toEqual({ ok: false, error: 'no_booking' })
        } finally {
          await holder.query('rollback')
          await pending?.catch(() => undefined)
        }
      })
      expect(
        (await holder.query('select id from public.reviews where booking_id=$1', [item.booking]))
          .rows,
      ).toHaveLength(1)
    })
  })
})

import { createHash, randomBytes } from 'node:crypto'
import { customerGateway } from '../../src/mybookings/customerGateway'
import { readStackEnv, withClient } from './_helpers'

/** Node has no document origin or cookie jar. Execute the real Worker handler, then real Edge/DB. */
export function installCustomerGatewayFetch(): () => void {
  const env = readStackEnv()
  if (env === null) throw new Error('Local Supabase is required for customer gateway integration')
  const gatewaySecret = process.env.CUSTOMER_GATEWAY_SECRET
  if (!gatewaySecret) throw new Error('Configure the local CUSTOMER_GATEWAY_SECRET for integration')
  const actualFetch = globalThis.fetch
  let cookie: string | null = null
  globalThis.fetch = async (input, init) => {
    if (input !== '/api/customer-bookings') return actualFetch(input, init)
    const headers = new Headers(init?.headers)
    headers.set('Origin', 'http://127.0.0.1:4173')
    headers.set('CF-Connecting-IP', '127.0.0.1')
    if (cookie !== null) headers.set('Cookie', cookie)
    const response = await customerGateway(
      new Request(`http://127.0.0.1:4173${input}`, { ...init, headers }),
      {
        SUPABASE_URL: env.url,
        SUPABASE_ANON_KEY: env.anonKey,
        CUSTOMER_GATEWAY_SECRET: gatewaySecret,
      },
    )
    const setCookie = response.headers.get('Set-Cookie')
    if (setCookie !== null) cookie = setCookie.split(';')[0] ?? null
    return response
  }
  return () => {
    globalThis.fetch = actualFetch
  }
}

let nextBookingOffsetHours = 2

export function memorySessionStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length(): number {
      return values.size
    },
    clear(): void {
      values.clear()
    },
    getItem(key: string): string | null {
      return values.get(key) ?? null
    },
    key(index: number): string | null {
      return Array.from(values.keys())[index] ?? null
    },
    removeItem(key: string): void {
      values.delete(key)
    },
    setItem(key: string, value: string): void {
      values.set(key, value)
    },
  }
}

export async function seedReviewableBooking(
  dbUrl: string,
  input: {
    readonly phone: string
    readonly email: string
    readonly customerName: string
    readonly barberId?: string
  },
): Promise<string> {
  const offsetHours = nextBookingOffsetHours
  nextBookingOffsetHours += 1

  return withClient(dbUrl, async (client) => {
    const result = await client.query<{ id: string }>(
      `insert into public.bookings
         (barber_id, service_id, service_name, price, duration_min, start_at, end_at,
          customer_name, method, phone, email, lang, status)
       values ($1, 'h', 'Hårklippning', 350, 45,
          now() - make_interval(hours => $5::int),
          now() - make_interval(hours => $5::int) + interval '45 minutes',
          $2, 'email', $3, lower($4), 'sv', 'confirmed')
       returning id`,
      [input.barberId ?? 'hassan', input.customerName, input.phone, input.email, offsetHours],
    )
    const row = result.rows[0]
    if (row === undefined) throw new Error('seedReviewableBooking inserted no row')
    return row.id
  })
}

export async function seedCustomerAccessSession(
  dbUrl: string,
  input: { readonly phone: string; readonly email: string },
): Promise<string> {
  const accessToken = randomBytes(32).toString('hex')
  const tokenHash = createHash('sha256').update(accessToken).digest('hex')

  await withClient(dbUrl, async (client) => {
    await client.query(
      `insert into public.customer_booking_access_sessions
         (phone, email, token_hash, expires_at)
       values ($1, lower($2), $3, now() + interval '20 minutes')`,
      [input.phone, input.email, tokenHash],
    )
  })

  return accessToken
}

/** Remove only this test's credentials/outbox rows; unrelated local identities remain intact. */
export async function removeCustomerAccessFixtures(
  dbUrl: string,
  emails: readonly string[],
): Promise<void> {
  const normalized = emails.map((email) => email.trim().toLowerCase())
  await withClient(dbUrl, async (client) => {
    await client.query('begin')
    try {
      await client.query(
        `delete from public.external_action_jobs
        where action_type='customer_access_email_send' and payload->>'challenge_id' in (
          select id::text from public.customer_booking_access_challenges where lower(email)=any($1)
        )`,
        [normalized],
      )
      for (const table of [
        'customer_booking_access_sessions',
        'customer_booking_access_challenges',
        'customer_booking_access_tokens',
      ]) {
        await client.query(`delete from public.${table} where lower(email)=any($1)`, [normalized])
      }
      await client.query('commit')
    } catch (error) {
      await client.query('rollback')
      throw error
    }
  })
}

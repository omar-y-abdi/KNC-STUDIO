import { createHash, randomBytes } from 'node:crypto'
import { withClient } from './_helpers'

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

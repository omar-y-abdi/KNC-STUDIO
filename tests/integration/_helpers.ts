// Shared integration-test plumbing. The tests drive the REAL adapters (the RLS path through the
// anon key, exactly as the browser does) and use a SUPERUSER Postgres connection ONLY to truncate
// `bookings`/`reviews` between tests for isolation.
//
// Why a direct `pg` connection (not a service_role REST client) for truncation: the frozen DB
// REVOKEs all direct table DML from the PostgREST roles (anon AND service_role) — every booking
// write goes through a SECURITY DEFINER RPC. So service_role REST truncation returns 42501/403.
// The superuser `postgres` role (exposed by the local stack as DB_URL) is the only credential that
// can truncate. This is local-stack-only test plumbing; production never uses it.

import { Client } from 'pg'

/** Accepted by Cloudflare's official always-pass Turnstile test secret in local/CI stacks. */
export const TURNSTILE_TEST_TOKEN = 'integration-test-token'

/** The env the local stack provides (loaded by vitest.integration.config.ts from `supabase status`). */
export interface StackEnv {
  readonly url: string
  readonly anonKey: string
  readonly dbUrl: string
}

/** Read the named env vars; `null` if any is missing or empty (the suite self-skips). */
export function readEnvVars<K extends string>(...keys: readonly K[]): Record<K, string> | null {
  const out = {} as Record<K, string>
  for (const key of keys) {
    const value = process.env[key]
    if (value === undefined || value === '') return null
    out[key] = value
  }
  return out
}

/** Read + validate the stack env from process.env, or `null` when the stack is absent (suite skips). */
export function readStackEnv(): StackEnv | null {
  const env = readEnvVars('SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_DB_URL')
  if (env === null) return null
  return { url: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY, dbUrl: env.SUPABASE_DB_URL }
}

/** `true` iff the local stack env is present — gate the whole suite on this (else `describe.skip`). */
export function backendReady(): boolean {
  return readStackEnv() !== null
}

/**
 * Run `fn` on a fresh superuser connection, always closing it (even on throw) so a failed test
 * can't leave a socket open.
 */
export async function withClient<T>(dbUrl: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: dbUrl })
  await client.connect()
  try {
    return await fn(client)
  } finally {
    await client.end()
  }
}

/**
 * TRUNCATE `bookings` + `reviews` via a fresh superuser connection. Used in `beforeEach` for a clean
 * slate.
 */
export async function truncateAll(dbUrl: string): Promise<void> {
  await withClient(dbUrl, (client) =>
    client.query(
      'truncate table public.bookings, public.reviews, public.public_action_attempts, public.barber_recurring_breaks restart identity cascade',
    ),
  )
}

/** The PII columns the RPC NEVER echoes back — read directly to verify they actually persisted. */
export interface PersistedBookingPii {
  readonly customerName: string
  readonly phone: string | null
  readonly email: string | null
  readonly serviceName: string
  /** PostgreSQL numeric is returned as a string by node-postgres; preserve exact decimal text. */
  readonly price: string
  readonly durationMin: number
}

/**
 * Read the persisted (never-echoed) PII for the confirmed booking with `phone`, via the superuser
 * connection. This is the ONLY way to assert the `create_booking` 9th arg `p_customer_name` truly
 * landed in the NOT-NULL `customer_name` column (the RPC's ok payload omits it by design).
 * Parameterized query — no string interpolation.
 */
export async function fetchPersistedBookingByPhone(
  dbUrl: string,
  phone: string,
): Promise<PersistedBookingPii | null> {
  return withClient(dbUrl, async (client) => {
    const res = await client.query<{
      customer_name: string
      phone: string | null
      email: string | null
      service_name: string
      price: string
      duration_min: number
    }>(
      "select customer_name, phone, email, service_name, price, duration_min from public.bookings where phone = $1 and status = 'confirmed' limit 1",
      [phone],
    )
    const row = res.rows[0]
    if (row === undefined) return null
    return {
      customerName: row.customer_name,
      phone: row.phone,
      email: row.email,
      serviceName: row.service_name,
      price: row.price,
      durationMin: row.duration_min,
    }
  })
}

export async function fetchActiveServiceId(
  dbUrl: string,
  barberId: string,
  name: string,
): Promise<string> {
  return withClient(dbUrl, async (client) => {
    const result = await client.query<{ id: string }>(
      'select id::text as id from public.services where barber_id = $1 and name = $2 and active = true limit 1',
      [barberId, name],
    )
    const row = result.rows[0]
    if (row === undefined) throw new Error(`Missing active service ${name} for ${barberId}`)
    return row.id
  })
}

/**
 * Read the persisted `start_at` (as an ISO-8601 UTC string) for the confirmed booking with `phone`,
 * via the superuser connection. Used to assert the WRITE-path timezone fix (H2): the adapter must
 * store the Europe/Stockholm instant for the selected wall-clock, regardless of the caller's tz.
 * Parameterized query — no string interpolation.
 */
export async function fetchPersistedStartAtByPhone(
  dbUrl: string,
  phone: string,
): Promise<string | null> {
  return withClient(dbUrl, async (client) => {
    const res = await client.query<{ start_at: Date }>(
      "select start_at from public.bookings where phone = $1 and status = 'confirmed' limit 1",
      [phone],
    )
    const row = res.rows[0]
    if (row === undefined) return null
    // node-postgres returns timestamptz as a JS Date (an absolute instant); normalize to UTC ISO.
    return new Date(row.start_at).toISOString()
  })
}

// --- create_booking RPC contract (pg, bypassing the HTTP gateway) -------------------------------
// The browser booking path now POSTs to the `submit-booking` edge function (Turnstile + rate-limit,
// then create_booking via service_role) — an HTTP layer a `pg` connection cannot serve. So we test
// the create_booking RPC CONTRACT directly here, authenticating as `service_role` (the
// gateway's own credential). The gateway HTTP layer itself is verified separately.

/** create_booking RPC Result, as returned over a direct pg call. */
export type CreateBookingRpcResult =
  | { readonly ok: true; readonly booking: Record<string, unknown> }
  | { readonly ok: false; readonly error: string }

/** Args for create_booking. Contact fields may be null to exercise database guards. */
export interface CreateBookingArgs {
  readonly barberId: string
  readonly serviceId: string
  readonly startAt: string | null
  readonly phone: string | null
  readonly email: string | null
  readonly lang: string
  readonly customerName: string
}

/**
 * Call `create_booking` directly as `service_role` (the credential the submit-booking
 * edge gateway uses). Opens + closes its own connection. Returns the RPC's jsonb Result.
 */
export async function callCreateBooking(
  dbUrl: string,
  args: CreateBookingArgs,
): Promise<CreateBookingRpcResult> {
  return withClient(dbUrl, async (client) => {
    await client.query('set role service_role')
    const res = await client.query<{ result: CreateBookingRpcResult }>(
      'select public.create_booking($1,$2,$3::timestamptz,$4,$5,$6,$7) as result',
      [
        args.barberId,
        args.serviceId,
        args.startAt,
        args.phone,
        args.email,
        args.lang,
        args.customerName,
      ],
    )
    const row = res.rows[0]
    if (row === undefined) throw new Error('create_booking returned no row')
    return row.result
  })
}

export async function callCreateBookingWithLimits(
  dbUrl: string,
  args: CreateBookingArgs,
  ipHash: string,
  phoneLimit: number,
): Promise<CreateBookingRpcResult> {
  return withClient(dbUrl, async (client) => {
    await client.query('set role service_role')
    const res = await client.query<{ result: CreateBookingRpcResult }>(
      `select public.create_booking_with_limits(
         $1,$2,$3::timestamptz,$4,$5,$6,$7,$8,600,86400,100,$9
       ) as result`,
      [
        args.barberId,
        args.serviceId,
        args.startAt,
        args.phone,
        args.email,
        args.lang,
        args.customerName,
        ipHash,
        phoneLimit,
      ],
    )
    const row = res.rows[0]
    if (row === undefined) throw new Error('create_booking_with_limits returned no row')
    return row.result
  })
}

// --- run-unique fixtures -------------------------------------------------------------------------
// Even though we truncate per test, fixtures are made unique PER RUN as defense in depth (so a
// crashed run that skipped a truncate can't collide on the exclusion constraint). A monotonic
// counter keeps values distinct within a run.

let counter = 0
function nextSeq(): number {
  counter += 1
  return counter
}

/** A unique Swedish-mobile-shaped phone (`^07\d{8}$`) for this run+call. */
export function uniquePhone(): string {
  const seq = nextSeq()
  const suffix = String(seq).padStart(8, '0').slice(-8)
  return `07${suffix}`
}

/** A unique review marker (name + text) so list assertions can find exactly this submission. */
export function uniqueReviewMarker(): string {
  return `IT-${Date.now()}-${nextSeq()}`
}

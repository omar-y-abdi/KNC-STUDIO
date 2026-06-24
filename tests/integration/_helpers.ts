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

/** The env the local stack provides (loaded by vitest.integration.config.ts from `supabase status`). */
export interface StackEnv {
  readonly url: string
  readonly anonKey: string
  readonly dbUrl: string
}

/** Read + validate the stack env from process.env, or `null` when the stack is absent (suite skips). */
export function readStackEnv(): StackEnv | null {
  const url = process.env.SUPABASE_URL
  const anonKey = process.env.SUPABASE_ANON_KEY
  const dbUrl = process.env.SUPABASE_DB_URL
  if (
    url === undefined ||
    anonKey === undefined ||
    dbUrl === undefined ||
    url === '' ||
    anonKey === '' ||
    dbUrl === ''
  ) {
    return null
  }
  return { url, anonKey, dbUrl }
}

/** `true` iff the local stack env is present — gate the whole suite on this (else `describe.skip`). */
export function backendReady(): boolean {
  return readStackEnv() !== null
}

/**
 * TRUNCATE `bookings` + `reviews` via a fresh superuser connection. Used in `beforeEach` for a clean
 * slate. Opens and closes its own connection so a failed test can't leave a socket open.
 */
export async function truncateAll(dbUrl: string): Promise<void> {
  const client = new Client({ connectionString: dbUrl })
  await client.connect()
  try {
    await client.query('truncate table public.bookings, public.reviews restart identity cascade')
  } finally {
    await client.end()
  }
}

/** The PII columns the RPC NEVER echoes back — read directly to verify they actually persisted. */
export interface PersistedBookingPii {
  readonly customerName: string
  readonly phone: string | null
  readonly email: string | null
}

/**
 * Read the persisted (never-echoed) PII for the confirmed booking with `phone`, via the superuser
 * connection. This is the ONLY way to assert the `create_booking` 11th arg `p_customer_name` truly
 * landed in the NOT-NULL `customer_name` column (the RPC's ok payload omits it by design).
 * Parameterized query — no string interpolation.
 */
export async function fetchPersistedBookingByPhone(
  dbUrl: string,
  phone: string,
): Promise<PersistedBookingPii | null> {
  const client = new Client({ connectionString: dbUrl })
  await client.connect()
  try {
    const res = await client.query<{ customer_name: string; phone: string | null; email: string | null }>(
      "select customer_name, phone, email from public.bookings where phone = $1 and status = 'confirmed' limit 1",
      [phone],
    )
    const row = res.rows[0]
    if (row === undefined) return null
    return { customerName: row.customer_name, phone: row.phone, email: row.email }
  } finally {
    await client.end()
  }
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
  const client = new Client({ connectionString: dbUrl })
  await client.connect()
  try {
    const res = await client.query<{ start_at: Date }>(
      "select start_at from public.bookings where phone = $1 and status = 'confirmed' limit 1",
      [phone],
    )
    const row = res.rows[0]
    if (row === undefined) return null
    // node-postgres returns timestamptz as a JS Date (an absolute instant); normalize to UTC ISO.
    return new Date(row.start_at).toISOString()
  } finally {
    await client.end()
  }
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

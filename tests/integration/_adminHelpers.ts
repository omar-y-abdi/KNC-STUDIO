// Integration-test plumbing for the ADMIN layer. The tests drive the REAL admin adapters through
// the RLS path (an authenticated client built on the anon key — exactly how the browser works), and
// use two privileged credentials ONLY for setup/teardown that RLS legitimately forbids the client:
//
//   * service_role Auth admin API — to CREATE/DELETE the test auth users (no client may do this).
//   * the postgres superuser (DB_URL) — to INSERT the `profiles` rows + READ rows back for
//     RLS-negative assertions. `admin_rls.sql` grants the admin tables to anon/authenticated only;
//     `profiles` has NO client insert policy at all, so the superuser is the one credential that can
//     seed them (service_role REST would 42501). This mirrors `_helpers.ts`'s truncate rationale.
//
// Nothing here is used in production — it is local-stack-only test scaffolding.

import { createClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readEnvVars, withClient } from './_helpers'

/** Full env the admin integration tests need (anon + service_role + db superuser). */
export interface AdminStackEnv {
  readonly url: string
  readonly anonKey: string
  readonly serviceRoleKey: string
  readonly dbUrl: string
}

/** Read + validate the admin stack env, or `null` when incomplete (suite self-skips). */
export function readAdminStackEnv(): AdminStackEnv | null {
  const env = readEnvVars(
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_DB_URL',
  )
  if (env === null) return null
  return {
    url: env.SUPABASE_URL,
    anonKey: env.SUPABASE_ANON_KEY,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    dbUrl: env.SUPABASE_DB_URL,
  }
}

/** `true` iff the full admin stack env is present (gate the whole admin suite on this). */
export function adminBackendReady(): boolean {
  return readAdminStackEnv() !== null
}

// --- seeded test identities ----------------------------------------------------------------------
// Stable emails/passwords + the barber the test-barber is linked to (a seeded roster id). The
// password is a local-only test credential (the stack is ephemeral + offline).

export const OWNER_EMAIL = 'owner.it@knc.test'
export const OWNER_PASSWORD = 'owner-it-pw-12345'
export const BARBER_EMAIL = 'barber.it@knc.test'
export const BARBER_PASSWORD = 'barber-it-pw-12345'
/** The seeded barber the test BARBER account acts as. */
export const BARBER_LINK_ID = 'hassan'
/** A DIFFERENT seeded barber, used to prove a barber cannot touch another's data. */
export const OTHER_BARBER_ID = 'victor'

export interface SeededUser {
  readonly id: string
  readonly email: string
}

/** A service_role client (Auth admin API). Used ONLY by setup/teardown, never by the tests' assertions. */
function serviceClient(env: AdminStackEnv): SupabaseClient {
  return createClient(env.url, env.serviceRoleKey, { auth: { persistSession: false } })
}

/**
 * Delete any existing test user with `email` (so re-runs are idempotent — the Auth admin API errors
 * on a duplicate email and the local stack persists between runs). Looks the user up by listing.
 */
async function deleteUserByEmail(env: AdminStackEnv, email: string): Promise<void> {
  const svc = serviceClient(env)
  // listUsers is paginated; the local stack has few users, so one page (perPage 200) is plenty.
  const { data, error } = await svc.auth.admin.listUsers({ page: 1, perPage: 200 })
  if (error !== null) return
  const existing = data.users.find((u) => u.email === email)
  if (existing !== undefined) await svc.auth.admin.deleteUser(existing.id)
}

/** Create a confirmed auth user (deleting any prior one first). Returns its id + email. */
async function createUser(
  env: AdminStackEnv,
  email: string,
  password: string,
): Promise<SeededUser> {
  await deleteUserByEmail(env, email)
  const svc = serviceClient(env)
  const { data, error } = await svc.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (error !== null || data.user === null) {
    throw new Error(`Failed to create test user ${email}: ${error?.message ?? 'no user returned'}`)
  }
  return { id: data.user.id, email }
}

/**
 * Insert (or update) a `profiles` row via the superuser — the only credential that may, since
 * `profiles` has no client write policy. Parameterized query (no interpolation).
 */
async function upsertProfile(
  env: AdminStackEnv,
  userId: string,
  role: 'owner' | 'barber',
  barberId: string | null,
): Promise<void> {
  await withClient(env.dbUrl, (client) =>
    client.query(
      `insert into public.profiles (id, role, barber_id) values ($1, $2, $3)
       on conflict (id) do update set role = excluded.role, barber_id = excluded.barber_id`,
      [userId, role, barberId],
    ),
  )
}

export interface SeededIdentities {
  readonly owner: SeededUser
  readonly barber: SeededUser
}

/**
 * Seed BOTH test identities (owner + barber) and their profiles. Idempotent: each user is deleted +
 * recreated, and the profile is upserted. Called once from the vitest globalSetup.
 */
export async function seedTestIdentities(env: AdminStackEnv): Promise<SeededIdentities> {
  const owner = await createUser(env, OWNER_EMAIL, OWNER_PASSWORD)
  const barber = await createUser(env, BARBER_EMAIL, BARBER_PASSWORD)
  await upsertProfile(env, owner.id, 'owner', null)
  await upsertProfile(env, barber.id, 'barber', BARBER_LINK_ID)
  return { owner, barber }
}

/** Remove the seeded users + their profiles (profiles cascade on user delete; we delete users). */
export async function cleanupTestIdentities(env: AdminStackEnv): Promise<void> {
  await deleteUserByEmail(env, OWNER_EMAIL)
  await deleteUserByEmail(env, BARBER_EMAIL)
}

// --- authenticated client (the path under test) --------------------------------------------------

/**
 * A FRESH authenticated client signed in as `email` — built on the ANON key + a real
 * `signInWithPassword`, exactly like the browser admin client. RLS therefore sees the user's role.
 * Each call returns an isolated client (its own session) so owner/barber tests don't share state.
 */
export async function signedInClient(
  env: AdminStackEnv,
  email: string,
  password: string,
): Promise<SupabaseClient> {
  const client = createClient(env.url, env.anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error !== null) throw new Error(`Sign-in failed for ${email}: ${error.message}`)
  return client
}

// --- superuser helpers for assertions + restore --------------------------------------------------

/** Read a single barber's full week (7 rows) via the superuser, for RLS-negative read-back checks. */
export async function readScheduleRaw(
  env: AdminStackEnv,
  barberId: string,
): Promise<readonly { weekday: number; working: boolean; start_min: number; end_min: number }[]> {
  return withClient(env.dbUrl, async (client) => {
    const res = await client.query<{
      weekday: number
      working: boolean
      start_min: number
      end_min: number
    }>(
      'select weekday, working, start_min, end_min from public.barber_schedules where barber_id = $1 order by weekday',
      [barberId],
    )
    return res.rows
  })
}

/** Count a barber's time-off rows via the superuser (RLS-negative read-back). */
export async function countTimeOffRaw(env: AdminStackEnv, barberId: string): Promise<number> {
  return withClient(env.dbUrl, async (client) => {
    const res = await client.query<{ n: string }>(
      'select count(*)::text as n from public.barber_time_off where barber_id = $1',
      [barberId],
    )
    return Number(res.rows[0]?.n ?? '0')
  })
}

/** A booking's status via the superuser (to assert a cancel did/did not happen). */
export async function bookingStatusRaw(
  env: AdminStackEnv,
  bookingId: string,
): Promise<string | null> {
  return withClient(env.dbUrl, async (client) => {
    const res = await client.query<{ status: string }>(
      'select status from public.bookings where id = $1',
      [bookingId],
    )
    return res.rows[0]?.status ?? null
  })
}

/** Insert a confirmed booking for a barber via the superuser; returns its id. Far-future to avoid clashes. */
export async function insertBookingRaw(
  env: AdminStackEnv,
  barberId: string,
  startAt: Date,
  durationMin: number,
): Promise<string> {
  return withClient(env.dbUrl, async (client) => {
    const end = new Date(startAt.getTime() + durationMin * 60000)
    const res = await client.query<{ id: string }>(
      `insert into public.bookings
         (barber_id, service_id, service_name, price, duration_min, start_at, end_at, customer_name, method, phone, lang)
       values ($1,'h','Hårklippning',350,$2,$3,$4,'IT Customer','phone','0700000000','sv')
       returning id`,
      [barberId, durationMin, startAt.toISOString(), end.toISOString()],
    )
    const id = res.rows[0]?.id
    if (id === undefined) throw new Error('insertBookingRaw: no id returned')
    return id
  })
}

/**
 * Restore the shared, seeded-but-mutable tables to their seed baseline after a test mutates them, so
 * tests stay isolated AND `available_slots` (which depends on schedules/time-off) is deterministic:
 *   - reset every barber's week to the seed default (Mon–Sat 09:00–18:00, Sun closed),
 *   - delete ALL time-off rows,
 *   - delete the test bookings we inserted (everything — the suite owns the bookings table here).
 * Storage objects from the gallery test are cleaned up by that test itself (it tracks its paths).
 */
export async function restoreSeedState(env: AdminStackEnv): Promise<void> {
  await withClient(env.dbUrl, async (client) => {
    await client.query('delete from public.barber_time_off')
    await client.query('delete from public.gallery_images')
    await client.query('truncate table public.bookings restart identity cascade')
    // Reset schedules to the seed default for every barber (upsert all 7 weekdays).
    await client.query(`
      insert into public.barber_schedules (barber_id, weekday, working, start_min, end_min)
      select b.id, wd.weekday, (wd.weekday between 1 and 6), 540, 1080
      from public.barbers b
      cross join generate_series(0, 6) as wd(weekday)
      on conflict (barber_id, weekday)
      do update set working = excluded.working, start_min = excluded.start_min, end_min = excluded.end_min
    `)
  })
}

// Standalone seeder for the LOCAL stack admin test identities (manual review convenience).
//
// The integration suite seeds these in a vitest globalSetup AND DELETES them in teardown — so after
// `npm run test:integration` the accounts are gone. Run this script to (re)create them for a manual
// browser review:
//
//   node tools/seed-admin-users.mjs
//
// It is idempotent (delete-then-create) and a no-op message if the local stack is down. It uses the
// service_role Auth admin API to create the users and the postgres superuser to insert their
// `profiles` rows (the only credential allowed to — `profiles` has no client write policy).
//
// Credentials created (LOCAL stack only — never production):
//   owner :  owner.it@knc.test  / owner-it-pw-12345    (role=owner)
//   barber:  barber.it@knc.test / barber-it-pw-12345   (role=barber, linked to barber 'hassan')

import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import { Client } from 'pg'

const OWNER = { email: 'owner.it@knc.test', password: 'owner-it-pw-12345', role: 'owner', barberId: null }
const BARBER = { email: 'barber.it@knc.test', password: 'barber-it-pw-12345', role: 'barber', barberId: 'hassan' }

function loadStackEnv() {
  try {
    const raw = execFileSync('npx', ['supabase', 'status', '-o', 'env'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 60_000,
    })
    const env = {}
    for (const line of raw.split('\n')) {
      const m = /^([A-Z0-9_]+)="(.*)"$/.exec(line.trim())
      if (m) env[m[1]] = m[2]
    }
    return env
  } catch {
    return {}
  }
}

async function deleteByEmail(svc, email) {
  const { data, error } = await svc.auth.admin.listUsers({ page: 1, perPage: 200 })
  if (error) return
  const u = data.users.find((x) => x.email === email)
  if (u) await svc.auth.admin.deleteUser(u.id)
}

async function createUser(svc, user) {
  await deleteByEmail(svc, user.email)
  const { data, error } = await svc.auth.admin.createUser({
    email: user.email,
    password: user.password,
    email_confirm: true,
  })
  if (error || !data.user) throw new Error(`create ${user.email}: ${error?.message ?? 'no user'}`)
  return data.user.id
}

async function upsertProfile(dbUrl, id, role, barberId) {
  const c = new Client({ connectionString: dbUrl })
  await c.connect()
  try {
    await c.query(
      `insert into public.profiles (id, role, barber_id) values ($1,$2,$3)
       on conflict (id) do update set role = excluded.role, barber_id = excluded.barber_id`,
      [id, role, barberId],
    )
  } finally {
    await c.end()
  }
}

const stack = loadStackEnv()
if (!stack.API_URL || !stack.SERVICE_ROLE_KEY || !stack.DB_URL) {
  console.error('Local Supabase stack not detected (run `npx supabase start`). Nothing seeded.')
  process.exit(1)
}

const svc = createClient(stack.API_URL, stack.SERVICE_ROLE_KEY, { auth: { persistSession: false } })

for (const user of [OWNER, BARBER]) {
  const id = await createUser(svc, user)
  await upsertProfile(stack.DB_URL, id, user.role, user.barberId)
  console.log(`seeded ${user.role.padEnd(6)} ${user.email}  (password: ${user.password})`)
}
console.log('\nDone. Open the app, go to /login, and sign in with either account.')

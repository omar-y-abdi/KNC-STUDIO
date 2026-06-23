// Vitest globalSetup for the admin integration suite. Runs ONCE before the suite (and a teardown
// after), in Vitest's MAIN process — where `test.env` is NOT applied. It therefore loads the stack
// env ITSELF (via the shared loader) rather than reading process.env, then seeds the two test auth
// identities (owner + barber) and their `profiles` rows. Idempotent (delete-then-create), so
// repeated local runs are safe.
//
// When the stack is absent (no local Supabase), it is a no-op — the suites self-skip via
// `describe.skipIf(!adminBackendReady())`, so `npm test`/CI-without-Docker stay green.

import { adminSeedEnvFrom, loadStackEnv } from './loadStackEnv'
import { cleanupTestIdentities, seedTestIdentities } from './_adminHelpers'

export async function setup(): Promise<void> {
  const env = adminSeedEnvFrom(loadStackEnv())
  if (env === null) return
  await seedTestIdentities(env)
}

export async function teardown(): Promise<void> {
  const env = adminSeedEnvFrom(loadStackEnv())
  if (env === null) return
  await cleanupTestIdentities(env)
}

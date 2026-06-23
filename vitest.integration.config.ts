import { defineConfig } from 'vitest/config'
import { loadStackEnv } from './tests/integration/loadStackEnv'

// Integration tests run the REAL adapters against the RUNNING local Supabase stack. This config
// loads the stack's env (URL + keys) at load time by shelling out to `supabase status -o env`, then
// injects it so:
//   - the adapters' `getSupabase()`/`getAdminClient()` see `import.meta.env.VITE_SUPABASE_URL/
//     ANON_KEY` (vitest's `test.env` populates BOTH import.meta.env and process.env in the worker), and
//   - the test files read `SUPABASE_*` / `DB_URL` / `SERVICE_ROLE_KEY` from `process.env` for the
//     anon/authenticated driver clients and the superuser connection.
// The admin globalSetup runs in Vitest's MAIN process (where `test.env` is NOT applied), so it loads
// the same stack env itself via the shared loader — see globalSetup.admin.ts.
// If the stack is DOWN (or the CLI is unavailable), the shell-out fails, env stays empty, and every
// suite self-skips — so plain `npm test` (and CI without Docker) stays green.

const stack = loadStackEnv()

/** Only forward the keys when the stack actually reported them (keeps the skip-guard honest). */
const testEnv: Record<string, string> = {}
if (stack.API_URL !== undefined && stack.ANON_KEY !== undefined) {
  // The adapters read these (VITE_-prefixed) from import.meta.env.
  testEnv.VITE_SUPABASE_URL = stack.API_URL
  testEnv.VITE_SUPABASE_ANON_KEY = stack.ANON_KEY
  // The test files read these (un-prefixed) from process.env.
  testEnv.SUPABASE_URL = stack.API_URL
  testEnv.SUPABASE_ANON_KEY = stack.ANON_KEY
  if (stack.SERVICE_ROLE_KEY !== undefined) testEnv.SUPABASE_SERVICE_ROLE_KEY = stack.SERVICE_ROLE_KEY
  if (stack.DB_URL !== undefined) testEnv.SUPABASE_DB_URL = stack.DB_URL
}

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/integration/**/*.test.ts'],
    env: testEnv,
    // Seed the admin test identities (owner + barber auth users + their profiles) once before the
    // suite, and remove them after. A no-op when the stack env is absent (the suites self-skip).
    globalSetup: ['tests/integration/globalSetup.admin.ts'],
    // Real network + a live DB; give each test room and run files serially to keep table-truncation
    // isolation simple and deterministic (no cross-file races on the shared `bookings`/`reviews`).
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
})

import { execFileSync } from 'node:child_process'
import { defineConfig } from 'vitest/config'

// Integration tests run the REAL adapters against the RUNNING local Supabase stack. This config
// loads the stack's env (URL + keys) at load time by shelling out to `supabase status -o env`, then
// injects it so:
//   - the adapters' `getSupabase()` sees `import.meta.env.VITE_SUPABASE_URL/ANON_KEY` (vitest's
//     `test.env` populates BOTH import.meta.env and process.env), and
//   - the test files read `SUPABASE_*` / `DB_URL` from `process.env` for the anon driver client and
//     the superuser truncate connection.
// If the stack is DOWN (or the CLI is unavailable), the shell-out fails, env stays empty, and the
// suite self-skips — so plain `npm test` (and CI without Docker) stays green.

/** Parse `KEY="value"` lines from `supabase status -o env`; ignore any non-matching preamble. */
function parseStatusEnv(raw: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const line of raw.split('\n')) {
    const match = /^([A-Z0-9_]+)="(.*)"$/.exec(line.trim())
    if (match) {
      const key = match[1]
      const value = match[2]
      if (key !== undefined && value !== undefined) env[key] = value
    }
  }
  return env
}

/** Read the local stack env, or `{}` if the stack/CLI is unavailable (suite then self-skips). */
function loadStackEnv(): Record<string, string> {
  try {
    // execFile (no shell): the command + args are a fixed literal list, no interpolation.
    const raw = execFileSync('npx', ['supabase', 'status', '-o', 'env'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 60_000,
    })
    return parseStatusEnv(raw)
  } catch {
    return {}
  }
}

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
    // Real network + a live DB; give each test room and run files serially to keep table-truncation
    // isolation simple and deterministic (no cross-file races on the shared `bookings`/`reviews`).
    testTimeout: 30_000,
    hookTimeout: 30_000,
    fileParallelism: false,
  },
})

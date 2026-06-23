// Shared loader for the local Supabase stack env. Used BOTH by `vitest.integration.config.ts` (to
// inject VITE_/SUPABASE_ vars into the test worker) AND by the globalSetup (which runs in Vitest's
// MAIN process, where `test.env` is NOT applied — so the setup must read the stack env itself to
// seed the auth users). Shelling out to `supabase status -o env` is the single source of truth.

import { execFileSync } from 'node:child_process'

/** Parse `KEY="value"` lines from `supabase status -o env`; ignore any non-matching preamble. */
export function parseStatusEnv(raw: string): Record<string, string> {
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

/** Read the local stack env, or `{}` if the stack/CLI is unavailable (callers then self-skip). */
export function loadStackEnv(): Record<string, string> {
  try {
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

/** The subset the admin globalSetup needs (anon + service_role + db superuser). Null if incomplete. */
export interface AdminSeedEnv {
  readonly url: string
  readonly anonKey: string
  readonly serviceRoleKey: string
  readonly dbUrl: string
}

/** Resolve the admin-seed env from a parsed stack map, or `null` when any piece is missing. */
export function adminSeedEnvFrom(stack: Record<string, string>): AdminSeedEnv | null {
  const url = stack.API_URL
  const anonKey = stack.ANON_KEY
  const serviceRoleKey = stack.SERVICE_ROLE_KEY
  const dbUrl = stack.DB_URL
  if (
    url === undefined ||
    anonKey === undefined ||
    serviceRoleKey === undefined ||
    dbUrl === undefined
  ) {
    return null
  }
  return { url, anonKey, serviceRoleKey, dbUrl }
}

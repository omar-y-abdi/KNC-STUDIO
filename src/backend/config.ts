// Backend config — the ENV check ONLY. This module is deliberately free of any `@supabase/supabase-js`
// import so it stays featherweight: the adapter selectors import `isBackendConfigured()` from here to
// decide real-vs-mock, while the actual client (which pulls in supabase-js) lives in `supabaseClient.ts`
// and is reached only through a DYNAMIC import. That split keeps supabase-js OUT of the main bundle —
// with no `VITE_SUPABASE_*` env it is never even fetched.

/** Non-empty trimmed env value, or `undefined`. The single place the "configured?" test is decided. */
function readEnv(value: string | undefined): string | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  return trimmed === '' ? undefined : trimmed
}

export const SUPABASE_URL = readEnv(import.meta.env.VITE_SUPABASE_URL)
export const SUPABASE_ANON_KEY = readEnv(import.meta.env.VITE_SUPABASE_ANON_KEY)

/**
 * Whether the real Supabase backend is configured: BOTH the URL and the anon key are present and
 * non-empty. The `default*Port` selectors use this (at module load) to choose real vs. mock, so with
 * no env the mocks stay the default and current behavior — and the lean bundle — are byte-identical.
 */
export function isBackendConfigured(): boolean {
  return SUPABASE_URL !== undefined && SUPABASE_ANON_KEY !== undefined
}

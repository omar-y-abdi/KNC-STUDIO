/// <reference types="vite/client" />

// Declare the project's build-time env vars as NAMED properties on ImportMetaEnv. Named props
// take precedence over Vite's fallback string index signature, so `import.meta.env.VITE_SITE_URL`
// type-checks under `noPropertyAccessFromIndexSignature` (otherwise dotted access to an index
// signature is a TS4111 error). Additive only — augments Vite's interface, touches no source.

interface ImportMetaEnv {
  readonly VITE_SITE_URL?: string
  readonly VITE_CLOCK?: string
  // Supabase backend (PUBLIC anon key — RLS is the boundary). Both BLANK -> offline mock adapters
  // (default). Set BOTH to switch the live site to the real backend. Optional so the mock path
  // type-checks (and runs) with zero Supabase env.
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string
  // Cloudflare Turnstile PUBLIC site key (safe to inline). Unset -> the widget renders nothing and
  // emits an empty token, symmetric with the `submit-booking` edge fn's fail-open skip when its
  // TURNSTILE_SECRET is unset. Set to activate the bot challenge on the booking gateway.
  readonly VITE_TURNSTILE_SITE_KEY?: string
}

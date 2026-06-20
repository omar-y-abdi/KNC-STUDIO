/// <reference types="vite/client" />

// Declare the project's build-time env vars as NAMED properties on ImportMetaEnv. Named props
// take precedence over Vite's fallback string index signature, so `import.meta.env.VITE_SITE_URL`
// type-checks under `noPropertyAccessFromIndexSignature` (otherwise dotted access to an index
// signature is a TS4111 error). Additive only — augments Vite's interface, touches no source.

interface ImportMetaEnv {
  readonly VITE_SITE_URL?: string
  readonly VITE_CLOCK?: string
}

import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import security from 'eslint-plugin-security'
import nounsan from 'eslint-plugin-no-unsanitized'

// Regrowth guard for the public boot path: libraries that were taken off it stay off it. Value
// imports are rejected, type-only imports are free and dynamic `import()` is how a lazy chunk is
// meant to load them. The admin is lazy and out of scope; a file that owns one of the libraries gets
// its own object below, because a later object for the same rule replaces the options entirely.
const BOOT_RESTRICTED = {
  zod: 'The public form checks are plain functions; zod belongs to rpcSchemas.ts and the admin.',
  'embla-carousel':
    'Embla loads by dynamic import in useBarberMarquee, only when the strip animates.',
  'embla-carousel-auto-scroll':
    'Embla loads by dynamic import in useBarberMarquee, only when the strip animates.',
  '@supabase/supabase-js':
    'Public pages use publicRest.ts and publicRealtime.ts; supabase-js is the admin client.',
}
const restrictBootImports = (owned = []) => ({
  rules: {
    '@typescript-eslint/no-restricted-imports': [
      'error',
      {
        paths: Object.entries(BOOT_RESTRICTED)
          .filter(([name]) => !owned.includes(name))
          .map(([name, message]) => ({ name, message, allowTypeImports: true })),
        patterns: [
          {
            group: ['**/backend/supabaseClient'],
            message: 'supabaseClient.ts is the admin client; public code uses publicRest.ts.',
          },
        ],
      },
    ],
  },
})

// Type checking is done by `tsc` (strict). ESLint covers footguns, security smells,
// and DOM-sink XSS (no-unsanitized). Type-aware rules are intentionally omitted to keep
// linting fast + stable on the bleeding-edge TS toolchain.
export default tseslint.config(
  // `supabase/` is a separate Deno project (edge functions) + SQL/pgTAP; it has its own runtime +
  // globals (Deno, server-side `console`) and is not in the app tsconfig, so it is excluded here.
  {
    ignores: [
      'dist/**',
      'dist-startup/**',
      'test-results/**',
      'playwright-report/**',
      'node_modules/**',
      '.vite-cache/**',
      '.wrangler/tmp/**',
      'tools/visual/**/*.png',
      'supabase/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  ...tseslint.configs.stylistic,
  {
    plugins: { security, 'no-unsanitized': nounsan },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': 'error',
      eqeqeq: ['error', 'always'],
      'no-unsanitized/method': 'error',
      'no-unsanitized/property': 'error',
      'security/detect-eval-with-expression': 'error',
      'security/detect-unsafe-regex': 'error',
      'security/detect-non-literal-regexp': 'warn',
    },
  },
  { files: ['src/**/*.{ts,tsx}'], ignores: ['src/admin/**'], ...restrictBootImports() },
  { files: ['src/backend/rpcSchemas.ts'], ...restrictBootImports(['zod']) },
  { files: ['src/backend/supabaseClient.ts'], ...restrictBootImports(['@supabase/supabase-js']) },
  // Tooling + tests run on Node and may use console + Node globals.
  {
    files: ['tools/**', 'tests/**', '**/*.config.{js,ts}'],
    languageOptions: {
      globals: {
        process: 'readonly',
        console: 'readonly',
        URL: 'readonly',
        Buffer: 'readonly',
        fetch: 'readonly',
      },
    },
    rules: { 'no-console': 'off' },
  },
)

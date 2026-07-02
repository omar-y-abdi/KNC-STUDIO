import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import security from 'eslint-plugin-security'
import nounsan from 'eslint-plugin-no-unsanitized'

// Type checking is done by `tsc` (strict). ESLint covers footguns, security smells,
// and DOM-sink XSS (no-unsanitized). Type-aware rules are intentionally omitted to keep
// linting fast + stable on the bleeding-edge TS toolchain.
export default tseslint.config(
  // `supabase/` is a separate Deno project (edge functions) + SQL/pgTAP; it has its own runtime +
  // globals (Deno, server-side `console`) and is not in the app tsconfig, so it is excluded here.
  { ignores: ['dist/**', 'node_modules/**', 'tools/visual/**/*.png', 'supabase/**'] },
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

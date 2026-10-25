import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Unit tests run against the pure domain modules (no DOM). The browser flows are covered
// separately by the visual-regression gate (tools/visual/).
export default defineConfig({
  resolve: {
    alias: {
      // Deno entrypoints use these specifiers; unit tests execute them with local packages.
      'https://esm.sh/@supabase/supabase-js@2.112.2': '@supabase/supabase-js',
      'npm:@imagemagick/magick-wasm@0.0.42': '@imagemagick/magick-wasm',
      'cloudflare:workers': fileURLToPath(
        new URL('./tests/unit/helpers/cloudflareWorkers.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
    },
  },
})

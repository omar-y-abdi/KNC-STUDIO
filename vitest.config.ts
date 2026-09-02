import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

// Unit tests run against the pure domain modules (no DOM). The browser flows are covered
// separately by the visual-regression gate (tools/visual/).
export default defineConfig({
  resolve: {
    alias: {
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

import { defineConfig } from 'vitest/config'

// Unit tests run against the pure domain modules (no DOM). The browser flows are covered
// separately by the Playwright e2e + the visual-regression gate.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: [
        'src/booking/validation.ts',
        'src/booking/ics.ts',
        'src/booking/pricing.ts',
        'src/booking/slots.ts',
        'src/booking/calendar.ts',
      ],
    },
  },
})

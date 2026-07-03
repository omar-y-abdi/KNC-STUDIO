import { defineConfig } from 'vitest/config'

// Unit tests run against the pure domain modules (no DOM). The browser flows are covered
// separately by the visual-regression gate (tools/visual/).
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
        'src/admin/time.ts',
        'src/admin/passwordPolicy.ts',
        'src/admin/recoveryLink.ts',
        'src/about/content/merge.ts',
        'src/cancellation/demoBooking.ts',
        'src/about/reviewValidation.ts',
      ],
    },
  },
})

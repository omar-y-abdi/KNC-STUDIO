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
        'src/mybookings/format.ts',
        'src/mybookings/escalation.ts',
        'src/mybookings/deviceMemory.ts',
        'src/mybookings/demoMyBookings.ts',
        'src/admin/serviceValidation.ts',
        'src/site/siteChrome.ts',
        'src/admin/calendar/status.ts',
      ],
    },
  },
})

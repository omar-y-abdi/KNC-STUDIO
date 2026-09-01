import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('handoff documentation contracts', () => {
  it('marks historical findings and avoids superseded deployment or test references', () => {
    const env = readFileSync(new URL('../../.env', import.meta.url), 'utf8')
    const findings = readFileSync(new URL('../../REVIEW_FINDINGS.md', import.meta.url), 'utf8')
    const map = readFileSync(new URL('../../CODEBASE-MAP.md', import.meta.url), 'utf8')
    const emailSetup = readFileSync(
      new URL('../../supabase/functions/send-confirmation/README.md', import.meta.url),
      'utf8',
    )

    expect(env).not.toContain('Vercel')
    expect(findings).toMatch(/^> Status: ARCHIVED — historical reference only/m)
    expect(map).not.toContain('myBookingsEscalation')
    expect(map).not.toContain('Older prose describes broader past+future backfill')
    expect(emailSetup).toContain('retry or discard')
  })

  it('records current ownership and contracts for the audited subsystems', () => {
    const calendarSetup = readFileSync(
      new URL('../../supabase/functions/calendar-sync/README.md', import.meta.url),
      'utf8',
    )
    const calendarCallback = readFileSync(
      new URL('../../supabase/functions/calendar-oauth-callback/index.ts', import.meta.url),
      'utf8',
    )
    const calendarMigration = readFileSync(
      new URL(
        '../../supabase/migrations/20260813115438_durable_storage_cleanup.sql',
        import.meta.url,
      ),
      'utf8',
    )
    const emailSetup = readFileSync(
      new URL('../../supabase/functions/send-confirmation/README.md', import.meta.url),
      'utf8',
    )
    const emailMigration = readFileSync(
      new URL(
        '../../supabase/migrations/20260823130000_classify_booking_email_delivery_failures.sql',
        import.meta.url,
      ),
      'utf8',
    )
    const backend = readFileSync(new URL('../../BACKEND.md', import.meta.url), 'utf8')
    const schedules = readFileSync(
      new URL('../../src/admin/adapters/schedulesAdmin.ts', import.meta.url),
      'utf8',
    )
    const scheduleMigration = readFileSync(
      new URL(
        '../../supabase/migrations/20260813115437_transactional_availability_mutations.sql',
        import.meta.url,
      ),
      'utf8',
    )
    const findings = readFileSync(new URL('../../REVIEW_FINDINGS.md', import.meta.url), 'utf8')
    const map = readFileSync(new URL('../../CODEBASE-MAP.md', import.meta.url), 'utf8')

    expect(calendarSetup).toContain(
      'queues a `calendar_event_sync` row in `public.external_action_jobs`',
    )
    expect(calendarSetup).toContain(
      'OAuth callback backfill covers confirmed future bookings (those with end time after now)',
    )
    expect(calendarSetup).toContain('owner coordinates external webhook and')
    expect(calendarSetup).toContain('shared-secret maintenance')
    expect(calendarCallback).toContain('backfill future confirmed bookings')
    expect(calendarMigration).toContain('and b.end_at > pg_catalog.now()')

    expect(emailSetup).toContain('booking_email_delivery_jobs')
    expect(emailSetup).toContain('move the job to `failed`')
    expect(emailSetup).toContain('explicit owner review')
    expect(emailSetup).toContain('Completed/skipped/superseded rows are retained for 90')
    expect(emailSetup).toContain('days, then removed by `booking-email-delivery-cleanup`')
    expect(emailMigration).toContain("'send_failed_permanent'")

    expect(backend).toContain('booking_email_delivery_jobs')
    expect(backend).toContain('customer-access email')
    expect(backend).toContain('Auth email sends directly through Resend')
    expect(backend).toContain('`upload-image`')
    expect(backend).toContain('is synchronous while')

    expect(schedules).toContain('Direct authenticated writes to `barber_schedules` are')
    expect(schedules).toContain('revoked by the transactional availability migration')
    expect(schedules).toContain("rpc('admin_save_barber_week'")
    expect(schedules).toContain("rpc('available_slots'")
    expect(scheduleMigration).toContain(
      'revoke insert, update, delete on table public.barber_schedules',
    )
    expect(scheduleMigration).toContain(
      'grant execute on function public.admin_save_barber_week(text, jsonb, boolean)',
    )

    expect(findings).toMatch(/^> Status: ARCHIVED — historical reference only/m)
    expect(findings).toContain(
      'not the current security, architecture, or production-status source',
    )
    expect(map).toContain('`supabase/functions/calendar-sync/README.md`')
    expect(map).toContain('`supabase/functions/send-confirmation/README.md`')
    expect(map).toContain('`BACKEND.md`')
    expect(map).toContain('`src/admin/adapters/schedulesAdmin.ts`')
    expect(map).toContain('`REVIEW_FINDINGS.md`')
  })
})

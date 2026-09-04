import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const calendarSync = readFileSync('supabase/functions/calendar-sync/index.ts', 'utf8')
const calendarCallback = readFileSync('supabase/functions/calendar-oauth-callback/index.ts', 'utf8')
const calendarBackfill = readFileSync('supabase/functions/_shared/calendarBackfill.ts', 'utf8')
const externalCleanup = readFileSync('supabase/functions/external-cleanup/index.ts', 'utf8')
const deletionOutboxMigration = readFileSync(
  'supabase/migrations/20260813115438_durable_storage_cleanup.sql',
  'utf8',
)
const syncOutboxMigration = readFileSync(
  'supabase/migrations/20260823174500_close_launch_review_findings.sql',
  'utf8',
)
const reassignmentMigration = readFileSync(
  'supabase/migrations/20260902005645_calendar_reassignment_cleanup.sql',
  'utf8',
)

describe('Calendar external-action ownership', () => {
  it('keeps deletion durable and makes the legacy webhook a sync-queue compatibility path', () => {
    expect(deletionOutboxMigration).toContain('booking_calendar_cleanup_on_status')
    expect(deletionOutboxMigration).toContain('booking_calendar_cleanup_on_delete')
    expect(deletionOutboxMigration).toContain("'calendar_event_delete'")

    expect(syncOutboxMigration).toContain("'calendar_event_sync'")
    expect(syncOutboxMigration).toContain('booking_calendar_sync_on_change')
    expect(calendarSync).toContain("service.rpc('queue_calendar_event_sync'")
    expect(calendarSync).not.toContain("service.rpc('calendar_deletion_context'")
    expect(calendarSync).not.toContain('await deleteEvent(')
  })

  it('routes OAuth backfill through the durable reassignment state machine', () => {
    expect(calendarCallback).toContain("from '../_shared/calendarBackfill.ts'")
    expect(calendarCallback).toContain('await queueBackfill(service, payload.barber_id)')
    expect(calendarCallback).not.toContain('insertEvent(')
    expect(calendarCallback).not.toContain('refreshAccessToken(')
    expect(calendarCallback).not.toContain("service.rpc('calendar_record_event'")
    expect(calendarBackfill).toContain("service.rpc('calendar_backfill_source'")
    expect(calendarBackfill).toContain("service.rpc('queue_calendar_event_sync'")
    expect(calendarBackfill).toContain('mapped_barber_id')
    expect(calendarBackfill).toContain('mapped_calendar_id')
    expect(calendarBackfill).toContain('mapped_google_event_id')
    expect(reassignmentMigration).toContain(
      'perform public.queue_calendar_event_sync(p_booking_id)',
    )
  })

  it('uses the Calendar dispatcher first and falls back to the generic seam only when absent', () => {
    expect(
      externalCleanup.indexOf("service.rpc('calendar_external_action_for_dispatch'"),
    ).toBeGreaterThan(-1)
    expect(externalCleanup.indexOf("service.rpc('external_action_for_dispatch'")).toBeGreaterThan(
      -1,
    )
    expect(externalCleanup).toContain('isMissingCalendarDispatcherError')
    expect(externalCleanup).toContain('calendarContext.data !== null')
  })
})

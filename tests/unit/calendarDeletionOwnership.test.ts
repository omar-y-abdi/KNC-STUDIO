import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const calendarSync = readFileSync('supabase/functions/calendar-sync/index.ts', 'utf8')
const deletionOutboxMigration = readFileSync(
  'supabase/migrations/20260813115438_durable_storage_cleanup.sql',
  'utf8',
)
const syncOutboxMigration = readFileSync(
  'supabase/migrations/20260823174500_close_launch_review_findings.sql',
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
})

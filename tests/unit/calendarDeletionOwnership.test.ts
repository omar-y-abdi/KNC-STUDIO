import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const calendarSync = readFileSync('supabase/functions/calendar-sync/index.ts', 'utf8')
const outboxMigration = readFileSync(
  'supabase/migrations/20260813115438_durable_storage_cleanup.sql',
  'utf8',
)

describe('Calendar deletion ownership', () => {
  it('routes booking cancellation and deletion through one durable outbox executor', () => {
    expect(outboxMigration).toContain('booking_calendar_cleanup_on_status')
    expect(outboxMigration).toContain('booking_calendar_cleanup_on_delete')
    expect(outboxMigration).toContain("'calendar_event_delete'")
    expect(calendarSync).not.toContain("service.rpc('calendar_deletion_context'")
    expect(calendarSync).not.toContain('await deleteEvent(')
    expect(calendarSync).toContain("outcome: 'deletion_queued'")
  })
})

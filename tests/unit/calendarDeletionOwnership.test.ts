import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const deletionOutboxMigration = readFileSync(
  'supabase/migrations/20260813115438_durable_storage_cleanup.sql',
  'utf8',
)
const syncOutboxMigration = readFileSync(
  'supabase/migrations/20260823174500_close_launch_review_findings.sql',
  'utf8',
)
const retirementMigrationName = readdirSync('supabase/migrations').find((name) =>
  name.endsWith('_retire_legacy_calendar_sync.sql'),
)
const retirementMigration =
  retirementMigrationName === undefined
    ? ''
    : readFileSync(`supabase/migrations/${retirementMigrationName}`, 'utf8')

describe('Calendar external-action ownership', () => {
  it('keeps Calendar durable and retires the legacy webhook path', () => {
    expect(deletionOutboxMigration).toContain('booking_calendar_cleanup_on_status')
    expect(deletionOutboxMigration).toContain('booking_calendar_cleanup_on_delete')
    expect(deletionOutboxMigration).toContain("'calendar_event_delete'")

    expect(syncOutboxMigration).toContain("'calendar_event_sync'")
    expect(syncOutboxMigration).toContain('booking_calendar_sync_on_change')
    expect(existsSync('supabase/functions/calendar-sync/index.ts')).toBe(false)
    expect(existsSync('supabase/functions/calendar-sync/README.md')).toBe(false)
    expect(retirementMigrationName).toBeDefined()
    expect(retirementMigration).toContain(
      'drop trigger if exists calendar_sync_on_bookings on public.bookings',
    )
    expect(retirementMigration).toContain("errcode = '55000'")
    expect(retirementMigration).toContain(
      "t.tgfoid = 'public.queue_booking_calendar_sync()'::regprocedure",
    )
    expect(retirementMigration).toContain('calendar_sync_on_bookings')
    expect(retirementMigration).toContain('booking_calendar_sync_on_change')
    expect(retirementMigration).toContain('queue_calendar_event_sync(uuid)')
  })
})

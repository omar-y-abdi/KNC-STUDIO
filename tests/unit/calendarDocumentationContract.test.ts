import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Calendar synchronization documentation', () => {
  it('documents the durable trigger as authoritative after legacy webhook retirement', () => {
    const map = readFileSync(new URL('../../CODEBASE-MAP.md', import.meta.url), 'utf8')
    const rollout = readFileSync(
      new URL('../../docs/operations/PUBLIC_BOOKING_GATEWAY_ROLLOUT.md', import.meta.url),
      'utf8',
    )
    const config = readFileSync(new URL('../../supabase/config.toml', import.meta.url), 'utf8')

    expect(map).toContain('booking_calendar_sync_on_change')
    expect(map).not.toContain('supabase/functions/calendar-sync')
    expect(config).not.toContain('[functions.calendar-sync]')
    expect(rollout).toContain('calendar_event_sync')
    expect(rollout).toContain('supabase functions delete calendar-sync --project-ref')
    expect(rollout).toContain(
      'npx supabase functions list --project-ref "$PROJECT_REF" --output-format json',
    )
    expect(rollout).toContain('jq -e \'all(.functions[]; .slug != "calendar-sync")\'')
    expect(rollout).toContain('calendar_sync_on_bookings')
    expect(rollout).toContain('Edge/Vault parity')
  })
})

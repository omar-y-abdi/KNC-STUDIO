import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Calendar synchronization documentation', () => {
  it('documents the durable trigger as authoritative and the webhook as compatibility-only', () => {
    const map = readFileSync(new URL('../../CODEBASE-MAP.md', import.meta.url), 'utf8')
    const rollout = readFileSync(
      new URL('../../docs/operations/PUBLIC_BOOKING_GATEWAY_ROLLOUT.md', import.meta.url),
      'utf8',
    )

    expect(map).toContain('booking_calendar_sync_on_change')
    expect(map).toContain('compatibility-only')
    expect(map).not.toContain(
      'Normal insert/update sync requires a Dashboard-managed Database Webhook',
    )
    expect(rollout).toContain('calendar_event_sync')
    expect(rollout).toContain('compatibility')
  })
})

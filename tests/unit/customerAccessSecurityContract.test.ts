import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { consumeBookingAccessLink } from '../../src/mybookings/accessLink'

describe('customer booking access links', () => {
  it('consumes new fragment links without exposing access codes to HTTP requests', () => {
    expect(
      consumeBookingAccessLink(
        'https://bladeblendstudio.se/?campaign=mail#booking_access=abc123&source=customer',
      ),
    ).toEqual({
      code: 'abc123',
      cleanPath: '/?campaign=mail#source=customer',
    })
  })

  it('keeps already-sent query links compatible while stripping their code', () => {
    expect(
      consumeBookingAccessLink(
        'https://bladeblendstudio.se/?booking_access=legacy123&campaign=mail#section=bookings',
      ),
    ).toEqual({
      code: 'legacy123',
      cleanPath: '/?campaign=mail#section=bookings',
    })
  })

  it('sends new links in fragments and moves email work off response timing', () => {
    const source = readFileSync('supabase/functions/public-booking-actions/index.ts', 'utf8')
    expect(source).toContain('`${SITE_URL}/#booking_access=${code}`')
    expect(source).not.toContain('`${SITE_URL}/?booking_access=${code}`')
    expect(source).toContain('edgeRuntime.waitUntil(')
    expect(source).not.toContain('await sendAccessEmail(')
  })
})

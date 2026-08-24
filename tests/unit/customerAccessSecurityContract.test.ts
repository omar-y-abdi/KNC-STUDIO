import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { consumeBookingAccessLink } from '../../src/mybookings/accessLink'

describe('customer booking access links', () => {
  it('consumes permanent random root-path links as direct access tokens', () => {
    const token = 'a'.repeat(64)
    expect(consumeBookingAccessLink(`https://bladeblendstudio.se/${token}`)).toEqual({
      code: token,
      cleanPath: '/',
      direct: true,
    })
  })

  it('consumes new fragment links without exposing access codes to HTTP requests', () => {
    expect(
      consumeBookingAccessLink(
        'https://bladeblendstudio.se/?campaign=mail#booking_access=abc123&source=customer',
      ),
    ).toEqual({
      code: 'abc123',
      cleanPath: '/?campaign=mail#source=customer',
      direct: false,
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
      direct: false,
    })
  })

  it('sends fragment links through the durable external-action worker', () => {
    const gateway = readFileSync('supabase/functions/public-booking-actions/index.ts', 'utf8')
    const worker = readFileSync('supabase/functions/_shared/externalActions.ts', 'utf8')
    const migration = readFileSync(
      'supabase/migrations/20260823174500_close_launch_review_findings.sql',
      'utf8',
    )

    expect(worker).toContain(
      'ctaHref: `https://bladeblendstudio.se/#booking_access=${action.access_code}`',
    )
    expect(worker).not.toContain('?booking_access=${action.access_code}')
    expect(gateway).toContain("service.rpc('create_customer_booking_access_request'")
    expect(gateway).toContain('p_access_code: code')
    expect(gateway).not.toContain('edgeRuntime.waitUntil(')
    expect(gateway).not.toContain('sendAccessEmail(')
    expect(migration).toContain("'customer_access_email_send'")
  })

  it('uses permanent root links in access and booking-confirmation email paths', () => {
    const accessWorker = readFileSync('supabase/functions/_shared/externalActions.ts', 'utf8')
    const confirmationWorker = readFileSync('supabase/functions/send-confirmation/index.ts', 'utf8')

    expect(accessWorker).toContain('customerAccessUrl(action.access_code)')
    expect(confirmationWorker).toContain("'customer_confirmation'")
    expect(confirmationWorker).toContain('customerAccessUrl')
    expect(confirmationWorker).not.toContain(
      "ctaHref: adminLink ? 'https://bladeblendstudio.se/admin' : 'https://bladeblendstudio.se'",
    )
  })
})

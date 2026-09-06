import { readdirSync, readFileSync } from 'node:fs'
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

  it('sends permanent root links through the durable external-action worker', () => {
    const gateway = readFileSync('supabase/functions/public-booking-actions/index.ts', 'utf8')
    const worker = readFileSync('supabase/functions/_shared/externalActions.ts', 'utf8')
    const outboxMigrationName = readdirSync('supabase/migrations').find((name) =>
      name.endsWith('_customer_access_outbox_ciphertext.sql'),
    )
    expect(outboxMigrationName).toBeDefined()
    const migration = readFileSync(`supabase/migrations/${outboxMigrationName}`, 'utf8')

    expect(worker).toContain('decryptCustomerAccessToken')
    expect(worker).toContain('customerAccessUrl(accessCode)')
    expect(worker).not.toContain('customerAccessUrl(action.access_code)')
    expect(worker).not.toContain('#booking_access=${action.access_code}')
    expect(gateway).toContain("service.rpc('rotate_customer_booking_access_token'")
    expect(gateway).toContain('p_access_code: code')
    expect(gateway).not.toContain('edgeRuntime.waitUntil(')
    expect(gateway).not.toContain('sendAccessEmail(')
    expect(migration).toContain("'customer_access_email_send'")
    expect(migration).toContain('customer_booking_access_tokens')
    expect(migration).toContain('payload = pg_catalog.jsonb_build_object(')
    expect(migration).toContain("'challenge_id', payload->'challenge_id'")
    expect(migration).toContain("'lang', payload->'lang'")
  })

  it('uses an opaque HttpOnly session cookie rather than browser storage for return visits', () => {
    const gateway = readFileSync('supabase/functions/public-booking-actions/index.ts', 'utf8')
    const adapter = readFileSync('src/mybookings/adapters/supabaseMyBookings.ts', 'utf8')
    const client = readFileSync('src/backend/supabaseClient.ts', 'utf8')
    const actionClient = readFileSync('src/backend/publicBookingActions.ts', 'utf8')
    expect(gateway).toContain('__Host-bladeblend_customer_session')
    expect(gateway).toContain('HttpOnly; Secure; SameSite=None')
    expect(gateway).toContain('sessionCookie(req)')
    expect(gateway).not.toContain('customer_email')
    expect(adapter).not.toContain('sessionStorage')
    expect(client).not.toContain("credentials: 'include'")
    expect(actionClient).toContain("credentials: 'include'")
    expect(gateway).toContain('establish_customer_booking_session')
    expect(gateway).not.toContain('Set-Cookie: ${CUSTOMER_SESSION_COOKIE}=${accessToken}')
  })

  it('uses permanent root links in access and booking-confirmation email paths', () => {
    const accessWorker = readFileSync('supabase/functions/_shared/externalActions.ts', 'utf8')
    const confirmationWorker = readFileSync('supabase/functions/send-confirmation/index.ts', 'utf8')

    expect(accessWorker).toContain('customerAccessUrl(accessCode)')
    expect(confirmationWorker).toContain("'customer_confirmation'")
    expect(confirmationWorker).toContain('customerAccessUrl')
    expect(confirmationWorker).not.toContain(
      "ctaHref: adminLink ? 'https://bladeblendstudio.se/admin' : 'https://bladeblendstudio.se'",
    )
  })
})

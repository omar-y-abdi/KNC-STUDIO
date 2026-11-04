import { describe, expect, it } from 'vitest'
import {
  adminDeleteBookingsResponse,
  emailSendLogCopy,
  emailSendLogEntryRow,
  failedBookingEmailDeliveryRow,
  serviceRow,
} from '../../src/admin/adminSchemas'
import {
  bookingReceiptResponse,
  listCustomerBookingsResponse,
  publicBusinessDiscoveryResponse,
  publicServiceRow,
} from '../../src/backend/rpcSchemas'
import { parse, uuid } from '../../supabase/functions/_shared/http.ts'
import { requestSchema as cmsStudio } from '../../supabase/functions/cms-studio/request.ts'

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e'
const delivery = {
  id: ID,
  booking_id: ID,
  event: 'booking_confirmed',
  attempt_count: 1,
  last_error_code: null,
  sent_kinds: ['barber'],
  customer_name: 'Ada Kund',
  customer_email: 'ada@example.com',
  customer_phone: null,
  booking_start_at: '2040-02-29T12:30:59Z',
  barber_name: 'Hassan',
  barber_email: 'hassan@example.com',
}
const loggedEmail = {
  id: ID,
  created_at: '2040-02-29T12:30:59Z',
  last_attempt_at: '2040-02-29T12:30:59Z',
  kind: 'customer_confirmation',
  recipient: 'ada@example.com',
  subject: 'Bokningsbekräftelse',
  status: 'sent',
  error_code: null,
  booking_id: ID,
  attempt_count: 1,
}
const loggedCopy = { id: ID, subject: 'Bokningsbekräftelse', html: '<p>Hej</p>', text_body: 'Hej' }
const customer = (start_at: unknown) => ({
  ok: true,
  session_proof: 'a'.repeat(64),
  phone: '0701234567',
  bookings: [
    {
      id: ID,
      barber_id: 'owner',
      service_name: 'Klippning',
      price: 350,
      duration_min: 45,
      start_at,
    },
  ],
})

describe('Zod 4 migration preserves wire contracts', () => {
  it.each([
    '0f8fad5b-d9cb-469f-a165-70867728950e',
    '0F8FAD5B-D9CB-469F-A165-70867728950E',
    '00000000-0000-0000-0000-000000000000',
    'ffffffff-ffff-ffff-ffff-ffffffffffff',
    '12345678-1234-f234-0234-123456789abc',
  ])('preserves the established UUID shape %s across request and response boundaries', (id) => {
    expect(uuid.safeParse(id).success).toBe(true)
    expect(
      bookingReceiptResponse.safeParse({ receipt_proof: 'a'.repeat(64), booking: { id } }).success,
    ).toBe(true)
    expect(
      failedBookingEmailDeliveryRow.safeParse({ ...delivery, id, failed_at: null }).success,
    ).toBe(true)
    expect(emailSendLogEntryRow.safeParse({ ...loggedEmail, id, booking_id: id }).success).toBe(
      true,
    )
    expect(emailSendLogCopy.safeParse({ ...loggedCopy, id }).success).toBe(true)
  })

  it.each(['not-a-uuid', `${ID}x`, ID.replace('-', ''), `g${ID.slice(1)}`])(
    'continues rejecting malformed UUIDs %s',
    (id) => {
      expect(uuid.safeParse(id).success).toBe(false)
      expect(
        bookingReceiptResponse.safeParse({ receipt_proof: 'a'.repeat(64), booking: { id } })
          .success,
      ).toBe(false)
      expect(emailSendLogEntryRow.safeParse({ ...loggedEmail, id }).success).toBe(false)
      expect(emailSendLogEntryRow.safeParse({ ...loggedEmail, booking_id: id }).success).toBe(false)
      expect(emailSendLogCopy.safeParse({ ...loggedCopy, id }).success).toBe(false)
    },
  )

  it.each([
    '2040-02-29T12:30Z',
    '2040-02-29T12:30+0100',
    '2040-02-29T12:30-01:00',
    '2040-02-29T12:30:59Z',
    '2040-02-29T12:30:59.123456+01:00',
    '2000-02-29T00:00:00+0000',
  ])('preserves accepted timestamp bytes %s in public and admin responses', (timestamp) => {
    const publicResult = listCustomerBookingsResponse.safeParse(customer(timestamp))
    expect(publicResult.success).toBe(true)
    if (publicResult.success && publicResult.data.ok)
      expect(publicResult.data.bookings[0]?.start_at).toBe(timestamp)
    const adminResult = failedBookingEmailDeliveryRow.safeParse({
      ...delivery,
      failed_at: timestamp,
    })
    expect(adminResult.success).toBe(true)
    if (adminResult.success) expect(adminResult.data.failed_at).toBe(timestamp)
    const logResult = emailSendLogEntryRow.safeParse({
      ...loggedEmail,
      created_at: timestamp,
      last_attempt_at: timestamp,
    })
    expect(logResult.success).toBe(true)
    if (logResult.success) {
      expect(logResult.data.created_at).toBe(timestamp)
      expect(logResult.data.last_attempt_at).toBe(timestamp)
    }
  })

  it.each([
    '1900-02-29T12:30:00Z',
    '2041-02-29T12:30:00Z',
    '2040-04-31T12:30:00Z',
    '2040-02-29T24:00:00Z',
    '2040-02-29T12:60:00Z',
    '2040-02-29T12:30:60Z',
    '2040-02-29T12:30:00',
    '2040-02-29T12:30:00+01',
    '2040-02-29T12:30:00.Z',
    null,
    7,
  ])('continues rejecting malformed public timestamps %j', (timestamp) => {
    expect(listCustomerBookingsResponse.safeParse(customer(timestamp)).success).toBe(false)
    if (timestamp !== null)
      expect(
        failedBookingEmailDeliveryRow.safeParse({ ...delivery, failed_at: timestamp }).success,
      ).toBe(false)
    expect(emailSendLogEntryRow.safeParse({ ...loggedEmail, created_at: timestamp }).success).toBe(
      false,
    )
    expect(
      emailSendLogEntryRow.safeParse({ ...loggedEmail, last_attempt_at: timestamp }).success,
    ).toBe(false)
  })

  it.each([
    'Customer+tag@Example.SE',
    "o'connor@example.se",
    'a_b@example-domain.se',
    'first.last@example.co.uk',
  ])('preserves response email values %s', (email) => {
    const result = listCustomerBookingsResponse.safeParse({
      ...customer('2040-02-29T12:30Z'),
      email,
      emails: [email],
    })
    expect(result.success).toBe(true)
    if (result.success && result.data.ok && result.data.authority === 'verified') {
      expect(result.data.email).toBe(email)
      expect(result.data.emails).toEqual([email])
    }
  })

  it.each([
    '.a@example.se',
    'a..b@example.se',
    "a'@example.se",
    'a@b',
    'a@ex_ample.se',
    'å@example.se',
    ' a@example.se',
  ])('rejects malformed response emails %s', (email) => {
    expect(
      listCustomerBookingsResponse.safeParse({ ...customer('2040-02-29T12:30Z'), email }).success,
    ).toBe(false)
  })

  it('keeps arbitrary string settings and rejects non-string values', () => {
    const discovery = { settings: {}, barbers: [], services: [], schedules: [] }
    expect(publicBusinessDiscoveryResponse.safeParse(discovery).success).toBe(true)
    const settings = { business_name: 'Salong', 'custom.setting': '' }
    const result = publicBusinessDiscoveryResponse.safeParse({ ...discovery, settings })
    expect(result.success && result.data.settings).toEqual(settings)
    for (const value of [null, false, 7, [], {}])
      expect(
        publicBusinessDiscoveryResponse.safeParse({ ...discovery, settings: { custom: value } })
          .success,
      ).toBe(false)
  })

  it.each([0, Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1])(
    'preserves nonnegative integer response fields without adding a safe-integer restriction: %s',
    (value) => {
      expect(adminDeleteBookingsResponse.safeParse({ ok: true, count: value }).success).toBe(true)
      const service = {
        id: ID,
        barber_id: 'owner',
        name: 'Klippning',
        price: 350,
        duration_min: 45,
        active: true,
        sort_order: value,
        available_weekdays: [0, 1],
      }
      expect(serviceRow.safeParse(service).success).toBe(true)
      expect(publicServiceRow.safeParse(service).success).toBe(true)
    },
  )

  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects invalid response counts %s',
    (count) => {
      expect(adminDeleteBookingsResponse.safeParse({ ok: true, count }).success).toBe(false)
    },
  )

  it('preserves missing and unconstrained CMS values for authoritative downstream validation', () => {
    expect(parse(cmsStudio, { operation: 'validate' })).toEqual({
      ok: true,
      data: { operation: 'validate' },
    })
    for (const document of [undefined, null, 7, {}, []])
      expect(parse(cmsStudio, { operation: 'validate', document })).toEqual({
        ok: true,
        data: { operation: 'validate', document },
      })
    expect(
      parse(cmsStudio, { operation: 'asset_copy', id: ID, version: 0, purpose: 'salon' }).ok,
    ).toBe(true)
  })

  it('keeps safe CMS revisions and the strict-field Swedish error authoritative', () => {
    expect(parse(cmsStudio, { operation: 'revision', revision: Number.MAX_SAFE_INTEGER }).ok).toBe(
      true,
    )
    expect(
      parse(cmsStudio, { operation: 'revision', revision: Number.MAX_SAFE_INTEGER + 1 }),
    ).toEqual({ ok: false, detail: 'revision: Expected a positive integer' })
    expect(
      parse(cmsStudio, {
        operation: 'asset_copy',
        id: 'bad',
        version: -1,
        purpose: 'salon',
        extra: true,
      }),
    ).toEqual({ ok: false, detail: 'asset: Välj en registrerad bild och en giltig destination.' })
    expect(parse(cmsStudio, { operation: 'revision', revision: 'bad', extra: true })).toEqual({
      ok: false,
      detail: 'request: Unsupported field',
    })
    expect(parse(cmsStudio, { operation: 'unknown' })).toEqual({
      ok: false,
      detail: 'operation: Unknown operation',
    })
  })
})

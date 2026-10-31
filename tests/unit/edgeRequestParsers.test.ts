import { describe, expect, it } from 'vitest'
import { parse } from '../../supabase/functions/_shared/http.ts'
import { requestSchema as adminCreateBarber } from '../../supabase/functions/admin-create-barber/request.ts'
import { requestSchema as adminManageBarber } from '../../supabase/functions/admin-manage-barber/request.ts'
import { requestSchema as cmsStudio } from '../../supabase/functions/cms-studio/request.ts'
import { requestSchema as externalCleanup } from '../../supabase/functions/external-cleanup/request.ts'
import { requestSchema as publicBookingActions } from '../../supabase/functions/public-booking-actions/request.ts'
import { parseRequest as sendConfirmation } from '../../supabase/functions/send-confirmation/request.ts'
import { requestSchema as sendEmailChange } from '../../supabase/functions/send-email-change/request.ts'
import { requestSchema as sendRecoveryEmail } from '../../supabase/functions/send-recovery-email/request.ts'
import { requestSchema as submitBooking } from '../../supabase/functions/submit-booking/request.ts'
import {
  deleteSchema,
  formFields,
  uploadSchema,
} from '../../supabase/functions/upload-image/request.ts'

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e'
const OTHER_ID = '6ba7b810-9dad-11d1-80b4-00c04fd430c8'
const TOKEN = 'ab'.repeat(32)

function detail(schema: Parameters<typeof parse>[0], raw: unknown): string | null {
  const result = parse(schema, raw)
  return result.ok ? null : result.detail
}

describe('submit-booking request', () => {
  const booking = {
    barberId: 'hassan',
    serviceId: ID,
    startAt: '2030-01-01T10:00:00+01:00',
    phone: '0701234567',
    email: ' Kund@Example.se ',
    lang: 'sv',
    customerName: 'Kund',
  }
  const valid = { booking, turnstileToken: 'token', rememberBookings: true }

  it('accepts a valid body and normalizes the address', () => {
    const result = parse(submitBooking, valid)
    expect(result).toEqual({
      ok: true,
      data: {
        booking: { ...booking, email: 'kund@example.se' },
        turnstileToken: 'token',
        rememberBookings: true,
      },
    })
  })

  it('rejects an unknown key at the root and inside the booking', () => {
    expect(parse(submitBooking, { ...valid, extra: 1 }).ok).toBe(false)
    expect(parse(submitBooking, { ...valid, booking: { ...booking, extra: 1 } }).ok).toBe(false)
  })

  it.each([
    [5, 'body must be a JSON object'],
    [{ ...valid, booking: undefined }, 'booking is required'],
    [{ ...valid, booking: { ...booking, barberId: 1 } }, 'barberId is required'],
    [{ ...valid, booking: { ...booking, serviceId: '' } }, 'serviceId is required'],
    [{ ...valid, booking: { ...booking, startAt: null } }, 'startAt is required'],
    [{ ...valid, booking: { ...booking, phone: undefined } }, 'phone is required'],
    [{ ...valid, booking: { ...booking, email: 'nope' } }, 'email is invalid'],
    [{ ...valid, booking: { ...booking, email: 7 } }, 'email is invalid'],
    [{ ...valid, booking: { ...booking, lang: 'fr' } }, 'lang is invalid'],
    [{ ...valid, booking: { ...booking, customerName: '' } }, 'customerName is required'],
  ])('answers %j with the detail %s', (raw, expected) => {
    expect(detail(submitBooking, raw)).toBe(expected)
  })

  it('reads an unusable token as empty and anything but true as not remembered', () => {
    const result = parse(submitBooking, { booking, turnstileToken: 5, rememberBookings: 'yes' })
    expect(result.ok && [result.data.turnstileToken, result.data.rememberBookings]).toEqual([
      '',
      false,
    ])
  })
})

describe('admin-create-barber request', () => {
  const valid = { email: 'Bar@Ber.se', barber_id: 'hassan', lang: 'en' }

  it('accepts a valid body and normalizes the address', () => {
    expect(parse(adminCreateBarber, valid)).toEqual({
      ok: true,
      data: { email: 'bar@ber.se', barber_id: 'hassan', lang: 'en' },
    })
  })

  it('answers Swedish for any language but en', () => {
    const result = parse(adminCreateBarber, { ...valid, lang: 'fr' })
    expect(result.ok && result.data.lang).toBe('sv')
  })

  it('rejects an unknown key', () => {
    expect(parse(adminCreateBarber, { ...valid, extra: 1 }).ok).toBe(false)
  })

  it.each([
    ['text', 'body must be a JSON object'],
    [{ barber_id: 'x' }, 'email is required'],
    [{ email: 5, barber_id: 'x' }, 'email is required'],
    [{ email: 'bad', barber_id: 'x' }, 'email is invalid'],
    [{ email: ' a@b.se', barber_id: 'x' }, 'email is invalid'],
    [{ email: 'a@b.se' }, 'barber_id is required'],
    [{ email: 'a@b.se', barber_id: 5 }, 'barber_id is required'],
  ])('answers %j with the detail %s', (raw, expected) => {
    expect(detail(adminCreateBarber, raw)).toBe(expected)
  })
})

describe('admin-manage-barber request', () => {
  it('accepts both actions', () => {
    const access = { action: 'set_access', barber_id: 'hassan-1', enabled: false }
    const purge = { action: 'delete', barber_id: 'hassan-1', purge_bookings: true }
    expect(parse(adminManageBarber, access)).toEqual({ ok: true, data: access })
    expect(parse(adminManageBarber, purge)).toEqual({ ok: true, data: purge })
  })

  it.each([
    { action: 'set_access', barber_id: 'a', enabled: true, extra: 1 },
    { action: 'delete', barber_id: 'a', purge_bookings: true, enabled: true },
    { action: 'set_access', barber_id: 'Bad Id', enabled: true },
    { action: 'set_access', barber_id: 'a', enabled: 'true' },
    { action: 'delete', barber_id: 'a'.repeat(33), purge_bookings: false },
    { action: 'delete', barber_id: 'a', purge_bookings: 1 },
    { action: 'rename', barber_id: 'a' },
    ['set_access'],
    null,
  ])('rejects %j', (raw) => {
    expect(parse(adminManageBarber, raw).ok).toBe(false)
  })
})

describe('external-cleanup request', () => {
  it('accepts the two queued identities', () => {
    expect(parse(externalCleanup, { action_id: ID, dispatch_token: OTHER_ID })).toEqual({
      ok: true,
      data: { actionId: ID, dispatchToken: OTHER_ID },
    })
  })

  it.each([
    { action_id: ID, dispatch_token: OTHER_ID, extra: 1 },
    { action_id: ID },
    { action_id: 'x', dispatch_token: OTHER_ID },
    { action_id: ID, dispatch_token: 5 },
    null,
  ])('rejects %j', (raw) => {
    expect(parse(externalCleanup, raw).ok).toBe(false)
  })
})

describe('send-email-change request', () => {
  it('accepts a valid body and normalizes the address', () => {
    expect(parse(sendEmailChange, { new_email: ' New@Mail.se ', lang: 'en' })).toEqual({
      ok: true,
      data: { new_email: 'new@mail.se', lang: 'en' },
    })
  })

  it('reads a non-text address as empty and any other language as Swedish', () => {
    expect(parse(sendEmailChange, { new_email: 5, lang: 'fr' })).toEqual({
      ok: true,
      data: { new_email: '', lang: 'sv' },
    })
  })

  it.each([{ new_email: 'a@b.se', extra: 1 }, 'text', null, ['a@b.se']])('rejects %j', (raw) => {
    expect(parse(sendEmailChange, raw).ok).toBe(false)
  })
})

describe('send-recovery-email request', () => {
  it('accepts a valid body and normalizes the address', () => {
    expect(parse(sendRecoveryEmail, { email: 'A@B.se', lang: 'en', turnstileToken: 't' })).toEqual({
      ok: true,
      data: { email: 'a@b.se', lang: 'en', turnstileToken: 't' },
    })
  })

  it('reads unusable fields as empty or Swedish', () => {
    expect(parse(sendRecoveryEmail, { email: 1, lang: 2, turnstileToken: 3 })).toEqual({
      ok: true,
      data: { email: '', lang: 'sv', turnstileToken: '' },
    })
  })

  it.each([{ email: 'a@b.se', extra: 1 }, 'text', null, []])('rejects %j', (raw) => {
    expect(parse(sendRecoveryEmail, raw).ok).toBe(false)
  })
})

describe('send-confirmation request', () => {
  it('accepts the delivery sweep body', () => {
    expect(sendConfirmation({ delivery_id: ID })).toEqual({
      ok: true,
      id: null,
      event: null,
      deliveryId: ID,
    })
  })

  it('accepts the reminder body and defaults a bare id to a confirmation', () => {
    expect(sendConfirmation({ id: ID, event: 'booking_reminder' })).toEqual({
      ok: true,
      id: ID,
      event: 'booking_reminder',
      deliveryId: null,
    })
    expect(sendConfirmation({ id: ID })).toMatchObject({ event: 'booking_confirmed' })
    expect(sendConfirmation({ id: ID, event: null })).toMatchObject({ event: 'booking_confirmed' })
  })

  it.each([
    [5, 'payload must be an object'],
    [null, 'payload must be an object'],
    [{}, 'id is required'],
    [{ id: 5 }, 'id is required'],
    [{ id: ID, event: 'booking_deleted' }, 'invalid event'],
    [{ delivery_id: '' }, 'id is required'],
    [{ delivery_id: 5 }, 'id is required'],
    [{ delivery_id: null, extra: 1 }, 'id is required'],
  ])('answers %j with the error %s', (raw, error) => {
    expect(sendConfirmation(raw)).toEqual({ ok: false, error })
  })

  it.each([
    { delivery_id: ID, extra: 1 },
    { id: ID, extra: 1 },
    { id: ID, record: {} },
    { id: ID, delivery_id: '' },
    { record: { id: ID } },
  ])('rejects the unknown key in %j', (raw) => {
    expect(sendConfirmation(raw).ok).toBe(false)
  })
})

describe('public-booking-actions request', () => {
  const valid: readonly (readonly [Record<string, unknown>, Record<string, unknown>])[] = [
    [{ action: 'forget_device' }, { action: 'forget_device' }],
    [
      { action: 'request_link', email: ' A@B.se ', sourceEmail: 'c@d.se', lang: 'sv' },
      { action: 'request_link', email: 'a@b.se', sourceEmail: 'c@d.se', lang: 'sv' },
    ],
    [
      { action: 'confirm_link', linkCode: TOKEN.toUpperCase() },
      { action: 'confirm_link', linkCode: TOKEN },
    ],
    [
      { action: 'exchange_access', accessCode: TOKEN },
      { action: 'exchange_access', accessToken: TOKEN },
    ],
    [{ action: 'list' }, { action: 'list' }],
    [
      { action: 'list', accessToken: TOKEN },
      { action: 'list', accessToken: TOKEN },
    ],
    [
      { action: 'cancel', bookingId: ID, accessToken: TOKEN },
      { action: 'cancel', bookingId: ID, accessToken: TOKEN },
    ],
    [
      { action: 'request_access', email: 'a@b.se', lang: 'en', turnstileToken: '' },
      { action: 'request_access', email: 'a@b.se', lang: 'en', turnstileToken: '' },
    ],
    [
      {
        action: 'review',
        phone: '070-123 45 67',
        rating: 5,
        text: 'Bra',
        turnstileToken: 't',
      },
      { action: 'review', phone: '0701234567', rating: 5, text: 'Bra', turnstileToken: 't' },
    ],
  ]

  it.each(valid)('accepts %j as the flat action', (raw, flat) => {
    expect(parse(publicBookingActions, raw)).toEqual({ ok: true, data: flat })
  })

  it.each(valid)('rejects %j once it carries an unknown key', (raw) => {
    expect(parse(publicBookingActions, { ...raw, extra: 1 }).ok).toBe(false)
  })

  const review = {
    action: 'review',
    phone: '0701234567',
    rating: 4,
    text: 'ok',
    turnstileToken: '',
  }
  it.each([
    { action: 'nope' },
    {},
    ['list'],
    { action: 'list', accessToken: null },
    { action: 'list', accessToken: 'short' },
    { action: 'cancel', bookingId: 'x' },
    { action: 'cancel', accessToken: TOKEN },
    { action: 'confirm_link', linkCode: 'z'.repeat(64) },
    { action: 'request_link', email: 'a@b.se', sourceEmail: 'bad', lang: 'sv' },
    { action: 'request_access', email: 'a@b.se', lang: 'fr', turnstileToken: '' },
    { action: 'request_access', email: 'a@b.se', lang: 'sv' },
    { ...review, phone: '0801234567' },
    { ...review, rating: 6 },
    { ...review, rating: 4.5 },
    { ...review, rating: '4' },
    { ...review, text: '' },
    { ...review, text: 'x'.repeat(1001) },
    { ...review, turnstileToken: undefined },
  ])('rejects %j', (raw) => {
    expect(parse(publicBookingActions, raw).ok).toBe(false)
  })
})

describe('cms-studio request', () => {
  const metadata = {
    operation: 'asset',
    id: ID,
    version: 2,
    name: ' Logo ',
    alt: 'Text',
    archived: false,
  }
  const publish = {
    operation: 'publish',
    document: {},
    baseRevision: 3,
    baseFingerprint: 'a'.repeat(32),
    requestId: OTHER_ID,
  }

  it.each([
    { operation: 'state' },
    { operation: 'history' },
    { operation: 'history', before: null },
    { operation: 'history', before: 7 },
    { operation: 'revision', revision: 0 },
    { operation: 'asset_usage', id: ID },
    { operation: 'asset_lifecycle', id: ID, action: 'trash', version: 1 },
    { operation: 'asset_copy', id: ID, version: 1, purpose: 'salon' },
    { operation: 'asset_copy', id: ID, version: 1, purpose: 'profile', barberId: 'hassan' },
    metadata,
    { operation: 'validate', document: {} },
    publish,
  ])('accepts %j', (raw) => {
    expect(parse(cmsStudio, raw).ok).toBe(true)
  })

  it.each([
    { operation: 'state' },
    { operation: 'history' },
    { operation: 'revision', revision: 1 },
    { operation: 'asset_usage', id: ID },
    { operation: 'asset_lifecycle', id: ID, action: 'trash', version: 1 },
    metadata,
    { operation: 'validate', document: {} },
    publish,
  ])('rejects an unknown key in %j with the legacy message', (raw) => {
    expect(detail(cmsStudio, { ...raw, extra: 1 })).toBe('request: Unsupported field')
  })

  it.each([
    [{ operation: 'history', before: -1 }, 'before: Expected a positive integer'],
    [{ operation: 'history', before: '1' }, 'before: Expected a positive integer'],
    [{ operation: 'revision' }, 'revision: Expected a positive integer'],
    [{ operation: 'revision', revision: 1.5 }, 'revision: Expected a positive integer'],
    [{ operation: 'asset_usage', id: 'x' }, 'asset: Invalid asset identity'],
    [{ operation: 'asset_usage' }, 'asset: Invalid asset identity'],
    [
      { operation: 'asset_lifecycle', id: ID, action: 'nuke', version: 1 },
      'asset: Invalid asset lifecycle action',
    ],
    [
      { operation: 'asset_lifecycle', id: 'x', action: 'trash', version: 1 },
      'asset: Invalid asset lifecycle action',
    ],
    [
      { operation: 'asset_lifecycle', id: ID, action: 'trash' },
      'version: Expected a positive integer',
    ],
    [{ ...metadata, name: '   ' }, 'asset: Invalid asset metadata'],
    [{ ...metadata, name: 'x'.repeat(161) }, 'asset: Invalid asset metadata'],
    [{ ...metadata, alt: 'x'.repeat(2001) }, 'asset: Invalid asset metadata'],
    [{ ...metadata, archived: 'no' }, 'asset: Invalid asset metadata'],
    [{ ...metadata, version: -1 }, 'version: Expected a positive integer'],
    [{ ...publish, baseFingerprint: 'zz' }, 'publication: Invalid publication identity'],
    [{ ...publish, requestId: 'x' }, 'publication: Invalid publication identity'],
    [{ ...publish, baseRevision: '3' }, 'baseRevision: Expected a positive integer'],
    [{ operation: 'launch' }, 'operation: Unknown operation'],
    [{ operation: 5 }, 'operation: Unknown operation'],
    [{}, 'operation: Unknown operation'],
    [
      { operation: 'asset_copy', id: ID, version: 1, purpose: 'banner' },
      'asset: Välj en registrerad bild och en giltig destination.',
    ],
    [
      { operation: 'asset_copy', id: ID, version: 1, purpose: 'salon', extra: 1 },
      'asset: Välj en registrerad bild och en giltig destination.',
    ],
    [
      { operation: 'asset_copy', id: 'x', version: 1, purpose: 'salon' },
      'asset: Välj en registrerad bild och en giltig destination.',
    ],
  ])('answers %j with the message %s', (raw, expected) => {
    expect(detail(cmsStudio, raw)).toBe(expected)
  })
})

describe('upload-image request', () => {
  function form(
    fields: Readonly<Record<string, string | File>>,
    extra: readonly (readonly [string, string])[] = [],
  ) {
    const data = new FormData()
    for (const [name, value] of Object.entries(fields)) data.append(name, value)
    for (const [name, value] of extra) data.append(name, value)
    return data
  }
  const image = new File(['x'], 'a.png', { type: 'image/png' })
  const profile = {
    kind: 'barber_photo',
    file: image,
    barberId: 'hassan',
  }

  it('accepts a scoped barber photo upload', () => {
    const parsed = uploadSchema.safeParse(formFields(form(profile)))
    expect(parsed.success && parsed.data).toEqual(profile)
  })

  it.each<[string, FormData]>([
    ['an unknown field', form({ ...profile, extra: 'x' })],
    ['an empty file', form({ ...profile, file: new File([], 'a.png') })],
    ['a repeated field', form(profile, [['barberId', 'victor']])],
    ['a missing file', form({ kind: 'barber_photo', barberId: 'hassan' })],
    ['the cms_asset kind', form({ kind: 'cms_asset', file: image })],
    ['a bad barber id', form({ ...profile, barberId: 'Bad Id' })],
    [
      'the retired gallery upload',
      form({ kind: 'gallery', file: image, galleryKind: 'salon', alt: 'Salong', sortOrder: '0' }),
    ],
    ['the retired logo upload', form({ kind: 'site_logo', file: image, expectedPath: '' })],
    [
      'the retired logo replacement',
      form({ kind: 'site_logo', file: image, expectedPath: `logo/${ID}.webp` }),
    ],
  ])('rejects %s', (_name, data) => {
    expect(uploadSchema.safeParse(formFields(data)).success).toBe(false)
  })

  it('accepts a scoped barber photo deletion', () => {
    const raw = {
      action: 'delete',
      kind: 'barber_photo',
      barberId: 'hassan',
      storagePath: 'hassan/a.webp',
    }
    expect(deleteSchema.safeParse(raw).success).toBe(true)
  })

  it.each([
    { action: 'delete', kind: 'gallery', id: ID, storagePath: 'salon/a.webp' },
    { action: 'delete', kind: 'site_logo', storagePath: `logo/${ID}.webp` },
    {
      action: 'delete',
      kind: 'barber_photo',
      barberId: 'hassan',
      storagePath: 'hassan/a.webp',
      extra: 1,
    },
    { action: 'delete', kind: 'barber_photo', barberId: 'hassan', storagePath: '' },
    { action: 'delete', kind: 'barber_photo', barberId: 'hassan', storagePath: 'x'.repeat(301) },
    { action: 'remove', kind: 'barber_photo', barberId: 'hassan', storagePath: 'hassan/a.webp' },
    { action: 'delete', kind: 'barber_photo', barberId: 'hassan', storagePath: 'victor/a.webp' },
    { action: 'delete', kind: 'barber_photo', barberId: 'hassan' },
    null,
  ])('rejects the deletion %j', (raw) => {
    expect(deleteSchema.safeParse(raw).success).toBe(false)
  })
})

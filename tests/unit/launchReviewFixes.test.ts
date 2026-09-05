import { describe, expect, it } from 'vitest'
import { parseExternalAction } from '../../supabase/functions/_shared/externalActions'

const ACTION_ID = '71000000-0000-4000-8000-000000000001'
const DISPATCH_TOKEN = '71000000-0000-4000-8000-000000000002'
const BOOKING_ID = '71000000-0000-4000-8000-000000000003'

describe('launch-review durable action contracts', () => {
  it('accepts a fully server-resolved Calendar sync action', () => {
    expect(
      parseExternalAction({
        id: ACTION_ID,
        dispatch_token: DISPATCH_TOKEN,
        action_type: 'calendar_event_sync',
        booking_id: BOOKING_ID,
        barber_id: 'hassan',
        service_name: 'Klippning',
        customer_name: 'Test Kund',
        phone: '0701234567',
        start_at: '2040-03-14T12:30:00.000Z',
        end_at: '2040-03-14T13:15:00.000Z',
        refresh_token: 'server-token',
        calendar_id: 'primary',
        google_event_id: null,
      }),
    ).toMatchObject({ action_type: 'calendar_event_sync', booking_id: BOOKING_ID })
  })

  it('accepts only encrypted customer-access email payloads', () => {
    const base = {
      id: ACTION_ID,
      dispatch_token: DISPATCH_TOKEN,
      action_type: 'customer_access_email_send',
      email: 'customer@example.com',
      lang: 'sv',
    }
    expect(
      parseExternalAction({
        ...base,
        challenge_id: ACTION_ID,
        token_ciphertext: 'v1.' + 'a'.repeat(64),
      }),
    ).toMatchObject({
      action_type: 'customer_access_email_send',
    })
    expect(
      parseExternalAction({ ...base, challenge_id: ACTION_ID, access_code: 'a'.repeat(64) }),
    ).toBeNull()
  })
})

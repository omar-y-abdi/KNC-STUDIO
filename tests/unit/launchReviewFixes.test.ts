import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseExternalAction } from '../../supabase/functions/_shared/externalActions'
import {
  currentCustomerAccessToken,
  forgetCustomerAccessToken,
  rememberCustomerAccessToken,
} from '../../src/mybookings/customerAccessSession'

const ACTION_ID = '71000000-0000-4000-8000-000000000001'
const DISPATCH_TOKEN = '71000000-0000-4000-8000-000000000002'
const BOOKING_ID = '71000000-0000-4000-8000-000000000003'
const CHALLENGE_ID = '71000000-0000-4000-8000-000000000005'

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  }
}

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

  it('accepts only encrypted customer-access dispatch context', () => {
    const base = {
      id: ACTION_ID,
      dispatch_token: DISPATCH_TOKEN,
      action_type: 'customer_access_email_send',
      email: 'customer@example.com',
      lang: 'sv',
      challenge_id: CHALLENGE_ID,
    }
    expect(
      parseExternalAction({ ...base, token_ciphertext: 'v1.' + 'A'.repeat(80) }),
    ).toMatchObject({
      action_type: 'customer_access_email_send',
    })
    expect(parseExternalAction({ ...base, token_ciphertext: 'plain-link-token' })).toBeNull()
    expect(parseExternalAction({ ...base, access_code: 'a'.repeat(64) })).toBeNull()
  })
})

describe('customer access session persistence', () => {
  beforeEach(() => {
    vi.stubGlobal('sessionStorage', memoryStorage())
  })

  it('keeps only a valid opaque session and can clear the matching token', () => {
    const token = 'b'.repeat(64)
    rememberCustomerAccessToken('invalid')
    expect(currentCustomerAccessToken()).toBeNull()

    rememberCustomerAccessToken(token)
    expect(currentCustomerAccessToken()).toBe(token)
    forgetCustomerAccessToken('c'.repeat(64))
    expect(currentCustomerAccessToken()).toBe(token)
    forgetCustomerAccessToken(token)
    expect(currentCustomerAccessToken()).toBeNull()
  })
})

import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config'

export type PublicBookingActionPayload =
  | {
      readonly action: 'request_link'
      readonly email: string
      readonly sourceEmail: string
      readonly lang: 'sv' | 'en'
    }
  | { readonly action: 'confirm_link'; readonly linkCode: string }
  | { readonly action: 'forget_device' }
  | {
      readonly action: 'request_access'
      readonly email: string
      readonly lang: 'sv' | 'en'
      readonly turnstileToken: string
    }
  | { readonly action: 'exchange_access'; readonly accessCode: string }
  | { readonly action: 'list'; readonly accessToken?: string }
  | {
      readonly action: 'cancel'
      readonly bookingId: string
      readonly accessToken?: string
    }
  | {
      readonly action: 'review'
      readonly phone: string
      readonly accessToken?: string
      readonly rating: number
      readonly text: string
      readonly turnstileToken: string
    }

export async function invokePublicBookingAction(
  payload: PublicBookingActionPayload,
): Promise<{ readonly data: unknown; readonly failed: boolean }> {
  if (SUPABASE_URL === undefined || SUPABASE_ANON_KEY === undefined) {
    return { data: null, failed: true }
  }
  try {
    // Worker relays only the customer gateway. The session stays first-party and HttpOnly.
    const response = await globalThis.fetch('/api/customer-bookings', {
      method: 'POST',
      credentials: 'same-origin',
      signal: AbortSignal.timeout(15_000),
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    if (!response.ok) return { data: null, failed: true }
    return { data: await response.json(), failed: false }
  } catch {
    return { data: null, failed: true }
  }
}

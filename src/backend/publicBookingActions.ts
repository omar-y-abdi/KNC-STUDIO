import { getSupabase } from './supabaseClient'

export type PublicBookingActionPayload =
  | {
      readonly action: 'request_access'
      readonly phone: string
      readonly email: string
      readonly lang: 'sv' | 'en'
      readonly turnstileToken: string
    }
  | { readonly action: 'exchange_access'; readonly accessCode: string }
  | { readonly action: 'list'; readonly accessToken: string }
  | {
      readonly action: 'cancel'
      readonly bookingId: string
      readonly accessToken: string
    }
  | {
      readonly action: 'review'
      readonly phone: string
      readonly rating: number
      readonly text: string
      readonly turnstileToken: string
    }

export async function invokePublicBookingAction(
  payload: PublicBookingActionPayload,
): Promise<{ readonly data: unknown; readonly failed: boolean }> {
  try {
    const { data, error } = await getSupabase().functions.invoke('public-booking-actions', {
      body: payload,
    })
    return { data, failed: error !== null }
  } catch {
    return { data: null, failed: true }
  }
}

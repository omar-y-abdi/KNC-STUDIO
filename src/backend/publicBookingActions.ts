import { getSupabase } from './supabaseClient'

export type PublicBookingActionPayload =
  | { readonly action: 'lookup' | 'list'; readonly phone: string; readonly turnstileToken: string }
  | {
      readonly action: 'cancel'
      readonly phone: string
      readonly bookingId: string
      readonly turnstileToken: string
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

import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config'

export type PublicBookingActionPayload =
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
    // Customer session is an HttpOnly cookie set by this Edge Function. Do not put credentials on
    // the shared Supabase client: PostgREST uses wildcard CORS and browsers reject it with cookies.
    const response = await globalThis.fetch(`${SUPABASE_URL}/functions/v1/public-booking-actions`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
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

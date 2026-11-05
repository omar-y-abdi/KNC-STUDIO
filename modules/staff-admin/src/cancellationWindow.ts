// The customer cancellation window ("Avbokningsfrist") in whole hours. The bounds mirror the
// database trigger `normalize_site_setting_value`, which rejects any other value
// (supabase/migrations/20260913145001_cms_legal_business_identity.sql:66-69):
// the text must match ^[0-9]{1,3}$ and be between 1 and 168.

export const CANCELLATION_HOURS_MIN = 1
export const CANCELLATION_HOURS_MAX = 168
export const CANCELLATION_HOURS_KEY = 'cancellation_policy_hours'

export type CancellationHoursCheck =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly reason: 'empty' | 'format' | 'range' }

export function checkCancellationHours(raw: string): CancellationHoursCheck {
  const text = raw.trim()
  if (text === '') return { ok: false, reason: 'empty' }
  if (!/^[0-9]{1,3}$/.test(text)) return { ok: false, reason: 'format' }
  const hours = Number(text)
  if (hours < CANCELLATION_HOURS_MIN || hours > CANCELLATION_HOURS_MAX) {
    return { ok: false, reason: 'range' }
  }
  return { ok: true, value: String(hours) }
}

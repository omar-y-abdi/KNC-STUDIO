// Device memory for Mina bokningar: the phone that last looked up bookings on THIS device (and the
// phone of the last completed booking) is remembered so a returning customer never re-types it.
//
// Effect isolated at this edge (localStorage), guarded so a disabled/unavailable store degrades to
// "not remembered" instead of throwing. First-party functional storage — a single phone string, no
// tracking, so it needs no consent gate.

const KEY = 'bladeblend.mybookings.phone'

/** Persist the proven phone on this device. Best-effort: a storage failure (private mode / disabled
 * storage) is intentionally non-fatal — remembering is a convenience, not a requirement. */
export function rememberPhone(phone: string): void {
  try {
    window.localStorage.setItem(KEY, phone)
  } catch {
    // Storage unavailable — skip remembering; the customer can still enter the number manually.
  }
}

/** The phone remembered on this device, or null if none is stored / storage is unavailable. */
export function recalledPhone(): string | null {
  try {
    const value = window.localStorage.getItem(KEY)
    return value !== null && value.trim() !== '' ? value : null
  } catch {
    return null
  }
}

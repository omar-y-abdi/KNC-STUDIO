import type { StoragePreferences } from '../site/storageConsent'

/** More bookings than this, as this device lists them, before the home-screen guide is offered. */
const BOOKINGS_BEFORE_GUIDE = 2

export function offersHomeScreenGuide(bookings: number): boolean {
  return bookings > BOOKINGS_BEFORE_GUIDE
}

/** Only an iPhone is ever shown the guide; no other visitor fetches its chunk. */
export function onIphone(userAgent: string): boolean {
  return userAgent.includes('iPhone')
}

/** A device list of bookings, and how many bookings had been completed here when it was read. */
export interface ListedBookings {
  readonly after: number
  readonly count: number
}

/** The count to offer the guide with when a confirmation closes: only from a list read after the
 * latest completed booking, so the booking just made is in it. */
export function guideOffer(listed: ListedBookings | null, completed: number): number | null {
  return listed !== null && listed.after === completed && offersHomeScreenGuide(listed.count)
    ? listed.count
    : null
}

/** The device's note that the guide has been shown, in localStorage. */
export const HOME_SCREEN_GUIDE_KEY = 'bladeblend_home_screen_guide'

export type GuideNoteOutcome = 'kept' | 'removed' | 'unreachable'

/** The note stays only while optional storage is on; here, not in the guide's chunk, so a page
 * load that never fetches the chunk still removes it. */
export function forgetHomeScreenGuide(
  storage: () => Storage,
  preferences: StoragePreferences | null,
): GuideNoteOutcome {
  if (preferences?.functional === true) return 'kept'
  try {
    storage().removeItem(HOME_SCREEN_GUIDE_KEY)
    return 'removed'
  } catch {
    return 'unreachable'
  }
}

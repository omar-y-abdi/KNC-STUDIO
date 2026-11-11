import type { StoragePreferences } from '../site/storageConsent'
import { HOME_SCREEN_GUIDE_KEY } from './trigger'

const SHOWN = 'shown'

/** A storage that throws or is missing holds no note. */
export function homeScreenGuideRecorded(storage: () => Storage): boolean {
  try {
    return storage().getItem(HOME_SCREEN_GUIDE_KEY) === SHOWN
  } catch {
    return false
  }
}

/** Written only with optional storage on; false when nothing was written. */
export function recordHomeScreenGuide(
  storage: () => Storage,
  preferences: StoragePreferences | null,
): boolean {
  if (preferences?.functional !== true) return false
  try {
    storage().setItem(HOME_SCREEN_GUIDE_KEY, SHOWN)
    return true
  } catch {
    return false
  }
}

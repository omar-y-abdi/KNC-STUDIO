import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import {
  readStoragePreferences,
  saveStoragePreferences,
  subscribeStoragePreferences,
  type StoragePreferences,
} from './storageConsent'

export interface PrivacyControls {
  readonly preferences: StoragePreferences | null
  readonly expanded: boolean
  readonly functional: boolean
  readonly setFunctional: (value: boolean) => void
  readonly openPreferences: () => void
  readonly choose: (value: StoragePreferences) => void
}

/** Shared by the global notice, hero control and About link; survives layout/breakpoint changes. */
export function usePrivacyPreferences(preview = false): PrivacyControls {
  const [preferences, setPreferences] = useState(() =>
    preview ? { functional: false } : readStoragePreferences(),
  )
  const currentPreferences = useRef(preferences)
  currentPreferences.current = preferences
  const [expanded, setExpanded] = useState(false)
  const opener = useRef<HTMLElement | null>(null)
  const [functional, setFunctional] = useState(() => preferences?.functional ?? false)
  useEffect(() => {
    if (preview) return
    const sync = (): void => setPreferences(readStoragePreferences())
    const unsubscribe = subscribeStoragePreferences(sync)
    window.addEventListener('focus', sync)
    document.addEventListener('visibilitychange', sync)
    return () => {
      unsubscribe()
      window.removeEventListener('focus', sync)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [preview])
  return {
    preferences,
    expanded,
    functional,
    setFunctional,
    openPreferences: useCallback(() => {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setFunctional(
        (preview ? currentPreferences.current : readStoragePreferences())?.functional ?? false,
      )
      setExpanded(true)
    }, [preview]),
    choose: useCallback(
      (value: StoragePreferences) => {
        if (preview) setPreferences({ ...value })
        else {
          saveStoragePreferences(value)
          setPreferences(readStoragePreferences())
        }
        setExpanded(false)
        requestAnimationFrame(() => {
          if (opener.current?.isConnected) opener.current.focus({ preventScroll: true })
        })
      },
      [preview],
    ),
  }
}

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
export function usePrivacyPreferences(): PrivacyControls {
  const [preferences, setPreferences] = useState(readStoragePreferences)
  const [expanded, setExpanded] = useState(false)
  const opener = useRef<HTMLElement | null>(null)
  const [functional, setFunctional] = useState(() => preferences?.functional ?? false)
  useEffect(() => {
    const sync = (): void => setPreferences(readStoragePreferences())
    const unsubscribe = subscribeStoragePreferences(sync)
    window.addEventListener('focus', sync)
    document.addEventListener('visibilitychange', sync)
    return () => {
      unsubscribe()
      window.removeEventListener('focus', sync)
      document.removeEventListener('visibilitychange', sync)
    }
  }, [])
  return {
    preferences,
    expanded,
    functional,
    setFunctional,
    openPreferences: useCallback(() => {
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      setFunctional(readStoragePreferences()?.functional ?? false)
      setExpanded(true)
    }, []),
    choose: useCallback((value: StoragePreferences) => {
      saveStoragePreferences(value)
      setPreferences(readStoragePreferences())
      setExpanded(false)
      requestAnimationFrame(() => {
        if (opener.current?.isConnected) opener.current.focus({ preventScroll: true })
      })
    }, []),
  }
}

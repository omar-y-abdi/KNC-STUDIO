// Admin theme + language hook. Mirrors the public site's convention (App.tsx): default to the
// device's light/dark preference, allow a manual toggle, and keep a Swedish/English switch. The
// admin UI is Swedish-first (the spec's labels are Swedish) but bios/About are bilingual, so the
// language toggle drives which language's editable fields are shown.
//
// Effects (matchMedia, document background/theme-color) are isolated in the hook; the rest of the
// admin UI takes plain {dark, lang} values.

import { useEffect, useState } from 'preact/hooks'
import type { Lang } from '../i18n/index'

export interface ThemeState {
  readonly dark: boolean
  readonly lang: Lang
  toggleMode: () => void
  setLang: (lang: Lang) => void
}

/** Resolve the initial mode from the OS preference (SSR-safe guard, though this app is client-only). */
function initialDark(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function useTheme(): ThemeState {
  const [dark, setDark] = useState<boolean>(initialDark)
  const [lang, setLangState] = useState<Lang>('sv')

  // Keep the page background + theme-color in sync so the admin surface fills the viewport edges
  // (matches the public site's edge-effect discipline). Light/dark only — no per-section nuance.
  useEffect(() => {
    const bg = dark ? '#1c1c1e' : '#ffffff'
    document.documentElement.style.background = bg
    document.body.style.background = bg
    let meta = document.querySelector('meta[name="theme-color"]')
    if (meta === null) {
      meta = document.createElement('meta')
      meta.setAttribute('name', 'theme-color')
      document.head.appendChild(meta)
    }
    meta.setAttribute('content', bg)
  }, [dark])

  return {
    dark,
    lang,
    toggleMode: () => setDark((d) => !d),
    setLang: (next: Lang) => setLangState(next),
  }
}

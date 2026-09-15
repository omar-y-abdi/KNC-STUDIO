import { createContext, type ComponentChildren, type JSX } from 'preact'
import { useContext, useEffect, useMemo, useState } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import { emptyPresentation, validatePresentation, presentationCss, mediaUrl, type CmsDocument, type CmsPresentation, type CmsLang, type CmsMode, type CopyGroup } from '../../shared/cms'
import { SUPABASE_URL } from '../backend/config'

interface CmsContextValue {
  presentation: CmsPresentation
  draft: CmsDocument | null
  revision: number
  lang: CmsLang
}
export interface PublishedCms { revision: number; presentation: CmsPresentation }
const neutral: CmsContextValue = { presentation: emptyPresentation(), draft: null, revision: 0, lang: 'sv' }
const CmsContext = createContext<CmsContextValue>(neutral)
export function useCms(): CmsContextValue { return useContext(CmsContext) }
let published: Promise<PublishedCms> | null = null

export function readPublishedCms(force = false): Promise<PublishedCms> {
  if (force) published = null
  published ??= (async () => {
    const response = await fetch('/api/cms/presentation', { credentials: 'omit', cache: 'no-store', headers: { accept: 'application/json' } })
    if (response.status === 404) return { revision: 0, presentation: emptyPresentation() }
    if (!response.ok) throw new Error(`CMS content: HTTP ${response.status}`)
    const value: unknown = await response.json()
    if (!value || typeof value !== 'object' || !('revision' in value) || typeof value.revision !== 'number' || !Number.isSafeInteger(value.revision) || value.revision < 0 || !('presentation' in value)) throw new Error('Invalid published CMS content')
    validatePresentation(value.presentation)
    return { revision: value.revision, presentation: value.presentation }
  })().catch((error: unknown) => { published = null; throw error })
  return published
}

export function CmsPublicProvider({ children }: { children: ComponentChildren }): JSX.Element {
  const [pathname] = useLocation()
  const publicRoute = !/^\/(?:admin(?:\/|$)|login(?:\/|$)|reset(?:\/|$)|invite(?:\/|$)|auth(?:\/|$))/.test(pathname)
  const [value, setValue] = useState<CmsContextValue>(neutral)
  useEffect(() => {
    if (!publicRoute || !SUPABASE_URL) return
    let mounted = true
    // Returning from the studio must not reuse the pre-publication promise.
    void readPublishedCms(true).then(result => {
      if (mounted) setValue({ ...result, draft: null, lang: 'sv' })
    }).catch(() => {
      // Native booking content keeps its existing backend path. Authored pages display their own error.
    })
    return () => { mounted = false }
  }, [pathname, publicRoute])
  const active = publicRoute ? value : neutral
  return <CmsContext.Provider value={active}><CmsStyles presentation={active.presentation} />{children}</CmsContext.Provider>
}

export function CmsDraftProvider({ document, lang = 'sv', children }: { document: CmsDocument; lang?: CmsLang; children: ComponentChildren }): JSX.Element {
  const value = useMemo(() => ({ presentation: document.presentation, draft: document, revision: -1, lang }), [document, lang])
  return <CmsContext.Provider value={value}><CmsStyles presentation={document.presentation} />{children}</CmsContext.Provider>
}

export function CmsLocaleProvider({ lang, children }: { lang: CmsLang; children: ComponentChildren }): JSX.Element {
  const inherited = useCms()
  const value = useMemo(() => ({ ...inherited, lang }), [inherited, lang])
  return <CmsContext.Provider value={value}>{children}</CmsContext.Provider>
}

function CmsStyles({ presentation }: { presentation: CmsPresentation }): JSX.Element | null {
  const css = useMemo(() => {
    const rules = [presentationCss(presentation)]
    for (const mode of ['light', 'dark'] as const) {
      const font = presentation.themes[mode]['fontFamily']
      if (font) rules.push(`[data-cms-theme="${mode}"] [data-cms-node]{font-family:${font}!important}`)
    }
    return rules.filter(Boolean).join('\n')
  }, [presentation])
  return css ? <style data-cms-presentation>{css}</style> : null
}

export function mergeCmsStrings<T extends object>(presentation: CmsPresentation, group: CopyGroup, lang: CmsLang, base: T): T {
  const values = presentation.copy[group]?.[lang]
  if (!values) return base
  const copy = { ...base } as Record<string, unknown>
  for (const [key, value] of Object.entries(values)) {
    if (typeof copy[key] === 'string') copy[key] = value
    else if (key.includes('.')) {
      const [name, rawIndex] = key.split('.')
      if (name && rawIndex && Array.isArray(copy[name])) {
        const index = Number(rawIndex), array = copy[name] as unknown[]
        if (Number.isSafeInteger(index) && index >= 0 && index < array.length && typeof array[index] === 'string') {
          const next = [...array]; next[index] = value; copy[name] = next
        }
      }
    }
  }
  return copy as T
}

export function useCmsStrings<T extends object>(group: CopyGroup, lang: CmsLang, base: T): T {
  const { presentation, draft } = useCms()
  const merged = mergeCmsStrings(presentation, group, lang, base)
  const records = draft && (group === 'about' ? draft.about : group === 'app' || group === 'booking' ? draft.site : null)
  if (!records) return merged
  const result = { ...merged } as Record<string, unknown>
  for (const [key, localized] of Object.entries(records)) {
    const value = localized[lang]
    if (value !== undefined && typeof result[key] === 'string') result[key] = value
  }
  return result as T
}

export function useCmsPalette<T extends object>(base: T, mode: CmsMode): T {
  const theme = useCms().presentation.themes[mode]
  if (Object.keys(theme).length === 0) return base
  const result = { ...base } as Record<string, unknown>
  const slots: Record<string, string> = { bg: 'background', text: 'text', line: 'border', inputLine: 'border', card: 'surface', navBg: 'surface', footer: 'surface', subtle: 'surface', input: 'surface', closeBg: 'surface', accent: 'accent', accentText: 'accentText', muted: 'muted' }
  for (const [key, slot] of Object.entries(slots)) {
    if (typeof result[key] === 'string' && theme[slot]) result[key] = theme[slot]
  }
  return result as T
}

export function useCmsTheme(mode: CmsMode): void {
  useEffect(() => {
    const root = window.document.documentElement
    const previous = root.dataset['cmsTheme']
    root.dataset['cmsTheme'] = mode
    return () => {
      if (previous === undefined) delete root.dataset['cmsTheme']
      else root.dataset['cmsTheme'] = previous
    }
  }, [mode])
}

export function CmsImage(props: JSX.IntrinsicElements['img'] & { 'data-cms-node': string }): JSX.Element {
  const { presentation, lang } = useCms()
  const override = presentation.images[props['data-cms-node']]
  return <img {...props} {...(override && SUPABASE_URL ? { src: mediaUrl(override.ref, SUPABASE_URL), alt: override.alt[lang] } : {})} />
}

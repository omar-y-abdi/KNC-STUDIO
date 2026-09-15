import { createContext, type ComponentChildren, type JSX } from 'preact'
import { useContext, useEffect, useMemo, useState } from 'preact/hooks'
import { emptyPresentation, validatePresentation, presentationCss, mediaUrl, type CmsDocument, type CmsPresentation, type CmsLang, type CmsMode, type CopyGroup } from '../../shared/cms'
import { SUPABASE_URL } from '../backend/config'

interface CmsContextValue { presentation: CmsPresentation; draft: CmsDocument | null; revision: number }
const neutral: CmsContextValue = { presentation: emptyPresentation(), draft: null, revision: 0 }
const CmsContext = createContext<CmsContextValue>(neutral)
export function useCms(): CmsContextValue { return useContext(CmsContext) }
let published: Promise<{ revision: number; presentation: CmsPresentation }> | null = null
export function readPublishedCms(force = false): Promise<{ revision: number; presentation: CmsPresentation }> {
  if (force) published = null
  published ??= (async () => {
    const response = await fetch('/api/cms/presentation', { credentials: 'omit', headers: { accept: 'application/json' } })
    if (response.status === 404 || response.status === 503) return { revision: 0, presentation: emptyPresentation() }
    if (!response.ok) throw new Error(`CMS content: HTTP ${response.status}`)
    const value: unknown = await response.json()
    if (!value || typeof value !== 'object' || !('revision' in value) || typeof value.revision !== 'number' || !Number.isSafeInteger(value.revision) || value.revision < 0 || !('presentation' in value)) throw new Error('Invalid published CMS content')
    validatePresentation(value.presentation)
    return { revision: value.revision, presentation: value.presentation }
  })().catch(error => { published = null; throw error })
  return published
}
export function CmsPublicProvider({ children }: { children: ComponentChildren }): JSX.Element {
  const [value, setValue] = useState<CmsContextValue>(neutral)
  useEffect(() => {
    if (window.location.pathname.startsWith('/admin') || !SUPABASE_URL) return
    let mounted = true
    void readPublishedCms().then(result => { if (mounted) setValue({ ...result, draft: null }) }).catch(() => { /* The existing website remains available when optional presentation cannot be read. */ })
    return () => { mounted = false }
  }, [])
  return <CmsContext.Provider value={value}><CmsStyles presentation={value.presentation} />{children}</CmsContext.Provider>
}
export function CmsDraftProvider({ document, children }: { document: CmsDocument; children: ComponentChildren }): JSX.Element {
  const value = useMemo(() => ({ presentation: document.presentation, draft: document, revision: -1 }), [document])
  return <CmsContext.Provider value={value}><CmsStyles presentation={document.presentation} />{children}</CmsContext.Provider>
}
function CmsStyles({ presentation }: { presentation: CmsPresentation }): JSX.Element | null {
  const css = useMemo(() => presentationCss(presentation), [presentation])
  return css ? <style data-cms-presentation>{css}</style> : null
}
export function useCmsStrings<T extends object>(group: CopyGroup, lang: CmsLang, base: T): T {
  const { presentation } = useCms()
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
export function useCmsTheme(mode: CmsMode): void {
  useEffect(() => { document.documentElement.dataset.cmsTheme = mode }, [mode])
}
export function CmsImage(props: JSX.IntrinsicElements['img'] & { 'data-cms-node': string }): JSX.Element {
  const { presentation } = useCms()
  const override = presentation.images[props['data-cms-node']]
  const lang = typeof document !== 'undefined' && document.documentElement.lang === 'en' ? 'en' : 'sv'
  return <img {...props} {...(override && SUPABASE_URL ? { src: mediaUrl(override.ref, SUPABASE_URL), alt: override.alt[lang] } : {})} />
}

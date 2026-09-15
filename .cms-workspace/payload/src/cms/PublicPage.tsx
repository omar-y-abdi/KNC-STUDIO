import type { JSX } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import { useLocation } from 'wouter-preact'
import { isPagePath, type CmsLang, type CmsMode } from '../../shared/cms'
import { NotFound } from '../app/NotFound'
import { CmsMarkup } from './Markup'
import { readPublishedCms, type PublishedCms } from './context'

function metadata(title: string, description: string, canonical: string, lang: CmsLang): void {
  document.title = title
  document.documentElement.lang = lang
  for (const [name, content] of Object.entries({ description, robots: 'index, follow', 'og:title': title, 'og:description': description, 'og:url': canonical, 'twitter:title': title, 'twitter:description': description })) {
    const property = name.startsWith('og:') ? 'property' : 'name'
    let element = document.head.querySelector<HTMLMetaElement>(`meta[${property}="${name}"]`)
    if (!element) { element = document.createElement('meta'); element.setAttribute(property, name); document.head.appendChild(element) }
    element.content = content
  }
  let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
  if (!link) { link = document.createElement('link'); link.rel = 'canonical'; document.head.appendChild(link) }
  link.href = canonical
}

export default function CmsPublicPage(): JSX.Element {
  const [pathname] = useLocation()
  const path = pathname.replace(/\/+$/, '')
  const [state, setState] = useState<{ path: string; value: PublishedCms | null; error: string }>({ path: '', value: null, error: '' })
  const params = new URLSearchParams(window.location.search)
  const [lang, setLang] = useState<CmsLang>(params.get('lang') === 'en' ? 'en' : 'sv')
  const [mode, setMode] = useState<CmsMode>(params.get('mode') === 'dark' ? 'dark' : params.get('mode') === 'light' ? 'light' : window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  const [attempt, setAttempt] = useState(0)
  const eligible = isPagePath(path) || path === '/privacy' || path === '/terms'
  useEffect(() => {
    if (!eligible) return
    let active = true
    setState({ path, value: null, error: '' })
    void readPublishedCms(true).then(value => {
      if (active) setState({ path, value, error: '' })
    }).catch(() => {
      if (active) setState({ path, value: null, error: 'Sidans innehåll kunde inte hämtas. Försök igen.' })
    })
    return () => { active = false }
  }, [path, attempt, eligible])
  const value = state.path === path ? state.value : null
  const page = value?.presentation.pages.find(item => item.path === path)
  useEffect(() => {
    if (value && !page && (path === '/privacy' || path === '/terms')) window.location.replace(`${path}.html`)
  }, [value, page, path])
  useEffect(() => {
    if (!page) return
    const origin = (import.meta.env.VITE_SITE_URL || window.location.origin).replace(/\/$/, '')
    metadata(page.title[lang] || page.name[lang], page.description[lang], `${origin}${page.path}${lang === 'en' ? '?lang=en' : ''}`, lang)
    const url = new URL(window.location.href)
    url.searchParams.set('lang', lang); url.searchParams.set('mode', mode)
    window.history.replaceState(window.history.state, '', url)
  }, [page, lang, mode])
  if (!eligible) return <NotFound />
  if (state.path === path && state.error) return <main role="alert" style={{ padding: '48px 24px', fontFamily: 'system-ui,sans-serif' }}><h1>Innehållet är tillfälligt otillgängligt</h1><p>{state.error}</p><button type="button" onClick={() => setAttempt(number => number + 1)}>Försök igen</button><p><a href="/">Till hemsidan</a></p></main>
  if (!value) return <p role="status" style={{ padding: '32px', fontFamily: 'system-ui,sans-serif' }}>Läser sidan…</p>
  if (!page) return path === '/privacy' || path === '/terms' ? <p role="status">Öppnar originalsidan…</p> : <NotFound />
  const content = page.content[lang]
  return <div data-cms-page={page.id} data-cms-theme={mode} style={{ minHeight: '100dvh', background: mode === 'dark' ? '#151517' : '#fff', color: mode === 'dark' ? '#f5f5f7' : '#202124', fontFamily: 'system-ui,sans-serif' }}>
    <nav aria-label={lang === 'sv' ? 'Sidval' : 'Page controls'} style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '16px', padding: '16px 24px' }}><a href="/" style={{ color: 'inherit' }}>{lang === 'sv' ? 'Till hemsidan' : 'Back to website'}</a><button type="button" onClick={() => setLang(current => current === 'sv' ? 'en' : 'sv')}>{lang === 'sv' ? 'English' : 'Svenska'}</button><button type="button" onClick={() => setMode(current => current === 'dark' ? 'light' : 'dark')}>{mode === 'dark' ? 'Light' : 'Dark'}</button></nav>
    <CmsMarkup html={content.html} css={content.css[mode]} label={page.name[lang]} />
  </div>
}

import { fontFaceCss } from '../../shared/cms-fonts'
import { parse, parseFragment, serialize, type DefaultTreeAdapterMap } from 'parse5'
import {
  emptyDocument,
  isPagePath,
  validatePresentation,
  type CmsPage,
  type CmsPresentation,
} from '../../shared/cms'
import { validateDocumentMarkup, type MarkupPolicy } from '../../shared/cms-markup'
import { CMS_BUILT_ASSETS } from '../../shared/cms-built-assets'

type Node = DefaultTreeAdapterMap['node']
type Element = DefaultTreeAdapterMap['element']
interface CmsEnvironment {
  SUPABASE_URL?: string
  SUPABASE_ANON_KEY?: string
  ASSETS: { fetch(input: Request | URL | string): Promise<Response> }
}
interface Published {
  revision: number
  presentation: CmsPresentation
}
const LIMIT = 2 * 1024 * 1024 + 1024

async function boundedJson(response: Response): Promise<unknown> {
  if (Number(response.headers.get('content-length')) > LIMIT || !response.body)
    throw new Error('Invalid CMS response')
  const reader = response.body.getReader(),
    decoder = new TextDecoder('utf-8', { fatal: true })
  let size = 0,
    text = ''
  try {
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      size += chunk.value.byteLength
      if (size > LIMIT) throw new Error('CMS response exceeds limit')
      text += decoder.decode(chunk.value, { stream: true })
    }
    return JSON.parse(text + decoder.decode()) as unknown
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
  } finally {
    reader.releaseLock()
  }
}

async function published(env: CmsEnvironment, siteOrigin: string): Promise<Published | null> {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return null
  const origin = new URL(env.SUPABASE_URL).origin
  const response = await fetch(`${origin}/rest/v1/rpc/public_cms_presentation`, {
    method: 'POST',
    redirect: 'error',
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
      'content-type': 'application/json',
    },
    body: '{}',
    signal: AbortSignal.timeout(4000),
  })
  // An installation without the additive migration still serves its existing pages.
  if (response.status === 404) return null
  if (!response.ok) throw new Error('CMS read unavailable')
  const value = await boundedJson(response)
  if (
    !value ||
    typeof value !== 'object' ||
    !('revision' in value) ||
    typeof value.revision !== 'number' ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    !('presentation' in value)
  )
    throw new Error('Invalid CMS response')
  validatePresentation(value.presentation)
  const document = emptyDocument()
  document.presentation = value.presentation
  const policy: MarkupPolicy = { siteOrigin, storageOrigin: origin, builtAssets: CMS_BUILT_ASSETS }
  validateDocumentMarkup(document, policy)
  return { revision: value.revision, presentation: document.presentation }
}

function attribute(element: Element, name: string, value: string): void {
  const current = element.attrs.find((item) => item.name === name)
  if (current) current.value = value
  else element.attrs.push({ name, value })
}
function text(element: Element, value: string): void {
  element.childNodes = [{ nodeName: '#text', value, parentNode: element }]
}
function find(node: Node, test: (element: Element) => boolean): Element | undefined {
  if ('tagName' in node && test(node)) return node
  if ('childNodes' in node)
    for (const child of node.childNodes) {
      const result = find(child, test)
      if (result) return result
    }
  return undefined
}
function append(parent: Element, html: string): void {
  const nodes = parseFragment(html).childNodes
  for (const node of nodes) node.parentNode = parent
  parent.childNodes.push(...nodes)
}
const escaped = (value: string): string =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')

export function renderCmsPage(shell: string, page: CmsPage, url: URL, siteOrigin: string): string {
  const lang = url.searchParams.get('lang') === 'en' ? 'en' : 'sv'
  const mode = url.searchParams.get('mode') === 'dark' ? 'dark' : 'light'
  const title = page.title[lang] || page.name[lang],
    description = page.description[lang]
  const canonical = `${siteOrigin}${page.path}${lang === 'en' ? '?lang=en' : ''}`
  const document = parse(shell)
  const html = find(document, (element) => element.tagName === 'html')
  const head = find(document, (element) => element.tagName === 'head')
  const root = find(document, (element) =>
    element.attrs.some((item) => item.name === 'id' && item.value === 'root'),
  )
  if (!html || !head || !root) throw new Error('CMS shell unavailable')
  attribute(html, 'lang', lang)
  attribute(html, 'data-cms-theme', mode)
  const titleNode = find(head, (element) => element.tagName === 'title')
  if (titleNode) text(titleNode, title)
  else append(head, `<title>${escaped(title)}</title>`)
  const metadata: Record<string, string> = {
    description,
    robots: 'index, follow',
    'og:title': title,
    'og:description': description,
    'og:url': canonical,
    'og:locale': lang === 'en' ? 'en_US' : 'sv_SE',
    'og:locale:alternate': lang === 'en' ? 'sv_SE' : 'en_US',
    'twitter:title': title,
    'twitter:description': description,
  }
  for (const [key, value] of Object.entries(metadata)) {
    const node = find(
      head,
      (element) =>
        element.tagName === 'meta' &&
        element.attrs.some(
          (item) => (item.name === 'name' || item.name === 'property') && item.value === key,
        ),
    )
    if (node) attribute(node, 'content', value)
    else
      append(
        head,
        `<meta ${key.startsWith('og:') ? 'property' : 'name'}="${key}" content="${escaped(value)}">`,
      )
  }
  const canonicalNode = find(
    head,
    (element) =>
      element.tagName === 'link' &&
      element.attrs.some((item) => item.name === 'rel' && item.value === 'canonical'),
  )
  if (canonicalNode) attribute(canonicalNode, 'href', canonical)
  else append(head, `<link rel="canonical" href="${escaped(canonical)}">`)
  const variant = page.content[lang]
  root.childNodes = []
  // Declarative shadow DOM keeps authored styles scoped and the saved content usable without JS.
  append(
    root,
    `<div data-cms-authored><template shadowrootmode="open"><style>:host{display:block;min-height:100vh;font-family:system-ui,sans-serif;color:${mode === 'dark' ? '#f5f5f7' : '#202124'};background:${mode === 'dark' ? '#151517' : '#ffffff'}}*{box-sizing:border-box}img{max-width:100%;height:auto}${variant.css[mode]}</style><nav aria-label="${lang === 'sv' ? 'Sidval' : 'Page controls'}"><a href="/">${lang === 'sv' ? 'Till hemsidan' : 'Back to website'}</a> · <a href="${page.path}?lang=${lang === 'sv' ? 'en' : 'sv'}&amp;mode=${mode}">${lang === 'sv' ? 'English' : 'Svenska'}</a> · <a href="${page.path}?lang=${lang}&amp;mode=${mode === 'dark' ? 'light' : 'dark'}">${mode === 'dark' ? 'Light' : 'Dark'}</a></nav>${variant.html}</template></div>`,
  )
  return serialize(document)
}

function dynamicHeaders(source?: Headers): Headers {
  const headers = new Headers(source)
  for (const name of ['content-length', 'content-encoding', 'etag', 'last-modified', 'set-cookie'])
    headers.delete(name)
  headers.set('cache-control', 'no-store')
  headers.set('x-content-type-options', 'nosniff')
  return headers
}

export async function cmsPublicResponse(
  request: Request,
  env: CmsEnvironment,
  siteOrigin: string,
): Promise<Response | null> {
  const url = new URL(request.url),
    path = url.pathname.replace(/\/+$/, '')
  const api = path === '/api/cms/presentation'
  if (!api && !isPagePath(path) && path !== '/privacy' && path !== '/terms') return null
  if (request.method !== 'GET' && request.method !== 'HEAD')
    return api
      ? new Response(null, {
          status: 405,
          headers: { allow: 'GET, HEAD', 'cache-control': 'no-store' },
        })
      : null
  try {
    const value = await published(env, siteOrigin)
    if (api) {
      const headers = dynamicHeaders()
      headers.set('content-type', 'application/json; charset=utf-8')
      headers.set('x-robots-tag', 'noindex')
      return new Response(
        request.method === 'HEAD' ? null : JSON.stringify(value ?? { error: 'cms_not_configured' }),
        { status: value ? 200 : 404, headers },
      )
    }
    const page = value?.presentation.pages.find((item) => item.path === path)
    if (!page) return null
    if (url.pathname !== path) {
      url.pathname = path
      return new Response(null, {
        status: 308,
        headers: { location: url.toString(), 'cache-control': 'no-store' },
      })
    }
    const assetUrl = new URL('/index.html', request.url)
    const shell = await env.ASSETS.fetch(new Request(assetUrl, { method: 'GET' }))
    if (!shell.ok) throw new Error('CMS shell unavailable')
    const base = await shell.text()
    const faces = value ? fontFaceCss(value.presentation, env.SUPABASE_URL ?? siteOrigin) : ''
    const body = renderCmsPage(
      base.replace('</head>', `<style>${faces}</style></head>`),
      page,
      url,
      siteOrigin,
    )
    const headers = dynamicHeaders(shell.headers)
    headers.set('content-type', 'text/html; charset=utf-8')
    headers.delete('x-robots-tag')
    headers.set('x-cms-revision', String(value?.revision))
    return new Response(request.method === 'HEAD' ? null : body, { headers })
  } catch {
    const headers = dynamicHeaders()
    headers.set('x-robots-tag', 'noindex')
    headers.set('retry-after', '30')
    headers.set(
      'content-type',
      api ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
    )
    return new Response(
      request.method === 'HEAD'
        ? null
        : api
          ? '{"error":"cms_unavailable"}'
          : 'Sidans innehåll är tillfälligt otillgängligt. Försök igen.',
      { status: 503, headers },
    )
  }
}

export function cmsResponsePolicy(
  response: Response,
  pathname: string,
  storageUrl?: string,
): Response {
  if (!response.headers.get('content-type')?.includes('text/html')) return response
  const path = pathname.replace(/\/+$/, ''),
    studio = path === '/admin/cms' || path.startsWith('/admin/cms/')
  const headers = new Headers(response.headers)
  const directives = new Map(
    (
      headers.get('content-security-policy') ??
      "default-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
    )
      .split(';')
      .map((value) => value.trim())
      .filter(Boolean)
      .map((value) => {
        const [name = '', ...sources] = value.split(/\s+/)
        return [name, sources]
      }),
  )
  if (storageUrl) {
    try {
      const origin = new URL(storageUrl).origin
      if (
        origin.startsWith('https://') ||
        (new URL(origin).protocol === 'http:' &&
          ['127.0.0.1', 'localhost'].includes(new URL(origin).hostname))
      )
        directives.set('font-src', [
          ...new Set([
            ...(directives.get('font-src') ?? ["'self'"]).filter((value) => value !== "'none'"),
            origin,
          ]),
        ])
    } catch {
      /* An invalid environment value is never inserted into a CSP header. */
    }
  }
  if (studio) {
    directives.set('frame-src', [
      ...new Set([
        ...(directives.get('frame-src') ?? []).filter((value) => value !== "'none'"),
        "'self'",
      ]),
    ])
    const preview = path === '/admin/cms/preview'
    directives.set('frame-ancestors', [preview ? "'self'" : "'none'"])
    headers.set('x-frame-options', preview ? 'SAMEORIGIN' : 'DENY')
    headers.set('cache-control', 'no-store')
    headers.set('x-robots-tag', 'noindex, nofollow')
  }
  headers.set(
    'content-security-policy',
    [...directives].map(([name, sources]) => `${name} ${sources.join(' ')}`).join('; '),
  )
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

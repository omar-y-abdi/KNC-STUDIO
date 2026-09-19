import { WorkerEntrypoint } from 'cloudflare:workers'
import {
  validatePresentation,
  type CmsLang,
  type CmsMode,
  type CmsPage,
  type CmsPresentation,
} from '../shared/cms'
import { publicBusinessDiscoveryResponse } from './backend/rpcSchemas'
import { customerGateway } from './mybookings/customerGateway'
import { privatePageTitle } from './site/routeMetadata'
import {
  DEFAULT_BUSINESS,
  EMPTY_BUSINESS_FACTS,
  buildBusinessStructuredData,
  formatBusinessAddress,
  resolveBusinessSettings,
  type BusinessDiscoveryFacts,
  type BusinessSettings,
} from './site/business'

interface StaticAssets {
  fetch(input: Request | URL | string): Promise<Response>
}

interface Env {
  ASSETS: StaticAssets
  SUPABASE_URL?: string
  SUPABASE_ANON_KEY?: string
  CUSTOMER_GATEWAY_SECRET?: string
}

interface WorkerContext {
  readonly exports: {
    readonly PublicContent: {
      fetch(request: Request): Promise<Response>
    }
  }
}

const CANONICAL_HOST = 'bladeblendstudio.se'
const WWW_HOST = `www.${CANONICAL_HOST}`
const SITE_URL = `https://${CANONICAL_HOST}`

const PUBLIC_FILE_ALIASES: Readonly<Record<string, string>> = {
  '/privacy': '/privacy.html',
  '/terms': '/terms.html',
  '/google-calendar': '/google-calendar.html',
}

function withoutTrailingSlash(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
}

export function customerAccessTokenFromPath(pathname: string): string | null {
  return withoutTrailingSlash(pathname).match(/^\/([0-9a-f]{64})$/i)?.[1] ?? null
}

export function isPrivatePath(pathname: string): boolean {
  const path = withoutTrailingSlash(pathname)
  return (
    path === '/login' ||
    path === '/reset' ||
    path === '/invite' ||
    path === '/auth/confirm' ||
    path === '/admin' ||
    path.startsWith('/admin/')
  )
}

export function isSpaPath(pathname: string): boolean {
  const path = withoutTrailingSlash(pathname)
  return path === '/' || isPrivatePath(path)
}

function isNoIndexPath(pathname: string): boolean {
  return isPrivatePath(pathname) || withoutTrailingSlash(pathname) === '/google-calendar'
}

function withNoIndex(response: Response): Response {
  const headers = new Headers(response.headers)
  headers.set('X-Robots-Tag', 'noindex, nofollow')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function redirectTo(url: URL, pathname: string): Response {
  url.pathname = pathname
  return new Response(null, { status: 308, headers: { Location: url.toString() } })
}

function assetRequest(request: Request, pathname: string, dynamic = false): Request {
  const url = new URL(request.url)
  url.pathname = pathname
  const asset = new Request(url, request)
  if (dynamic) {
    asset.headers.delete('If-Modified-Since')
    asset.headers.delete('If-None-Match')
  }
  return asset
}

async function serveAsset(
  request: Request,
  env: Env,
  pathname: string,
  dynamic = false,
): Promise<Response> {
  return env.ASSETS.fetch(assetRequest(request, pathname, dynamic))
}

export interface BusinessDiscovery {
  readonly business: BusinessSettings
  readonly facts: BusinessDiscoveryFacts
}

interface PublicCmsPresentation {
  readonly revision: number
  readonly presentation: CmsPresentation
}

function publicCmsFromWire(value: unknown): PublicCmsPresentation | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const wire = value as Record<string, unknown>
  if (typeof wire['revision'] !== 'number' || !Number.isSafeInteger(wire['revision'])) return null
  const presentation = structuredClone(wire['presentation'])
  try {
    validatePresentation(presentation)
  } catch {
    return null
  }
  return { revision: wire['revision'], presentation }
}

async function loadPublicCms(env: Env): Promise<PublicCmsPresentation | null> {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return null
  try {
    const response = await fetch(
      `${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/public_cms_presentation`,
      {
        method: 'POST',
        headers: {
          apikey: env.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
        signal: AbortSignal.timeout(1800),
      },
    )
    if (!response.ok) return null
    return publicCmsFromWire(await response.json())
  } catch {
    return null
  }
}

function discoveryFromWire(value: unknown): BusinessDiscovery | null {
  const parsed = publicBusinessDiscoveryResponse.safeParse(value)
  if (!parsed.success) return null
  return {
    business: resolveBusinessSettings(new Map(Object.entries(parsed.data.settings))),
    facts: {
      barbers: parsed.data.barbers,
      services: parsed.data.services.map((service) => ({
        id: service.id,
        barberId: service.barber_id,
        price: service.price,
      })),
      schedules: parsed.data.schedules.map((schedule) => ({
        barberId: schedule.barber_id,
        weekday: schedule.weekday,
        startMin: schedule.start_min,
        endMin: schedule.end_min,
      })),
    },
  }
}

async function loadDiscovery(env: Env): Promise<BusinessDiscovery | null> {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) return null
  try {
    const response = await fetch(
      `${env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/public_business_discovery`,
      {
        method: 'POST',
        headers: {
          apikey: env.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
        signal: AbortSignal.timeout(1800),
      },
    )
    if (!response.ok) return null
    return discoveryFromWire(await response.json())
  } catch {
    return null
  }
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

function escapeElementText(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function tagBounds(
  html: string,
  id: string,
): { readonly start: number; readonly end: number } | null {
  const markerIndex = html.indexOf(`id="${id}"`)
  if (markerIndex < 0) return null
  const start = html.lastIndexOf('<', markerIndex)
  const end = html.indexOf('>', markerIndex)
  return start >= 0 && end >= 0 ? { start, end } : null
}

function replaceElementContent(html: string, id: string, value: string): string {
  const bounds = tagBounds(html, id)
  if (bounds === null) return html
  const openingTag = html.slice(bounds.start, bounds.end + 1)
  const tag = openingTag.match(/^<([a-z0-9-]+)/i)?.[1]
  if (tag === undefined) return html
  const closingStart = html.indexOf(`</${tag}>`, bounds.end + 1)
  if (closingStart < 0) return html
  return `${html.slice(0, bounds.end + 1)}${value}${html.slice(closingStart)}`
}

function replaceElementText(html: string, id: string, value: string): string {
  return replaceElementContent(html, id, escapeElementText(value))
}

function replaceJsonScript(html: string, id: string, value: unknown): string {
  return replaceElementContent(html, id, JSON.stringify(value).replaceAll('<', '\\u003c'))
}

function replaceMetaContent(html: string, id: string, value: string): string {
  const bounds = tagBounds(html, id)
  if (bounds === null) return html
  const tag = html.slice(bounds.start, bounds.end + 1)
  const updated = tag.replace(
    /content=(['"])[\s\S]*?\1/i,
    () => `content="${escapeAttribute(value)}"`,
  )
  return `${html.slice(0, bounds.start)}${updated}${html.slice(bounds.end + 1)}`
}

function cmsFontCss(presentation: CmsPresentation, storageOrigin: string): string {
  return Object.entries(presentation.fonts ?? {})
    .map(([id, font]) => {
      const url = `${storageOrigin.replace(/\/$/, '')}/storage/v1/object/public/${font.ref.bucket}/${font.ref.path
        .split('/')
        .map(encodeURIComponent)
        .join('/')}`
      return `@font-face{font-family:"CMSFont-${id}";src:url("${url}") format("woff2");font-display:swap}`
    })
    .join('\n')
}

export function renderCmsPage(
  html: string,
  page: CmsPage,
  lang: CmsLang,
  mode: CmsMode,
  canonicalUrl: string,
  fontCss = '',
): string {
  const variant = page.content[lang]
  let rendered = html.replace(/<html\b[^>]*lang=(['"])[^'"]*\1/i, `<html lang="${lang}"`)
  rendered = replaceElementText(rendered, 'business-title', page.title[lang])
  rendered = replaceMetaContent(rendered, 'business-description', page.description[lang])
  rendered = replaceMetaContent(rendered, 'business-og-title', page.title[lang])
  rendered = replaceMetaContent(rendered, 'business-og-description', page.description[lang])
  rendered = replaceMetaContent(rendered, 'business-twitter-title', page.title[lang])
  rendered = replaceMetaContent(rendered, 'business-twitter-description', page.description[lang])
  rendered = rendered.replace(
    /(<meta\b[^>]*property="og:locale"[^>]*content=")[^"]*(")/i,
    `$1${lang === 'en' ? 'en_US' : 'sv_SE'}$2`,
  )
  rendered = rendered.replace(
    /(<meta\b[^>]*property="og:locale:alternate"[^>]*content=")[^"]*(")/i,
    `$1${lang === 'en' ? 'sv_SE' : 'en_US'}$2`,
  )
  rendered = rendered.replace(
    /(<link\b[^>]*rel="canonical"[^>]*href=")[^"]*(")/i,
    `$1${escapeAttribute(canonicalUrl)}$2`,
  )
  rendered = rendered.replace(
    '</head>',
    `<style id="cms-fonts">${fontCss}</style>` +
      `<style id="cms-page-light" media="(prefers-color-scheme: light)">${variant.css.light}</style>` +
      `<style id="cms-page-dark" media="(prefers-color-scheme: dark)">${variant.css.dark}</style></head>`,
  )
  rendered = replaceElementContent(rendered, 'root', variant.html)
  const bounds = tagBounds(rendered, 'root')
  if (bounds !== null) {
    const opening = rendered.slice(bounds.start, bounds.end + 1)
    const marked = opening.replace(
      /\s*>$/,
      ` data-cms-public="1" data-cms-mode="${mode}" data-cms-page-id="${escapeAttribute(page.id)}">`,
    )
    rendered = `${rendered.slice(0, bounds.start)}${marked}${rendered.slice(bounds.end + 1)}`
  }
  return rendered
}

export function renderHomepageMetadata(html: string, discovery: BusinessDiscovery): string {
  const { business, facts } = discovery
  const seo = business.seo.sv
  const structured = buildBusinessStructuredData(business, facts, SITE_URL)
  let rendered = replaceElementText(html, 'business-title', seo.title)
  rendered = replaceMetaContent(rendered, 'business-description', seo.description)
  rendered = replaceMetaContent(rendered, 'business-og-site-name', business.name)
  rendered = replaceMetaContent(rendered, 'business-og-title', seo.title)
  rendered = replaceMetaContent(rendered, 'business-og-description', seo.description)
  rendered = replaceMetaContent(rendered, 'business-og-image-alt', business.name)
  rendered = replaceMetaContent(rendered, 'business-twitter-title', seo.title)
  rendered = replaceMetaContent(rendered, 'business-twitter-description', seo.description)
  rendered = replaceJsonScript(rendered, 'business-json-ld', structured)
  // Readable first response, including when scripts fail or are disabled. Preact replaces this
  // mount content on startup; business facts come from the same source as the visible shell.
  return replaceElementContent(
    rendered,
    'root',
    `<main><h1>${escapeElementText(business.name)}</h1><p>${escapeElementText(seo.description)}</p>` +
      `<p>${escapeElementText(formatBusinessAddress(business))}</p>` +
      `<p><a href="mailto:${escapeAttribute(business.email)}">${escapeElementText(business.email)}</a></p>` +
      '<p>Aktivera JavaScript för att välja behandling och boka tid online.</p>' +
      '<nav aria-label="Information"><a href="/privacy">Integritet och cookies</a> · <a href="/terms">Bokningsvillkor</a></nav></main>',
  )
}

export function renderPrivateMetadata(html: string, pathname: string): string {
  const title = privatePageTitle(pathname)
  if (title === null) return html
  let rendered = replaceElementText(html, 'business-title', title)
  for (const id of ['business-og-title', 'business-twitter-title']) {
    rendered = replaceMetaContent(rendered, id, title)
  }
  for (const id of ['business-og-description', 'business-twitter-description']) {
    rendered = replaceMetaContent(
      rendered,
      id,
      'Inloggning och administration för salongens personal.',
    )
  }
  const route = pathname.startsWith('/admin') ? '/admin' : withoutTrailingSlash(pathname)
  rendered = rendered.replace(
    /(<meta\b[^>]*property="og:url"[^>]*content=")[^"]*(")/i,
    `$1${SITE_URL}${route}$2`,
  )
  rendered = replaceMetaContent(
    rendered,
    'business-description',
    'Inloggning och administration för salongens personal.',
  )
  rendered = rendered
    .replace(/<link\b[^>]*rel="canonical"[^>]*>/i, '')
    .replace(/(<meta\b[^>]*name="robots"[^>]*content=")[^"]*(")/i, '$1noindex, nofollow$2')
  return rendered
}

/** Legal pages are rendered from the same owner CMS as the booking UI, without a cached identity. */
export function renderLegalMetadata(
  html: string,
  pathname: '/terms' | '/privacy',
  business: BusinessSettings | null,
): string {
  if (business === null) return html
  const title = `${pathname === '/terms' ? 'Bokningsvillkor' : 'Integritet och cookies'} — ${business.name}`
  let rendered = replaceElementText(html, 'legal-title', title)
  rendered = replaceMetaContent(rendered, 'legal-og-title', title)
  rendered = replaceMetaContent(rendered, 'legal-image-alt', business.name)
  rendered = replaceMetaContent(
    rendered,
    'legal-description',
    pathname === '/terms'
      ? `Bokning, priser, avbokning och kontakt hos ${business.name}.`
      : `Så hanterar ${business.name} bokningsuppgifter, cookies, e-post och kalenderkoppling.`,
  )
  rendered = rendered.replaceAll(
    /<span data-business-name\s*>[^<]*<\/span\s*>/g,
    () => `<span data-business-name>${escapeElementText(business.name)}</span>`,
  )
  rendered = rendered.replaceAll(
    /<span data-business-controller="(sv|en)"\s*>[^<]*<\/span\s*>/g,
    (_match, lang: string) =>
      `<span data-business-controller="${lang}">${escapeElementText(business.legalName || business.name)}</span>`,
  )
  const contact =
    business.email === ''
      ? '<a href="/">Kontakt / Contact</a>'
      : `<a href="mailto:${escapeAttribute(business.email)}">${escapeElementText(business.email)}</a>`
  rendered = rendered.replaceAll(
    /<span data-business-contact\s*>[\s\S]*?<\/span\s*>/g,
    () => `<span data-business-contact>${contact}</span>`,
  )
  for (const lang of ['sv', 'en'] as const) {
    const rows: readonly (readonly [string, string])[] = [
      [lang === 'sv' ? 'Salong' : 'Salon', business.name],
      [lang === 'sv' ? 'Juridiskt företagsnamn' : 'Legal business name', business.legalName],
      [lang === 'sv' ? 'Organisationsnummer' : 'Registration number', business.organizationNumber],
      [lang === 'sv' ? 'Adress' : 'Address', formatBusinessAddress(business)],
      [lang === 'sv' ? 'E-post' : 'Email', business.email],
      [lang === 'sv' ? 'Telefon' : 'Phone', business.phoneDisplay],
    ]
    const details = rows
      .filter(([, value]) => value !== '')
      .map(
        ([label, value]) =>
          `<dt>${escapeElementText(label)}</dt><dd>${escapeElementText(value)}</dd>`,
      )
      .join('')
    rendered = replaceElementContent(
      rendered,
      `legal-business-details-${lang}`,
      `<dl>${details}</dl>`,
    )
    rendered = replaceElementText(
      rendered,
      `cancellation-policy-${lang}`,
      lang === 'sv'
        ? `Avboka senast ${business.cancellationPolicyHours} timmar före den bokade tiden.`
        : `Cancel at least ${business.cancellationPolicyHours} hours before your appointment.`,
    )
  }
  return rendered
}

function priceRange(facts: BusinessDiscoveryFacts): string | null {
  const prices = facts.services.map((service) => service.price)
  if (prices.length === 0) return null
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  return min === max ? `${min} kr` : `${min}–${max} kr`
}

export function renderLlmsText(discovery: BusinessDiscovery): string {
  const { business, facts } = discovery
  const lines = [
    `# ${business.name}`,
    '',
    `> Public online appointment booking for a barbershop in ${business.city}, Sweden.`,
    '',
    `${business.name} lets visitors choose a barber, service, day, and time and book online. The public site supports Swedish and English.`,
    '',
    '## Current business information',
    `- Address: ${formatBusinessAddress(business)}, Sweden`,
    `- Barbers: ${facts.barbers.map((barber) => barber.name).join(', ') || 'See booking page'}`,
  ]
  if (business.phoneDisplay !== '') lines.splice(8, 0, `- Phone: ${business.phoneDisplay}`)
  const prices = priceRange(facts)
  if (prices !== null) lines.push(`- Active service price range: ${prices} SEK`)
  lines.push(
    '',
    '## Pages',
    `- [${business.name}](${SITE_URL}/): Home and online booking`,
    `- [Privacy Policy](${SITE_URL}/privacy): Data handling and Google Calendar disclosure`,
    `- [Booking terms](${SITE_URL}/terms): Booking, cancellation and contact`,
    '',
  )
  return lines.join('\n')
}

export function cmsFrameResponse(response: Response, source: boolean): Response {
  const headers = new Headers(response.headers)
  const current =
    headers.get('Content-Security-Policy') ??
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'"
  const parts = current
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .filter(
      (part) => !part.startsWith('frame-src ') && !(source && part.startsWith('frame-ancestors ')),
    )
  parts.push("frame-src 'self' https://challenges.cloudflare.com")
  if (source) parts.push("frame-ancestors 'self'")
  headers.set('Content-Security-Policy', parts.join('; '))
  headers.set('X-Frame-Options', source ? 'SAMEORIGIN' : 'DENY')
  headers.set('Cache-Control', 'no-store')
  headers.set('X-Robots-Tag', 'noindex, nofollow')
  return new Response(response.body, { status: response.status, headers })
}

async function fetchPublicContent(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const pathname = url.pathname
  const cleanPathname = withoutTrailingSlash(pathname)

  if (pathname === '/api/cms/presentation') {
    if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 })
    const cms = await loadPublicCms(env)
    return new Response(
      request.method === 'HEAD' ? null : JSON.stringify(cms ?? { error: 'unavailable' }),
      {
        status: cms ? 200 : 503,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      },
    )
  }
  if (pathname === '/cms-public/source' && ['GET', 'HEAD'].includes(request.method)) {
    return cmsFrameResponse(await serveAsset(request, env, '/index.html', true), true)
  }

  if (pathname === '/404.html') {
    const missing = await serveAsset(request, env, '/404.html')
    return withNoIndex(
      new Response(request.method === 'HEAD' ? null : missing.body, {
        status: 404,
        headers: missing.headers,
      }),
    )
  }

  const customerAccessToken = customerAccessTokenFromPath(pathname)
  if (customerAccessToken !== null && (request.method === 'GET' || request.method === 'HEAD')) {
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${url.origin}/#booking_token=${customerAccessToken}`,
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    })
  }

  if (pathname === '/llms.txt' && request.method === 'GET') {
    const discovery = await loadDiscovery(env)
    if (discovery !== null) {
      return new Response(renderLlmsText(discovery), {
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'public, max-age=300',
        },
      })
    }
  }

  if (
    pathname !== cleanPathname &&
    (isSpaPath(cleanPathname) || Object.hasOwn(PUBLIC_FILE_ALIASES, cleanPathname))
  ) {
    return redirectTo(url, cleanPathname)
  }

  const canonicalPath = pathname.endsWith('.html') ? pathname.slice(0, -'.html'.length) : undefined
  if (canonicalPath !== undefined && Object.hasOwn(PUBLIC_FILE_ALIASES, canonicalPath)) {
    return redirectTo(url, canonicalPath)
  }

  if (pathname === '/index.html') return redirectTo(url, '/')

  if (
    (request.method === 'GET' || request.method === 'HEAD') &&
    !isPrivatePath(pathname) &&
    pathname !== '/google-calendar'
  ) {
    const cms = await loadPublicCms(env)
    const cmsPage = cms?.presentation.pages.find((page) => page.path === cleanPathname)
    if (cmsPage) {
      const index = await serveAsset(request, env, '/index.html', true)
      const lang: CmsLang = url.searchParams.get('lang') === 'en' ? 'en' : 'sv'
      const mode: CmsMode = url.searchParams.get('mode') === 'dark' ? 'dark' : 'light'
      const canonicalUrl = `${SITE_URL}${cmsPage.path === '/' ? '/' : cmsPage.path}`
      const discovery = request.method === 'HEAD' ? null : await loadDiscovery(env)
      const headers = new Headers(index.headers)
      headers.delete('Content-Length')
      headers.delete('ETag')
      headers.delete('Last-Modified')
      headers.set('Cache-Control', 'no-store')
      let body = renderCmsPage(
        await index.text(),
        cmsPage,
        lang,
        mode,
        canonicalUrl,
        cms ? cmsFontCss(cms.presentation, env.SUPABASE_URL ?? '') : '',
      )
      if (discovery) {
        const structured = buildBusinessStructuredData(
          discovery.business,
          discovery.facts,
          SITE_URL,
        )
        body = replaceMetaContent(body, 'business-og-site-name', discovery.business.name)
        body = replaceMetaContent(body, 'business-og-image-alt', discovery.business.name)
        body = replaceJsonScript(body, 'business-json-ld', structured)
      }
      if (cms && cmsPage.content[lang].html.includes('data-knc-native="1"')) {
        const state = JSON.stringify(cms.presentation).replaceAll('<', '\\u003c')
        body = body.replace(
          '</head>',
          `<script type="application/json" id="cms-native-state">${state}</script></head>`,
        )
      }
      if (cmsPage.path === '/privacy' || cmsPage.path === '/terms')
        body = renderLegalMetadata(body, cmsPage.path, discovery?.business ?? null)
      return new Response(request.method === 'HEAD' ? null : body, {
        status: index.status,
        headers,
      })
    }
  }

  const assetPath = pathname === '/' ? '/index.html' : (PUBLIC_FILE_ALIASES[pathname] ?? pathname)
  const dynamicHomepage = pathname === '/' && request.method === 'GET'
  const dynamicLegal =
    (pathname === '/terms' || pathname === '/privacy') &&
    (request.method === 'GET' || request.method === 'HEAD')
  const asset = await serveAsset(request, env, assetPath, dynamicHomepage || dynamicLegal)
  if (asset.status !== 404) {
    if (dynamicLegal) {
      const discovery = request.method === 'HEAD' ? null : await loadDiscovery(env)
      const headers = new Headers(asset.headers)
      headers.delete('Content-Length')
      headers.delete('ETag')
      headers.delete('Last-Modified')
      headers.set('Cache-Control', 'no-store')
      return new Response(
        request.method === 'HEAD'
          ? null
          : renderLegalMetadata(await asset.text(), pathname, discovery?.business ?? null),
        { status: asset.status, headers },
      )
    }
    if (dynamicHomepage) {
      const loadedDiscovery = await loadDiscovery(env)
      const discovery = loadedDiscovery ?? {
        business: DEFAULT_BUSINESS,
        facts: EMPTY_BUSINESS_FACTS,
      }
      const headers = new Headers(asset.headers)
      headers.delete('Content-Length')
      headers.delete('ETag')
      headers.delete('Last-Modified')
      headers.set(
        'Cache-Control',
        loadedDiscovery === null ? 'no-store' : 'public, max-age=60, s-maxage=300',
      )
      return new Response(renderHomepageMetadata(await asset.text(), discovery), {
        status: asset.status,
        statusText: asset.statusText,
        headers,
      })
    }
    return isNoIndexPath(pathname) ? withNoIndex(asset) : asset
  }

  if (request.method === 'GET' || request.method === 'HEAD') {
    if (isSpaPath(pathname)) {
      const index = await serveAsset(request, env, '/index.html')
      const headers = new Headers(index.headers)
      headers.set('Cache-Control', 'no-store')
      headers.delete('ETag')
      headers.delete('Content-Length')
      return withNoIndex(
        new Response(
          request.method === 'HEAD' ? null : renderPrivateMetadata(await index.text(), pathname),
          { status: index.status, headers },
        ),
      )
    }
    // Never turn unknown URLs into a successful homepage (soft 404).
    if (!pathname.startsWith('/api/')) {
      const missing = await serveAsset(request, env, '/404.html')
      if (missing.ok) {
        return withNoIndex(
          new Response(request.method === 'HEAD' ? null : missing.body, {
            status: 404,
            headers: missing.headers,
          }),
        )
      }
    }
  }

  return withNoIndex(asset)
}

export class PublicContent extends WorkerEntrypoint<Env> {
  override async fetch(request: Request): Promise<Response> {
    return fetchPublicContent(request, this.env)
  }
}

function isCacheablePublicContent(request: Request, url: URL): boolean {
  return request.method === 'GET' && (url.pathname === '/' || url.pathname === '/llms.txt')
}

export default {
  async fetch(request: Request, env: Env, context: WorkerContext): Promise<Response> {
    const url = new URL(request.url)

    if (url.hostname === WWW_HOST) {
      url.hostname = CANONICAL_HOST
      return new Response(null, { status: 308, headers: { Location: url.toString() } })
    }

    if (url.pathname === '/api/customer-bookings') return customerGateway(request, env)
    if (url.pathname === '/api/bookings') return customerGateway(request, env, 'submit-booking')

    if (url.hostname === CANONICAL_HOST && isCacheablePublicContent(request, url)) {
      return context.exports.PublicContent.fetch(request)
    }

    const response = await fetchPublicContent(request, env)
    return /^\/admin\/cms(?:\/|$)/.test(url.pathname) ? cmsFrameResponse(response, false) : response
  },
} satisfies { fetch(request: Request, env: Env, context: WorkerContext): Promise<Response> }

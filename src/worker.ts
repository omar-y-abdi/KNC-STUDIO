import { publicBusinessDiscoveryResponse } from './backend/rpcSchemas'
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
}

const CANONICAL_HOST = 'bladeblendstudio.se'
const WWW_HOST = `www.${CANONICAL_HOST}`
const SITE_URL = `https://${CANONICAL_HOST}`

const PUBLIC_FILE_ALIASES: Readonly<Record<string, string>> = {
  '/privacy': '/privacy.html',
  '/google-calendar': '/google-calendar.html',
}

function withoutTrailingSlash(pathname: string): string {
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
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
  const updated = tag.replace(/content=(['"])[\s\S]*?\1/i, `content="${escapeAttribute(value)}"`)
  return `${html.slice(0, bounds.start)}${updated}${html.slice(bounds.end + 1)}`
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
  return replaceJsonScript(rendered, 'business-json-ld', structured)
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
  if (business.phoneDisplay !== '') lines.splice(5, 0, `- Phone: ${business.phoneDisplay}`)
  const prices = priceRange(facts)
  if (prices !== null) lines.push(`- Active service price range: ${prices} SEK`)
  lines.push(
    '',
    '## Pages',
    `- [${business.name}](${SITE_URL}/): Home and online booking`,
    `- [Privacy Policy](${SITE_URL}/privacy): Data handling and Google Calendar disclosure`,
    `- [ACP discovery](${SITE_URL}/.well-known/acp.json): Agentic Commerce Protocol metadata`,
    '',
  )
  return lines.join('\n')
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const pathname = url.pathname
    const cleanPathname = withoutTrailingSlash(pathname)

    if (url.hostname === WWW_HOST) {
      url.hostname = CANONICAL_HOST
      return new Response(null, { status: 308, headers: { Location: url.toString() } })
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

    const canonicalPath = pathname.endsWith('.html')
      ? pathname.slice(0, -'.html'.length)
      : undefined
    if (canonicalPath !== undefined && Object.hasOwn(PUBLIC_FILE_ALIASES, canonicalPath)) {
      return redirectTo(url, canonicalPath)
    }

    const assetPath = pathname === '/' ? '/index.html' : (PUBLIC_FILE_ALIASES[pathname] ?? pathname)
    const dynamicHomepage = pathname === '/' && request.method === 'GET'
    const asset = await serveAsset(request, env, assetPath, dynamicHomepage)
    if (asset.status !== 404) {
      if (dynamicHomepage) {
        const discovery = (await loadDiscovery(env)) ?? {
          business: DEFAULT_BUSINESS,
          facts: EMPTY_BUSINESS_FACTS,
        }
        const headers = new Headers(asset.headers)
        headers.delete('Content-Length')
        headers.delete('ETag')
        headers.delete('Last-Modified')
        headers.set('Cache-Control', 'no-cache')
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
        return isNoIndexPath(pathname) ? withNoIndex(index) : index
      }
    }

    return withNoIndex(asset)
  },
} satisfies { fetch(request: Request, env: Env): Promise<Response> }

interface StaticAssets {
  fetch(input: Request | URL | string): Promise<Response>
}

interface Env {
  ASSETS: StaticAssets
}

const CANONICAL_HOST = 'bladeblendstudio.se'
const WWW_HOST = `www.${CANONICAL_HOST}`

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

function assetRequest(request: Request, pathname: string): Request {
  const url = new URL(request.url)
  url.pathname = pathname
  return new Request(url, request)
}

async function serveAsset(request: Request, env: Env, pathname: string): Promise<Response> {
  return env.ASSETS.fetch(assetRequest(request, pathname))
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

    const assetPath = PUBLIC_FILE_ALIASES[pathname] ?? pathname
    const asset = await serveAsset(request, env, assetPath)
    if (asset.status !== 404) return isNoIndexPath(pathname) ? withNoIndex(asset) : asset

    if (request.method === 'GET' || request.method === 'HEAD') {
      if (isSpaPath(pathname)) {
        const index = await serveAsset(request, env, '/index.html')
        return isNoIndexPath(pathname) ? withNoIndex(index) : index
      }
    }

    return withNoIndex(asset)
  },
} satisfies { fetch(request: Request, env: Env): Promise<Response> }

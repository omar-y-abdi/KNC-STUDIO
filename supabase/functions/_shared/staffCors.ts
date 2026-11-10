// CORS for the functions the admin panel invokes from another origin. This module imports nothing, so
// every staff function can use it: the calendar-* functions deploy without an import map.

const STAFF_ORIGINS = ['https://bladeblendstudio.se', 'https://www.bladeblendstudio.se']

/**
 * Every response of `handler`, preflight and errors included, names the caller's Origin only when the
 * panel is served there: production, an origin in `configured` (CMS_ALLOWED_ORIGINS, the list
 * cms-studio accepts) or loopback http in development. A browser on any other origin gets no
 * Access-Control-Allow-Origin and refuses the answer; a caller without an Origin is not a browser.
 */
export function staffCors(
  configured: string | undefined,
  handler: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
  const origins = [
    ...STAFF_ORIGINS,
    ...(configured ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  ]
  return async (req) => {
    const response = await handler(req)
    const origin = req.headers.get('origin')
    const headers = new Headers(response.headers)
    headers.delete('Access-Control-Allow-Origin')
    if (
      origin !== null &&
      (origins.includes(origin) || /^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/.test(origin))
    )
      headers.set('Access-Control-Allow-Origin', origin)
    headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
    headers.set(
      'Access-Control-Allow-Headers',
      'authorization, x-client-info, apikey, content-type',
    )
    headers.append('Vary', 'Origin')
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  }
}

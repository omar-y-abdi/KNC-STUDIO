// Imports nothing on purpose: the calendar-* functions that use it deploy without an import map.

const STAFF_ORIGINS = ['https://bladeblendstudio.se', 'https://www.bladeblendstudio.se']

/** Every response, preflight and errors included, names the caller's Origin only for the panel's
 * origins: production, `configured` (CMS_ALLOWED_ORIGINS, as cms-studio) or loopback http. */
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

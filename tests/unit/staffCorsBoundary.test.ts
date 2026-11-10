import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({}) }))
vi.mock('@imagemagick/magick-wasm', () => ({ initializeImageMagick: vi.fn() }))
vi.mock('../../supabase/functions/upload-image/processImage', () => ({
  processImage: vi.fn(),
  ImageValidationError: class extends Error {},
}))

type Handler = (request: Request) => Promise<Response>

// Deno entrypoints have a separate type-check gate; this exercises their HTTP boundary in Node.
const ENTRYPOINTS: Readonly<Record<string, () => Promise<unknown>>> = {
  'admin-create-barber': () =>
    vi.importActual('../../supabase/functions/admin-create-barber/index.ts'),
  'admin-manage-barber': () =>
    vi.importActual('../../supabase/functions/admin-manage-barber/index.ts'),
  'calendar-disconnect': () =>
    vi.importActual('../../supabase/functions/calendar-disconnect/index.ts'),
  'calendar-oauth-start': () =>
    vi.importActual('../../supabase/functions/calendar-oauth-start/index.ts'),
  'redeem-staff-invite': () =>
    vi.importActual('../../supabase/functions/redeem-staff-invite/index.ts'),
  'send-email-change': () => vi.importActual('../../supabase/functions/send-email-change/index.ts'),
  'send-recovery-email': () =>
    vi.importActual('../../supabase/functions/send-recovery-email/index.ts'),
  'upload-image': () => vi.importActual('../../supabase/functions/upload-image/index.ts'),
}

const METHODS = 'POST, OPTIONS'
const HEADERS = 'authorization, x-client-info, apikey, content-type'
/** Where the staff panel is served: production, the configured extra origin, local development. */
const PANEL_ORIGINS = [
  'https://bladeblendstudio.se',
  'https://www.bladeblendstudio.se',
  'https://127.0.0.1:4197',
  'http://localhost:5173',
  'http://127.0.0.1:4173',
]

describe.each(Object.keys(ENTRYPOINTS))('%s answers browsers by origin', (name) => {
  let handler: Handler
  beforeEach(async () => {
    vi.resetModules()
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('Unexpected network request')
      }),
    )
    vi.stubGlobal('Deno', {
      env: {
        get: (key: string) =>
          key === 'CMS_ALLOWED_ORIGINS' ? 'https://127.0.0.1:4197' : undefined,
      },
      serve: (callback: Handler) => {
        handler = callback
      },
    })
    await ENTRYPOINTS[name]?.()
  })
  afterEach(() => vi.unstubAllGlobals())

  const send = (method: string, origin: string | null): Promise<Response> =>
    handler(
      new Request(`https://edge.example.test/${name}`, {
        method,
        headers: origin === null ? {} : { origin },
      }),
    )

  it.each(PANEL_ORIGINS)('lets the panel on %s read the preflight and an error', async (origin) => {
    const preflight = await send('OPTIONS', origin)
    expect(preflight.status).toBe(200)
    const refused = await send('GET', origin)
    expect(refused.status).toBe(405)
    expect(await refused.json()).toEqual({ ok: false, error: 'method_not_allowed' })
    for (const response of [preflight, refused]) {
      expect(response.headers.get('access-control-allow-origin')).toBe(origin)
      expect(response.headers.get('access-control-allow-methods')).toBe(METHODS)
      expect(response.headers.get('access-control-allow-headers')).toBe(HEADERS)
      expect(response.headers.get('vary')).toBe('Origin')
    }
  })

  it.each(['https://attacker.example', 'https://bladeblendstudio.se.attacker.example', 'null'])(
    'names no origin for a page on %s',
    async (origin) => {
      for (const method of ['OPTIONS', 'GET']) {
        const response = await send(method, origin)
        expect(response.status).toBe(method === 'OPTIONS' ? 200 : 405)
        expect(response.headers.has('access-control-allow-origin')).toBe(false)
        expect(response.headers.get('vary')).toBe('Origin')
      }
    },
  )

  it('answers a caller without an Origin as before, with no origin named', async () => {
    const refused = await send('GET', null)
    expect(refused.status).toBe(405)
    expect(await refused.json()).toEqual({ ok: false, error: 'method_not_allowed' })
    expect(refused.headers.has('access-control-allow-origin')).toBe(false)
    expect((await send('OPTIONS', null)).status).toBe(200)
  })
})

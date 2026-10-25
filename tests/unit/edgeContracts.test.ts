import type * as TurnstileModule from '../../supabase/functions/_shared/turnstile'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { corsHeaders, corsJson, json, parse, uuid } from '../../supabase/functions/_shared/http.ts'
import { z } from 'zod'

const FUNCTIONS = 'supabase/functions'
const ESM_SUPABASE = 'https://esm.sh/@supabase/supabase-js@2.112.2'

function sources(dir: string): string[] {
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((file) => file.endsWith('.ts'))
    .map((file) => join(dir, file))
}

/** Files a module imports through relative specifiers, followed to the end. */
function reach(entry: string, seen = new Set<string>()): Set<string> {
  if (seen.has(entry)) return seen
  seen.add(entry)
  const text = readFileSync(entry, 'utf8')
  for (const [, specifier] of text.matchAll(/from\s+'(\.[^']+)'/g)) {
    reach(normalize(join(dirname(entry), specifier as string)), seen)
  }
  return seen
}

describe('shared http helpers', () => {
  it('json sets the content type and merges extra headers', async () => {
    const response = json({ ok: true }, 201, { 'Cache-Control': 'no-store' })
    expect(response.status).toBe(201)
    expect(response.headers.get('content-type')).toBe('application/json')
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ ok: true })
  })

  it('json answers 200 and no CORS by default', () => {
    const response = json({})
    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })

  it('corsJson adds the open CORS headers', () => {
    const response = corsJson({}, 400)
    expect(response.status).toBe(400)
    for (const [name, value] of Object.entries(corsHeaders)) {
      expect(response.headers.get(name)).toBe(value)
    }
  })

  it('uuid accepts database identities only', () => {
    expect(uuid.safeParse('0f8fad5b-d9cb-469f-a165-70867728950e').success).toBe(true)
    expect(uuid.safeParse('0F8FAD5B-D9CB-469F-A165-70867728950E').success).toBe(true)
    expect(uuid.safeParse('not-a-uuid').success).toBe(false)
    expect(uuid.safeParse(7).success).toBe(false)
  })

  it('parse reports an unknown key before a field error', () => {
    const schema = z.object({ a: z.string({ message: 'a is required' }) }).strict()
    const result = parse(schema, { b: 1 })
    expect(result.ok).toBe(false)
    expect(!result.ok && result.detail).toContain('b')
    expect(parse(schema, {})).toEqual({ ok: false, detail: 'a is required' })
    expect(parse(schema, { a: 'x' })).toEqual({ ok: true, data: { a: 'x' } })
  })
})

describe('edge import map', () => {
  const read = (path: string) =>
    (JSON.parse(readFileSync(path, 'utf8')) as { imports: Record<string, string> }).imports

  // The local runtime hands a shared fallback map to the worker without resolving bare specifiers,
  // so every function that imports them owns its deno.json.
  const functions = readdirSync(FUNCTIONS, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
    .map((entry) => entry.name)
    .filter((name) => !name.startsWith('calendar-'))

  it('gives every function outside the Calendar set its own deno.json', () => {
    expect(functions.length).toBeGreaterThan(0)
    for (const name of functions) {
      expect(existsSync(`${FUNCTIONS}/${name}/deno.json`), name).toBe(true)
    }
  })

  it('pins supabase-js and zod to the same targets in every deno.json', () => {
    for (const name of functions) {
      const imports = read(`${FUNCTIONS}/${name}/deno.json`)
      expect(imports['@supabase/supabase-js'], name).toBe(ESM_SUPABASE)
      expect(imports['zod'], name).toBe('npm:zod@3.25.76')
    }
  })

  it('has no shared fallback map that the runtime would not resolve', () => {
    expect(existsSync(`${FUNCTIONS}/import_map.json`)).toBe(false)
  })

  it('leaves no direct esm.sh import outside the Calendar functions', () => {
    const offenders = sources(FUNCTIONS)
      .filter((file) => !/calendar/.test(file))
      .filter((file) => readFileSync(file, 'utf8').includes('https://esm.sh/'))
    expect(offenders).toEqual([])
  })
})

describe('edge bundles', () => {
  it('only cms-studio reaches shared/cms.ts', () => {
    const entries = readdirSync(FUNCTIONS, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
      .map((entry) => join(FUNCTIONS, entry.name, 'index.ts'))
    const reaching = entries.filter((entry) => [...reach(entry)].includes('shared/cms.ts'))
    expect(reaching).toEqual([join(FUNCTIONS, 'cms-studio', 'index.ts')])
  })
})

const gateway = vi.hoisted(() => ({ verify: vi.fn(), challenge: vi.fn(), rpc: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc: gateway.rpc }) }))
vi.mock('../../supabase/functions/_shared/customerGatewayAuth', () => ({
  verifyCustomerGateway: gateway.verify,
}))
vi.mock('../../supabase/functions/_shared/turnstile', async (original) => ({
  ...(await original<typeof TurnstileModule>()),
  verifyTurnstile: gateway.challenge,
}))

describe('submit-booking gateway', () => {
  let handler: (request: Request) => Promise<Response>
  beforeEach(async () => {
    vi.resetModules()
    gateway.verify.mockReset().mockResolvedValue(null)
    gateway.challenge.mockReset().mockResolvedValue(true)
    gateway.rpc.mockReset()
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('Unexpected network request')
      }),
    )
    vi.stubGlobal('Deno', {
      env: { get: () => 'unit-config' },
      serve: (callback: typeof handler) => {
        handler = callback
      },
    })
    await vi.importActual('../../supabase/functions/submit-booking/index.ts')
  })
  afterEach(() => vi.unstubAllGlobals())

  it('rejects an unsigned malformed body before parsing it and exposes no CORS path', async () => {
    const response = await handler(
      new Request('https://edge.example.test/submit-booking', { method: 'POST', body: '{' }),
    )
    expect(response.status).toBe(403)
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'origin_not_allowed' })
    expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull()
    expect(gateway.verify).toHaveBeenCalledWith(expect.any(Request), 'unit-config', '{')
    const preflight = await handler(
      new Request('https://edge.example.test/submit-booking', { method: 'OPTIONS' }),
    )
    expect(preflight.status).toBe(405)
    expect(preflight.headers.get('Access-Control-Allow-Origin')).toBeNull()
    expect(gateway.rpc).not.toHaveBeenCalled()
  })

  it('reports invalid JSON after successful signature verification', async () => {
    gateway.verify.mockResolvedValue('203.0.113.9')
    const response = await handler(
      new Request('https://edge.example.test/submit-booking', { method: 'POST', body: '{' }),
    )
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'invalid_json' })
    expect(gateway.rpc).not.toHaveBeenCalled()
  })

  it.each([false, true])(
    'issues a receipt only when the successful signed booking requests it (remember=%s)',
    async (remember) => {
      gateway.verify.mockResolvedValue('203.0.113.9')
      const id = '54000000-0000-4000-8000-000000000001'
      gateway.rpc
        .mockResolvedValueOnce({ data: { ok: true, booking: { id } }, error: null })
        .mockResolvedValueOnce({ data: { existing: false, max_age: 3600 }, error: null })
      const response = await handler(
        new Request('https://edge.example.test/submit-booking', {
          method: 'POST',
          body: JSON.stringify({
            booking: {
              barberId: 'owner',
              serviceId: id,
              startAt: '2040-03-18T10:00:00+01:00',
              phone: '0701234567',
              email: 'customer@example.test',
              lang: 'sv',
              customerName: 'Customer',
            },
            turnstileToken: 'challenge',
            rememberBookings: remember,
          }),
        }),
      )
      expect(response.status).toBe(200)
      expect(gateway.rpc).toHaveBeenNthCalledWith(
        1,
        'create_booking_with_limits',
        expect.objectContaining({ p_service_id: id }),
      )
      expect(gateway.rpc).toHaveBeenCalledTimes(remember ? 2 : 1)
      if (remember) {
        expect(gateway.rpc).toHaveBeenNthCalledWith(2, 'append_customer_booking_receipt', {
          p_booking_id: id,
          p_existing_hash: null,
          p_new_hash: expect.stringMatching(/^[a-f0-9]{64}$/),
          p_session_hash: null,
        })
        expect(response.headers.get('Set-Cookie')).toMatch(
          /^__Host-bladeblend_booking_receipts=[a-f0-9]{64}; Path=\/; Max-Age=3600; HttpOnly; Secure; SameSite=None$/,
        )
        await expect(response.json()).resolves.toMatchObject({
          ok: true,
          receipt_proof: expect.stringMatching(/^[a-f0-9]{64}$/),
        })
      } else {
        expect(response.headers.get('Set-Cookie')).toBeNull()
        await expect(response.json()).resolves.toEqual({ ok: true, booking: { id } })
      }
      expect(fetch).not.toHaveBeenCalled()
    },
  )
})

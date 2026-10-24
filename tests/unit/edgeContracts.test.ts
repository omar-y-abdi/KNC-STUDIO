import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'
import { describe, expect, it } from 'vitest'
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

  it('pins supabase-js and zod once per map, to the same targets', () => {
    const maps = [
      read(`${FUNCTIONS}/import_map.json`),
      read(`${FUNCTIONS}/cms-studio/deno.json`),
      read(`${FUNCTIONS}/upload-image/deno.json`),
    ]
    for (const imports of maps) {
      expect(imports['@supabase/supabase-js']).toBe(ESM_SUPABASE)
      expect(imports['zod']).toBe('npm:zod@3.25.76')
    }
  })

  it('leaves no direct esm.sh import outside the Calendar functions', () => {
    const offenders = sources(FUNCTIONS)
      .filter((file) => !/calendar/.test(file))
      .filter((file) => readFileSync(file, 'utf8').includes('https://esm.sh/'))
    expect(offenders).toEqual([])
  })

  it('keeps one json and one uuid pattern outside the Calendar functions', () => {
    const files = sources(FUNCTIONS).filter(
      (file) => !/calendar/.test(file) && !file.endsWith('http.ts'),
    )
    const text = files.map((file) => readFileSync(file, 'utf8')).join('\n')
    expect(text).not.toMatch(/function json\(/)
    expect(text).not.toContain('[0-9a-f]{8}')
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

describe('submit-booking gateway', () => {
  const source = readFileSync(`${FUNCTIONS}/submit-booking/index.ts`, 'utf8')

  it('has no CORS and no unsigned path', () => {
    expect(source).not.toMatch(/Access-Control|corsHeaders|OPTIONS|firstParty|cf-connecting-ip/i)
  })

  it('verifies the signature before it parses the body, and refuses with 403', () => {
    const verify = source.indexOf('verifyCustomerGateway(')
    const parseBody = source.indexOf('JSON.parse(')
    expect(verify).toBeGreaterThan(-1)
    expect(verify).toBeLessThan(parseBody)
    expect(source).toMatch(
      /if \(ip === null\) return reply\(\{ ok: false, error: 'origin_not_allowed' \}, 403\)/,
    )
  })

  it('remembers a booking for every signed request that asks for it', () => {
    expect(source).toContain('if (rememberBookings && rpc.data?.ok === true')
  })

  it('is smoke-tested through the Worker relay', () => {
    const smoke = readFileSync('tools/smoke-live.mjs', 'utf8')
    expect(smoke).not.toContain('/functions/v1/submit-booking')
    expect(smoke).toContain("'/api/bookings'")
  })
})

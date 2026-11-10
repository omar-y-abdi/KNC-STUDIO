import type * as TurnstileModule from '../../supabase/functions/_shared/turnstile'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, normalize } from 'node:path'
import {
  createSourceFile,
  isExportDeclaration,
  isImportDeclaration,
  isNamedExports,
  isNamedImports,
  isStringLiteral,
  preProcessFile,
  ScriptTarget,
} from 'typescript'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { corsHeaders, corsJson, json, parse, uuid } from '../../supabase/functions/_shared/http.ts'
import { staffCors } from '../../supabase/functions/_shared/staffCors.ts'
import { z } from 'zod'

const FUNCTIONS = 'supabase/functions'
const ESM_SUPABASE = 'https://esm.sh/@supabase/supabase-js@2.112.2'

function sources(dir: string): string[] {
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((file) => file.endsWith('.ts'))
    .map((file) => join(dir, file))
}

/** TypeScript resolves actual import specifiers, excluding comments and unrelated URL strings. */
function directEsmImports(source: string): string[] {
  return preProcessFile(source, true, true)
    .importedFiles.map(({ fileName }) => fileName)
    .filter((specifier) => {
      try {
        return new URL(specifier).hostname === 'esm.sh'
      } catch {
        return false
      }
    })
}

/** Follow local imports, validating bare specifiers against the deploying function's map. */
function reach(
  entry: string,
  seen = new Set<string>(),
  imports?: Readonly<Record<string, string>>,
): Set<string> {
  if (seen.has(entry)) return seen
  seen.add(entry)
  const { importedFiles } = preProcessFile(readFileSync(entry, 'utf8'), true, true)
  for (const { fileName: specifier } of importedFiles) {
    if (specifier.startsWith('.')) {
      reach(normalize(join(dirname(entry), specifier)), seen, imports)
    } else if (imports && !specifier.startsWith('/') && !/^[a-z][a-z\d+.-]*:/i.test(specifier)) {
      const mapped = Object.keys(imports).some(
        (key) => key === specifier || (key.endsWith('/') && specifier.startsWith(key)),
      )
      if (!mapped) throw new Error(`${entry}: unmapped bare import ${specifier}`)
    }
  }
  return seen
}

const HTTP = join(FUNCTIONS, '_shared', 'http.ts')

/** The open-CORS names `file` takes from _shared/http.ts. `*` stands for a form that names nothing
 *  and so may take them: a namespace, `export *`, a bare or a dynamic import. */
function openCorsImports(file: string, source: string): string[] {
  const fromHttp = (specifier: string): boolean =>
    specifier.startsWith('.') && normalize(join(dirname(file), specifier)) === HTTP
  const taken: string[] = []
  let declarations = 0
  for (const statement of createSourceFile(file, source, ScriptTarget.Latest).statements) {
    if (!isImportDeclaration(statement) && !isExportDeclaration(statement)) continue
    const specifier = statement.moduleSpecifier
    if (specifier === undefined || !isStringLiteral(specifier) || !fromHttp(specifier.text))
      continue
    declarations += 1
    const bindings = isImportDeclaration(statement)
      ? statement.importClause?.namedBindings
      : statement.exportClause
    if (bindings === undefined || !(isNamedImports(bindings) || isNamedExports(bindings))) {
      taken.push('*')
      continue
    }
    for (const element of bindings.elements) {
      const name = (element.propertyName ?? element.name).text
      if (name === 'corsHeaders' || name === 'corsJson') taken.push(name)
    }
  }
  const imports = preProcessFile(source, true, true).importedFiles.filter(({ fileName }) =>
    fromHttp(fileName),
  )
  if (imports.length > declarations) taken.push('*')
  return taken
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

describe('staff CORS', () => {
  const EXTRA = ' https://127.0.0.1:4197 , https://staging.example.test,'
  const METHODS = 'POST, OPTIONS'
  const HEADERS = 'authorization, x-client-info, apikey, content-type'
  const ALLOWED = [
    'https://bladeblendstudio.se',
    'https://www.bladeblendstudio.se',
    'https://127.0.0.1:4197',
    'https://staging.example.test',
    'http://localhost:5173',
    'http://127.0.0.1:4173',
  ]
  const FOREIGN = [
    'https://attacker.example',
    'https://bladeblendstudio.se.attacker.example',
    'https://admin.bladeblendstudio.se',
    'https://bladeblendstudio.se:8443',
    'http://bladeblendstudio.se',
    'https://localhost:5173',
    'http://localhost',
    'http://localhost:5173.attacker.example',
    'http://127.0.0.1:4173/',
    'http://192.168.1.20:5173',
    'null',
    '*',
  ]
  type Handler = (req: Request) => Promise<Response>
  const refusal: Handler = async () =>
    json({ ok: false, error: 'forbidden' }, 403, { 'Cache-Control': 'no-store' })
  const success: Handler = async () => json({ ok: true })
  const preflight: Handler = async () => new Response('ok')
  const call = (
    origin: string | null,
    handler: Handler = refusal,
    method = 'POST',
  ): Promise<Response> => {
    const request = new Request('https://edge.example.test/staff', {
      method,
      headers: origin === null ? {} : { origin },
    })
    return staffCors(EXTRA, handler)(request)
  }

  it.each(ALLOWED)(
    'names the allowed origin %s on an error and keeps the answer',
    async (origin) => {
      const response = await call(origin)
      expect(response.status).toBe(403)
      expect(response.headers.get('access-control-allow-origin')).toBe(origin)
      expect(response.headers.get('access-control-allow-methods')).toBe(METHODS)
      expect(response.headers.get('access-control-allow-headers')).toBe(HEADERS)
      expect(response.headers.get('vary')).toBe('Origin')
      expect(response.headers.get('content-type')).toBe('application/json')
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(await response.json()).toEqual({ ok: false, error: 'forbidden' })
    },
  )

  it.each(FOREIGN)('names no origin for %s and keeps the answer', async (origin) => {
    const response = await call(origin)
    expect(response.status).toBe(403)
    expect(response.headers.has('access-control-allow-origin')).toBe(false)
    expect(response.headers.get('access-control-allow-methods')).toBe(METHODS)
    expect(response.headers.get('access-control-allow-headers')).toBe(HEADERS)
    expect(response.headers.get('vary')).toBe('Origin')
    expect(await response.json()).toEqual({ ok: false, error: 'forbidden' })
  })

  it('names no origin for a caller that sends none and keeps the answer', async () => {
    const response = await call(null, success)
    expect(response.status).toBe(200)
    expect(response.headers.has('access-control-allow-origin')).toBe(false)
    expect(response.headers.get('vary')).toBe('Origin')
    expect(await response.json()).toEqual({ ok: true })
  })

  it('answers a preflight and a success with the headers of an error', async () => {
    const origin = 'https://bladeblendstudio.se'
    const cors = (response: Response): (string | null)[] =>
      [
        'access-control-allow-origin',
        'access-control-allow-methods',
        'access-control-allow-headers',
        'vary',
      ].map((name) => response.headers.get(name))
    const failed = await call(origin, refusal)
    const options = await call(origin, preflight, 'OPTIONS')
    const succeeded = await call(origin, success)
    expect(cors(failed)).toEqual([origin, METHODS, HEADERS, 'Origin'])
    expect(cors(options)).toEqual(cors(failed))
    expect(cors(succeeded)).toEqual(cors(failed))
    expect(options.status).toBe(200)
    expect(await options.text()).toBe('ok')
    const blocked = await call('https://attacker.example', preflight, 'OPTIONS')
    expect(blocked.headers.has('access-control-allow-origin')).toBe(false)
  })

  it('replaces an origin the handler named itself and keeps its Vary', async () => {
    const open: Handler = async () =>
      json({}, 200, { 'Access-Control-Allow-Origin': '*', Vary: 'Accept' })
    const foreign = await call('https://attacker.example', open)
    expect(foreign.headers.has('access-control-allow-origin')).toBe(false)
    expect(foreign.headers.get('vary')).toBe('Accept, Origin')
    const allowed = await call('https://www.bladeblendstudio.se', open)
    expect(allowed.headers.get('access-control-allow-origin')).toBe(
      'https://www.bladeblendstudio.se',
    )
  })

  it('allows only production and loopback http when no extra origin is configured', async () => {
    const answer = (origin: string): Promise<Response> =>
      staffCors(
        undefined,
        refusal,
      )(new Request('https://edge.example.test/staff', { method: 'POST', headers: { origin } }))
    expect(
      (await answer('https://bladeblendstudio.se')).headers.get('access-control-allow-origin'),
    ).toBe('https://bladeblendstudio.se')
    expect((await answer('http://localhost:5173')).headers.get('access-control-allow-origin')).toBe(
      'http://localhost:5173',
    )
    expect(
      (await answer('https://127.0.0.1:4197')).headers.has('access-control-allow-origin'),
    ).toBe(false)
  })
})

describe('open CORS helper', () => {
  const entry = join(FUNCTIONS, 'any-function', 'index.ts')

  it.each([
    ["import { corsHeaders } from '../_shared/http.ts'", ['corsHeaders']],
    ["import { corsJson as json, parse } from '../_shared/http.ts'", ['corsJson']],
    ["export { corsHeaders, corsJson } from '../_shared/http.ts'", ['corsHeaders', 'corsJson']],
    ["import * as http from '../_shared/http.ts'", ['*']],
    ["export * from '../_shared/http.ts'", ['*']],
    ["import '../_shared/http.ts'", ['*']],
    ["const http = await import('../_shared/http.ts')", ['*']],
  ] as const)('finds the open helper in: %s', (source, names) => {
    expect(openCorsImports(entry, source)).toEqual(names)
  })

  it.each([
    "import { json, parse, uuid } from '../_shared/http.ts'",
    "import type { Parsed } from '../_shared/http.ts'",
    "import { corsHeaders } from './http.ts'",
    "import { corsHeaders } from '../_shared/staffCors.ts'",
    "// import { corsJson } from '../_shared/http.ts'",
    "const corsHeaders = { 'Access-Control-Allow-Origin': origin }",
  ])('finds none in: %s', (source) => {
    expect(openCorsImports(entry, source)).toEqual([])
  })

  it('is taken from _shared/http.ts by no function and no shared module', () => {
    const files = sources(FUNCTIONS).filter((file) => file !== HTTP)
    expect(files.length).toBeGreaterThan(0)
    const offenders = files
      .map((file) => [file, openCorsImports(file, readFileSync(file, 'utf8'))] as const)
      .filter(([, names]) => names.length > 0)
    expect(offenders).toEqual([])
  })

  it('reaches every staff function through the one dependency-free module', () => {
    const staff = join(FUNCTIONS, '_shared', 'staffCors.ts')
    expect(preProcessFile(readFileSync(staff, 'utf8'), true, true).importedFiles).toEqual([])
    for (const name of [
      'admin-create-barber',
      'admin-manage-barber',
      'calendar-disconnect',
      'calendar-oauth-start',
      'redeem-staff-invite',
      'send-email-change',
      'send-recovery-email',
      'upload-image',
    ]) {
      expect([...reach(join(FUNCTIONS, name, 'index.ts'))], name).toContain(staff)
    }
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
      expect(imports['zod'], name).toBe('npm:zod@4.6.6')
    }
  })

  it('locks the same patched Zod package in npm and the frozen Deno dependency graph', () => {
    const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
      dependencies: Record<string, string>
    }
    const npmLock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as {
      packages: Record<string, { version?: string; integrity?: string }>
    }
    const denoLock = JSON.parse(readFileSync(`${FUNCTIONS}/deno.lock`, 'utf8')) as {
      specifiers: Record<string, string>
      npm: Record<string, { integrity: string }>
      workspace: { dependencies: string[] }
    }
    expect(manifest.dependencies['zod']).toBe('4.6.6')
    expect(npmLock.packages['node_modules/zod']?.version).toBe('4.6.6')
    expect(read(`${FUNCTIONS}/deno.json`)['zod']).toBe('npm:zod@4.6.6')
    expect(denoLock.specifiers['npm:zod@4.6.6']).toBe('4.6.6')
    expect(denoLock.workspace.dependencies).toContain('npm:zod@4.6.6')
    expect(denoLock.npm['zod@4.6.6']?.integrity).toBe(
      npmLock.packages['node_modules/zod']?.integrity,
    )
  })

  it('has no shared fallback map that the runtime would not resolve', () => {
    expect(existsSync(`${FUNCTIONS}/import_map.json`)).toBe(false)
  })

  it.each([
    "import { x } from 'https://esm.sh/pkg'",
    "export { x } from 'https://ESM.SH/pkg'",
    "const x = import('https://esm.sh:443/pkg')",
    "import type { X } from 'https://esm.sh/pkg'",
    "import { x } from 'https://esm.sh'",
    "import { x } from 'https://user:password@esm.sh/pkg'",
  ])('detects a direct esm.sh import: %s', (source) => {
    expect(directEsmImports(source)).toHaveLength(1)
  })

  it.each([
    "// import { x } from 'https://esm.sh/pkg'",
    "const documentation = 'https://esm.sh/pkg'",
    "import { x } from 'https://esm.sh.example.test/pkg'",
    "import { x } from 'https://esm.sh@other.example.test/pkg'",
    "import { x } from './local.ts'",
    "import { x } from 'zod'",
  ])('does not mistake other text or hosts for esm.sh imports: %s', (source) => {
    expect(directEsmImports(source)).toEqual([])
  })

  it('leaves no direct esm.sh import outside the Calendar functions', () => {
    const offenders = sources(FUNCTIONS)
      .filter((file) => !/calendar/.test(file))
      .filter((file) => directEsmImports(readFileSync(file, 'utf8')).length > 0)
    expect(offenders).toEqual([])
  })
})

describe('edge bundles', () => {
  it('resolves every reachable bare import from the deploying function map, including shared files', () => {
    const entries = readdirSync(FUNCTIONS, { withFileTypes: true }).filter(
      (entry) => entry.isDirectory() && existsSync(join(FUNCTIONS, entry.name, 'index.ts')),
    )
    expect(entries.length).toBeGreaterThan(0)
    for (const { name } of entries) {
      const config = join(FUNCTIONS, name, 'deno.json')
      const imports = existsSync(config)
        ? (JSON.parse(readFileSync(config, 'utf8')) as { imports: Record<string, string> }).imports
        : {}
      expect(() => reach(join(FUNCTIONS, name, 'index.ts'), new Set(), imports), name).not.toThrow()
    }
  })

  it.each(['@supabase/supabase-js', 'zod', 'parse5', 'css-tree'])(
    'rejects a missing %s binding even when the CI map supplies it',
    (specifier) => {
      const imports = (
        JSON.parse(readFileSync(`${FUNCTIONS}/cms-studio/deno.json`, 'utf8')) as {
          imports: Record<string, string>
        }
      ).imports
      const incomplete = Object.fromEntries(
        Object.entries(imports).filter(([name]) => name !== specifier),
      )
      expect(() => reach(`${FUNCTIONS}/cms-studio/index.ts`, new Set(), incomplete)).toThrow(
        `unmapped bare import ${specifier}`,
      )
    },
  )

  it('only cms-studio reaches packages/content-contracts/src/cms.ts', () => {
    const entries = readdirSync(FUNCTIONS, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('_'))
      .map((entry) => join(FUNCTIONS, entry.name, 'index.ts'))
    const reaching = entries.filter((entry) =>
      [...reach(entry)].includes('packages/content-contracts/src/cms.ts'),
    )
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

  const submit = (): Promise<Response> =>
    handler(
      new Request('https://edge.example.test/submit-booking', {
        method: 'POST',
        body: JSON.stringify({
          booking: {
            barberId: 'owner',
            serviceId: '54000000-0000-4000-8000-000000000001',
            startAt: '2040-03-18T10:00:00+01:00',
            phone: '0701234567',
            email: 'customer@example.test',
            lang: 'sv',
            customerName: 'Customer',
          },
          turnstileToken: 'challenge',
          rememberBookings: false,
        }),
      }),
    )

  it('logs the code of a database failure and none of the row values in its detail', async () => {
    gateway.verify.mockResolvedValue('203.0.113.9')
    gateway.rpc.mockResolvedValueOnce({
      data: null,
      error: {
        code: '23514',
        message: 'new row for relation "bookings" violates check constraint "bookings_email_check"',
        details: 'Failing row contains (customer@example.test, 0701234567, Customer).',
        hint: '',
      },
    })
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const response = await submit()
    const calls = [...logged.mock.calls]
    logged.mockRestore()
    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ ok: false, error: 'server_error' })
    expect(calls).toEqual([['submit-booking: unhandled error:', '23514', 'object']])
  })

  it.each([
    [new Error('customer@example.test'), 'Error'],
    [new TypeError('customer@example.test'), 'TypeError'],
    [{ code: 'Customer 0701234567' }, 'object'],
    // A database code has five to eight characters; any other value is not one.
    [{ code: '0701234567' }, 'object'],
    [{ code: 'PGRST3011' }, 'object'],
    [{ code: 'P000' }, 'object'],
    [{ code: 23514 }, 'object'],
    [{ message: 'customer@example.test' }, 'object'],
    ['customer@example.test', 'string'],
    [null, 'object'],
  ] as const)(
    'logs the kind of a failure without a database code and none of its text: %j',
    async (failure, kind) => {
      gateway.verify.mockResolvedValue('203.0.113.9')
      gateway.rpc.mockRejectedValueOnce(failure)
      const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const response = await submit()
      const calls = [...logged.mock.calls]
      logged.mockRestore()
      expect(response.status).toBe(500)
      expect(calls).toEqual([['submit-booking: unhandled error:', 'unknown', kind]])
    },
  )

  it.each(['23514', 'PGRST301'])(
    'logs a database code of five to eight characters: %s',
    async (code) => {
      gateway.verify.mockResolvedValue('203.0.113.9')
      gateway.rpc.mockRejectedValueOnce({ code, message: 'customer@example.test' })
      const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      await submit()
      const calls = [...logged.mock.calls]
      logged.mockRestore()
      expect(calls).toEqual([['submit-booking: unhandled error:', code, 'object']])
    },
  )
})

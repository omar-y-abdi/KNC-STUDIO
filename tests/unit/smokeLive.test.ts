import { spawnSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { GetPage, PageHead, PageResponse } from '../../tools/smoke-live.mjs'
import {
  moduleScriptUrl,
  pageChecks,
  pageVerdict,
  requestTimeLimit,
  retryingOnce,
  runChecks,
  runVerdict,
  sitePageChecks,
  smokeChecks,
} from '../../tools/smoke-live.mjs'

const ORIGIN = 'https://bladeblendstudio.se'
const WWW = 'https://www.bladeblendstudio.se/'
const MISSING = `${ORIGIN}/live-smoke-no-such-page`
const SCRIPT = `${ORIGIN}/assets/7tnY_pk_.js`
const WWW_CHECK = 'www host (permanent redirect to the apex host)'
const SCRIPT_CHECK = 'homepage module script under /assets/ (200, not text/html)'
const NOT_HTML = 'expected status 200 with a content-type other than text/html'

const read = (text: string): PageResponse['body'] => ({ kind: 'read', text })
const unread = (reason: string): PageResponse['body'] => ({ kind: 'unread', reason })

const answer = (
  status: number,
  contentType: string | null,
  extra: Partial<PageResponse> = {},
): PageResponse => ({
  status,
  contentType,
  location: null,
  cfMitigated: null,
  body: read(''),
  ...extra,
})

// Production's head order, ending with the inline script Cloudflare appends.
const HOME_HTML = [
  '<!doctype html><html lang="sv"><head>',
  '<script id="business-json-ld" type="application/ld+json">{}</script>',
  '<script type="module" crossorigin src="/assets/7tnY_pk_.js"></script>',
  '<link rel="modulepreload" crossorigin href="/assets/3ovRssOY.js">',
  '</head><body><div id="root"></div><script>window.__CF$cv$params={}</script></body></html>',
].join('\n')

const HEALTHY: Readonly<Record<string, PageResponse>> = {
  [`${ORIGIN}/`]: answer(200, 'text/html; charset=utf-8', { body: read(HOME_HTML) }),
  [`${ORIGIN}/booking`]: answer(200, 'text/html'),
  [`${ORIGIN}/contact`]: answer(200, 'text/html'),
  [`${ORIGIN}/privacy`]: answer(200, 'text/html'),
  [`${ORIGIN}/terms`]: answer(200, 'text/html'),
  [MISSING]: answer(404, 'text/html'),
  [`${ORIGIN}/robots.txt`]: answer(200, 'text/plain'),
  [`${ORIGIN}/sitemap.xml`]: answer(200, 'application/xml'),
  [`${ORIGIN}/llms.txt`]: answer(200, 'text/plain; charset=utf-8'),
  [WWW]: answer(308, null, { location: `${ORIGIN}/` }),
  [SCRIPT]: answer(200, 'text/javascript'),
}

function fakeSite(responses: Readonly<Record<string, PageResponse>>) {
  const requested: string[] = []
  const get: GetPage = async (url) => {
    requested.push(url)
    const response = responses[url]
    return response === undefined
      ? { kind: 'unreachable', reasons: ['TypeError: fetch failed', 'TypeError: fetch failed'] }
      : { kind: 'response', response, retriedAfter: null }
  }
  return { get, requested }
}

async function run(responses: Readonly<Record<string, PageResponse>>) {
  const { get, requested } = fakeSite(responses)
  const results: { name: string; pass: boolean; detail: string }[] = []
  for (const [name, check] of sitePageChecks(ORIGIN, get))
    results.push({ name, ...(await check()) })
  return { results, requested }
}

describe('live smoke page checks', () => {
  it('asks for exactly the agreed pages, unknown path, public files and www host', () => {
    expect(pageChecks(ORIGIN).map(({ url, expect: wanted }) => ({ url, wanted }))).toEqual([
      { url: `${ORIGIN}/`, wanted: { kind: 'html' } },
      { url: `${ORIGIN}/booking`, wanted: { kind: 'html' } },
      { url: `${ORIGIN}/contact`, wanted: { kind: 'html' } },
      { url: `${ORIGIN}/privacy`, wanted: { kind: 'html' } },
      { url: `${ORIGIN}/terms`, wanted: { kind: 'html' } },
      { url: MISSING, wanted: { kind: 'status', status: 404 } },
      { url: `${ORIGIN}/robots.txt`, wanted: { kind: 'file' } },
      { url: `${ORIGIN}/sitemap.xml`, wanted: { kind: 'file' } },
      { url: `${ORIGIN}/llms.txt`, wanted: { kind: 'file' } },
      { url: WWW, wanted: { kind: 'redirect', origin: ORIGIN } },
    ])
  })

  it('passes all eleven checks against a healthy site and requests nothing else', async () => {
    const { results, requested } = await run(HEALTHY)
    expect(results.filter((result) => !result.pass)).toEqual([])
    expect(results).toHaveLength(11)
    expect([...new Set(requested)].sort()).toEqual(Object.keys(HEALTHY).sort())
  })

  it('accepts 301 as well as 308 from the www host', async () => {
    const { results } = await run({ ...HEALTHY, [WWW]: answer(301, null, { location: ORIGIN }) })
    expect(results.filter((result) => !result.pass)).toEqual([])
  })

  it('reads the media type without regard to case or parameters', async () => {
    const { results } = await run({
      ...HEALTHY,
      [`${ORIGIN}/booking`]: answer(200, 'Text/HTML; Charset=UTF-8'),
    })
    expect(results.filter((result) => !result.pass)).toEqual([])
  })

  it.each([
    {
      fault: 'a page answers 500',
      url: `${ORIGIN}/booking`,
      response: answer(500, 'text/html'),
      fails: ['page /booking (200 text/html)'],
      shows: ['status=500', 'expected status 200 with content-type text/html'],
    },
    {
      fault: 'a page is not HTML',
      url: `${ORIGIN}/contact`,
      response: answer(200, 'application/json'),
      fails: ['page /contact (200 text/html)'],
      shows: ['status=200', 'content-type=application/json'],
    },
    {
      fault: 'a page redirects instead of answering',
      url: `${ORIGIN}/privacy`,
      response: answer(308, null, { location: `${ORIGIN}/` }),
      fails: ['page /privacy (200 text/html)'],
      shows: ['status=308', `location=${ORIGIN}/`],
    },
    {
      fault: 'Cloudflare challenges the client',
      url: `${ORIGIN}/terms`,
      response: answer(403, 'text/html', { cfMitigated: 'challenge' }),
      fails: ['page /terms (200 text/html)'],
      shows: ['status=403', 'cf-mitigated=challenge'],
    },
    {
      fault: 'an unknown path answers 200',
      url: MISSING,
      response: answer(200, 'text/html'),
      fails: ['unknown path /live-smoke-no-such-page (404)'],
      shows: ['status=200', 'expected status 404'],
    },
    {
      fault: 'a public file is missing',
      url: `${ORIGIN}/sitemap.xml`,
      response: answer(404, 'text/html'),
      fails: ['file /sitemap.xml (200, not text/html)'],
      shows: ['status=404', NOT_HTML],
    },
    {
      fault: 'an HTML page answers in place of robots.txt',
      url: `${ORIGIN}/robots.txt`,
      response: answer(200, 'text/html'),
      fails: ['file /robots.txt (200, not text/html)'],
      shows: ['status=200', 'content-type=text/html', NOT_HTML],
    },
    {
      fault: 'an HTML page answers in place of sitemap.xml',
      url: `${ORIGIN}/sitemap.xml`,
      response: answer(200, 'text/html; charset=utf-8'),
      fails: ['file /sitemap.xml (200, not text/html)'],
      shows: ['status=200', 'content-type=text/html; charset=utf-8', NOT_HTML],
    },
    {
      fault: 'an HTML page answers in place of llms.txt, its media type in upper case',
      url: `${ORIGIN}/llms.txt`,
      response: answer(200, 'TEXT/HTML; Charset=UTF-8'),
      fails: ['file /llms.txt (200, not text/html)'],
      shows: ['status=200', 'content-type=TEXT/HTML; Charset=UTF-8', NOT_HTML],
    },
    {
      fault: 'the www host serves the site instead of redirecting',
      url: WWW,
      response: answer(200, 'text/html'),
      fails: [WWW_CHECK],
      shows: ['status=200', `expected status 301 or 308 with a Location on ${ORIGIN}`],
    },
    {
      fault: 'the www host redirects to another host',
      url: WWW,
      response: answer(308, null, { location: 'https://example.org/' }),
      fails: [WWW_CHECK],
      shows: ['status=308', 'location=https://example.org/'],
    },
    {
      fault: 'the www host redirects to the apex over plain http',
      url: WWW,
      response: answer(308, null, { location: 'http://bladeblendstudio.se/' }),
      fails: [WWW_CHECK],
      shows: ['status=308', 'location=http://bladeblendstudio.se/'],
    },
    {
      fault: 'the www redirect is relative, so it stays on the www host',
      url: WWW,
      response: answer(308, null, { location: '/' }),
      fails: [WWW_CHECK],
      shows: ['status=308', 'location=/'],
    },
    {
      fault: 'the www host redirects only temporarily',
      url: WWW,
      response: answer(302, null, { location: `${ORIGIN}/` }),
      fails: [WWW_CHECK],
      shows: ['status=302'],
    },
    {
      fault: 'the www redirect names no target',
      url: WWW,
      response: answer(308, null),
      fails: [WWW_CHECK],
      shows: ['status=308'],
    },
    {
      fault: 'the entry script is gone',
      url: SCRIPT,
      response: answer(404, null),
      fails: [SCRIPT_CHECK],
      shows: ['status=404', NOT_HTML],
    },
    {
      fault: 'an HTML page answers in place of the entry script',
      url: SCRIPT,
      response: answer(200, 'text/html'),
      fails: [SCRIPT_CHECK],
      shows: ['status=200', 'content-type=text/html', NOT_HTML],
    },
    {
      fault: 'the homepage names no entry script',
      url: `${ORIGIN}/`,
      response: answer(200, 'text/html', {
        body: read('<!doctype html><html><body></body></html>'),
      }),
      fails: [SCRIPT_CHECK],
      shows: ['status=200', 'names no <script type="module"> with a src under /assets/'],
    },
    {
      fault: 'the homepage body cannot be read',
      url: `${ORIGIN}/`,
      response: answer(200, 'text/html', { body: unread('TypeError: terminated') }),
      fails: [SCRIPT_CHECK],
      shows: ['status=200', 'body=unread (TypeError: terminated)', 'cannot be looked up'],
    },
    {
      fault: 'the homepage is down',
      url: `${ORIGIN}/`,
      response: answer(503, 'text/html'),
      fails: ['page / (200 text/html)', SCRIPT_CHECK],
      shows: ['status=503'],
    },
  ])(
    'fails only the affected check, naming URL and status, when $fault',
    async ({ url, response, fails, shows }) => {
      const { results } = await run({ ...HEALTHY, [url]: response })
      const failed = results.filter((result) => !result.pass)
      expect(failed.map((result) => result.name)).toEqual(fails)
      for (const { detail } of failed) {
        expect(detail).toContain(`GET ${url} -> `)
        for (const part of shows) expect(detail).toContain(part)
      }
    },
  )

  it('does not look for the entry script in a homepage that answers 503', async () => {
    const { results, requested } = await run({
      ...HEALTHY,
      [`${ORIGIN}/`]: answer(503, 'text/html', { body: read(HOME_HTML) }),
    })
    expect(results.filter((result) => !result.pass).map((result) => result.name)).toEqual([
      'page / (200 text/html)',
      SCRIPT_CHECK,
    ])
    expect(requested).not.toContain(SCRIPT)
  })

  it('fails with the URL and no status when a URL gives no HTTP response', async () => {
    const { results } = await run(
      Object.fromEntries(Object.entries(HEALTHY).filter(([url]) => url !== WWW)),
    )
    const failed = results.filter((result) => !result.pass)
    expect(failed.map((result) => result.name)).toEqual([WWW_CHECK])
    expect(failed[0]?.detail).toBe(
      `GET ${WWW} -> status=none; no HTTP response in 2 attempts ` +
        '(TypeError: fetch failed; then TypeError: fetch failed)',
    )
  })

  it('shows that a pass needed the second attempt', () => {
    const verdict = pageVerdict(
      { url: `${ORIGIN}/robots.txt`, expect: { kind: 'file' } },
      {
        kind: 'response',
        response: answer(200, 'text/plain'),
        retriedAfter: 'TimeoutError: The operation was aborted due to timeout',
      },
    )
    expect(verdict.pass).toBe(true)
    expect(verdict.detail).toContain('second attempt')
    expect(verdict.detail).toContain('TimeoutError: The operation was aborted due to timeout')
  })
})

describe('live smoke retry policy', () => {
  const url = `${ORIGIN}/robots.txt`
  const head = (status: number, text: () => Promise<string> = async () => ''): PageHead => ({
    status,
    contentType: 'text/html',
    location: null,
    cfMitigated: null,
    text,
  })

  it.each([200, 404, 500, 503])('never repeats a request that got status %i', async (status) => {
    let calls = 0
    const get = retryingOnce(async () => {
      calls += 1
      return head(status)
    })
    expect(await get(url)).toEqual({
      kind: 'response',
      response: answer(status, 'text/html'),
      retriedAfter: null,
    })
    expect(calls).toBe(1)
  })

  it.each([200, 503])(
    'keeps a status %i response whose body cannot be read and never asks again',
    async (status) => {
      let calls = 0
      const get = retryingOnce(async () => {
        calls += 1
        return head(status, async () => {
          throw new TypeError('terminated')
        })
      })
      expect(await get(url)).toEqual({
        kind: 'response',
        response: answer(status, 'text/html', { body: unread('TypeError: terminated') }),
        retriedAfter: null,
      })
      expect(calls).toBe(1)
    },
  )

  it('asks a second time after no response and reports the first failure', async () => {
    let calls = 0
    const get = retryingOnce(async () => {
      calls += 1
      if (calls === 1)
        throw new TypeError('fetch failed', {
          cause: Object.assign(new Error('getaddrinfo ENOTFOUND'), { code: 'ENOTFOUND' }),
        })
      return head(200, async () => 'User-agent: *')
    })
    expect(await get(url)).toEqual({
      kind: 'response',
      response: answer(200, 'text/html', { body: read('User-agent: *') }),
      retriedAfter: 'TypeError: fetch failed (ENOTFOUND)',
    })
    expect(calls).toBe(2)
  })

  it('stops after the second attempt without a response', async () => {
    let calls = 0
    const get = retryingOnce(async () => {
      calls += 1
      throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
    })
    const reason = 'TimeoutError: The operation was aborted due to timeout'
    expect(await get(url)).toEqual({ kind: 'unreachable', reasons: [reason, reason] })
    expect(calls).toBe(2)
  })
})

describe('live smoke time limits', () => {
  it('gives a request 10 seconds, less at the end of the 6-minute budget and nothing after it', () => {
    expect(requestTimeLimit(0)).toBe(10_000)
    expect(requestTimeLimit(350_000)).toBe(10_000)
    expect(requestTimeLimit(356_000)).toBe(4_000)
    expect(requestTimeLimit(359_999)).toBe(1)
    expect(requestTimeLimit(360_000)).toBeNull()
    expect(requestTimeLimit(400_000)).toBeNull()
  })

  it('sends every request of the script under that limit', () => {
    const script = readFileSync('tools/smoke-live.mjs', 'utf8')
    expect(script.match(/\bfetch\(/g)).toHaveLength(2)
    expect(script.match(/signal: requestSignal\(\)/g)).toHaveLength(2)
  })
})

describe('live smoke run', () => {
  const verdict = (pass: boolean) => async () => ({ pass, detail: pass ? 'fine' : 'broken' })
  async function report(checks: Parameters<typeof runChecks>[0]) {
    const lines: string[] = []
    const result = await runChecks(checks, (line) => {
      lines.push(line)
    })
    return { result, lines }
  }

  it('runs the six backend checks and then every site check', async () => {
    const { get, requested } = fakeSite(HEALTHY)
    const checks = smokeChecks(ORIGIN, get)
    expect(checks.map(([name]) => name)).toEqual([
      'database-owned catalog + available_slots',
      '/api/bookings invalid (empty body -> 400)',
      '/api/bookings invalid email (malformed -> 400)',
      '/api/bookings turnstile gate (empty token -> failed_challenge)',
      'public action gateway (empty token -> failed_challenge)',
      'direct lookup_booking RPC (anon -> 404)',
      ...sitePageChecks(ORIGIN, get).map(([name]) => name),
    ])
    // The first six are the backend checks, which send real requests.
    const { result } = await report(checks.slice(6))
    expect(result).toEqual({ total: 11, failures: 0 })
    expect([...new Set(requested)].sort()).toEqual(Object.keys(HEALTHY).sort())
  })

  it('counts one failing check as one failure and still runs the checks after it', async () => {
    const { result, lines } = await report([
      ['first', verdict(true)],
      ['second', verdict(false)],
      ['third', verdict(true)],
    ])
    expect(result).toEqual({ total: 3, failures: 1 })
    expect(lines).toEqual(['[PASS] first — fine', '[FAIL] second — broken', '[PASS] third — fine'])
  })

  it('reports a check whose request ran out of time as a failure and goes on', async () => {
    const { result, lines } = await report([
      [
        'hangs',
        async () => {
          throw new DOMException('The operation was aborted due to timeout', 'TimeoutError')
        },
      ],
      ['after', verdict(true)],
    ])
    expect(result).toEqual({ total: 2, failures: 1 })
    expect(lines).toEqual([
      '[FAIL] hangs — threw: The operation was aborted due to timeout',
      '[PASS] after — fine',
    ])
  })

  it('gives the all-green line and exit status 0 only to a run without a failure', () => {
    expect(runVerdict({ total: 17, failures: 0 })).toEqual({
      lines: ['\nResult: 17/17 passed.', 'VERDICT: ALL_GREEN'],
      exitCode: 0,
    })
    expect(runVerdict({ total: 17, failures: 1 })).toEqual({
      lines: ['\nResult: 16/17 passed.', 'VERDICT: FAIL (1 check failed)'],
      exitCode: 1,
    })
    expect(runVerdict({ total: 17, failures: 17 })).toEqual({
      lines: ['\nResult: 0/17 passed.', 'VERDICT: FAIL (17 checks failed)'],
      exitCode: 1,
    })
  })
})

describe('live smoke entry point', () => {
  const script = resolve('tools/smoke-live.mjs')
  const FATAL = 'FATAL: SUPABASE_URL, SUPABASE_ANON_KEY, and SITE_ORIGIN are required.'
  // The child gets no configuration, so it has no address to send a request to.
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SITE_ORIGIN'].includes(name),
    ),
  )
  const start = (...args: string[]) => spawnSync(process.execPath, args, { env, encoding: 'utf8' })

  it('runs when started with node, and without configuration stops before any check', () => {
    const child = start(script)
    expect(child.status).toBe(1)
    expect(child.stderr).toContain(FATAL)
    expect(child.stdout).toBe('')
  })

  it('runs the same way when started through a symbolic link', () => {
    const directory = mkdtempSync(join(tmpdir(), 'live-smoke-'))
    try {
      const link = join(directory, 'smoke-link.mjs')
      symlinkSync(script, link)
      const child = start(link)
      expect(child.status).toBe(1)
      expect(child.stderr).toContain(FATAL)
      expect(child.stdout).toBe('')
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('does nothing when imported by a process whose started path names no file', () => {
    const child = start(
      '--input-type=module',
      '--eval',
      `await import(${JSON.stringify(pathToFileURL(script).href)})`,
      'no-such-file',
    )
    expect(child.stderr).not.toContain('ENOENT')
    expect(child.stdout).toBe('')
    expect(child.status).toBe(0)
  })
})

describe('moduleScriptUrl', () => {
  const page = `${ORIGIN}/`

  it.each([
    ['the served homepage', HOME_HTML, SCRIPT],
    [
      'single quotes and upper case',
      "<SCRIPT SRC='/assets/a.js' TYPE='module'></SCRIPT>",
      `${ORIGIN}/assets/a.js`,
    ],
    [
      'unquoted attributes',
      '<script type=module src=/assets/b.js></script>',
      `${ORIGIN}/assets/b.js`,
    ],
    [
      'an absolute URL on the same origin',
      `<script type="module" src="${ORIGIN}/assets/c.js"></script>`,
      `${ORIGIN}/assets/c.js`,
    ],
    [
      'a relative URL',
      '<script type="module" src="assets/d.js"></script>',
      `${ORIGIN}/assets/d.js`,
    ],
    [
      'the first of two entries',
      '<script type="module" src="/assets/e.js"></script><script type="module" src="/assets/f.js">',
      `${ORIGIN}/assets/e.js`,
    ],
  ])('finds the entry script in %s', (_label, html, expected) => {
    expect(moduleScriptUrl(html, page)).toBe(expected)
  })

  it.each([
    ['a page without scripts', '<!doctype html><html><body></body></html>'],
    ['a classic script under /assets/', '<script src="/assets/a.js"></script>'],
    ['structured data', '<script id="business-json-ld" type="application/ld+json">{}</script>'],
    ['a module preload link', '<link rel="modulepreload" crossorigin href="/assets/3ovRssOY.js">'],
    ['the unbuilt development entry', '<script type="module" src="/src/main.tsx"></script>'],
    [
      'a module script from another origin',
      '<script type="module" src="https://example.org/assets/a.js"></script>',
    ],
    ['a module script on the www host', `<script type="module" src="${WWW}assets/a.js"></script>`],
    ['an inline module script', '<script type="module">import "/assets/a.js"</script>'],
    ['a data-src attribute', '<script type="module" data-src="/assets/a.js"></script>'],
  ])('finds no entry script in %s', (_label, html) => {
    expect(moduleScriptUrl(html, page)).toBeNull()
  })
})

describe('live smoke workflow', () => {
  const source = readFileSync('.github/workflows/live-smoke.yml', 'utf8')
  const lines = source.split('\n')
  const block = (key: string): string[] => {
    const rest = lines.slice(lines.indexOf(`${key}:`) + 1)
    const end = rest.findIndex((line) => !line.startsWith(' '))
    return lines.includes(`${key}:`) ? rest.slice(0, end === -1 ? rest.length : end) : []
  }
  const actionRefs = (text: string) => Array.from(text.matchAll(/\buses:\s*(\S+)/g), (m) => m[1])

  it('runs once a day off the hour and on manual dispatch, and on nothing else', () => {
    const [schedule, cron, dispatch, ...others] = block('on')
    expect(schedule).toBe('  schedule:')
    expect(dispatch).toBe('  workflow_dispatch:')
    expect(others).toEqual([])
    const [, minute, hour] = /^ {4}- cron: '(\d+) (\d+) \* \* \*'$/.exec(cron ?? '') ?? []
    expect(Number(minute)).toBeGreaterThan(0)
    expect(Number(minute)).toBeLessThan(60)
    expect(Number(hour)).toBeLessThan(24)
  })

  it('holds a read-only token, no secret or variable, a time limit and one run at a time', () => {
    expect(block('permissions')).toEqual(['  contents: read'])
    expect(source.match(/permissions:/g)).toHaveLength(1)
    expect(source).not.toContain('${{')
    // The script stops at 6 minutes; the two setup steps get the rest.
    const [, minutes] = /^ {4}timeout-minutes: (\d+)$/m.exec(source) ?? []
    expect(Number(minutes)).toBeGreaterThanOrEqual(8)
    expect(block('concurrency')).toEqual([
      '  group: live-site-smoke',
      '  cancel-in-progress: false',
    ])
  })

  it('uses only actions the other workflows already pin, at the same commits', () => {
    const others = readdirSync('.github/workflows')
      .filter((name) => name !== 'live-smoke.yml')
      .map((name) => readFileSync(`.github/workflows/${name}`, 'utf8'))
      .concat(
        readdirSync('.github/actions').map((name) =>
          readFileSync(`.github/actions/${name}/action.yml`, 'utf8'),
        ),
      )
      .flatMap(actionRefs)
    const used = actionRefs(source)
    expect(used.length).toBeGreaterThan(0)
    for (const ref of used) {
      expect(ref).toMatch(/@[0-9a-f]{40}$/)
      expect(others).toContain(ref)
    }
  })

  it('checks out once, without leaving the token in the repository configuration', () => {
    expect(source.match(/uses: actions\/checkout@/g)).toHaveLength(1)
    expect(source).toMatch(
      /^ {8}uses: actions\/checkout@[0-9a-f]{40}.*\n {8}with:\n {10}persist-credentials: false$/m,
    )
  })

  it('checks production with the tracked public configuration', () => {
    expect(source).toContain('SITE_ORIGIN: https://bladeblendstudio.se')
    expect(source).toContain('node tools/smoke-live.mjs')
    const env = readFileSync('.env', 'utf8').split('\n')
    for (const name of ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY']) {
      expect(source).toContain(`sed -n 's/^${name}=//p' .env`)
      // Exactly one non-empty value, or the script would be handed nothing or two lines.
      const values = env.filter((line) => line.startsWith(`${name}=`))
      expect(values).toHaveLength(1)
      expect(values[0]?.length).toBeGreaterThan(`${name}=`.length)
    }
  })

  it('is green only when the script exits 0 and prints its all-green line', () => {
    const [, allGreen] = runVerdict({ total: 1, failures: 0 }).lines
    const commands = lines
      .slice(lines.indexOf('        run: |') + 1)
      .filter((line) => line !== '' && !line.trimStart().startsWith('#'))
    // Exact lines: `|| true` after the script, a dropped pipefail or a dropped grep all change them.
    expect(commands).toEqual([
      '          set -eo pipefail',
      `          SUPABASE_URL="$(sed -n 's/^VITE_SUPABASE_URL=//p' .env)"`,
      `          SUPABASE_ANON_KEY="$(sed -n 's/^VITE_SUPABASE_ANON_KEY=//p' .env)"`,
      '          export SUPABASE_URL SUPABASE_ANON_KEY',
      '          node tools/smoke-live.mjs | tee "$RUNNER_TEMP/live-smoke.log"',
      `          grep -qx '${allGreen}' "$RUNNER_TEMP/live-smoke.log"`,
    ])
    // That block is the workflow's only command, in bash; no step may fail quietly or be skipped.
    expect(lines.filter((line) => /^\s+(?:run|shell):/.test(line))).toEqual([
      '  run:',
      '    shell: bash',
      '        run: |',
    ])
    expect(source).not.toContain('continue-on-error')
    expect(lines.filter((line) => /^\s+if:/.test(line))).toEqual([])
  })
})

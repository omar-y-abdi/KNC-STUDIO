import { test, expect } from './fixtures.mjs'

// Hostile spec: every probe targets a host the guard must refuse. Belt and braces: the contexts also
// use an unreachable proxy (loopback bypassed), so a broken guard could only produce connection
// errors here and never reach a real host.
const DEAD_PROXY = { server: 'http://127.0.0.1:9', bypass: '127.0.0.1,localhost' }
const SUPABASE_PROBE = 'https://example.supabase.co/rest/v1/rpc/public_booking_catalog'
const SITE_PROBE = 'https://bladeblendstudio.se/api/cms/presentation'
const SOCKET_PROBE = 'wss://example.supabase.co/realtime/v1/websocket'
const PROBES = [SUPABASE_PROBE, SITE_PROBE]
const PROBE_PAGE = '/guard-probe'

test.use({ proxy: DEAD_PROXY })

// A real http origin served by a test route, so workers and same-origin fetches behave normally.
async function openProbePage(page, baseURL) {
  await page.route(`${baseURL}${PROBE_PAGE}`, (route) =>
    route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>probe</title>' }),
  )
  await page.goto(`${baseURL}${PROBE_PAGE}`)
}

const attemptFetch = (page, url) =>
  page.evaluate(
    (target) =>
      fetch(target).then(
        () => 'reached',
        (error) => `failed: ${error.name}`,
      ),
    url,
  )

const hosts = (violations) => violations.map(({ url }) => new URL(url).host).sort()

for (const url of PROBES)
  test(`aborts a page request to ${new URL(url).host} and records it`, async ({
    page,
    baseURL,
    networkGuard,
  }) => {
    await openProbePage(page, baseURL)
    expect(await attemptFetch(page, url)).toBe('failed: TypeError')
    expect(networkGuard.takeViolations()).toEqual([
      { channel: 'request', method: 'GET', url, reason: 'production-host' },
    ])
  })

test('closes a WebSocket to a production host and records it without its query', async ({
  page,
  baseURL,
  networkGuard,
}) => {
  await openProbePage(page, baseURL)
  const closeCode = await page.evaluate(
    (target) =>
      new Promise((resolve) => {
        const socket = new globalThis.WebSocket(`${target}?apikey=probe-key`)
        socket.onclose = (event) => resolve(event.code)
      }),
    SOCKET_PROBE,
  )
  expect(closeCode).toBe(1008)
  expect(networkGuard.takeViolations()).toEqual([
    { channel: 'websocket', method: 'GET', url: SOCKET_PROBE, reason: 'production-host' },
  ])
})

test('rejects APIRequestContext calls to production hosts', async ({
  page,
  request,
  networkGuard,
}) => {
  await expect(page.request.get(SITE_PROBE)).rejects.toThrow(/network guard/)
  await expect(page.context().request.post(SUPABASE_PROBE)).rejects.toThrow(/network guard/)
  await expect(request.fetch(SITE_PROBE)).rejects.toThrow(/network guard/)
  expect(networkGuard.takeViolations().map(({ channel }) => channel)).toEqual([
    'api-request',
    'api-request',
    'api-request',
  ])
})

test('guards iframes and popups', async ({ page, baseURL, networkGuard }) => {
  await openProbePage(page, baseURL)
  await page.evaluate((target) => {
    const frame = globalThis.document.createElement('iframe')
    frame.src = target
    globalThis.document.body.append(frame)
  }, SUPABASE_PROBE)
  await page.evaluate((target) => globalThis.open(target), SITE_PROBE)
  await expect
    .poll(() => hosts(networkGuard.violations))
    .toEqual(['bladeblendstudio.se', 'example.supabase.co'])
  networkGuard.takeViolations()
})

test('guards requests made by a Worker', async ({ page, baseURL, networkGuard }) => {
  await openProbePage(page, baseURL)
  const outcome = await page.evaluate(
    (target) =>
      new Promise((resolve) => {
        const source = `fetch(${JSON.stringify(target)}).then(() => postMessage('reached'), () => postMessage('failed'))`
        const url = globalThis.URL.createObjectURL(new globalThis.Blob([source]))
        const worker = new globalThis.Worker(url)
        worker.onmessage = (event) => resolve(event.data)
      }),
    SUPABASE_PROBE,
  )
  expect(outcome).toBe('failed')
  expect(hosts(networkGuard.takeViolations())).toEqual(['example.supabase.co'])
})

test('guards contexts created through the newContext fixture', async ({
  newContext,
  networkGuard,
}) => {
  const context = await newContext({ proxy: DEAD_PROXY })
  const page = await context.newPage()
  expect(await attemptFetch(page, SUPABASE_PROBE)).toBe('failed: TypeError')
  expect(hosts(networkGuard.takeViolations())).toEqual(['example.supabase.co'])
})

// A real worker script served by the dev harness: with workers allowed the registration takes
// effect, so a pass here proves the block and not a missing script. Registration may reject or
// resolve depending on the blocker, so the check counts live registrations.
const SERVICE_WORKER_SCRIPT = '/tools/e2e/fixtures/noop-sw.js'

test('registers no service worker, so none can answer requests outside the guard', async ({
  page,
  baseURL,
}) => {
  await page.goto(`${baseURL}/tools/e2e/admin-harness.html`)
  const registrations = await page.evaluate(async (script) => {
    const workers = globalThis.navigator.serviceWorker
    await workers.register(script).catch(() => undefined)
    await new Promise((resolve) => globalThis.setTimeout(resolve, 500))
    return (await workers.getRegistrations()).length
  }, SERVICE_WORKER_SCRIPT)
  expect(registrations).toBe(0)
  expect(page.context().serviceWorkers()).toEqual([])
})

test('lets local and stubbed traffic through without a violation', async ({
  page,
  baseURL,
  networkGuard,
}) => {
  await page.route('https://admin-harness.invalid/**', (route) =>
    route.fulfill({ headers: { 'access-control-allow-origin': '*' }, body: 'harness stub' }),
  )
  await openProbePage(page, baseURL)
  const local = await page.evaluate(
    (path) => fetch(path).then((response) => response.status),
    PROBE_PAGE,
  )
  const stubbed = await page.evaluate(() =>
    fetch('https://admin-harness.invalid/rest/v1/x').then((response) => response.text()),
  )
  expect({ local, stubbed }).toEqual({ local: 200, stubbed: 'harness stub' })
  expect(networkGuard.violations).toEqual([])
})

test('a test route may stub a foreign host, which then never reaches the network', async ({
  page,
  baseURL,
  networkGuard,
}) => {
  await page.route('https://challenges.cloudflare.com/**', (route) =>
    route.fulfill({
      headers: { 'access-control-allow-origin': '*' },
      contentType: 'application/javascript',
      body: 'window.turnstile = {}',
    }),
  )
  await openProbePage(page, baseURL)
  const body = await page.evaluate(() =>
    fetch('https://challenges.cloudflare.com/turnstile/v0/api.js').then((response) =>
      response.text(),
    ),
  )
  expect(body).toBe('window.turnstile = {}')
  expect(networkGuard.violations).toEqual([])
})

// Without takeViolations() the blocked attempt must fail the test that made it. test.fail() turns
// the guard's teardown failure into a pass and turns "no failure" into a failure.
test.describe('a blocked attempt fails the test that made it', () => {
  test.fail()
  for (const url of PROBES)
    test(`fails on ${new URL(url).host}`, async ({ page, baseURL }) => {
      await openProbePage(page, baseURL)
      await attemptFetch(page, url)
    })
})

import { assetFixture, documentFixture } from './builders.mjs'
import { routeApi } from './route-api.mjs'
/* global window, document, location */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { CORE_PAGE_PATHS } from '../../shared/cms.ts'
import { nativeBackend } from './cms-backend.mjs'
import { expect, test, devices } from './fixtures.mjs'
import { startupOrigin } from './origins.mjs'
const base = startupOrigin

async function startupDocument() {
  const bytes = await readFile(
    process.env.CMS_STARTUP_PRESENTATION ??
      new URL('./fixtures/presentation.json.gz', import.meta.url),
  )
  const doc = {
    ...documentFixture(),
    presentation: JSON.parse(
      bytes[0] === 0x1f && bytes[1] === 0x8b
        ? gunzipSync(bytes).toString('utf8')
        : bytes.toString('utf8'),
    ).presentation,
  }
  return doc
}

const median = (values) => [...values].sort((a, b) => a - b)[1]

async function observeStartup(context) {
  await context.addInitScript(() => {
    if (window !== window.top) return
    const clock = globalThis.performance
    const tasks = []
    const supported =
      globalThis.PerformanceObserver?.supportedEntryTypes.includes('longtask') ?? false
    const observer = supported
      ? new globalThis.PerformanceObserver((list) => tasks.push(...list.getEntries()))
      : null
    observer?.observe({ type: 'longtask', buffered: true })
    const start = clock.now()
    globalThis.cmsStartupSample = () => {
      tasks.push(...(observer?.takeRecords() ?? []))
      observer?.disconnect()
      const ready = clock.getEntriesByName('cms:startup:ready').at(-1)?.startTime
      if (ready === undefined) throw new Error('Canvas startup did not record readiness')
      const work = clock.getEntriesByName('cms:startup:work')
      return {
        readyMs: ready - start,
        // Active synchronous editor spans, excluding scheduler/paint/network waits. This is
        // a main-thread work proxy, not an OS CPU counter; each span uses performance.now().
        cpuMs: work.reduce((sum, entry) => sum + entry.duration, 0),
        passes: work.length,
        longestTaskMs: supported
          ? Math.max(
              0,
              ...tasks
                .filter(
                  (entry) => entry.startTime + entry.duration > start && entry.startTime < ready,
                )
                .map((entry) => entry.duration),
            )
          : null,
      }
    }
  })
}

async function startupSamples(newContext, doc, verify) {
  const samples = []
  for (let index = 0; index < 3; index++) {
    // Isolated storage: a prior sample's migrated backup must not change the measured input.
    const context = await newContext({ ...devices['iPhone 15'], reducedMotion: 'reduce' })
    try {
      await csp(context)
      await observeStartup(context)
      const backend = await nativeBackend(context, doc, undefined, base)
      await ownerSession(context)
      await context.route('**/cms-public/source', (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: '<!doctype html><html data-knc-source-listening="1"><script>addEventListener("message",e=>{document.documentElement.dataset.kncSourceError=e.data.id;document.documentElement.dataset.kncSourceFailure="Offline source"})</script></html>',
        }),
      )
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.goto(`${base}/admin/cms/`, { waitUntil: 'domcontentloaded' })
      await page
        .locator('.cms-editor-canvas[data-cms-canvas-ready="true"]')
        .waitFor({ timeout: 15000 })
      await page
        .frameLocator('.gjs-frame')
        .first()
        .locator('[data-knc-surface="mobile-home"]')
        .waitFor()
      // Let PerformanceObserver deliver the task containing the readiness mark.
      await page.evaluate(() => new Promise((resolve) => window.setTimeout(resolve, 0)))
      samples.push(await page.evaluate(() => globalThis.cmsStartupSample()))
      if (index === 2 && verify) await verify(page)
      assert.deepEqual(errors, [], 'no unhandled startup errors')
      assert.deepEqual(backend.writes, [])
    } finally {
      await context.close()
    }
  }
  return {
    samples,
    readyMs: median(samples.map((sample) => sample.readyMs)),
    cpuMs: median(samples.map((sample) => sample.cpuMs)),
    longestTaskMs: samples.every((sample) => sample.longestTaskMs !== null)
      ? median(samples.map((sample) => sample.longestTaskMs))
      : null,
  }
}

function storedDocument() {
  const doc = documentFixture()
  doc.presentation.pages = CORE_PAGE_PATHS.map((path, index) => {
    const html =
      path === '/contact'
        ? '<main class="bb-page bb-doc"><h1>Kontakt</h1><span data-business-name>Salongen</span><span data-business-city>Göteborg</span><div id="contact-details"></div><div id="contact-hours"></div></main>'
        : '<div data-knc-native="1"><main data-knc-surface="mobile-home"><h1 id="owner-heading">Stored owner heading</h1></main></div>'
    return {
      id: `10000000-0000-4000-8000-00000000000${index + 1}`,
      path,
      kind: 'page',
      inMenu: true,
      name: { sv: path, en: path },
      title: { sv: '', en: '' },
      description: { sv: '', en: '' },
      content: {
        sv: { html, css: { light: '', dark: '' } },
        en: { html, css: { light: '', dark: '' } },
      },
    }
  })
  return doc
}
async function ownerSession(context) {
  const user = {
    id: '20000000-0000-4000-8000-000000000001',
    email: 'cms-test@example.invalid',
    aud: 'authenticated',
    role: 'authenticated',
  }
  const exp = Math.floor(Date.now() / 1000) + 3600
  const jwt = [
    Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'),
    Buffer.from(JSON.stringify({ sub: user.id, exp, role: 'authenticated' })).toString('base64url'),
    'fixture',
  ].join('.')
  await context.addInitScript(
    (session) => window.localStorage.setItem('knc-admin-auth', JSON.stringify(session)),
    {
      user,
      access_token: jwt,
      refresh_token: 'fixture',
      expires_at: exp,
      expires_in: 3600,
      token_type: 'bearer',
    },
  )
  await routeApi(context, [
    [
      'https://admin-harness.invalid/rest/v1/profiles*',
      (route, headers) =>
        route.fulfill({
          headers,
          json: {
            role: 'owner',
            barber_id: null,
            must_change_password: false,
            account_enabled: true,
          },
        }),
    ],
  ])
}
const headerFile = await readFile(new URL('../../public/_headers', import.meta.url), 'utf8')
const policy = headerFile.match(/Content-Security-Policy:\s*([^\n]+)/)?.[1]
assert.ok(policy, 'production CSP must be present')
async function csp(context) {
  await context.route(`${base}/**`, async (route) => {
    if (route.request().resourceType() !== 'document') return route.fallback()
    const response = await route.fetch()
    const value = policy
      .replace(/;?\s*upgrade-insecure-requests/g, '')
      .replace("connect-src 'self'", "connect-src 'self' https://admin-harness.invalid")
      .replace(
        'frame-src https://challenges.cloudflare.com',
        "frame-src 'self' https://challenges.cloudflare.com",
      )
      .replace(/frame-ancestors [^;]+/, "frame-ancestors 'self'")
    await route.fulfill({
      response,
      headers: { ...response.headers(), 'content-security-policy': value },
    })
  })
}

test.use({ ...devices['iPhone 15'], contextOptions: { reducedMotion: 'reduce' } })

test('stored-page-independent-of-source', async ({ newContext }, testInfo) => {
  const metrics = await startupSamples(newContext, storedDocument(), async (page) => {
    await page
      .getByRole('alert')
      .filter({ hasText: 'Dina befintliga sidor går fortfarande att redigera' })
      .waitFor()
    await page
      .locator('.cms-mobile-tools')
      .getByRole('button', { name: 'Design', exact: true })
      .click()
    await page.getByLabel('Namn', { exact: true }).fill('Owner edit after source failure')
    await page.getByRole('button', { name: 'Stäng panel', exact: true }).click()
    assert.equal(
      await page.locator('.cms-canvas-breadcrumb strong').innerText(),
      'Owner edit after source failure',
    )
  })
  await testInfo.attach('metrics', {
    body: JSON.stringify(metrics, null, 2),
    contentType: 'application/json',
  })
  assert.ok(metrics.readyMs < 3000, `Median stored startup: ${metrics.readyMs}ms; budget 3000ms`)
})

test('real-fixture startup uses median in-page CPU and longest-task budgets', async ({
  newContext,
}, testInfo) => {
  const doc = await startupDocument()
  const metrics = await startupSamples(newContext, doc)
  await testInfo.attach('real-fixture-metrics', {
    body: JSON.stringify(metrics, null, 2),
    contentType: 'application/json',
  })
  // Keep the original CPU calibration: reserve 0.5s of the original 3s readiness target
  // for waits/paint, leaving 2.5s of active editor work. Native
  // conversion, CSS import and model import now run in separate tasks; cap the largest
  // indivisible pass at half that work budget (1.25s). These are targets, not measurements.
  assert.ok(
    metrics.samples.every((sample) => sample.passes >= 5),
    'Heavy passes must yield separately',
  )
  assert.ok(metrics.readyMs < 3000, `Median real startup: ${metrics.readyMs}ms; budget 3000ms`)
  assert.ok(metrics.cpuMs < 2500, `Median active editor work: ${metrics.cpuMs}ms; budget 2500ms`)
  if (metrics.longestTaskMs !== null)
    assert.ok(
      metrics.longestTaskMs < 1250,
      `Median longest task: ${metrics.longestTaskMs}ms; budget 1250ms`,
    )
})
test('source-upgrade-preserves-editable-page', async ({ page, context }, testInfo) => {
  page.setDefaultTimeout(5000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await csp(context)
  const metrics = await (async (page, context) => {
    const doc = storedDocument()
    const backend = await nativeBackend(context, doc, undefined, base)
    await ownerSession(context)
    const start = Date.now()
    await page.goto(`${base}/admin/cms/`, { waitUntil: 'domcontentloaded' })
    await page.locator('.gjs-frame').first().waitFor({ timeout: 10000 })
    await page
      .frameLocator('.gjs-frame')
      .first()
      .locator('[data-knc-surface="mobile-home"]')
      .waitFor()
    const readyMs = Date.now() - start
    const capture = page.locator('iframe[title="Läser den befintliga webbplatsen"]')
    await capture.waitFor({ state: 'attached' })
    // Edit before the optional capture finishes. Its response must merge with
    // the current draft, not the old document that started the operation.
    await page
      .locator('.cms-mobile-tools')
      .getByRole('button', { name: 'Design', exact: true })
      .click()
    await page.getByLabel('Namn', { exact: true }).fill('Owner edit during capture')
    await page.getByRole('button', { name: 'Stäng panel', exact: true }).click()
    await capture.waitFor({ state: 'detached', timeout: 30000 })
    assert.equal(
      await page.getByRole('heading', { name: 'Sidan kunde inte öppnas i editorn' }).count(),
      0,
    )
    assert.equal(
      await page.locator('.cms-canvas-breadcrumb strong').innerText(),
      'Owner edit during capture',
    )
    assert.equal(
      await page.getByRole('alert').count(),
      0,
      'the real source upgrade must finish without errors',
    )
    await page
      .frameLocator('.gjs-frame')
      .first()
      .locator('[data-knc-surface="mobile-home"]')
      .waitFor()
    assert.deepEqual(backend.writes, [])
    return { readyMs, upgradedMs: Date.now() - start }
  })(page, context)
  assert.deepEqual(errors, [], 'no unhandled errors')
  await testInfo.attach('metrics', {
    body: JSON.stringify(metrics ?? {}, null, 2),
    contentType: 'application/json',
  })
})
test('legacy-backup-without-pages-keeps-authoritative-layouts', async ({
  page,
  context,
}, testInfo) => {
  page.setDefaultTimeout(5000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await csp(context)
  const metrics = await (async (page, context) => {
    const backend = await nativeBackend(context, storedDocument(), undefined, base)
    await ownerSession(context)
    const backup = documentFixture()
    backup.settings.business_name = 'Unsaved owner business name'
    await context.addInitScript((draft) => {
      if (window !== window.top) return
      window.sessionStorage.setItem('knc-cms-tab', 'startup-recovery')
      window.localStorage.setItem(
        'knc-cms-draft:startup-recovery',
        JSON.stringify({
          savedAt: '2026-09-23T00:00:00Z',
          document: draft,
        }),
      )
    }, backup)
    await context.route('**/cms-public/source', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html>Source unavailable</html>',
      }),
    )
    await page.goto(`${base}/admin/cms/`, { waitUntil: 'domcontentloaded' })
    await page.locator('.gjs-frame').first().waitFor()
    // The legacy localStorage draft moved to IndexedDB, and this tab recovered it as its own.
    const recovered = () =>
      page.evaluate(
        () =>
          new Promise((resolve, reject) => {
            const opening = window.indexedDB.open('knc-cms-drafts', 1)
            opening.onerror = () => reject(opening.error)
            opening.onsuccess = () => {
              const request = opening.result
                .transaction('records')
                .objectStore('records')
                .get('startup-recovery')
              request.onerror = () => reject(request.error)
              request.onsuccess = () => {
                opening.result.close()
                const draft = request.result && JSON.parse(request.result.document)
                resolve(draft && [draft.settings.business_name, draft.presentation.pages.length])
              }
            }
          }),
      )
    await expect.poll(recovered).toEqual(['Unsaved owner business name', CORE_PAGE_PATHS.length])
    assert.equal(
      await page.evaluate(() => window.localStorage.getItem('knc-cms-draft:startup-recovery')),
      null,
    )
    const canvas = await page.locator('.cms-canvas-shell').boundingBox()
    assert.ok(
      canvas && canvas.height >= 240 && canvas.y + canvas.height <= page.viewportSize().height,
      'Recovered drafts must leave a usable canvas inside the phone viewport',
    )
    assert.deepEqual(backend.writes, [])
  })(page, context)
  assert.deepEqual(errors, [], 'no unhandled errors')
  await testInfo.attach('metrics', {
    body: JSON.stringify(metrics ?? {}, null, 2),
    contentType: 'application/json',
  })
})
test('page-import-failure-keeps-workspace', async ({ page, context }, testInfo) => {
  page.setDefaultTimeout(5000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await csp(context)
  const metrics = await (async (page, context) => {
    const doc = storedDocument()
    for (const variant of Object.values(doc.presentation.pages[0].content))
      variant.html = variant.html.replace(
        'id="owner-heading"',
        'id="owner-heading" data-knc-baseline="broken-json"',
      )
    await nativeBackend(context, doc, undefined, base)
    await ownerSession(context)
    await context.route('**/cms-public/source', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html><body>Source unavailable</body></html>',
      }),
    )
    await page.goto(`${base}/admin/cms/`, { waitUntil: 'domcontentloaded' })
    await page.getByRole('heading', { name: 'Sidan kunde inte öppnas i editorn' }).waitFor()
    assert.equal(await page.locator('.cms-topbar').isVisible(), true)
    await page.getByText('Teknisk felinformation', { exact: true }).click()
    assert.ok((await page.locator('details').innerText()).length > 'Teknisk felinformation'.length)
    await page
      .locator('.cms-mobile-tools')
      .getByRole('button', { name: 'Sidor', exact: true })
      .click()
    await page.locator('.cms-page-list button').filter({ hasText: '/terms' }).click()
    await page.locator('.gjs-frame').first().waitFor()
    assert.equal(
      await page.getByRole('heading', { name: 'Sidan kunde inte öppnas i editorn' }).count(),
      0,
    )
  })(page, context)
  assert.deepEqual(errors, [], 'no unhandled errors')
  await testInfo.attach('metrics', {
    body: JSON.stringify(metrics ?? {}, null, 2),
    contentType: 'application/json',
  })
})
test('resource-worker-under-production-policy', async ({ page, context }, testInfo) => {
  page.setDefaultTimeout(5000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await csp(context)
  const metrics = await (async (page, context) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    const doc = storedDocument()
    // Legal pages use authored markup, not the native-only metadata allowance.
    for (const entry of doc.presentation.pages.filter((item) =>
      ['/privacy', '/terms'].includes(item.path),
    ))
      for (const variant of Object.values(entry.content))
        variant.html = '<main><h1>Legal page</h1></main>'
    const asset = assetFixture({
      id: '77777777-7777-4777-8777-000000000001',
      bucket: 'cms-library',
      path: 'images/unused.webp',
      name: 'Unused fixture',
      alt: '',
      mime: 'image/webp',
      bytes: 100,
      width: 40,
      height: 40,
      archived: true,
      version: 1,
    })
    const backend = await nativeBackend(context, doc, [asset], base)
    await ownerSession(context)
    await context.route('**/cms-public/source', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html>Source unavailable</html>',
      }),
    )
    await context.route('https://admin-harness.invalid/storage/**', (route) =>
      route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"/>',
      }),
    )
    await page.goto(`${base}/admin/cms/`, { waitUntil: 'domcontentloaded' })
    await page.locator('.gjs-frame').first().waitFor({ timeout: 10000 })
    await page
      .locator('#cms-library')
      .getByRole('button', { name: 'Resurser', exact: true })
      .click()
    await page.getByRole('button', { name: 'Arkiverade', exact: true }).click()
    await page.locator('.cms-resource-card button').filter({ hasText: asset.name }).click()
    await page.getByText(/Utkast: 0 placeringar/).waitFor()
    await page.getByText(/Publicerat: 0 · Historik: 0/).waitFor()
    assert.equal(
      await page.getByRole('button', { name: 'Flytta till papperskorg', exact: true }).isEnabled(),
      true,
    )
    assert.deepEqual(backend.writes, [])
    return { indexedUnderCsp: true }
  })(page, context)
  assert.deepEqual(errors, [], 'no unhandled errors')
  await testInfo.attach('metrics', {
    body: JSON.stringify(metrics ?? {}, null, 2),
    contentType: 'application/json',
  })
})
test('capture-without-animation-frames', async ({ page, context }, testInfo) => {
  page.setDefaultTimeout(5000)
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await csp(context)
  const metrics = await (async (page, context) => {
    // The source protocol describes its actual iframe viewport, not a forced
    // layout prop. Match the Desktop context just as readCorePageSource does.
    await page.setViewportSize({ width: 1440, height: 900 })
    const backend = await nativeBackend(context, undefined, undefined, base)
    const reads = [],
      challenges = []
    context.on('request', (request) => {
      if (request.url().includes('/rest/v1/site_content')) reads.push(request.url())
      if (new URL(request.url()).hostname === 'challenges.cloudflare.com')
        challenges.push(request.url())
    })
    await context.addInitScript(() => {
      window.requestAnimationFrame = () => 0
    })
    await page.goto(`${base}/cms-public/source`)
    await page.waitForFunction(
      () => document.documentElement.dataset.kncSourceListening === '1',
      null,
      { polling: 20 },
    )
    for (const [index, scene] of ['home', 'my-bookings', 'home'].entries()) {
      const id = `capture-${index}`
      await page.evaluate(
        ({ id, scene, index }) =>
          window.postMessage(
            {
              type: 'knc-source-context',
              id,
              scene,
              lang: 'sv',
              mode: index === 2 ? 'dark' : 'light',
              device: 'Desktop',
            },
            location.origin,
          ),
        { id, scene, index },
      )
      await page.waitForFunction(
        (id) => document.documentElement.dataset.kncSourceReady === id,
        id,
        { polling: 20 },
      )
    }
    assert.equal(reads.length, 1, 'source copy is loaded once, not once per scene/theme')
    assert.deepEqual(challenges, [], 'read-only previews never mount a Turnstile challenge')
    assert.deepEqual(backend.writes, [])
    return { copyReads: reads.length }
  })(page, context)
  assert.deepEqual(errors, [], 'no unhandled errors')
  await testInfo.attach('metrics', {
    body: JSON.stringify(metrics ?? {}, null, 2),
    contentType: 'application/json',
  })
})

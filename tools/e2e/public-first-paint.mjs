import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { emptyDocument } from '../../shared/cms.ts'

const PRESENTATION_PATH = '/api/cms/presentation'
const HERO_AMPERSAND =
  '[data-knc-surface="mobile-home"] svg[aria-label="Blade & Blend Studio"] > text:nth-of-type(3)'
const BASELINE_HERO_AMPERSAND =
  '[data-knc-fold="hero"] svg[aria-label="Blade & Blend Studio"] > text:nth-of-type(3)'
const TIMEOUT = 15000
const NO_STORE = { 'cache-control': 'no-store' }

function isPresentationRequest(request) {
  return request.method() === 'GET' && new URL(request.url()).pathname === PRESENTATION_PATH
}

function firstPaintPresentation() {
  const document = emptyDocument()
  // This minimal native surface intentionally preserves the real application tree; its CSS edits
  // the third SVG wordmark glyph, which is the actual B&B ampersand rendered by HeroLockup.
  const html =
    '<div data-knc-native="1" style="display:contents"><div data-knc-surface="mobile-home"></div></div>'
  const css =
    '[data-knc-surface="mobile-home"] svg[aria-label="Blade & Blend Studio"] > text:nth-of-type(3){opacity:.18}'
  const variants = () => ({ html, css: { light: css, dark: css } })
  document.presentation.pages.push({
    id: '10000000-0000-4000-8000-000000000001',
    path: '/',
    kind: 'page',
    inMenu: true,
    name: { sv: 'Startsida', en: 'Home' },
    title: { sv: '', en: '' },
    description: { sv: '', en: '' },
    content: { sv: variants(), en: variants() },
  })
  return document.presentation
}

/** Plain Vite preview has no Worker-backed CMS endpoint; give it an authoritative empty document. */
export async function installEmptyCmsPresentation(context) {
  const presentation = emptyDocument().presentation
  await context.route('**/api/cms/presentation', (route) =>
    route.fulfill({
      headers: { 'content-type': 'application/json', ...NO_STORE },
      json: { revision: 0, presentation },
    }),
  )
}

function heldResponse() {
  let release
  const waiting = new Promise((resolve) => {
    release = resolve
  })
  return { waiting, release }
}

async function clientNavigate(page, path) {
  await page.evaluate((nextPath) => {
    globalThis.history.pushState({}, '', nextPath)
    globalThis.dispatchEvent(new globalThis.PopStateEvent('popstate'))
  }, path)
}

async function assertLoadingWithoutLegacy(page, label) {
  await page.getByText('Laddar webbplatsen…', { exact: true }).waitFor()
  await page.waitForTimeout(450)
  const state = await page.evaluate(
    (selectors) => ({
      loading: globalThis.document.querySelector('main[role="status"]') !== null,
      ampersand: globalThis.document.querySelector(selectors.published) !== null,
      baselineAmpersand: globalThis.document.querySelector(selectors.baseline) !== null,
      fallbackVisible: globalThis.document.body.innerText.includes('Aktivera JavaScript'),
      sampledOpacities: [...(globalThis.window.__kncCmsAmpersandPaintSamples ?? [])],
    }),
    { published: HERO_AMPERSAND, baseline: BASELINE_HERO_AMPERSAND },
  )
  assert.equal(state.loading, true, `${label}: native route waits for its CMS presentation`)
  assert.equal(state.ampersand, false, `${label}: the old hero is not rendered during the request`)
  assert.equal(
    state.baselineAmpersand,
    false,
    `${label}: the unprojected code hero is not rendered during the request`,
  )
  assert.equal(
    state.fallbackVisible,
    false,
    `${label}: no-JavaScript copy is hidden with scripting enabled`,
  )
  assert.deepEqual(
    state.sampledOpacities,
    [],
    `${label}: the browser never sampled the legacy opaque ampersand`,
  )
  return {
    gateVisible: state.loading,
    oldHeroVisible: state.ampersand || state.baselineAmpersand,
  }
}

async function readPublishedHero(page, label) {
  const ampersand = page.locator(HERO_AMPERSAND)
  await ampersand.waitFor({ state: 'visible' })
  const glyph = await ampersand.evaluate((node) => ({
    text: node.textContent?.trim(),
    opacity: globalThis.getComputedStyle(node).opacity,
  }))
  assert.equal(glyph.text, '&', `${label}: the assertion targets the rendered ampersand glyph`)
  assert.equal(
    glyph.opacity,
    '0.18',
    `${label}: response opacity is applied before the hero renders`,
  )
  await page.waitForFunction(() => {
    const samples = globalThis.window.__kncCmsAmpersandPaintSamples ?? []
    return samples.length > 0 && samples.includes('0.18')
  })
  const samples = await page.evaluate(() => [
    ...(globalThis.window.__kncCmsAmpersandPaintSamples ?? []),
  ])
  const observed = [...new Set(samples)]
  assert.deepEqual(observed, ['0.18'], `${label}: no old opaque frame preceded the published style`)
  return { opacity: glyph.opacity, sampleCount: samples.length, sampledValues: observed }
}

async function verifyNoScriptFallback(browser, workerOrigin) {
  const enabledContext = await browser.newContext({ ignoreHTTPSErrors: true })
  const disabledContext = await browser.newContext({
    ignoreHTTPSErrors: true,
    javaScriptEnabled: false,
  })
  enabledContext.setDefaultTimeout(TIMEOUT)
  disabledContext.setDefaultTimeout(TIMEOUT)
  try {
    const enabled = await enabledContext.newPage()
    let delayedScripts = 0
    await enabledContext.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (url.origin === workerOrigin && route.request().resourceType() === 'script') {
        delayedScripts++
        await new Promise((resolve) => globalThis.setTimeout(resolve, 600))
        return route.abort().catch(() => {
          // The page may finish its navigation cleanup before Playwright closes this held route.
        })
      }
      return route.continue()
    })
    const response = await enabled.goto(`${workerOrigin}/`, { waitUntil: 'commit' })
    assert.equal(response?.status(), 200, 'The local Worker serves the native homepage')
    const html = await response.text()
    assert.match(html, /<noscript>[\s\S]*Aktivera JavaScript[\s\S]*<\/noscript>/)
    await enabled.waitForTimeout(700)
    assert.ok(
      delayedScripts > 0,
      'The app script was delayed and blocked during the visibility check',
    )
    assert.equal(
      (await enabled.locator('body').innerText()).includes('Aktivera JavaScript'),
      false,
      'Script-enabled visitors never see the fallback while the bundle is delayed or blocked',
    )

    const disabled = await disabledContext.newPage()
    const noScriptResponse = await disabled.goto(`${workerOrigin}/`, {
      waitUntil: 'domcontentloaded',
    })
    assert.equal(noScriptResponse?.status(), 200)
    const fallback = disabled.getByText(/Aktivera JavaScript/)
    await fallback.waitFor({ state: 'visible' })
    assert.equal(await fallback.isVisible(), true, 'The no-JavaScript fallback remains available')
    return { delayedScripts, fallbackVisibleWithoutScripting: true }
  } finally {
    await enabledContext.close()
    await disabledContext.close()
  }
}

/** Exercise real Worker HTML and client startup while the public presentation request is controlled. */
export async function verifyPublicFirstPaint(browser, workerOrigin, work) {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    colorScheme: 'light',
    reducedMotion: 'reduce',
    ignoreHTTPSErrors: true,
  })
  context.setDefaultTimeout(TIMEOUT)
  const presentation = firstPaintPresentation()
  const emptyPresentation = emptyDocument().presentation
  const holds = new Map([1, 2, 3].map((number) => [number, heldResponse()]))
  let requestCount = 0
  const noStore = NO_STORE

  await context.addInitScript(
    (selectors) => {
      const samples = []
      globalThis.window.__kncCmsAmpersandPaintSamples = samples
      const sample = () => {
        const node =
          globalThis.document.querySelector(selectors.published) ??
          globalThis.document.querySelector(selectors.baseline)
        if (node) samples.push(globalThis.getComputedStyle(node).opacity)
        globalThis.window.requestAnimationFrame(sample)
      }
      globalThis.window.requestAnimationFrame(sample)
    },
    { published: HERO_AMPERSAND, baseline: BASELINE_HERO_AMPERSAND },
  )

  await context.route('**/api/cms/presentation', async (route) => {
    requestCount++
    if (requestCount <= 3) {
      const hold = holds.get(requestCount)
      try {
        await hold.waiting
        await route.fulfill({ headers: noStore, json: { revision: 1, presentation } })
      } catch {
        // The SPA transition case intentionally aborts one held request after leaving the route.
      }
      return
    }
    if (requestCount === 4)
      return route.fulfill({ headers: noStore, json: { revision: 2, presentation: null } })
    if (requestCount === 5)
      return route.fulfill({
        status: 503,
        headers: noStore,
        json: { message: 'Local presentation fixture unavailable' },
      })
    if (requestCount === 6)
      return route.fulfill({ headers: noStore, json: { revision: 3, presentation } })
    return route.fulfill({
      headers: noStore,
      json: { revision: 4, presentation: emptyPresentation },
    })
  })

  const isPresentationResponse = (response) =>
    response.request().method() === 'GET' && new URL(response.url()).pathname === PRESENTATION_PATH

  try {
    const page = await context.newPage()
    const firstRequest = page.waitForRequest(isPresentationRequest, { timeout: TIMEOUT })
    const directResponse = await page.goto(`${workerOrigin}/`, { waitUntil: 'domcontentloaded' })
    assert.equal(directResponse?.status(), 200, 'A new public tab receives the Worker homepage')
    await firstRequest
    const directPending = await assertLoadingWithoutLegacy(page, 'new tab')
    const directResponseReady = page.waitForResponse(isPresentationResponse, { timeout: TIMEOUT })
    holds.get(1).release()
    assert.equal((await directResponseReady).status(), 200)
    const directPaint = await readPublishedHero(page, 'new tab')
    await page.screenshot({
      path: join(work, `public-first-paint-${browser.browserType().name()}-new-tab.png`),
    })

    const reloadRequest = page.waitForRequest(isPresentationRequest, { timeout: TIMEOUT })
    const reload = page.reload({ waitUntil: 'domcontentloaded' })
    await reloadRequest
    const reloadPending = await assertLoadingWithoutLegacy(page, 'hard refresh')
    const reloadResponseReady = page.waitForResponse(isPresentationResponse, { timeout: TIMEOUT })
    holds.get(2).release()
    assert.equal((await reloadResponseReady).status(), 200)
    await reload
    const reloadPaint = await readPublishedHero(page, 'hard refresh')
    await page.screenshot({
      path: join(work, `public-first-paint-${browser.browserType().name()}-hard-refresh.png`),
    })

    const privatePage = await context.newPage()
    await privatePage.goto(`${workerOrigin}/login`, { waitUntil: 'domcontentloaded' })
    await privatePage.waitForFunction(() => globalThis.document.title.startsWith('Logga in'))
    const delayedRequest = privatePage.waitForRequest(isPresentationRequest, { timeout: TIMEOUT })
    await clientNavigate(privatePage, '/')
    await delayedRequest
    const routePending = await assertLoadingWithoutLegacy(privatePage, 'admin to public navigation')
    const requestCanceled = privatePage.waitForEvent('requestfailed', {
      predicate: isPresentationRequest,
      timeout: TIMEOUT,
    })
    await clientNavigate(privatePage, '/login')
    await privatePage.waitForFunction(
      () =>
        globalThis.document.title.startsWith('Logga in') &&
        !globalThis.document.querySelector('main[role="status"]'),
    )
    await requestCanceled
    holds.get(3).release()

    const invalidResponse = privatePage.waitForResponse(isPresentationResponse, {
      timeout: TIMEOUT,
    })
    await clientNavigate(privatePage, '/')
    assert.equal(
      (await invalidResponse).status(),
      200,
      'A null payload returns a successful HTTP response',
    )
    await privatePage.getByText('Webbplatsen kunde inte laddas just nu.', { exact: true }).waitFor()
    assert.equal(await privatePage.locator(HERO_AMPERSAND).count(), 0)

    const unavailableResponse = privatePage.waitForResponse(isPresentationResponse, {
      timeout: TIMEOUT,
    })
    await privatePage.getByRole('button', { name: 'Försök igen', exact: true }).click()
    assert.equal((await unavailableResponse).status(), 503, 'HTTP 503 stays in the failure state')
    await privatePage.getByText('Webbplatsen kunde inte laddas just nu.', { exact: true }).waitFor()
    assert.equal(await privatePage.locator(HERO_AMPERSAND).count(), 0)

    const retryResponse = privatePage.waitForResponse(isPresentationResponse, { timeout: TIMEOUT })
    await privatePage.getByRole('button', { name: 'Försök igen', exact: true }).click()
    assert.equal((await retryResponse).status(), 200)
    const retryPaint = await readPublishedHero(privatePage, 'manual retry')

    const emptyPage = await context.newPage()
    const emptyResponse = emptyPage.waitForResponse(isPresentationResponse, { timeout: TIMEOUT })
    await emptyPage.goto(`${workerOrigin}/?cms-empty-presentation=1`, {
      waitUntil: 'domcontentloaded',
    })
    assert.equal((await emptyResponse).status(), 200, 'The empty presentation response is valid')
    assert.equal(
      await emptyPage.locator(HERO_AMPERSAND).count(),
      0,
      'An empty presentation does not create a projected CMS wrapper',
    )
    const baselineAmpersand = emptyPage.locator(BASELINE_HERO_AMPERSAND)
    await baselineAmpersand.waitFor({ state: 'visible' })
    const baselineOpacity = await baselineAmpersand.evaluate(
      (node) => globalThis.getComputedStyle(node).opacity,
    )
    assert.equal(
      baselineOpacity,
      '1',
      'A validated empty presentation is authoritative and may render the code baseline',
    )
    await emptyPage.waitForFunction(() => {
      const samples = globalThis.window.__kncCmsAmpersandPaintSamples ?? []
      return samples.length > 0
    })
    const emptySamples = await emptyPage.evaluate(() => [
      ...(globalThis.window.__kncCmsAmpersandPaintSamples ?? []),
    ])
    assert.deepEqual(
      [...new Set(emptySamples)],
      ['1'],
      'An authoritative empty response renders only the unstyled code baseline',
    )

    const noScriptFallback = await verifyNoScriptFallback(browser, workerOrigin)
    const metrics = {
      browser: browser.browserType().name(),
      presentationSource: 'intercepted local CMS response fixture',
      directLoad: { ...directPending, ...directPaint },
      hardRefresh: { ...reloadPending, ...reloadPaint },
      adminToPublic: routePending,
      nullThen503Retry: retryPaint,
      authoritativeEmptyBaseline: {
        opacity: baselineOpacity,
        sampleCount: emptySamples.length,
        sampledValues: [...new Set(emptySamples)],
      },
      noScriptFallback,
    }
    await writeFile(
      join(work, `public-first-paint-${metrics.browser}.json`),
      JSON.stringify(metrics, null, 2),
    )
    return metrics
  } finally {
    for (const hold of holds.values()) hold.release()
    await context.close()
  }
}

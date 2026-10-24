import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { inflateSync } from 'node:zlib'
import { emptyDocument } from '../../shared/cms.ts'

const PRESENTATION_PATH = '/api/cms/presentation'
const HERO_AMPERSAND =
  '[data-knc-surface="mobile-home"] svg[aria-label="Blade & Blend Studio"] > text:nth-of-type(3)'
const BASELINE_HERO_AMPERSAND =
  '[data-knc-fold="hero"] svg[aria-label="Blade & Blend Studio"] > text:nth-of-type(3)'
const DESKTOP_PANEL = '[data-testid="desktop-top-panel"]'
const INTRO_HEADING_ID = 'public-intro-heading'
const LOADING_TEXT = 'Laddar webbplatsen…'
const ERROR_TEXT = 'Webbplatsen kunde inte laddas just nu.'
const RETRY_BUTTON = { name: 'Försök igen', exact: true }
// The client pauses about 500 ms, then about 1,500 ms, before its two automatic re-reads.
const FIRST_RETRY_GAP_MS = 400
const SECOND_RETRY_GAP_MS = 1300
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

const answers = {
  presentation: (presentation) => (route) =>
    route.fulfill({ headers: NO_STORE, json: { revision: 1, presentation } }),
  // The Worker's own answer when the database read fails or times out (src/worker.ts).
  unavailable: () => (route) =>
    route.fulfill({ status: 503, headers: NO_STORE, json: { error: 'unavailable' } }),
  invalid: () => (route) =>
    route.fulfill({ headers: NO_STORE, json: { revision: 2, presentation: null } }),
}

/** An answer that waits for `release()`. The page may abort the request while it waits. */
function heldAnswer(presentation) {
  let release
  const released = new Promise((resolve) => {
    release = resolve
  })
  const answer = async (route) => {
    await released
    await route.fulfill({ headers: NO_STORE, json: { revision: 1, presentation } }).catch(() => {
      // Leaving the route aborted this request; there is nobody left to answer.
    })
  }
  return { answer, release }
}

/**
 * Every presentation read is answered from a plan, in request order, and logged with its arrival
 * time. A read without a planned answer is a failure: it is what a second, unreused request per
 * load (or a retry that should not exist) looks like.
 */
async function installPresentationPlan(context) {
  const planned = []
  const served = []
  const unplanned = []
  await context.route('**/api/cms/presentation', async (route) => {
    if (route.request().method() !== 'GET') return route.continue()
    const answer = planned.shift()
    served.push(Date.now())
    if (answer === undefined) {
      unplanned.push(served.length)
      return route.fulfill({ status: 500, headers: NO_STORE, json: { error: 'unplanned' } })
    }
    return answer(route)
  })
  return {
    plan: (...next) => planned.push(...next),
    served,
    assertSettled(label) {
      assert.deepEqual(unplanned, [], `${label}: every presentation read was planned`)
      assert.equal(planned.length, 0, `${label}: every planned presentation read happened`)
    },
  }
}

/** Per animation frame: what the visitor could see before and while the app renders. */
function installPaintSampler(selectors) {
  const state = {
    ampersand: [],
    introFrames: 0,
    loadingFrames: 0,
    errorFrames: 0,
    firstErrorAt: null,
  }
  globalThis.window.__kncCmsAmpersandPaintSamples = state.ampersand
  globalThis.window.__kncFirstPaint = state
  // Visually hidden means the usual clip pattern: a box of at most 1 x 1 px.
  const shown = (element) => {
    const box = element?.getBoundingClientRect()
    return box !== undefined && (box.width > 1 || box.height > 1)
  }
  const elementWithText = (text) => {
    const walker = globalThis.document.createTreeWalker(globalThis.document.body, 4)
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode())
      if (node.textContent?.includes(text)) return node.parentElement
    return null
  }
  const sample = () => {
    const document = globalThis.document
    const glyph =
      document.querySelector(selectors.published) ?? document.querySelector(selectors.baseline)
    if (glyph) state.ampersand.push(globalThis.getComputedStyle(glyph).opacity)
    const intro = document.getElementById(selectors.intro)
    if (intro !== null && intro.getClientRects().length > 0) state.introFrames++
    const text = document.body?.textContent ?? ''
    if (text.includes(selectors.loading) && shown(elementWithText(selectors.loading)))
      state.loadingFrames++
    if (text.includes(selectors.error)) {
      state.errorFrames++
      state.firstErrorAt ??= Date.now()
    }
    globalThis.window.requestAnimationFrame(sample)
  }
  globalThis.window.requestAnimationFrame(sample)
}

const paintState = (page) => page.evaluate(() => ({ ...globalThis.window.__kncFirstPaint }))

function paeth(left, up, upLeft) {
  const estimate = left + up - upLeft
  const [a, b, c] = [left, up, upLeft].map((value) => Math.abs(estimate - value))
  return a <= b && a <= c ? left : b <= c ? up : upLeft
}

/** Distinct colours of a screenshot (8-bit RGB or RGBA, not interlaced: what every engine writes). */
function screenshotColours(png) {
  const chunks = []
  let header
  for (let offset = 8; offset < png.length;) {
    const length = png.readUInt32BE(offset)
    const type = png.toString('latin1', offset + 4, offset + 8)
    const data = png.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') header = data
    if (type === 'IDAT') chunks.push(data)
    offset += length + 12
  }
  const [width, height] = [header.readUInt32BE(0), header.readUInt32BE(4)]
  const channels = { 2: 3, 6: 4 }[header[9]]
  assert.ok(header[8] === 8 && header[12] === 0 && channels, 'unsupported screenshot PNG format')
  const pixels = inflateSync(Buffer.concat(chunks))
  const stride = width * channels
  let previous = Buffer.alloc(stride)
  const colours = new Set()
  for (let y = 0; y < height; y++) {
    const filter = pixels[y * (stride + 1)]
    const row = Buffer.from(pixels.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)))
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? row[x - channels] : 0
      const upLeft = x >= channels ? previous[x - channels] : 0
      const predictor = [0, left, previous[x], (left + previous[x]) >> 1]
      row[x] += filter === 4 ? paeth(left, previous[x], upLeft) : predictor[filter]
    }
    for (let x = 0; x < stride; x += channels)
      colours.add((row[x] << 16) | (row[x + 1] << 8) | row[x + 2])
    previous = row
  }
  return colours
}

const pageBackground = (page) =>
  page.evaluate(() => ({
    html: globalThis.getComputedStyle(globalThis.document.documentElement).backgroundColor,
    body: globalThis.getComputedStyle(globalThis.document.body).backgroundColor,
  }))

/** While the presentation is read the page is its background: no intro, gate text or old hero. */
async function assertBackgroundOnly(page, label) {
  // Leave the browser a few frames to paint (and the sampler to record) whatever it would show.
  await page.waitForTimeout(450)
  const state = await page.evaluate(
    (selectors) => ({
      ampersand: globalThis.document.querySelector(selectors.published) !== null,
      baselineAmpersand: globalThis.document.querySelector(selectors.baseline) !== null,
      fallbackVisible: globalThis.document.body.innerText.includes('Aktivera JavaScript'),
      statusInsideMain:
        globalThis.document.querySelector('main [role="status"]')?.textContent ===
        selectors.loading,
      landmarkRole: globalThis.document.querySelector('main[role]')?.getAttribute('role') ?? null,
    }),
    { published: HERO_AMPERSAND, baseline: BASELINE_HERO_AMPERSAND, loading: LOADING_TEXT },
  )
  const painted = await paintState(page)
  const colours = screenshotColours(await page.screenshot())
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
  assert.equal(painted.introFrames, 0, `${label}: no frame showed the agent intro text`)
  assert.equal(painted.loadingFrames, 0, `${label}: no frame showed visible loading text`)
  assert.equal(
    state.statusInsideMain,
    true,
    `${label}: assistive technology still hears the loading status`,
  )
  assert.equal(state.landmarkRole, null, `${label}: the gate keeps its main landmark role`)
  assert.equal(colours.size, 1, `${label}: the page shows only its background colour`)
  assert.deepEqual(
    painted.ampersand,
    [],
    `${label}: the browser never sampled the legacy opaque ampersand`,
  )
  return { background: await pageBackground(page), screenshotColours: colours.size }
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

/** 'hero' once the published hero renders, 'error' once the failure state does. */
async function outcomeOf(page) {
  const outcome = await page.waitForFunction(
    ({ hero, error }) =>
      globalThis.document.querySelector(hero) !== null
        ? 'hero'
        : (globalThis.document.body.textContent?.includes(error) ?? false) && 'error',
    { hero: HERO_AMPERSAND, error: ERROR_TEXT },
  )
  return outcome.jsonValue()
}

async function clientNavigate(page, path) {
  await page.evaluate((nextPath) => {
    globalThis.history.pushState({}, '', nextPath)
    globalThis.dispatchEvent(new globalThis.PopStateEvent('popstate'))
  }, path)
}

async function leaveForLogin(page) {
  await clientNavigate(page, '/login')
  await page.waitForFunction(
    (loading) =>
      globalThis.document.title.startsWith('Logga in') &&
      !globalThis.document.body.textContent?.includes(loading),
    LOADING_TEXT,
  )
}

/** A held read on a new tab or a reload: background only, then the published home, one request. */
async function verifyHeldLoad(page, presentations, presentation, label, load) {
  const held = heldAnswer(presentation)
  const before = presentations.served.length
  presentations.plan(held.answer)
  const request = page.waitForRequest(isPresentationRequest, { timeout: TIMEOUT })
  const checked = request
    .then(() => assertBackgroundOnly(page, label))
    .finally(() => held.release())
  // Both settle before this returns, so a failed check never leaves the navigation unobserved.
  const [pending] = await Promise.all([checked, load()])
  return { pending, requests: () => presentations.served.length - before }
}

/** Desktop pre-paint (STY-3): the background before the app equals the one it paints. */
async function verifyDesktopPrePaint(context, presentations, presentation, workerOrigin, scheme) {
  const page = await context.newPage()
  try {
    await page.setViewportSize({ width: 1280, height: 720 })
    await page.emulateMedia({ colorScheme: scheme })
    const label = `desktop ${scheme}`
    const load = await verifyHeldLoad(page, presentations, presentation, label, () =>
      page.goto(`${workerOrigin}/`, { waitUntil: 'domcontentloaded' }),
    )
    await page.locator(DESKTOP_PANEL).waitFor({ state: 'visible' })
    const painted = await pageBackground(page)
    assert.deepEqual(
      load.pending.background,
      painted,
      `${label}: the pre-paint background equals the painted home`,
    )
    assert.equal(load.requests(), 1, `${label}: one presentation request for the load`)
    return { prePaint: load.pending.background, painted }
  } finally {
    await page.close()
  }
}

async function verifyNoScriptFallback(createContext, workerOrigin) {
  const enabledContext = await createContext({ ignoreHTTPSErrors: true })
  const disabledContext = await createContext({
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
    assert.match(html, new RegExp(`id="${INTRO_HEADING_ID}"`), 'Agents receive the intro text')
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
    assert.equal(
      await enabled.locator(`#${INTRO_HEADING_ID}`).isVisible(),
      false,
      'Script-enabled visitors never see the agent intro while the bundle is delayed or blocked',
    )

    const disabled = await disabledContext.newPage()
    const noScriptResponse = await disabled.goto(`${workerOrigin}/`, {
      waitUntil: 'domcontentloaded',
    })
    assert.equal(noScriptResponse?.status(), 200)
    const fallback = disabled.getByText(/Aktivera JavaScript/)
    await fallback.waitFor({ state: 'visible' })
    assert.equal(await fallback.isVisible(), true, 'The no-JavaScript fallback remains available')
    assert.equal(
      await disabled.locator(`#${INTRO_HEADING_ID}`).isVisible(),
      true,
      'Visitors without scripting keep the intro text',
    )
    return { delayedScripts, fallbackVisibleWithoutScripting: true, introWithoutScripting: true }
  } finally {
    await enabledContext.close()
    await disabledContext.close()
  }
}

/** Exercise real Worker HTML and client startup while the public presentation request is controlled. */
export async function verifyPublicFirstPaint(createContext, engineName, workerOrigin, work) {
  const context = await createContext({
    viewport: { width: 390, height: 844 },
    colorScheme: 'light',
    reducedMotion: 'reduce',
    ignoreHTTPSErrors: true,
  })
  context.setDefaultTimeout(TIMEOUT)
  const presentation = firstPaintPresentation()
  const emptyPresentation = emptyDocument().presentation
  await context.addInitScript(installPaintSampler, {
    published: HERO_AMPERSAND,
    baseline: BASELINE_HERO_AMPERSAND,
    intro: INTRO_HEADING_ID,
    loading: LOADING_TEXT,
    error: ERROR_TEXT,
  })
  const presentations = await installPresentationPlan(context)

  try {
    const page = await context.newPage()
    let directResponse
    const direct = await verifyHeldLoad(page, presentations, presentation, 'new tab', async () => {
      directResponse = await page.goto(`${workerOrigin}/`, { waitUntil: 'domcontentloaded' })
    })
    assert.equal(directResponse?.status(), 200, 'A new public tab receives the Worker homepage')
    const directPaint = await readPublishedHero(page, 'new tab')
    assert.equal(direct.requests(), 1, 'new tab: one presentation request for the load')
    assert.deepEqual(
      await pageBackground(page),
      direct.pending.background,
      'new tab: the pre-paint background equals the painted home',
    )
    await page.screenshot({
      path: join(work, `public-first-paint-${engineName}-new-tab.png`),
    })

    const reload = await verifyHeldLoad(page, presentations, presentation, 'hard refresh', () =>
      page.reload({ waitUntil: 'domcontentloaded' }),
    )
    const reloadPaint = await readPublishedHero(page, 'hard refresh')
    assert.equal(reload.requests(), 1, 'hard refresh: one presentation request for the load')
    await page.screenshot({
      path: join(work, `public-first-paint-${engineName}-hard-refresh.png`),
    })

    const privatePage = await context.newPage()
    await privatePage.goto(`${workerOrigin}/login`, { waitUntil: 'domcontentloaded' })
    await privatePage.waitForFunction(() => globalThis.document.title.startsWith('Logga in'))
    const held = heldAnswer(presentation)
    presentations.plan(held.answer)
    const delayedRequest = privatePage.waitForRequest(isPresentationRequest, { timeout: TIMEOUT })
    await clientNavigate(privatePage, '/')
    await delayedRequest
    const routePending = await assertBackgroundOnly(privatePage, 'admin to public navigation')
    const requestCanceled = privatePage.waitForEvent('requestfailed', {
      predicate: isPresentationRequest,
      timeout: TIMEOUT,
    })
    await leaveForLogin(privatePage)
    await requestCanceled
    held.release()

    // Leaving the route during the pause before a retry ends the sequence.
    const abandonedFrom = presentations.served.length
    presentations.plan(answers.unavailable())
    const abandoned = privatePage.waitForResponse(
      (response) => isPresentationRequest(response.request()),
      { timeout: TIMEOUT },
    )
    await clientNavigate(privatePage, '/')
    await abandoned
    await leaveForLogin(privatePage)
    await privatePage.waitForTimeout(FIRST_RETRY_GAP_MS + 600)
    assert.equal(
      presentations.served.length - abandonedFrom,
      1,
      'leaving the route cancels the pending retry',
    )

    // Three failed reads end in the error state; the manual retry starts a new bounded sequence.
    await privatePage.evaluate(() => {
      globalThis.window.__kncFirstPaint.firstErrorAt = null
    })
    const exhaustedFrom = presentations.served.length
    presentations.plan(answers.unavailable(), answers.invalid(), answers.unavailable())
    await clientNavigate(privatePage, '/')
    await privatePage.getByText(ERROR_TEXT, { exact: true }).waitFor()
    const exhausted = presentations.served.slice(exhaustedFrom)
    assert.equal(exhausted.length, 3, 'failed reads: two automatic retries before the error state')
    assert.ok(
      exhausted[1] - exhausted[0] >= FIRST_RETRY_GAP_MS &&
        exhausted[2] - exhausted[1] >= SECOND_RETRY_GAP_MS,
      `failed reads: the retries back off (${exhausted[1] - exhausted[0]} ms, ${exhausted[2] - exhausted[1]} ms)`,
    )
    const failed = await paintState(privatePage)
    assert.ok(
      failed.firstErrorAt >= exhausted[2],
      'failed reads: the error state appears only after the last read',
    )
    assert.equal(await privatePage.locator(HERO_AMPERSAND).count(), 0)

    const manualFrom = presentations.served.length
    presentations.plan(answers.unavailable(), answers.presentation(presentation))
    const manualFailure = privatePage.waitForResponse(
      (response) => isPresentationRequest(response.request()),
      { timeout: TIMEOUT },
    )
    await privatePage.getByRole('button', RETRY_BUTTON).click()
    assert.equal((await manualFailure).status(), 503, 'manual retry: the first read fails again')
    const errorFramesAfterClick = (await paintState(privatePage)).errorFrames
    assert.equal(await outcomeOf(privatePage), 'hero', 'manual retry: its bounded retry succeeds')
    assert.equal(
      (await paintState(privatePage)).errorFrames,
      errorFramesAfterClick,
      'manual retry: the error state never flashed during its automatic retry',
    )
    assert.equal(presentations.served.length - manualFrom, 2, 'manual retry: one automatic retry')
    const retryPaint = await readPublishedHero(privatePage, 'manual retry')

    // A new visitor during a slow database (start of a minute): the 503 is retried, never shown.
    const transientPage = await context.newPage()
    const transientFrom = presentations.served.length
    presentations.plan(answers.unavailable(), answers.presentation(presentation))
    await transientPage.goto(`${workerOrigin}/`, { waitUntil: 'domcontentloaded' })
    assert.equal(
      await outcomeOf(transientPage),
      'hero',
      'transient 503: the client retries automatically instead of showing the error state',
    )
    const transient = presentations.served.slice(transientFrom)
    assert.equal(transient.length, 2, 'transient 503: one automatic retry')
    assert.ok(
      transient[1] - transient[0] >= FIRST_RETRY_GAP_MS,
      `transient 503: the retry waits first (${transient[1] - transient[0]} ms)`,
    )
    const transientFrames = await paintState(transientPage)
    assert.equal(transientFrames.errorFrames, 0, 'transient 503: the error state never flashed')
    assert.equal(transientFrames.loadingFrames, 0, 'transient 503: no visible loading text')
    assert.equal(transientFrames.introFrames, 0, 'transient 503: no frame showed the agent intro')
    const transientPaint = await readPublishedHero(transientPage, 'transient 503')

    const desktop = []
    for (const scheme of ['light', 'dark'])
      desktop.push(
        await verifyDesktopPrePaint(context, presentations, presentation, workerOrigin, scheme),
      )

    const emptyPage = await context.newPage()
    presentations.plan(answers.presentation(emptyPresentation))
    const emptyResponse = emptyPage.waitForResponse(
      (response) => isPresentationRequest(response.request()),
      { timeout: TIMEOUT },
    )
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
    presentations.assertSettled('presentation reads')

    const noScriptFallback = await verifyNoScriptFallback(createContext, workerOrigin)
    const metrics = {
      browser: engineName,
      presentationSource: 'intercepted local CMS response fixture',
      directLoad: { ...direct.pending, ...directPaint },
      hardRefresh: { ...reload.pending, ...reloadPaint },
      adminToPublic: routePending,
      transient503Retry: { gapMs: transient[1] - transient[0], ...transientPaint },
      exhaustedRetries: {
        gapsMs: [exhausted[1] - exhausted[0], exhausted[2] - exhausted[1]],
      },
      manualRetry: retryPaint,
      desktopPrePaint: desktop,
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
    await context.close()
  }
}

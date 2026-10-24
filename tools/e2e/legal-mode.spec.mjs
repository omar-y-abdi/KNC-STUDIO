// Worker-rendered CMS pages in the visitor's colour scheme (PAR-2, STY-1, LIB-8, STY-10, TST-2).
// Each document is the real Worker output (tools/e2e/cms-render.mjs) for the committed production
// fixture plus a page created the way the Studio creates one, with the served harness build's
// index.html as the shell and the production CSP. The preview server supplies the built stylesheet
// and fonts. visual.spec.mjs stays the guard for the code-rendered homepage.

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { gunzipSync } from 'node:zlib'
import { createSitePage } from '../../shared/site-page.ts'
import { loadWorker, routeWorkerDocuments } from './cms-render.mjs'
import { expect, test } from './fixtures.mjs'
import { publicOrigin } from './origins.mjs'
import { installPublicBackend } from './public-fixtures.mjs'

const AXE_SOURCE = readFileSync(
  createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
  'utf8',
)
const fixture = JSON.parse(
  gunzipSync(readFileSync(new URL('./fixtures/presentation.json.gz', import.meta.url))),
).presentation

// What the Studio's "Skapa ny sida" dialog creates with its defaults (src/admin/cms/Studio.tsx,
// createPage): the same starter markup, materialised by createSitePage over the presentation.
function studioCreatedPage(presentation) {
  const starter = (language) =>
    `<main style="max-width:1120px;min-height:55vh;margin:0 auto;padding:64px 32px"><h1 style="font-size:40px;line-height:1.15;letter-spacing:-1px;margin:0 0 24px">Ny sida</h1><p style="font-size:17px;line-height:1.7">${language === 'sv' ? 'Skriv din text här.' : 'Write your page here.'}</p></main>`
  return createSitePage(presentation, {
    id: '20000000-0000-4000-8000-000000000001',
    kind: 'page',
    path: '/hemsida',
    inMenu: true,
    name: { sv: 'Ny sida', en: 'New page' },
    title: { sv: 'Ny sida', en: 'New page' },
    description: { sv: '', en: '' },
    content: {
      sv: { html: starter('sv'), css: { light: '', dark: '' } },
      en: { html: starter('en'), css: { light: '', dark: '' } },
    },
  })
}

const published = globalThis.structuredClone(fixture)
published.pages.push(studioCreatedPage(published))

// The element that paints each page and its colour per scheme, from the fixture CSS and the site
// theme: /terms colours :root, /privacy colours body, a created page colours its site shell.
// A created page's header is the published home header, copied by createSitePage with its own
// colours: its phone link and language label measure 4.28:1 and 3.76:1 in light (the same CSS and
// markup as before this change), and its wordmark is SVG text that axe cannot measure. The contrast
// check covers the rest of that page.
const PAGES = [
  { path: '/terms', surface: 'html', light: 'rgb(244, 243, 240)', dark: 'rgb(28, 28, 30)' },
  { path: '/privacy', surface: 'body', light: 'rgb(255, 255, 255)', dark: 'rgb(15, 17, 21)' },
  {
    path: '/hemsida',
    surface: '#cms-site-shell',
    light: 'rgb(255, 255, 255)',
    dark: 'rgb(28, 28, 30)',
    unmeasured: ['#cms-site-header'],
  },
]
const PATHS = PAGES.map(({ path }) => path)
const MIN_CONTRAST = 4.5

let rendering
let shell
test.beforeAll(async () => {
  const response = await fetch(`${publicOrigin}/index.html`)
  if (!response.ok)
    throw new Error(`The preview server answered ${response.status} for /index.html`)
  shell = await response.text()
  rendering = await loadWorker()
})
test.afterAll(async () => {
  if (rendering) await rendering.close()
})

/** Open `url` as the Worker serves it, recording script requests, CSP reports and page errors. */
async function visit(page, context, url, presentation = published) {
  await installPublicBackend(context)
  await page.addInitScript(() => {
    const reports = []
    globalThis.__cspReports = reports
    globalThis.document.addEventListener('securitypolicyviolation', (event) =>
      reports.push(`${event.effectiveDirective} ${event.blockedURI}`),
    )
  })
  const scripts = []
  page.on('request', (request) => {
    if (request.resourceType() === 'script' || new URL(request.url()).pathname.endsWith('.js'))
      scripts.push(request.url())
  })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await routeWorkerDocuments(page, {
    origin: publicOrigin,
    paths: PATHS,
    worker: rendering.worker,
    presentation,
    shell,
  })
  const response = await page.goto(`${publicOrigin}${url}`, { waitUntil: 'load' })
  expect(response?.status()).toBe(200)
  // Lazily imported chunks of an app bundle would arrive after load.
  await page.waitForLoadState('networkidle')
  return {
    scriptRequests: () => scripts.length,
    /** Everything a visit must never show: script requests, blocked scripts, page errors. */
    async faults() {
      const reports = await page.evaluate(() => globalThis.__cspReports)
      return {
        scripts,
        blockedScripts: reports.filter((report) => report.startsWith('script-src')),
        errors,
      }
    },
    reports: () => page.evaluate(() => globalThis.__cspReports),
  }
}

/**
 * The browser chrome colour as the browser picks it: the first theme-color whose media matches,
 * resolved so that "#f4f3f0" reads as "rgb(244, 243, 240)".
 */
function themeColor(page) {
  return page.evaluate(() => {
    const { document } = globalThis
    const meta = [...document.querySelectorAll('meta[name="theme-color"]')].find(
      (candidate) => !candidate.media || globalThis.matchMedia(candidate.media).matches,
    )
    if (!meta) return null
    const probe = document.createElement('span')
    document.documentElement.append(probe)
    probe.style.color = meta.content
    const color =
      probe.style.color === ''
        ? `unparsed ${meta.content}`
        : globalThis.getComputedStyle(probe).color
    probe.remove()
    return color
  })
}

/** The painted surface, the browser chrome colour and the bundle markers of the open page. */
async function paint(page, selector) {
  const painted = await page.evaluate((selector) => {
    const { document } = globalThis
    const style = (element) => globalThis.getComputedStyle(element)
    const surface = document.querySelector(selector)
    const visible = (color) => color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)'
    return {
      surface: surface ? style(surface).backgroundColor : null,
      // Distinct colours html and body paint: two means the body box shows on a different canvas.
      canvas: [
        ...new Set(
          [document.documentElement, document.body]
            .map((element) => style(element).backgroundColor)
            .filter(visible),
        ),
      ],
      moduleMarkup: document.querySelectorAll('script[type="module"], link[rel="modulepreload"]')
        .length,
      inlineStyles: [document.documentElement, document.body]
        .map((element) => element.getAttribute('style'))
        .filter((value) => value !== null),
      rootColorScheme: document.documentElement.style.colorScheme,
    }
  }, selector)
  return { ...painted, themeColor: await themeColor(page) }
}

/** Two animation frames: long enough for any scheduled theme update to have run. */
const settle = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) =>
        globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve)),
      ),
  )

/** axe color-contrast over the page minus `unmeasured`, with the lowest ratio for the report. */
async function contrast(page, unmeasured) {
  // Injected through the automation channel: the page's CSP allows no injected script tags.
  await page.evaluate(`${AXE_SOURCE}\n;undefined`)
  return page.evaluate(async (unmeasured) => {
    const context = { include: [globalThis.document], exclude: unmeasured.map((at) => [at]) }
    const results = await globalThis.axe.run(context, {
      runOnly: { type: 'rule', values: ['color-contrast'] },
    })
    const nodes = (rules) => rules.flatMap((rule) => rule.nodes)
    const describe = (node) => `${node.target.join(' ')}: ${JSON.stringify(node.any[0]?.data)}`
    const ratios = [...nodes(results.passes), ...nodes(results.violations)]
      .flatMap((node) => node.any)
      .map((check) => check.data?.contrastRatio)
      .filter((ratio) => Number.isFinite(ratio))
    return {
      passes: nodes(results.passes).length,
      violations: nodes(results.violations).map(describe),
      incomplete: nodes(results.incomplete).map(describe),
      minContrast: ratios.length > 0 ? Math.min(...ratios) : null,
    }
  }, unmeasured)
}

function report(testInfo, metrics) {
  testInfo.annotations.push({ type: 'metrics', description: JSON.stringify(metrics) })
}

/** Measure and report before asserting, so a failing run still records its numbers. */
async function measure(page, testInfo, target, opened, label) {
  const result = await contrast(page, target.unmeasured ?? [])
  const { surface, canvas, themeColor: chrome } = await paint(page, target.surface)
  report(testInfo, {
    label,
    minContrast: result.minContrast,
    passes: result.passes,
    violations: result.violations.length,
    scriptRequests: opened.scriptRequests(),
    surface,
    canvas,
    themeColor: chrome,
    cspReports: await opened.reports(),
  })
  return { label, ...result }
}

function expectReadable({ label, ...result }) {
  expect(result.violations, `${label}: color-contrast violations`).toEqual([])
  expect(result.incomplete, `${label}: contrast axe could not decide`).toEqual([])
  expect(result.passes, `${label}: axe measured text`).toBeGreaterThan(0)
  expect(result.minContrast, `${label}: lowest contrast`).toBeGreaterThanOrEqual(MIN_CONTRAST)
}

async function expectSurface(page, target, scheme) {
  await expect
    .poll(() => paint(page, target.surface), { message: `${target.path} paints ${scheme}` })
    .toMatchObject({ surface: target[scheme], themeColor: target[scheme] })
}

async function expectNoFaults(visitResult) {
  expect(await visitResult.faults()).toEqual({ scripts: [], blockedScripts: [], errors: [] })
}

for (const scheme of ['light', 'dark']) {
  for (const width of [390, 800, 1280]) {
    test.describe(`OS ${scheme}, ${width}px, no ?mode`, () => {
      test.use({ colorScheme: scheme, viewport: { width, height: 900 } })
      for (const target of PAGES) {
        test(`${target.path} follows the visitor's scheme`, async ({ page, context }, testInfo) => {
          const opened = await visit(page, context, target.path)
          const label = `${target.path} ${scheme} ${width}px`
          const readable = await measure(page, testInfo, target, opened, label)
          await expectSurface(page, target, scheme)
          const painted = await paint(page, target.surface)
          expect(painted.moduleMarkup, 'no app bundle on a page without a runtime island').toBe(0)
          expect(painted.inlineStyles, 'html and body backgrounds stay under the page CSS').toEqual(
            [],
          )
          expect(painted.canvas.length, 'one page colour behind the content').toBeLessThanOrEqual(1)
          expectReadable(readable)
          await expectNoFaults(opened)
        })
      }
    })
  }
}

for (const [mode, os] of [
  ['light', 'dark'],
  ['dark', 'light'],
]) {
  test.describe(`?mode=${mode} in an OS-${os} browser`, () => {
    test.use({ colorScheme: os, viewport: { width: 1280, height: 900 } })
    for (const target of PAGES) {
      test(`${target.path} stays ${mode} across OS changes`, async ({
        page,
        context,
      }, testInfo) => {
        const opened = await visit(page, context, `${target.path}?mode=${mode}`)
        const label = `${target.path}?mode=${mode} OS ${os}`
        const readable = await measure(page, testInfo, target, opened, label)
        await expectSurface(page, target, mode)
        expect((await paint(page, target.surface)).rootColorScheme).toBe(mode)
        expectReadable(readable)
        await page.emulateMedia({ colorScheme: mode })
        await page.emulateMedia({ colorScheme: os })
        await settle(page)
        expect(await paint(page, target.surface)).toMatchObject({
          surface: target[mode],
          themeColor: target[mode],
        })
        await expectNoFaults(opened)
      })
    }
  })
}

test.describe('an OS scheme change after load', () => {
  test.use({ colorScheme: 'light', viewport: { width: 1280, height: 900 } })
  for (const target of PAGES) {
    test(`${target.path} repaints and recolours the browser chrome`, async ({ page, context }) => {
      const opened = await visit(page, context, target.path)
      await expectSurface(page, target, 'light')
      await page.emulateMedia({ colorScheme: 'dark' })
      await expectSurface(page, target, 'dark')
      await page.emulateMedia({ colorScheme: 'light' })
      await expectSurface(page, target, 'light')
      await expectNoFaults(opened)
    })
  }
})

test.describe('the created page header toggles', () => {
  test.use({ colorScheme: 'dark', viewport: { width: 1280, height: 900 } })
  const [created] = PAGES.filter(({ path }) => path === '/hemsida')
  const hrefs = (page) =>
    page.evaluate(() =>
      Object.fromEntries(
        ['language', 'theme'].map((action) => [
          action,
          globalThis.document.querySelector(`#cms-site-header a.cms-site-action-${action}`)?.href,
        ]),
      ),
    )

  test('point at the opposite scheme and pin it on click', async ({ page, context }) => {
    const opened = await visit(page, context, created.path)
    const shown = await hrefs(page)
    expect(shown.language && shown.theme, 'both header toggles are rendered').toBeTruthy()
    expect(new URL(shown.language).searchParams.has('mode'), 'language keeps auto').toBe(false)
    expect(new URL(shown.theme).searchParams.get('mode')).toBe('light')
    await page.emulateMedia({ colorScheme: 'light' })
    await expect
      .poll(async () => new URL((await hrefs(page)).theme).searchParams.get('mode'))
      .toBe('dark')
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect
      .poll(async () => new URL((await hrefs(page)).theme).searchParams.get('mode'))
      .toBe('light')
    await page.locator('#cms-site-header a.cms-site-action-theme').click()
    await page.waitForURL((url) => url.searchParams.get('mode') === 'light')
    await expectSurface(page, created, 'light')
    await expectNoFaults(opened)
  })
})

// Owner CSS that paints the page background with a gradient and changes background and text
// together at the mobile breakpoint: the theme script must leave both under stylesheet control.
const OWNER_CSS =
  'html body{background:linear-gradient(#123456,#345678) #123456;color:#ffffff}' +
  '@media (max-width:768px){html body{background:#f0e0d0;color:#101010}}'
const DESKTOP = { gradient: true, background: 'rgb(18, 52, 86)', color: 'rgb(255, 255, 255)' }
const MOBILE = { gradient: false, background: 'rgb(240, 224, 208)', color: 'rgb(16, 16, 16)' }

function withOwnerCss(presentation) {
  const next = globalThis.structuredClone(presentation)
  const terms = next.pages.find(({ path }) => path === '/terms')
  for (const lang of ['sv', 'en'])
    for (const mode of ['light', 'dark']) terms.content[lang].css[mode] += OWNER_CSS
  return next
}

test.describe('owner CSS on html and body', () => {
  test.use({ colorScheme: 'light', viewport: { width: 1280, height: 900 } })
  const body = async (page) => ({
    ...(await page.evaluate(() => {
      const { document } = globalThis
      const style = globalThis.getComputedStyle(document.body)
      return {
        gradient: style.backgroundImage.includes('linear-gradient'),
        background: style.backgroundColor,
        color: style.color,
        inlineStyles: [document.documentElement, document.body]
          .map((element) => element.getAttribute('style'))
          .filter((value) => value !== null),
      }
    })),
    themeColor: await themeColor(page),
  })
  const expectBody = (page, expected) =>
    expect
      .poll(() => body(page))
      .toEqual({ ...expected, themeColor: expected.background, inlineStyles: [] })

  test('keeps its gradient and its breakpoint rules', async ({ page, context }) => {
    const opened = await visit(page, context, '/terms', withOwnerCss(published))
    await expectBody(page, DESKTOP)
    await page.setViewportSize({ width: 390, height: 900 })
    await expectBody(page, MOBILE)
    await page.setViewportSize({ width: 1280, height: 900 })
    await expectBody(page, DESKTOP)
    await expectNoFaults(opened)
  })
})

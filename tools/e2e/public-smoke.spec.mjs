import { test, expect } from './fixtures.mjs'
import { installPublicBackend } from './public-fixtures.mjs'
import { publicOrigin } from './origins.mjs'
import {
  verifyPublicPage,
  verifyNormalMotionGalleryKeyboard,
  verifyStaticEndpoints,
} from './public-checks.mjs'
for (const viewport of [
  { width: 1280, height: 900 },
  { width: 390, height: 844 },
])
  test.describe('public ' + viewport.width, () => {
    test.use({ viewport, contextOptions: { reducedMotion: 'reduce' }, hasTouch: true })
    test('booking, my bookings, gallery and discovery', async ({ page }) =>
      verifyPublicPage(page, viewport))
  })
test.describe('normal motion', () => {
  test.use({
    viewport: { width: 2400, height: 900 },
    contextOptions: { reducedMotion: 'no-preference' },
    hasTouch: true,
  })
  test('gallery keyboard and pointer controls', async ({ page }) =>
    verifyNormalMotionGalleryKeyboard(page))
})
test('static endpoints', async ({ page }) => verifyStaticEndpoints(page))

// LIB-4: the carousel engine (Embla and its auto-scroll plugin) is its own chunk, requested only
// once the mobile strip animates. A desktop visit never downloads it.
const ENGINE_SIGNATURES = ['inViewThreshold', 'stopOnMouseEnter'] // option names only the libraries spell

const carriesEngine = (text) => ENGINE_SIGNATURES.some((signature) => text.includes(signature))

// Opens the homepage and scrolls About (the only user of the engine) into view. Returns a reader
// for the scripts that carried the engine so far.
async function openHomepage(page, context, { blockEngine = false } = {}) {
  await installPublicBackend(context)
  if (blockEngine)
    await context.route(/\/assets\/[^/]+\.js$/, async (route) => {
      const response = await route.fetch()
      const body = await response.text()
      if (carriesEngine(body)) return route.abort('failed')
      return route.fulfill({ response, body })
    })
  const reads = []
  page.on('response', (response) => {
    if (response.request().resourceType() !== 'script') return
    reads.push(response.text().then((text) => (carriesEngine(text) ? response.url() : null)))
  })
  await page.goto(publicOrigin, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page
    .getByRole('button', { name: 'Byt språk till engelska', exact: true })
    .waitFor({ state: 'visible', timeout: 15000 })
  await page.locator('#om-oss').scrollIntoViewIfNeeded()
  return async () => (await Promise.all(reads)).filter((url) => url !== null)
}

const entryScript = (page) =>
  page.evaluate(() => globalThis.document.querySelector('script[type="module"][src]')?.src)

const translateX = (locator) =>
  locator.evaluate((node) => {
    const transform = globalThis.getComputedStyle(node).transform
    return transform === 'none' ? 0 : new globalThis.DOMMatrixReadOnly(transform).m41
  })

// The barber strip and its cards; the cards arrive with the roster once About is in view.
const barberStrip = (page) => page.locator('[aria-roledescription="carousel"]')

test.describe('carousel engine chunk', () => {
  test.describe('desktop', () => {
    test.use({
      viewport: { width: 1280, height: 900 },
      contextOptions: { reducedMotion: 'no-preference' },
    })
    test('is not requested while browsing the homepage', async ({ page, context }) => {
      const engineScripts = await openHomepage(page, context)
      await page.waitForTimeout(2500)
      expect(await engineScripts()).toEqual([])
    })
  })

  test.describe('mobile', () => {
    test.use({
      viewport: { width: 390, height: 844 },
      contextOptions: { reducedMotion: 'no-preference' },
      hasTouch: true,
    })
    test('arrives as its own chunk for the animated strip, which then moves', async ({
      page,
      context,
    }) => {
      const engineScripts = await openHomepage(page, context)
      const strip = barberStrip(page)
      await expect(strip.locator(':scope > *')).toHaveCount(2)
      const start = await translateX(strip)
      await expect.poll(async () => Math.abs((await translateX(strip)) - start)).toBeGreaterThan(5)
      const engine = await engineScripts()
      expect(engine).not.toEqual([])
      expect(engine).not.toContain(await entryScript(page))
    })

    test('keeps the strip scrollable when the chunk cannot load', async ({ page, context }) => {
      await openHomepage(page, context, { blockEngine: true })
      const strip = barberStrip(page)
      await expect(strip.locator(':scope > *')).toHaveCount(2)
      await expect
        .poll(() => strip.evaluate((node) => globalThis.getComputedStyle(node).overflowX))
        .toBe('auto')
      expect(await strip.evaluate((node) => node.scrollWidth > node.clientWidth)).toBe(true)
    })
  })
})

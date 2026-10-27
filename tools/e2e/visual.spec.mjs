// Code-fallback guard (TST-2): approved screenshots of the homepage as the app code renders it when
// the CMS document is empty (installPublicBackend serves an empty presentation), on the plain Vite
// preview without the Worker. It does not cover Worker-rendered CMS pages: legal-mode.spec.mjs
// renders those through the real Worker.
import { test, expect } from './fixtures.mjs'
import { installPublicBackend } from './public-fixtures.mjs'
import { publicOrigin } from './origins.mjs'

const base = publicOrigin
for (const viewport of [
  { device: 'desktop', width: 1280, height: 900 },
  { device: 'mobile', width: 390, height: 844 },
]) {
  for (const scheme of ['light', 'dark']) {
    for (const lang of ['sv', 'en']) {
      const name = `${viewport.device}-${scheme}-${lang}.png`
      test.describe(name, () => {
        test.use({
          viewport: { width: viewport.width, height: viewport.height },
          colorScheme: scheme,
          deviceScaleFactor: 2,
          contextOptions: { reducedMotion: 'reduce' },
        })
        test('approved public screenshot', async ({ page, context }) => {
          await installPublicBackend(context)
          await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 })
          const english = page.getByRole('button', { name: 'Byt språk till engelska', exact: true })
          await english.waitFor({ state: 'visible', timeout: 15000 })
          await page.evaluate(() => globalThis.document.fonts.ready)
          if (lang === 'en') {
            await english.click()
            await page
              .getByRole('button', { name: 'Switch language to Swedish', exact: true })
              .waitFor({ state: 'visible', timeout: 15000 })
          }
          await page.waitForFunction(() =>
            [...globalThis.document.images].every((image) => image.complete),
          )
          await page.waitForFunction(() =>
            globalThis.document
              .getAnimations()
              .every(
                (animation) =>
                  animation.effect?.getComputedTiming().iterations === Infinity ||
                  ['finished', 'idle'].includes(animation.playState),
              ),
          )
          await expect(page).toHaveScreenshot(name, {
            // Preserve the existing pixelmatch policy and 2x image dimensions.
            threshold: 0.1,
            maxDiffPixelRatio: 0.001,
            scale: 'device',
            animations: 'allow',
            caret: 'initial',
          })
        })
      })
    }
  }
}

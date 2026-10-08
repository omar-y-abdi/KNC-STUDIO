import { test, expect } from './fixtures.mjs'
import { installEmptyCmsPresentation } from './public-first-paint.mjs'

const base = process.env.PUBLIC_BASE_URL ?? 'http://127.0.0.1:4173'
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
          await installEmptyCmsPresentation(context)
          await page.goto(base, { waitUntil: 'domcontentloaded', timeout: 30000 })
          const english = page.getByRole('button', { name: 'Byt språk till engelska', exact: true })
          await english.waitFor({ state: 'visible', timeout: 15000 })
          await page.evaluate(() => globalThis.document.fonts.ready)
          if (lang === 'en') {
            await english.click()
            await page
              .getByRole('button', { name: 'Switch language to Swedish', exact: true })
              .waitFor({ state: 'visible', timeout: 15000 })
            await page.waitForTimeout(500)
          }
          await page.waitForTimeout(700)
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

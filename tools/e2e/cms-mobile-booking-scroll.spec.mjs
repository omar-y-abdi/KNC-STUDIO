import { test, expect } from './fixtures.mjs'
import { harnessOrigin } from './origins.mjs'
import { installStoredBackend } from './public-fixtures.mjs'
import { validateMarkup } from '../../packages/content-contracts/src/cms-markup.ts'
import { CMS_BUILT_ASSETS } from '../../packages/content-contracts/src/cms-built-assets.ts'

test('captured booking opens at its content and folds reversibly in the editing canvas', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await installStoredBackend(context)
  await context.addCookies([
    { name: 'bladeblend_storage_preferences', value: 'essential', url: harnessOrigin },
  ])
  await page.goto(`${harnessOrigin}/booking?mode=light`)
  await page.getByTestId('booking-barber-option').first().waitFor()
  const capture = await page.evaluate(async () => {
    const { snapshotNative, mergeModes } = await import('/modules/studio/src/nativePages.ts')
    const { nativeCanvas } = await import('/modules/studio/src/nativeCanvas.ts')
    const { canvasBehavior } = await import('/modules/studio/src/canvasBehavior.ts')
    const source = globalThis.document.querySelector('[data-knc-surface="mobile-booking"]')
    const snapshot = snapshotNative(source, 'mobile-booking')
    const html = mergeModes(snapshot, snapshot)
    const canvas = nativeCanvas({ html, css: { light: '', dark: '' } }, 'light')
    const frame = globalThis.document.createElement('iframe')
    frame.id = 'booking-canvas-fixture'
    frame.style.cssText = 'position:fixed;inset:0;width:390px;height:844px;border:0;z-index:999'
    globalThis.document.body.appendChild(frame)
    const parsed = new globalThis.DOMParser().parseFromString(canvas.html, 'text/html')
    frame.contentDocument.body.replaceChildren(
      frame.contentDocument.importNode(parsed.body.firstElementChild, true),
    )
    const style = frame.contentDocument.createElement('style')
    style.textContent = `body{margin:0}${canvas.css}`
    frame.contentDocument.head.appendChild(style)
    globalThis.disposeBookingCanvas = canvasBehavior(
      {
        Canvas: { getDocument: () => frame.contentDocument },
        on: () => undefined,
        off: () => undefined,
        refresh: () => undefined,
      },
      'default',
      'light',
    )
    return { html, css: canvas.css }
  })
  validateMarkup(
    capture.html,
    capture.css,
    {
      siteOrigin: harnessOrigin,
      storageOrigin: 'https://admin-harness.invalid',
      builtAssets: CMS_BUILT_ASSETS,
    },
    { native: true },
  )
  const frame = page.frameLocator('#booking-canvas-fixture')
  const root = frame.locator('[data-knc-surface="mobile-booking"]')
  const panel = frame.locator('[data-knc-fold="panel"]')
  await expect.poll(() => root.evaluate((root) => root.scrollTop)).toBe(732)
  await expect.poll(() => panel.evaluate((panel) => panel.offsetHeight)).toBe(112)
  await root.evaluate((root) => {
    root.scrollTop = 0
  })
  await expect.poll(() => panel.evaluate((panel) => panel.offsetHeight)).toBe(844)
  await root.evaluate((root) => {
    root.scrollTop = 732
  })
  await expect.poll(() => panel.evaluate((panel) => panel.offsetHeight)).toBe(112)
  await page.evaluate(() => globalThis.disposeBookingCanvas())
  await expect(frame.locator('#cms-canvas-behavior')).toHaveCount(0)
})

import { test, expect } from './fixtures.mjs'
import { harnessOrigin } from './origins.mjs'
import { installStoredBackend, storedPresentationResponse } from './public-fixtures.mjs'
import { validateMarkup } from '../../packages/content-contracts/src/cms-markup.ts'
import { CMS_BUILT_ASSETS } from '../../packages/content-contracts/src/cms-built-assets.ts'

test('captured booking opens at its content and folds reversibly in the editing canvas', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await installStoredBackend(context)
  const custom = globalThis.structuredClone(storedPresentationResponse())
  const booking = custom.presentation.pages.find((page) => page.path === '/booking')
  const panelId = await page.evaluate((html) => {
    const doc = new globalThis.DOMParser().parseFromString(html, 'text/html')
    return doc.querySelector('[data-knc-surface="mobile-booking"] [data-knc-fold="panel"]').id
  }, booking.content.sv.html)
  // The editor owns ID-based rules. Its existing transform/contain/style choices survive
  // the real capture -> editing-canvas round trip on the sticky folding panel.
  const ownerCss = `#${panelId}{background-color:rgb(230,220,200)!important;transform:translateX(2px)!important;contain:layout style}`
  booking.content.sv.css.light += ownerCss
  await context.route(
    (url) => url.pathname === '/api/cms/presentation',
    (route) => route.fulfill({ json: custom }),
  )
  await context.addCookies([
    { name: 'bladeblend_storage_preferences', value: 'essential', url: harnessOrigin },
  ])
  await page.goto(`${harnessOrigin}/booking?mode=light`)
  await page.getByTestId('booking-barber-option').first().waitFor()
  const livePanel = page.locator('[data-knc-fold="panel"]')
  await expect(livePanel).toHaveAttribute('id', panelId)
  await expect(livePanel).toHaveCSS('background-color', 'rgb(230, 220, 200)')
  await expect(livePanel).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 2, 0)')
  await expect(livePanel).toHaveCSS('contain', 'layout style')
  const capture = await page.evaluate(async (ownerCss) => {
    const { snapshotNative, mergeModes } = await import('/modules/studio/src/nativePages.ts')
    const { nativeCanvas } = await import('/modules/studio/src/nativeCanvas.ts')
    const { canvasBehavior } = await import('/modules/studio/src/canvasBehavior.ts')
    const source = globalThis.document.querySelector('[data-knc-surface="mobile-booking"]')
    const snapshot = snapshotNative(source, 'mobile-booking')
    const html = mergeModes(snapshot, snapshot)
    const captured = new globalThis.DOMParser().parseFromString(html, 'text/html')
    const ids = (root) =>
      [...root.querySelectorAll('[data-knc-fold="panel"] [data-knc-source]')].map((node) =>
        node.getAttribute('data-knc-source'),
      )
    if (captured.querySelector('[data-knc-brand-runtime],[data-knc-brand-baseline]'))
      throw new Error('Private brand runtime leaked into capture')
    if (JSON.stringify(ids(source)) !== JSON.stringify(ids(captured)))
      throw new Error('Native identities changed in capture')
    const canvas = nativeCanvas({ html, css: { light: ownerCss, dark: ownerCss } }, 'light')
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
  }, ownerCss)
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
  await expect(panel).toHaveAttribute('id', panelId)
  await expect(panel).toHaveCSS('background-color', 'rgb(230, 220, 200)')
  await expect(panel).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 2, 0)')
  await expect(panel).toHaveCSS('contain', 'layout style')
  await expect.poll(() => root.evaluate((root) => root.scrollTop)).toBe(732)
  await expect.poll(() => panel.evaluate((panel) => panel.getBoundingClientRect().bottom)).toBe(112)
  await expect
    .poll(() =>
      frame
        .locator('[data-knc-fold="controls"]')
        .evaluate((controls) => controls.parentElement.getBoundingClientRect().top),
    )
    .toBe(0)
  await root.evaluate((root) => {
    root.scrollTop = 0
  })
  await expect.poll(() => panel.evaluate((panel) => panel.getBoundingClientRect().bottom)).toBe(844)
  await root.evaluate((root) => {
    root.scrollTop = 732
  })
  await expect.poll(() => panel.evaluate((panel) => panel.getBoundingClientRect().bottom)).toBe(112)
  await expect
    .poll(() =>
      frame
        .locator('[data-knc-fold="controls"]')
        .evaluate((controls) => controls.parentElement.getBoundingClientRect().top),
    )
    .toBe(0)
  await page.evaluate(() => globalThis.disposeBookingCanvas())
  await expect(frame.locator('#cms-canvas-behavior')).toHaveCount(0)
})

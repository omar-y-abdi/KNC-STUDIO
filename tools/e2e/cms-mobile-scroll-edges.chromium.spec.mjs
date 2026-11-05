import { writeFile } from 'node:fs/promises'
import { test, expect } from './fixtures.mjs'
import { harnessOrigin } from './origins.mjs'
import { nativeMobileScroll } from './native-mobile-scroll.mjs'
import { installPublicBackend, installStoredBackend } from './public-fixtures.mjs'

// These cases send native touchscreen gestures through CDP.
test.use({ hasTouch: true })

for (const [stored, reducedMotion] of [
  [false, 'reduce'],
  [false, 'no-preference'],
  [true, 'reduce'],
  [true, 'no-preference'],
]) {
  test(`native fold top and bottom (${stored ? 'stored' : 'source'}, ${reducedMotion})`, async ({
    page,
    context,
    evidenceDir,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.emulateMedia({ reducedMotion })
    await (stored ? installStoredBackend : installPublicBackend)(context)
    await context.addCookies([
      { name: 'bladeblend_storage_preferences', value: 'essential', url: harnessOrigin },
    ])
    let releaseReviews
    const reviews = new Promise((resolve) => {
      releaseReviews = resolve
    })
    await context.route('**/rest/v1/reviews*', async (route) => {
      await reviews
      await route.fulfill({
        json: Array.from({ length: 12 }, (_, i) => ({
          id: `review-${i}`,
          name: 'Fixture',
          rating: 5,
          text: 'Completed visit.',
        })),
      })
    })
    try {
      await page.goto(`${harnessOrigin}/?mode=light`)
      await page.getByTestId('mobile-site-scroll').evaluate((root) => {
        root.scrollTop = 0
      })
      await page.locator('[data-knc-fold="controls"]').evaluate((controls) => {
        controls.parentElement.setAttribute('data-test-visible-header', '')
      })
      await page.addStyleTag({
        content: `
        [data-test-visible-header]::before {content:'';position:absolute;left:0;top:0;width:8px;height:4px;background:rgb(255,0,255);z-index:2147483647;pointer-events:none}
        [data-knc-fold='panel']::after {content:'';position:absolute;left:40%;bottom:0;width:8px;height:2px;background:rgb(0,255,255);z-index:2147483647;pointer-events:none}
        [data-knc-fold='body']::before {content:'';display:block;position:relative;left:60%;width:8px;height:0;box-shadow:0 0 0 2px rgb(0,255,0);z-index:2147483647;pointer-events:none}
      `,
      })
      await page.getByTestId('mobile-site-scroll').evaluate((root) => {
        globalThis.__pinProbeEvents = []
        for (const name of ['touchstart', 'touchmove', 'touchend', 'scroll'])
          root.addEventListener(
            name,
            (event) =>
              globalThis.__pinProbeEvents.push({
                type: event.type,
                time: globalThis.performance.now(),
              }),
            { passive: true },
          )
      })
      const cdp = await context.newCDPSession(page)
      const frames = []
      let firstFrame
      const first = new Promise((resolve) => {
        firstFrame = resolve
      })
      cdp.on('Page.screencastFrame', (frame) => {
        frames.push(frame)
        firstFrame()
        void cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId })
      })
      await cdp.send('Page.startScreencast', { format: 'png', everyNthFrame: 1 })
      await first
      for (const [index, distance] of [-800, 800, -800, 800].entries()) {
        const before = await page.getByTestId('mobile-site-scroll').evaluate((root) => root.scrollTop)
        const gesture = nativeMobileScroll(cdp, distance)
        if (index === 0) {
          await page.waitForFunction(
            () =>
              globalThis.document.querySelector('[data-testid="mobile-site-scroll"]').scrollTop >
              300,
          )
          releaseReviews()
        }
        await gesture
        const after = () => page.getByTestId('mobile-site-scroll').evaluate((root) => root.scrollTop)
        if (distance < 0) await expect.poll(after).toBeGreaterThan(before)
        else await expect.poll(after).toBeLessThan(before)
      }
      await cdp.send('Page.stopScreencast')
      expect(frames.length).toBeGreaterThan(10)
      const offsets = await page.evaluate(
        async (frames) => {
          const result = []
          for (const frame of frames) {
            const bytes = Uint8Array.from(globalThis.atob(frame), (char) => char.charCodeAt(0))
            const bitmap = await globalThis.createImageBitmap(
              new globalThis.Blob([bytes], { type: 'image/png' }),
            )
            const scale = bitmap.width / 390
            const canvas = new globalThis.OffscreenCanvas(bitmap.width, bitmap.height)
            const ctx = canvas.getContext('2d')
            ctx.drawImage(bitmap, 0, 0)
            bitmap.close()
            const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
            const find = (x, color) => {
              for (let y = 0; y < canvas.height; y++) {
                const p = (y * canvas.width + Math.floor(x * scale)) * 4
                if (color.every((channel, i) => Math.abs(data[p + i] - channel) < 10))
                  return y / scale
              }
              return null
            }
            const top = find(2, [255, 0, 255])
            const edge = find(158, [0, 255, 255])
            const body = find(236, [0, 255, 0])
            result.push({
              top,
              edge,
              body,
              error: edge === null || body === null ? null : edge + 2 - Math.max(112, body + 2),
            })
          }
          return result
        },
        frames.map((frame) => frame.data),
      )
      const events = await page.evaluate(() => globalThis.__pinProbeEvents)
      await writeFile(`${evidenceDir}/marker-offsets.json`, JSON.stringify({ offsets, events }))
      for (let i = 0; i < frames.length; i++) {
        if (
          i === 0 ||
          i === frames.length - 1 ||
          i === Math.floor(frames.length / 4) ||
          offsets[i].top !== 0 ||
          offsets[i].error !== 0
        )
          await writeFile(`${evidenceDir}/frame-${i}.png`, Buffer.from(frames[i].data, 'base64'))
      }
      testInfo.annotations.push({
        type: 'painted-frames',
        description: JSON.stringify({
          frames: frames.length,
          displacedTop: offsets.filter((offset) => offset.top !== 0).length,
          misalignedBottom: offsets.filter((offset) => offset.error !== 0).length,
        }),
      })
      expect(offsets.filter((offset) => offset.top !== 0 || offset.error !== 0)).toEqual([])
    } finally {
      releaseReviews()
    }
  })
}

import { writeFile } from 'node:fs/promises'
import { test, expect } from './fixtures.mjs'
import { harnessOrigin } from './origins.mjs'
import { installPublicBackend, installStoredBackend } from './public-fixtures.mjs'

// These cases send native touchscreen gestures through CDP.
test.use({ hasTouch: true })

// CDP captures compositor output, unlike reading layout inside an early rAF callback.
// Chromium captures painted frames; mobile-viewport and keyboard tests cover all three engines.
for (const [stored, reducedMotion, deviceScaleFactor] of [
  [false, 'reduce', 1],
  [false, 'no-preference', 1],
  [true, 'reduce', 1],
  [true, 'no-preference', 1],
  [true, 'no-preference', 3],
]) {
  test.describe(`device pixels ${deviceScaleFactor}, ${stored}, ${reducedMotion}`, () => {
    test.use({ deviceScaleFactor })
    test(`native scroll keeps painted controls stationary (${stored ? 'stored' : 'source'}, ${reducedMotion})`, async ({
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
            text: 'A completed visit.',
          })),
        })
      })
      try {
        await page.goto(`${harnessOrigin}/?mode=light`)
        await page.getByTestId('mobile-site-scroll').evaluate((root) => {
          root.scrollTop = 100
        })
        await expect
          .poll(() =>
            page
              .locator('[data-knc-fold="controls"]')
              .evaluate((p) => globalThis.getComputedStyle(p).marginTop),
          )
          .toBe('24px')
        const cdp = await context.newCDPSession(page)
        const frames = []
        let firstFrame
        const painted = new Promise((resolve) => {
          firstFrame = resolve
        })
        cdp.on('Page.screencastFrame', (frame) => {
          frames.push(frame)
          firstFrame(frame.data)
          void cdp.send('Page.screencastFrameAck', { sessionId: frame.sessionId })
        })
        await cdp.send('Page.startScreencast', {
          format: 'png',
          everyNthFrame: 1,
          maxWidth: 390 * deviceScaleFactor,
          maxHeight: 844 * deviceScaleFactor,
        })
        const reference = await painted
        await writeFile(`${evidenceDir}/reference.png`, Buffer.from(reference, 'base64'))
        for (const [index, distance] of [-800, 800, -800, 800].entries()) {
          const gesture = cdp.send('Input.synthesizeScrollGesture', {
            x: 200,
            y: 600,
            yDistance: distance,
            speed: 600,
            gestureSourceType: 'touch',
            preventFling: true,
          })
          if (index === 0) {
            await page.waitForFunction(
              () =>
                globalThis.document.querySelector('[data-testid="mobile-site-scroll"]').scrollTop >
                300,
            )
            releaseReviews()
          }
          await gesture
        }
        await cdp.send('Page.stopScreencast')
        expect(frames.length).toBeGreaterThan(10)
        const offsets = await page.evaluate(
          async ({ reference, frames }) => {
            const pixels = async (base64) => {
              const bytes = Uint8Array.from(globalThis.atob(base64), (char) => char.charCodeAt(0))
              const bitmap = await globalThis.createImageBitmap(
                new globalThis.Blob([bytes], { type: 'image/png' }),
              )
              const scale = bitmap.width / 390
              const width = 31 * scale,
                height = 84 * scale
              const canvas = new globalThis.OffscreenCanvas(width, height)
              const context = canvas.getContext('2d')
              context.drawImage(bitmap, 24 * scale, 30 * scale, width, height, 0, 0, width, height)
              bitmap.close()
              return { data: context.getImageData(0, 0, width, height).data, scale, width }
            }
            const baseline = await pixels(reference)
            const offsets = []
            for (const frame of frames) {
              const image = await pixels(frame)
              if (image.scale !== baseline.scale) throw new Error('Screencast scale changed')
              const { scale, width } = baseline
              let best = { offset: 0, error: Infinity }
              for (let delta = -20 * scale; delta <= 20 * scale; delta++) {
                let error = 0
                for (let y = 20 * scale; y < 64 * scale; y++)
                  for (let x = 0; x < width; x++)
                    for (let c = 0; c < 3; c++)
                      error += Math.abs(
                        baseline.data[(y * width + x) * 4 + c] -
                          image.data[((y + delta) * width + x) * 4 + c],
                      )
                if (error < best.error) best = { offset: delta, error }
              }
              offsets.push(best)
            }
            return offsets
          },
          { reference, frames: frames.map((frame) => frame.data) },
        )
        await writeFile(`${evidenceDir}/pixel-offsets.json`, JSON.stringify(offsets))
        testInfo.annotations.push({
          type: 'painted-frames',
          description: JSON.stringify({
            frames: frames.length,
            shifted: offsets.filter((frame) => frame.offset !== 0).length,
          }),
        })
        for (const [index, frame] of frames.entries()) {
          if (index === 0 || index === frames.length - 1 || offsets[index].offset !== 0)
            await writeFile(`${evidenceDir}/frame-${index}.png`, Buffer.from(frame.data, 'base64'))
        }
        expect(offsets.filter((frame) => frame.offset !== 0)).toEqual([])
      } finally {
        releaseReviews()
      }
    })
  })
}

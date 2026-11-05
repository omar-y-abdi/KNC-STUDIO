import assert from 'node:assert/strict'
import { test, expect } from './fixtures.mjs'
import { harnessOrigin } from './origins.mjs'

test('suppressing gallery pointer focus preserves native vertical touch scrolling', async ({
  newContext,
}) => {
  const context = await newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    reducedMotion: 'reduce',
  })
  const page = await context.newPage()
  await page.goto(`${harnessOrigin}/tools/e2e/admin-harness.html`)
  await page.evaluate(async () => {
    ;(await import('/tools/e2e/cms-marquee-harness.tsx')).mountGallery(390)
    const host = globalThis.document.getElementById('gallery-host')
    host.style.paddingTop = '220px'
    host.style.paddingBottom = '1000px'
  })
  const row = page.getByTestId('marquee-row').first()
  const before = await row.boundingBox()
  assert.ok(before)
  const client = await context.newCDPSession(page)
  const touch = { x: 180, y: before.y + before.height / 2, id: 1 }
  try {
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [touch] })
    for (const dy of [12, 30, 60, 90, 130])
      await client.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ ...touch, x: 182, y: touch.y - dy }],
      })
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
    await expect.poll(() => page.evaluate(() => globalThis.scrollY)).toBeGreaterThan(40)
    await expect(row.locator('[aria-pressed="true"]')).toHaveCount(0)
    const trackX = await row.evaluate(
      (r) => r.firstElementChild.getBoundingClientRect().left - r.getBoundingClientRect().left,
    )
    assert.equal(trackX, 0, 'Vertical touch scroll moved the gallery sideways')
  } finally {
    await client.detach()
  }
})

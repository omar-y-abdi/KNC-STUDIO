import assert from 'node:assert/strict'
import { test, expect } from './fixtures.mjs'
import { harnessOrigin } from './origins.mjs'

const rowSelector = '[data-testid="marquee-row"]'
const shift = (row) =>
  row.evaluate((element) => {
    const transform = globalThis.getComputedStyle(element.firstElementChild).transform
    return transform === 'none' ? 0 : new globalThis.DOMMatrixReadOnly(transform).m41
  })

// Observe several rendered frames: stationary checks must cover an opportunity to animate.
const frames = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        let remaining = 12
        const next = () => (--remaining === 0 ? resolve() : globalThis.requestAnimationFrame(next))
        globalThis.requestAnimationFrame(next)
      }),
  )

async function mount(newContext, options = {}, prepare) {
  const context = await newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    reducedMotion: 'no-preference',
    ...options,
  })
  const page = await context.newPage()
  await prepare?.(page)
  await page.goto(`${harnessOrigin}/tools/e2e/admin-harness.html`)
  await page.evaluate(async () =>
    (await import('/tools/e2e/cms-marquee-harness.tsx')).mountGallery(390),
  )
  return { page, context, row: page.locator(rowSelector).first() }
}

test('gallery touch selects the photo under the finger without moving its row', async ({
  newContext,
}) => {
  const { page, row } = await mount(newContext)
  await expect.poll(() => shift(row)).toBeLessThan(-90)
  const before = await row.evaluate((element) => {
    const bounds = element.getBoundingClientRect()
    const x = bounds.left + bounds.width / 2
    const y = bounds.top + bounds.height / 2
    const tile = globalThis.document.elementFromPoint(x, y)?.closest('[data-tile-key]')
    if (!tile) throw new Error('No photo under the finger')
    const rect = tile.getBoundingClientRect()
    return { x, y, key: tile.getAttribute('data-tile-key'), center: rect.left + rect.width / 2 }
  })
  await page.touchscreen.tap(before.x, before.y)
  const selected = row.locator(`[data-tile-key="${before.key}"]`)
  await expect(selected).toHaveAttribute('aria-pressed', 'true')
  const after = await selected.evaluate((tile) => {
    const rect = tile.getBoundingClientRect()
    return rect.left + rect.width / 2
  })
  assert.ok(Math.abs(after - before.center) < 4, `Tapped photo moved ${after - before.center}px`)
  const paused = await shift(row)
  await frames(page)
  assert.ok(Math.abs((await shift(row)) - paused) < 1, 'Selected row kept moving')
  await page.touchscreen.tap(before.x, before.y)
  await expect(selected).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(() => shift(row)).toBeLessThan(paused - 4)
})

test('gallery waits for cold images before starting either direction', async ({ newContext }) => {
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const { page } = await mount(newContext, {}, async (page) => {
    await page.route('**/og-image.png', async (route) => {
      await gate
      await route.fulfill({ path: 'public/og-image.png', contentType: 'image/png' })
    })
  })
  try {
    const rows = page.locator(rowSelector)
    await expect(rows).toHaveCount(2)
    const before = await Promise.all([shift(rows.nth(0)), shift(rows.nth(1))])
    await frames(page)
    assert.deepEqual(
      await Promise.all([shift(rows.nth(0)), shift(rows.nth(1))]),
      before,
      'The rows started moving before their images arrived',
    )
    release()
    await expect.poll(() => shift(rows.nth(0))).toBeLessThan(-4)
    await expect.poll(() => shift(rows.nth(1))).toBeLessThan(-4)
  } finally {
    release()
  }
})

test('gallery ignores finger jitter and vertical gestures before horizontal dragging', async ({
  newContext,
}) => {
  const { page, row } = await mount(newContext, { reducedMotion: 'reduce' })
  await page.mouse.move(180, 80)
  await page.mouse.down()
  const before = await shift(row)
  await page.mouse.move(183, 82)
  assert.equal(await shift(row), before, 'A sub-threshold finger movement shifted the row')
  await page.mouse.move(200, 140)
  assert.equal(await shift(row), before, 'A vertical gesture shifted the row horizontally')
  await page.mouse.up()
  await expect(row.locator('[aria-pressed="true"]')).toHaveCount(0)
})

test('gallery still moves when an image fails to decode', async ({ newContext }) => {
  const { row } = await mount(newContext, {}, async (page) => {
    await page.route('**/og-image.png', (route) => route.fulfill({ status: 404, body: '' }))
  })
  await expect.poll(() => shift(row)).toBeLessThan(-4)
})

test('gallery keyboard focus reveals later photos without hidden horizontal scrolling', async ({
  newContext,
}) => {
  const { page, row } = await mount(newContext, { reducedMotion: 'reduce' })
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  await page.keyboard.press('Tab')
  const bounds = await row.evaluate((element) => {
    const row = element.getBoundingClientRect()
    const tile = globalThis.document.activeElement.getBoundingClientRect()
    return { left: tile.left - row.left, right: tile.right - row.right, scroll: element.scrollLeft }
  })
  assert.ok(
    bounds.left >= -1 && bounds.right <= 1,
    `Focused photo is clipped: ${JSON.stringify(bounds)}`,
  )
  assert.equal(bounds.scroll, 0, 'Browser scrolling and animation offsets must not accumulate')
  await page.keyboard.press('Enter')
  await expect(row.locator('[aria-pressed="true"]')).toHaveCount(1)
})

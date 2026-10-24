import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { marqueeCardWidth, minLoopScale } from '../../src/admin/cms/hierarchicalResize.ts'
import { installBlankProbe, readBlankProbe } from './cms-marquee-probe.mjs'
import { test } from './fixtures.mjs'
import { harnessOrigin } from './origins.mjs'

const strip = '[data-knc-fold="barber-marquee"]'
// Neighbouring cards keep 24 px margins each: beside a visible card at most two such gaps fit.
const MAX_BLANK = 96
// Embla measures slides by whole-pixel offsetWidth, so its loop seam may open up to 1 px wider.
const SEAM = 1

const cardRule = (declarations) =>
  `@media (max-width:768px){${strip}>[role="button"]{${declarations}}}`
const cardWidth = (scale) =>
  cardRule(
    `width:${marqueeCardWidth(scale)}!important;flex-basis:${marqueeCardWidth(scale)}!important`,
  )

/** 90 s of AutoScroll on the fake clock with the given owner card CSS and roster at 390 px. */
async function measureStrip(newContext, css, barbers = 4) {
  const context = await newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'no-preference',
  })
  await context.clock.install()
  const page = await context.newPage()
  await page.goto(`${harnessOrigin}/tools/e2e/admin-harness.html`)
  await page.evaluate(
    async ([css, barbers]) =>
      (await import('/tools/e2e/cms-marquee-harness.tsx')).mountBarberStrip(css, barbers),
    [css, barbers],
  )
  await page
    .locator(`${strip} > [role="button"]`)
    .nth(barbers - 1)
    .waitFor()
  // Effects, Embla's setup and AutoScroll's 800 ms start delay all run on the fake clock.
  await context.clock.runFor(3000)
  await page.evaluate(installBlankProbe, strip)
  await context.clock.runFor(90_000)
  return page.evaluate(readBlankProbe)
}

test('mobile barber strip control: legacy card zoom leaves the viewport blank', async ({
  newContext,
  evidenceDir,
}) => {
  const probe = await measureStrip(newContext, cardRule('zoom:0.7!important'))
  await writeFile(`${evidenceDir}/barber-strip-zoom.json`, JSON.stringify(probe, null, 2))
  assert.ok(probe.maxBlank > MAX_BLANK + SEAM, `Card zoom left only ${probe.maxBlank} px blank`)
})

// Each 10 s sample moved on from the one before.
const moving = (probe) =>
  probe.offsets.slice(1).every((value, index) => Math.abs(value - probe.offsets[index]) > 1)

for (const [barbers, scale] of [
  [4, 0.7],
  [4, 0.5],
  [3, minLoopScale(3)],
  [2, minLoopScale(2)],
])
  test(`mobile barber strip: ${barbers} cards at ${scale} width keep the viewport covered while moving`, async ({
    newContext,
    evidenceDir,
  }) => {
    const probe = await measureStrip(newContext, cardWidth(scale), barbers)
    await writeFile(
      `${evidenceDir}/barber-strip-${barbers}-${scale}.json`,
      JSON.stringify(probe, null, 2),
    )
    assert.ok(probe.samples >= 1800, `The probe sampled only ${probe.samples} times`)
    assert.ok(probe.maxBlank <= MAX_BLANK + SEAM, `${probe.maxBlank} px of the viewport went blank`)
    assert.ok(moving(probe), `The strip stopped moving (${probe.offsets.join(', ')})`)
  })

// Below these widths Embla alone drops loop and AutoScroll halts; the runtime floor keeps it looping.
for (const [barbers, scale] of [
  [2, 0.5],
  [3, 0.3],
])
  test(`mobile barber strip: ${barbers} cards at ${scale} width, below their loop scale, still loop`, async ({
    newContext,
    evidenceDir,
  }) => {
    const probe = await measureStrip(newContext, cardWidth(scale), barbers)
    await writeFile(
      `${evidenceDir}/barber-strip-${barbers}-${scale}-floor.json`,
      JSON.stringify(probe, null, 2),
    )
    assert.ok(probe.maxBlank <= MAX_BLANK + SEAM, `${probe.maxBlank} px of the viewport went blank`)
    assert.ok(moving(probe), `The strip stopped moving (${probe.offsets.join(', ')})`)
  })

test('mobile barber strip: narrow 10vw cards spread by space-between still loop', async ({
  newContext,
  evidenceDir,
}) => {
  // Widening the cards consumes the distributed space, so one measured floor is not enough.
  const css =
    cardRule('width:10vw!important;flex-basis:10vw!important') +
    `@media (max-width:768px){${strip}{justify-content:space-between!important}}`
  const probe = await measureStrip(newContext, css, 4)
  await writeFile(`${evidenceDir}/barber-strip-space-between.json`, JSON.stringify(probe, null, 2))
  assert.ok(probe.maxBlank <= MAX_BLANK + SEAM, `${probe.maxBlank} px of the viewport went blank`)
  assert.ok(moving(probe), `The strip stopped moving (${probe.offsets.join(', ')})`)
})

test('mobile barber strip: no Embla observer outlives its carousel', async ({ newContext }) => {
  const context = await newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'no-preference',
  })
  // Every live ResizeObserver with the targets it still watches.
  await context.addInitScript(() => {
    const live = new Map()
    globalThis.__observed = live
    const Native = globalThis.ResizeObserver
    globalThis.ResizeObserver = class extends Native {
      constructor(callback) {
        super(callback)
        live.set(this, new Set())
      }
      observe(target, options) {
        live.get(this).add(target)
        super.observe(target, options)
      }
      unobserve(target) {
        live.get(this).delete(target)
        super.unobserve(target)
      }
      disconnect() {
        live.get(this).clear()
        super.disconnect()
      }
    }
  })
  const page = await context.newPage()
  await page.goto(`${harnessOrigin}/tools/e2e/admin-harness.html`)
  const frames = () =>
    page.evaluate(
      () =>
        new Promise((resolve) => {
          let count = 0
          const next = () => (++count >= 8 ? resolve() : globalThis.requestAnimationFrame(next))
          globalThis.requestAnimationFrame(next)
        }),
    )
  const mount = async (barbers) => {
    await page.evaluate(
      async ([css, barbers]) =>
        (await import('/tools/e2e/cms-marquee-harness.tsx')).mountBarberStrip(css, barbers),
      [cardWidth(0.3), barbers],
    )
    // Below their loop scale the slides pass through several floor reInits.
    await page.waitForFunction(
      ([selector, barbers]) => {
        const cards = [...globalThis.document.querySelectorAll(`${selector} > [role="button"]`)]
        return (
          cards.length === barbers &&
          cards.every((card) => card.style.getPropertyPriority('min-width') === 'important')
        )
      },
      [strip, barbers],
    )
    await frames()
  }
  const observers = () =>
    page.evaluate((selector) => {
      const track = globalThis.document.querySelector(selector)
      const watching = [...globalThis.__observed.values()]
      return {
        track: watching.filter((targets) => track && targets.has(track)).length,
        targets: watching.reduce((sum, targets) => sum + targets.size, 0),
      }
    }, strip)
  await mount(2)
  assert.equal((await observers()).track, 1, 'Two cards: one Embla observer watches the strip')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await frames()
  assert.deepEqual(await observers(), { track: 0, targets: 0 }, 'Reduced motion left observers')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.waitForFunction(
    (selector) =>
      [...globalThis.document.querySelectorAll(`${selector} > [role="button"]`)].every(
        (card) => card.style.getPropertyPriority('min-width') === 'important',
      ),
    strip,
  )
  await frames()
  assert.equal((await observers()).track, 1, 'Motion again: one Embla observer')
  await mount(3)
  assert.equal((await observers()).track, 1, 'Three cards: one Embla observer')
  await page.evaluate(async () =>
    (await import('/tools/e2e/cms-marquee-harness.tsx')).unmountFixture(),
  )
  await frames()
  assert.deepEqual(await observers(), { track: 0, targets: 0 }, 'Unmount left observers')
})

test('mobile barber strip: the loop floor returns to the inline width once cards loop alone', async ({
  newContext,
}) => {
  const context = await newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'no-preference',
  })
  const page = await context.newPage()
  await page.goto(`${harnessOrigin}/tools/e2e/admin-harness.html`)
  await page.evaluate(
    async (css) => (await import('/tools/e2e/cms-marquee-harness.tsx')).mountBarberStrip(css, 3),
    cardWidth(0.4),
  )
  const minWidths = () =>
    page.evaluate(
      (selector) =>
        [...globalThis.document.querySelectorAll(`${selector} > [role="button"]`)].map((card) => ({
          value: card.style.getPropertyValue('min-width'),
          priority: card.style.getPropertyPriority('min-width'),
          width: card.offsetWidth,
        })),
      strip,
    )
  // 3 cards at 0.4 (146 px) cannot loop at 390 px; every slide gets the same wider floor.
  await page.waitForFunction(
    (selector) =>
      [...globalThis.document.querySelectorAll(`${selector} > [role="button"]`)].every(
        (card) => card.style.getPropertyPriority('min-width') === 'important',
      ),
    strip,
  )
  const floored = await minWidths()
  assert.ok(
    floored.every(
      ({ value, width }) =>
        value === floored[0]?.value && width === parseInt(value, 10) && width > 0.4 * 366 + 1,
    ),
    JSON.stringify(floored),
  )
  // Wider owner cards loop on their own: Embla's resize reInit drops the floor again.
  await page.evaluate((css) => {
    const style = globalThis.document.createElement('style')
    style.textContent = css
    globalThis.document.head.appendChild(style)
  }, cardWidth(0.7))
  await page.waitForFunction(
    (selector) =>
      [...globalThis.document.querySelectorAll(`${selector} > [role="button"]`)].every(
        (card) => card.style.getPropertyPriority('min-width') === '',
      ),
    strip,
  )
  const natural = await minWidths()
  assert.ok(
    natural.every(({ value, width }) => value === '0px' && Math.abs(width - 0.7 * 366) < 1),
    JSON.stringify(natural),
  )
})

test('mobile barber strip: a single barber stays a static, fully visible card', async ({
  newContext,
  evidenceDir,
}) => {
  const probe = await measureStrip(newContext, '', 1)
  await writeFile(`${evidenceDir}/barber-strip-1.json`, JSON.stringify(probe, null, 2))
  assert.ok(
    probe.offsets.every((value) => value === 0),
    `One card moved (${probe.offsets.join(', ')})`,
  )
  // The lone card keeps 12 px margins on both sides.
  assert.ok(probe.maxBlank <= 24 + SEAM, `${probe.maxBlank} px of the viewport went blank`)
})

test('the gallery loop follows the width of its container', async ({ page }) => {
  await page.goto(`${harnessOrigin}/tools/e2e/admin-harness.html`)
  await page.evaluate(async () =>
    (await import('/tools/e2e/cms-marquee-harness.tsx')).mountGallery(600),
  )
  // Rows report their tiles and the widest band one loop-half can leave empty once settled.
  const settle = () =>
    page.evaluate(async () => {
      const read = () =>
        [...globalThis.document.querySelectorAll('[data-testid="marquee-track"]')].map((track) => ({
          tiles: track.children.length,
          band: Math.max(0, Math.round(track.parentElement.clientWidth - track.scrollWidth / 2)),
        }))
      let last = JSON.stringify(read())
      for (let frame = 0, stable = 0; frame < 180 && stable < 10; frame++) {
        await new Promise((resolve) => globalThis.requestAnimationFrame(resolve))
        const now = JSON.stringify(read())
        stable = now === last ? stable + 1 : 0
        last = now
      }
      return read()
    })
  const resize = (width) =>
    page.evaluate((width) => {
      const host = globalThis.document.getElementById('gallery-host')
      if (!host) throw new Error('Gallery host is missing')
      host.style.width = `${width}px`
    }, width)
  const rows = (tiles) => [
    { tiles, band: 0 },
    { tiles, band: 0 },
  ]
  assert.deepEqual(await settle(), rows(6), 'Three photos fill a 600 px row with one loop-half')
  await resize(1400)
  assert.deepEqual(await settle(), rows(18), 'A widened container repeats the photos without a gap')
  await resize(600)
  assert.deepEqual(await settle(), rows(6), 'A narrowed container drops the extra repeats')
})

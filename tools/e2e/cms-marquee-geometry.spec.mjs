import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { marqueeCardWidth, minLoopScale } from '../../src/admin/cms/hierarchicalResize.ts'
import { installBlankProbe, readBlankProbe } from './cms-marquee-probe.mjs'
import { test } from './fixtures.mjs'
import { harnessOrigin } from './origins.mjs'

const strip = '[data-knc-fold="barber-marquee"]'
// Neighbouring cards keep 24 px margins each.
const GAP = 48
// Beside a visible card of the usual widths at most two such gaps fit.
const MAX_BLANK = 2 * GAP
// Embla measures slides by whole-pixel offsetWidth, so its loop seam may open up to 1 px wider.
const SEAM = 1

const cardRule = (declarations) =>
  `@media (max-width:768px){${strip}>[role="button"]{${declarations}}}`
const cardWidth = (scale) =>
  cardRule(
    `width:${marqueeCardWidth(scale)}!important;flex-basis:${marqueeCardWidth(scale)}!important`,
  )

/** 90 s of AutoScroll on the fake clock with the given owner card CSS, roster and viewport width. */
async function measureStrip(newContext, css, barbers = 4, width = 390) {
  const context = await newContext({
    viewport: { width, height: 844 },
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
  const probe = await page.evaluate(readBlankProbe)
  // Embla's slide looper translates slides only while the carousel loops.
  const looping = await page.evaluate(
    (selector) =>
      [...globalThis.document.querySelectorAll(`${selector} > [role="button"]`)].some(
        (card) => card.style.transform !== '',
      ),
    strip,
  )
  return { ...probe, looping }
}

/** Init script: every ResizeObserver the page creates, with the targets it still watches. */
function trackResizeObservers() {
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
}

/** Eight animation frames, so queued observations and fitting passes have run. */
const frames = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        let count = 0
        const next = () => (++count >= 8 ? resolve() : globalThis.requestAnimationFrame(next))
        globalThis.requestAnimationFrame(next)
      }),
  )

/** Observers watching the strip, and the targets all observers still watch. */
const observers = (page) =>
  page.evaluate((selector) => {
    const track = globalThis.document.querySelector(selector)
    const watching = [...globalThis.__observed.values()]
    return {
      track: watching.filter((targets) => track && targets.has(track)).length,
      targets: watching.reduce((sum, targets) => sum + targets.size, 0),
    }
  }, strip)

const unmountStrip = (page) =>
  page.evaluate(async () => (await import('/tools/e2e/cms-marquee-harness.tsx')).unmountFixture())

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
  assert.ok(probe.looping, 'Embla dropped loop')
  // The floor stops at 98 px, so three of the regular 48 px gaps fit in the viewport at once: bound
  // the widest single hole by one gap, which a loop seam opening up would exceed.
  assert.ok(probe.maxHole <= GAP + SEAM, `A ${probe.maxHole} px hole opened in the strip`)
  assert.ok(moving(probe), `The strip stopped moving (${probe.offsets.join(', ')})`)
})

test('mobile barber strip: six 4vw cards spread by space-between at 768 px still loop', async ({
  newContext,
  evidenceDir,
}) => {
  // The estimates follow the shrinking gaps (84, 122, then 150 px, at which five slides cover only
  // 750 px); the last pass's gapless floor, ceil(768 / 5) = 154 px, covers the view.
  const css =
    cardRule('width:4vw!important;flex-basis:4vw!important;margin:0!important') +
    `@media (max-width:768px){${strip}{justify-content:space-between!important}}`
  const probe = await measureStrip(newContext, css, 6, 768)
  await writeFile(
    `${evidenceDir}/barber-strip-6-space-between.json`,
    JSON.stringify(probe, null, 2),
  )
  assert.ok(probe.looping, 'Embla dropped loop')
  assert.ok(probe.samples >= 1800, `The probe sampled only ${probe.samples} times`)
  assert.ok(probe.maxBlank <= MAX_BLANK + SEAM, `${probe.maxBlank} px of the viewport went blank`)
  assert.ok(moving(probe), `The strip stopped moving (${probe.offsets.join(', ')})`)
})

test('mobile barber strip: no Embla observer outlives its carousel', async ({ newContext }) => {
  const context = await newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'no-preference',
  })
  await context.addInitScript(trackResizeObservers)
  const page = await context.newPage()
  await page.goto(`${harnessOrigin}/tools/e2e/admin-harness.html`)
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
    await frames(page)
  }
  await mount(2)
  assert.equal((await observers(page)).track, 1, 'Two cards: one Embla observer watches the strip')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await frames(page)
  assert.deepEqual(await observers(page), { track: 0, targets: 0 }, 'Reduced motion left observers')
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.waitForFunction(
    (selector) =>
      [...globalThis.document.querySelectorAll(`${selector} > [role="button"]`)].every(
        (card) => card.style.getPropertyPriority('min-width') === 'important',
      ),
    strip,
  )
  await frames(page)
  assert.equal((await observers(page)).track, 1, 'Motion again: one Embla observer')
  await mount(3)
  assert.equal((await observers(page)).track, 1, 'Three cards: one Embla observer')
  await unmountStrip(page)
  await frames(page)
  assert.deepEqual(await observers(page), { track: 0, targets: 0 }, 'Unmount left observers')
})

test('mobile barber strip: a resize between the fitting frames orphans no Embla observer', async ({
  newContext,
}) => {
  const context = await newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'no-preference',
  })
  await context.addInitScript(trackResizeObservers)
  const page = await context.newPage()
  await page.goto(`${harnessOrigin}/tools/e2e/admin-harness.html`)
  // Embla's first transform on the strip ends its init, with its observation and the fit's first
  // frame queued. A frame queued now runs after both and narrows the cards, so Embla's observer
  // reInits before the fit's second frame. Both widths are below the loop scale: the fit floors.
  await page.evaluate(
    async ([selector, css, narrower]) => {
      const watcher = new globalThis.MutationObserver(() => {
        const track = globalThis.document.querySelector(selector)
        if (!(track instanceof globalThis.HTMLElement) || track.style.transform === '') return
        watcher.disconnect()
        globalThis.requestAnimationFrame(() => {
          const style = globalThis.document.createElement('style')
          style.textContent = narrower
          globalThis.document.head.appendChild(style)
        })
      })
      watcher.observe(globalThis.document.body, {
        subtree: true,
        attributes: true,
        attributeFilter: ['style'],
      })
      const harness = await import('/tools/e2e/cms-marquee-harness.tsx')
      harness.mountBarberStrip(css, 2)
    },
    [strip, cardWidth(0.3), cardWidth(0.25)],
  )
  await page.waitForFunction((selector) => {
    const cards = [...globalThis.document.querySelectorAll(`${selector} > [role="button"]`)]
    return (
      cards.length === 2 &&
      cards.every((card) => card.style.getPropertyPriority('min-width') === 'important')
    )
  }, strip)
  await frames(page)
  // The initial engine, the one Embla's resize created, and the one the fit created.
  assert.ok(
    (await page.evaluate(() => globalThis.__observed.size)) >= 3,
    'Embla did not reinitialise between the fitting frames',
  )
  assert.deepEqual(
    await observers(page),
    { track: 1, targets: 3 },
    'One Embla observer watches the strip and its two cards',
  )
  await unmountStrip(page)
  await frames(page)
  assert.deepEqual(await observers(page), { track: 0, targets: 0 }, 'Unmount left observers')
})

/** Mounts two cards below their loop scale and runs `act` in the microtask right after the first
 * fitting reInit, while the engine it created has not yet had its observation frame. */
const actAfterFittingReInit = (page, act) =>
  page.evaluate(
    async ([selector, css, act]) => {
      const harness = await import('/tools/e2e/cms-marquee-harness.tsx')
      const watcher = new globalThis.MutationObserver(() => {
        const cards = [...globalThis.document.querySelectorAll(`${selector} > [role="button"]`)]
        const floored = cards.every((card) => card.style.getPropertyPriority('min-width'))
        if (cards.length !== 2 || !floored) return
        watcher.disconnect()
        globalThis.__acted = true
        if (act === 'unmount') harness.unmountFixture()
        else {
          // A new child is a slide change: Embla's own MutationObserver reInits in this frame.
          const extra = globalThis.document.createElement('div')
          extra.id = 'extra-slide'
          globalThis.document.querySelector(selector)?.appendChild(extra)
        }
      })
      watcher.observe(globalThis.document.body, {
        subtree: true,
        attributes: true,
        attributeFilter: ['style'],
      })
      harness.mountBarberStrip(css, 2)
    },
    [strip, cardWidth(0.3), act],
  )

test('mobile barber strip: an unmount right after a fitting reInit leaves no observer', async ({
  newContext,
}) => {
  const context = await newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'no-preference',
  })
  await context.addInitScript(trackResizeObservers)
  const page = await context.newPage()
  await page.goto(`${harnessOrigin}/tools/e2e/admin-harness.html`)
  await actAfterFittingReInit(page, 'unmount')
  await page.waitForFunction(() => globalThis.__acted === true)
  await frames(page)
  assert.ok(
    (await page.evaluate(() => globalThis.__observed.size)) >= 2,
    'The strip was unmounted before its fitting reInit',
  )
  assert.deepEqual(await observers(page), { track: 0, targets: 0 }, 'Unmount left observers')
})

test('mobile barber strip: a slide change inside an init frame leaves one observer', async ({
  newContext,
}) => {
  const context = await newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'no-preference',
  })
  await context.addInitScript(trackResizeObservers)
  const page = await context.newPage()
  await page.goto(`${harnessOrigin}/tools/e2e/admin-harness.html`)
  await actAfterFittingReInit(page, 'slide')
  await page.waitForFunction(() => globalThis.__acted === true)
  await frames(page)
  await page.evaluate(() => globalThis.document.getElementById('extra-slide')?.remove())
  await frames(page)
  assert.deepEqual(
    await observers(page),
    { track: 1, targets: 3 },
    'One Embla observer watches the strip and its two cards',
  )
  await unmountStrip(page)
  await frames(page)
  assert.deepEqual(await observers(page), { track: 0, targets: 0 }, 'Unmount left observers')
})

test('mobile barber strip: a strip no floor can loop falls back to native scrolling', async ({
  newContext,
}) => {
  const context = await newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'no-preference',
  })
  const page = await context.newPage()
  await page.goto(`${harnessOrigin}/tools/e2e/admin-harness.html`)
  const failure = page.waitForEvent('pageerror')
  // Sized by its cards, the strip widens with every floor, so its other slides never cover it.
  const css = cardWidth(0.3) + `@media (max-width:768px){${strip}{width:max-content!important}}`
  await page.evaluate(
    async (css) => (await import('/tools/e2e/cms-marquee-harness.tsx')).mountBarberStrip(css, 2),
    css,
  )
  assert.match((await failure).message, /The barber strip cannot loop/)
  await page.waitForFunction((selector) => {
    const track = globalThis.document.querySelector(selector)
    return (
      track instanceof globalThis.HTMLElement &&
      track.style.overflowX === 'auto' &&
      [...track.children].every(
        (card) =>
          card instanceof globalThis.HTMLElement &&
          card.style.getPropertyPriority('min-width') === '',
      )
    )
  }, strip)
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

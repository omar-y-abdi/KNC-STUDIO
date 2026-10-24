import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { marqueeCardWidth } from '../../src/admin/cms/hierarchicalResize.ts'
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

/** 90 s of AutoScroll on the fake clock with the given owner card CSS at 390 px. */
async function measureStrip(newContext, css) {
  const context = await newContext({
    viewport: { width: 390, height: 844 },
    reducedMotion: 'no-preference',
  })
  await context.clock.install()
  const page = await context.newPage()
  await page.goto(`${harnessOrigin}/tools/e2e/admin-harness.html`)
  await page.evaluate(
    async (css) => (await import('/tools/e2e/cms-marquee-harness.tsx')).mountBarberStrip(css),
    css,
  )
  await page.locator(`${strip} > [role="button"]`).nth(3).waitFor()
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

for (const scale of [0.7, 0.5])
  test(`mobile barber strip: cards at ${scale} width keep the viewport covered while moving`, async ({
    newContext,
    evidenceDir,
  }) => {
    const probe = await measureStrip(newContext, cardWidth(scale))
    await writeFile(`${evidenceDir}/barber-strip-${scale}.json`, JSON.stringify(probe, null, 2))
    assert.ok(probe.samples >= 1800, `The probe sampled only ${probe.samples} times`)
    assert.ok(probe.maxBlank <= MAX_BLANK + SEAM, `${probe.maxBlank} px of the viewport went blank`)
    assert.ok(
      probe.offsets.slice(1).every((value, index) => Math.abs(value - probe.offsets[index]) > 1),
      `The strip stopped moving (${probe.offsets.join(', ')})`,
    )
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

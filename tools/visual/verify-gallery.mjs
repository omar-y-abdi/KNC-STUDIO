// Behaviour verification for the About galleries: two counter-scrolling rows, tap-to-select
// (pause + highlight + scale, nothing removed), and drag-to-reverse-direction. Proves the
// INTERACTION, not just that tiles render.
//
// NOTE: the tiles never stop moving, so Playwright's actionability (it waits for an element to be
// "stable" before click/scroll) times out on them. We therefore drive everything with RAW
// page.mouse coordinates taken from getBoundingClientRect, and scroll via DOM scrollIntoView —
// both bypass the stability wait.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

/* global document, getComputedStyle */

const BASE = process.env.BASE ?? 'http://localhost:4173'
const OUT = process.env.OUT ?? '/tmp/gallery'
mkdirSync(OUT, { recursive: true })

const results = []
const ok = (n, c, d = '') => {
  results.push({ n, p: !!c })
  console.log((c ? 'PASS' : 'FAIL') + ' · ' + n + (d ? ' · ' + d : ''))
}

const browser = await chromium.launch()
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark', deviceScaleFactor: 1 })
  const page = await ctx.newPage()
  await page.goto(BASE, { waitUntil: 'networkidle' })
  await page.waitForSelector('#root > *')
  await page.getByRole('button', { name: 'Om oss', exact: true }).first().click()
  await page.waitForTimeout(1200)

  // Bring the first ("I salongen") gallery into view (DOM scroll — no stability wait).
  await page.evaluate(() => {
    const h = [...document.querySelectorAll('h3')].find((e) => (e.textContent || '').includes('I salongen'))
    if (h) h.scrollIntoView({ block: 'center' })
  })
  await page.waitForTimeout(400)

  const trackX = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('[data-testid="marquee-track"]')].map((el) => {
        const m = /translate3d\(([-0-9.]+)px/.exec(el.style.transform || '')
        return m ? parseFloat(m[1]) : 0
      }),
    )
  const tileCount = () => page.evaluate(() => document.querySelectorAll('[data-tile-key]').length)
  // Centre of a tile in the FIRST row that sits comfortably inside the viewport.
  const firstRowTile = () =>
    page.evaluate(() => {
      const row = document.querySelector('[data-testid="marquee-row"]')
      if (!row) return null
      const tiles = [...row.querySelectorAll('[data-tile-key]')]
      for (const el of tiles) {
        const r = el.getBoundingClientRect()
        if (r.x > 280 && r.right < 980 && r.y > 0 && r.bottom < 900) return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
      }
      return null
    })
  const selectedCenter = () =>
    page.evaluate(() => {
      const el = document.querySelector('[data-tile-key][aria-pressed="true"]')
      if (!el) return null
      const r = el.getBoundingClientRect()
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
    })
  const pressedCount = () => page.evaluate(() => document.querySelectorAll('[data-tile-key][aria-pressed="true"]').length)

  // 1 — four tracks (2 galleries × 2 rows)
  const x0 = await trackX()
  ok('four marquee tracks (2 galleries x 2 rows)', x0.length === 4, `found ${x0.length}`)

  // 2 — auto-scroll, opposite directions (row A dir 1 → x decreasing; row B dir −1 → x increasing)
  await page.waitForTimeout(800)
  const x1 = await trackX()
  const dA = x1[0] - x0[0]
  const dB = x1[1] - x0[1]
  ok('row A auto-scrolls', Math.abs(dA) > 2, `dA=${dA.toFixed(1)}`)
  ok('the two rows scroll OPPOSITE directions', dA < 0 && dB > 0, `dA=${dA.toFixed(1)} dB=${dB.toFixed(1)}`)
  await page.screenshot({ path: `${OUT}/gallery-default.png` })

  // 3 — tap a tile: selects (aria-pressed), nothing removed, its row pauses, the tile scales up
  const before = await tileCount()
  const tp = await firstRowTile()
  if (tp) {
    await page.mouse.click(tp.x, tp.y)
    await page.waitForTimeout(250)
    ok('tap selects exactly one tile', (await pressedCount()) === 1, `pressed=${await pressedCount()}`)
    ok('no tiles removed on select', (await tileCount()) === before, `count=${before}`)

    const f0 = (await trackX())[0]
    await page.waitForTimeout(600)
    const f1 = (await trackX())[0]
    ok('selected tile row PAUSES', Math.abs(f1 - f0) < 1.5, `Δ=${(f1 - f0).toFixed(2)}`)

    const b0 = (await trackX())[1]
    await page.waitForTimeout(400)
    const b1 = (await trackX())[1]
    ok('other row keeps moving', Math.abs(b1 - b0) > 1, `Δ=${(b1 - b0).toFixed(2)}`)

    const scaleX = await page.evaluate(() => {
      const el = document.querySelector('[data-tile-key][aria-pressed="true"]')
      if (!el) return 1
      const m = /matrix\(([-0-9.]+)/.exec(getComputedStyle(el).transform)
      return m ? parseFloat(m[1]) : 1
    })
    ok('selected tile scales up (>1)', scaleX > 1.02, `scaleX=${scaleX.toFixed(3)}`)
    await page.screenshot({ path: `${OUT}/gallery-selected.png` })

    // 4 — tap the selected (now stationary) tile again → deselect
    const sc = await selectedCenter()
    if (sc) {
      await page.mouse.click(sc.x, sc.y)
      await page.waitForTimeout(250)
      ok('tap again deselects', (await pressedCount()) === 0, `pressed=${await pressedCount()}`)
    } else {
      ok('deselect reachable', false, 'no selected tile')
    }
  } else {
    ok('tappable tile in viewport', false, 'none found')
  }

  // 5 — drag the first row to the RIGHT → direction reverses (x starts increasing)
  const rowRect = await page.evaluate(() => {
    const row = document.querySelector('[data-testid="marquee-row"]')
    if (!row) return null
    const r = row.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height }
  })
  if (rowRect) {
    const cy = rowRect.y + rowRect.h / 2
    const sx = rowRect.x + rowRect.w / 2
    await page.mouse.move(sx, cy)
    await page.mouse.down()
    for (let i = 1; i <= 8; i++) {
      await page.mouse.move(sx + i * 18, cy)
      await page.waitForTimeout(16)
    }
    await page.mouse.up()
    await page.waitForTimeout(350)
    const g0 = (await trackX())[0]
    await page.waitForTimeout(600)
    const g1 = (await trackX())[0]
    ok('drag-right reverses row A (now scrolls right)', g1 - g0 > 0.5, `Δ=${(g1 - g0).toFixed(1)}`)
  } else {
    ok('drag test reachable', false, 'no row')
  }

  await ctx.close()
  const failed = results.filter((r) => !r.p)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length) {
    console.log('FAILED: ' + failed.map((f) => f.n).join(' | '))
    process.exitCode = 1
  } else {
    console.log('GALLERY VERIFIED')
  }
} catch (e) {
  console.error('ERR', e instanceof Error ? e.stack : String(e))
  process.exitCode = 1
} finally {
  await browser.close()
}

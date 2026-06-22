// Verify the galleries are full-bleed: tiles reach the screen edge AND no horizontal page scroll
// is introduced (the main risk of a 100vw breakout). Desktop + mobile. Screenshots saved.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

/* global document, window */

const BASE = process.env.BASE ?? 'http://localhost:4173'
const OUT = process.env.OUT ?? '/tmp/fb'
mkdirSync(OUT, { recursive: true })

const ok = (n, c, d = '') => {
  console.log((c ? 'PASS' : 'FAIL') + ' · ' + n + (d ? ' · ' + d : ''))
  return c
}

const browser = await chromium.launch()
let fail = 0
try {
  for (const v of [
    { d: 'desktop', w: 1280, h: 900, dsf: 1 },
    { d: 'mobile', w: 390, h: 844, dsf: 2 },
  ]) {
    const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h }, colorScheme: 'dark', deviceScaleFactor: v.dsf })
    const p = await ctx.newPage()
    await p.goto(BASE, { waitUntil: 'networkidle' })
    await p.waitForSelector('#root > *')
    await p.getByRole('button', { name: 'Om oss', exact: true }).first().click()
    await p.waitForTimeout(1100)

    const horiz = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
    if (!ok(`${v.d}: no horizontal page scroll`, horiz.sw <= horiz.cw + 1, `scrollW=${horiz.sw} clientW=${horiz.cw}`)) fail++

    await p.evaluate(() => {
      const h = [...document.querySelectorAll('h3')].find((e) => (e.textContent || '').includes('I salongen'))
      if (h) h.scrollIntoView({ block: 'center' })
    })
    await p.waitForTimeout(400)

    const minLeft = await p.evaluate(() => {
      const tiles = [...document.querySelectorAll('[data-tile-key]')]
      let m = 9999
      for (const t of tiles) {
        const r = t.getBoundingClientRect()
        if (r.bottom > 0 && r.top < window.innerHeight) m = Math.min(m, r.left)
      }
      return Math.round(m)
    })
    if (!ok(`${v.d}: tiles reach the screen edge (left ~ 0)`, minLeft <= 2, `minLeft=${minLeft}`)) fail++

    await p.screenshot({ path: `${OUT}/${v.d}-fullbleed.png` })
    await ctx.close()
  }
  console.log(fail === 0 ? '\nFULLBLEED OK' : '\nFULLBLEED ISSUES')
  process.exitCode = fail === 0 ? 0 : 1
} catch (e) {
  console.error('ERR', e instanceof Error ? e.stack : String(e))
  process.exitCode = 1
} finally {
  await browser.close()
}

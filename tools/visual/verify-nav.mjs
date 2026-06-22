// Navigation-MODEL verification (not content). Proves the home/booking/about state machine:
//   - HOME is static: the page does NOT scroll, both desktop folds are collapsed, and on mobile the
//     shell's overflowY is `hidden` with neither section in the DOM.
//   - "Boka tid" opens ONLY the booking section; "Om oss" opens ONLY the about section; toggling
//     returns to the static home. Each link drives its own state — you cannot reach a section by
//     scrolling. Screenshots are saved alongside for a visual cross-check.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

// `document` / `window` / `getComputedStyle` below appear only inside page.evaluate() callbacks,
// which execute in the BROWSER (not Node) — declare them so ESLint's Node env doesn't flag them.
/* global document, window, getComputedStyle */

const BASE = process.env.BASE ?? 'http://localhost:4173'
const OUT = process.env.OUT ?? '/tmp/nav'
mkdirSync(OUT, { recursive: true })

const results = []
const ok = (name, cond, detail = '') => {
  results.push({ name, pass: !!cond })
  console.log((cond ? 'PASS' : 'FAIL') + ' · ' + name + (detail ? ' · ' + detail : ''))
}
const settle = (page) => page.waitForTimeout(950) // let the .58s/.66s fold transition finish

const metrics = (page) => page.evaluate(() => ({ scroll: document.documentElement.scrollHeight, inner: window.innerHeight }))
const foldH = (page, id) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel)
    return el ? Math.round(el.getBoundingClientRect().height) : -1
  }, `[data-testid="${id}"]`)
const shellOverflowY = (page) =>
  page.evaluate(() => {
    const el = document.querySelector('#root > div')
    return el ? getComputedStyle(el).overflowY : 'n/a'
  })

const browser = await chromium.launch()
try {
  // ----------------------------- DESKTOP -----------------------------
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: 'dark', deviceScaleFactor: 1, reducedMotion: 'reduce' })
    const page = await ctx.newPage()
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.waitForSelector('#root > *')
    await settle(page)

    let m = await metrics(page)
    ok('desktop HOME does not scroll', m.scroll <= m.inner + 2, `scroll=${m.scroll} inner=${m.inner}`)
    ok('desktop HOME booking fold collapsed', (await foldH(page, 'fold-booking')) <= 1)
    ok('desktop HOME about fold collapsed', (await foldH(page, 'fold-about')) <= 1)
    await page.screenshot({ path: `${OUT}/d-home.png` })

    await page.getByRole('button', { name: 'Boka tid', exact: true }).first().click()
    await settle(page)
    // "Reveal" = the booking fold expanded (NOT page scroll — the barber-select step is short enough
    // to fit a tall viewport, so scrollHeight need not grow; the fold height is the real signal).
    ok('desktop BOKA TID booking fold OPEN', (await foldH(page, 'fold-booking')) > 100)
    ok('desktop BOKA TID about fold still collapsed', (await foldH(page, 'fold-about')) <= 1)
    await page.screenshot({ path: `${OUT}/d-booking.png` })

    await page.getByRole('button', { name: 'Om oss', exact: true }).first().click()
    await settle(page)
    ok('desktop OM OSS about fold OPEN', (await foldH(page, 'fold-about')) > 100)
    ok('desktop OM OSS booking fold collapsed (switched off)', (await foldH(page, 'fold-booking')) <= 1)
    await page.screenshot({ path: `${OUT}/d-about.png` })

    await page.getByRole('button', { name: 'Om oss', exact: true }).first().click()
    await settle(page)
    m = await metrics(page)
    ok('desktop OM OSS again returns to static HOME (no scroll)', m.scroll <= m.inner + 2, `scroll=${m.scroll}`)
    ok('desktop HOME both folds collapsed again', (await foldH(page, 'fold-booking')) <= 1 && (await foldH(page, 'fold-about')) <= 1)
    await ctx.close()
  }

  // ----------------------------- MOBILE -----------------------------
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', deviceScaleFactor: 1, reducedMotion: 'reduce' })
    const page = await ctx.newPage()
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.waitForSelector('#root > *')
    await settle(page)

    ok('mobile HOME shell overflowY hidden (not scrollable)', (await shellOverflowY(page)) === 'hidden', `overflowY=${await shellOverflowY(page)}`)
    ok('mobile HOME booking not in DOM', (await page.getByText('Välj din barberare').count()) === 0)
    ok('mobile HOME about not in DOM', (await page.getByText('Hantverk, inte bara en').count()) === 0)
    await page.screenshot({ path: `${OUT}/m-home.png` })

    await page.getByRole('button', { name: 'Boka tid', exact: true }).first().click()
    await settle(page)
    ok('mobile BOKA TID booking visible', await page.getByText('Välj din barberare').first().isVisible())
    ok('mobile BOKA TID about not in DOM', (await page.getByText('Hantverk, inte bara en').count()) === 0)
    ok('mobile BOKA TID shell scrollable', (await shellOverflowY(page)) === 'auto', `overflowY=${await shellOverflowY(page)}`)
    await page.screenshot({ path: `${OUT}/m-booking.png` })

    await page.getByTitle('Till startsidan').first().click()
    await settle(page)
    ok('mobile BACK chevron returns home (booking gone)', (await page.getByText('Välj din barberare').count()) === 0)
    ok('mobile BACK shell overflowY hidden again', (await shellOverflowY(page)) === 'hidden')

    await page.getByRole('button', { name: 'Om oss', exact: true }).first().click()
    await settle(page)
    ok('mobile OM OSS about visible', await page.getByText('Hantverk, inte bara en').first().isVisible())
    ok('mobile OM OSS booking not in DOM', (await page.getByText('Välj din barberare').count()) === 0)
    await page.screenshot({ path: `${OUT}/m-about.png` })
    await ctx.close()
  }

  const failed = results.filter((r) => !r.pass)
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
  if (failed.length) {
    console.log('FAILED: ' + failed.map((f) => f.name).join(' | '))
    process.exitCode = 1
  } else {
    console.log('NAV MODEL VERIFIED')
  }
} catch (e) {
  console.error('VERIFY ERROR:', e instanceof Error ? e.stack : String(e))
  process.exitCode = 1
} finally {
  await browser.close()
}

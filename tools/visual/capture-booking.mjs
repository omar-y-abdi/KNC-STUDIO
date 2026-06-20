// Booking-flow state capture (desktop). Drives the flow deterministically (fixed clock = June 2026,
// today=19) and screenshots: the service/time builder, the pristine details popup, the per-field
// error popup (invalid phone), and the confirmation. Same selectors work on the original + new build.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://localhost:8090'
const OUT = process.env.OUT ?? '/tmp/bk'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()

async function flow(scheme) {
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    colorScheme: scheme,
    deviceScaleFactor: 2,
    reducedMotion: 'reduce',
  })
  const page = await ctx.newPage()
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForSelector('#root > *', { timeout: 15000 })

  await page.getByRole('button', { name: 'Boka tid', exact: true }).first().click() // expand fold
  await page.getByRole('button').filter({ hasText: 'Hassan' }).click()
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: '20', exact: true }).click() // Sat 20 June (selectable)
  await page.getByRole('button').filter({ hasText: 'Hårklippning + skägg' }).first().click()
  await page.waitForTimeout(400)
  if (scheme === 'light') await page.screenshot({ path: `${OUT}/bk-builder-light.png`, fullPage: true })

  await page.getByRole('button', { name: '10:30', exact: true }).click() // free slot -> popup
  await page.waitForTimeout(500)
  if (scheme === 'light') await page.screenshot({ path: `${OUT}/bk-popup-pristine-light.png` })

  // invalid phone -> per-field red + note
  await page.getByPlaceholder('För- och efternamn').fill('Test Testsson')
  await page.getByPlaceholder('07X XXX XX XX').fill('abc')
  await page.getByRole('button', { name: 'SMS', exact: true }).click()
  await page.getByRole('button', { name: 'Boka tid', exact: true }).last().click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/bk-popup-error-${scheme}.png` })

  if (scheme === 'light') {
    await page.getByPlaceholder('07X XXX XX XX').fill('0701234567') // valid -> book -> confirmation
    await page.getByRole('button', { name: 'Boka tid', exact: true }).last().click()
    await page.waitForTimeout(600)
    await page.screenshot({ path: `${OUT}/bk-confirm-light.png` })
  }
  await ctx.close()
}

try {
  await flow('light')
  await flow('dark')
  console.log('DONE')
} catch (e) {
  console.error('BK ERROR:', e instanceof Error ? e.message : String(e))
  process.exitCode = 1
} finally {
  await browser.close()
}

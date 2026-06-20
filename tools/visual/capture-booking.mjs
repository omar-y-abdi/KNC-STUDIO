// Booking-flow capture (desktop). Waits for each step to appear before acting, then screenshots
// the pristine details popup and the per-field error popup (invalid phone).
// Run against a FIXED-clock build (VITE_CLOCK=fixed → June 2026, Sat 20 selectable).
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
  await page.waitForSelector('#root > *')

  await page.getByRole('button', { name: 'Boka tid', exact: true }).first().click()
  await page.getByText('Välj din barberare').waitFor({ state: 'visible', timeout: 10000 })
  await page.getByRole('button', { name: /Hassan/ }).click()
  await page.getByText('Välj en dag').waitFor({ state: 'visible', timeout: 10000 })
  await page.getByRole('button', { name: '20', exact: true }).click()
  await page.getByText('Hårklippning + skägg').first().waitFor({ state: 'visible', timeout: 10000 })
  await page.getByText('Hårklippning + skägg').first().click()
  const slot = page.getByRole('button', { name: '10:30', exact: true })
  await slot.waitFor({ state: 'visible', timeout: 10000 })
  await slot.click()
  await page.getByText('Dina uppgifter').waitFor({ state: 'visible', timeout: 10000 })
  if (scheme === 'light') await page.screenshot({ path: `${OUT}/bk-popup-pristine.png` })

  await page.getByPlaceholder('För- och efternamn').fill('Test Testsson')
  await page.getByPlaceholder('07X XXX XX XX').fill('abc')
  await page.getByRole('button', { name: 'SMS', exact: true }).click()
  await page.getByRole('button', { name: 'Boka tid', exact: true }).last().click()
  await page.getByRole('alert').first().waitFor({ state: 'visible', timeout: 6000 })
  await page.screenshot({ path: `${OUT}/bk-popup-error-${scheme}.png` })
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

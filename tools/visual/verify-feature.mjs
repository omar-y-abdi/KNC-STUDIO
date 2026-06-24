// One-off feature verification: drives the NEW phone-only booking, phone-only cancellation, and
// phone-gated review flows against a running mock dev server, captures screenshots, and asserts the
// removed method/email UI is gone + the flows work functionally (mock). Run with VITE_CLOCK=fixed.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://localhost:5173'
const OUT = process.env.OUT ?? '/tmp/knc-shots'
mkdirSync(OUT, { recursive: true })
const log = (...a) => console.log(...a)
const results = []

const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 900 },
  colorScheme: 'light',
  deviceScaleFactor: 1,
  reducedMotion: 'reduce',
})
const page = await ctx.newPage()

async function fresh() {
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForSelector('#root > *')
  await page.waitForTimeout(600)
}

try {
  await fresh()
  await page.screenshot({ path: `${OUT}/01-home.png` })
  log('home captured')

  // ===== BOOKING =====
  await page.getByRole('button', { name: 'Boka tid', exact: true }).first().click()
  await page.getByText('Välj din barberare').waitFor({ state: 'visible', timeout: 10000 })
  await page.getByRole('button', { name: /Hassan/ }).click()
  await page.getByText('Välj en dag', { exact: true }).waitFor({ state: 'visible', timeout: 10000 })
  await page.getByRole('button', { name: '20', exact: true }).click()
  await page.getByText('Hårklippning + skägg').first().waitFor({ state: 'visible', timeout: 10000 })
  await page.getByText('Hårklippning + skägg').first().click()
  const slot = page.getByRole('button', { name: '10:30', exact: true })
  await slot.waitFor({ state: 'visible', timeout: 10000 })
  await slot.click()
  await page.getByText('Dina uppgifter').waitFor({ state: 'visible', timeout: 10000 })
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/02-booking-popup.png` })

  results.push(['booking popup — SMS method buttons (want 0)', await page.getByRole('button', { name: 'SMS', exact: true }).count()])
  results.push(['booking popup — "post" (email) mentions (want 0)', await page.getByText(/post/i).count()])
  results.push(['booking popup — phone field (want 1)', await page.getByPlaceholder('07X XXX XX XX').count()])
  results.push(['booking popup — name field (want 1)', await page.getByPlaceholder('För- och efternamn').count()])

  await page.getByPlaceholder('För- och efternamn').fill('Test Testsson')
  await page.getByRole('textbox', { name: 'Telefon', exact: true }).fill('0701234567')
  await page.screenshot({ path: `${OUT}/03-booking-filled.png` })
  await page.getByRole('button', { name: 'Boka tid', exact: true }).last().click()
  const booked = await page.getByText(/Tack/).first().waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false)
  results.push(['booking submit → confirmation (mock)', booked])
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/04-booking-confirmed.png` })

  // ===== CANCELLATION =====
  await fresh()
  await page.getByRole('button', { name: 'Avbokning', exact: true }).first().click()
  await page.waitForTimeout(500)
  results.push(['cancel — SMS method buttons (want 0)', await page.getByRole('button', { name: 'SMS', exact: true }).count()])
  results.push(['cancel — phone field (want 1)', await page.getByPlaceholder('07X XXX XX XX').count()])
  await page.getByRole('textbox', { name: 'Telefon', exact: true }).fill('0701234567')
  await page.screenshot({ path: `${OUT}/05-cancel-lookup.png` })
  await page.getByRole('button', { name: 'Avboka tid', exact: true }).first().click()
  const found = await page.getByText(/hittade din bokning/i).waitFor({ state: 'visible', timeout: 8000 }).then(() => true).catch(() => false)
  results.push(['cancel lookup → booking found (mock)', found])
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/06-cancel-confirm.png` })

  // ===== REVIEWS =====
  await fresh()
  const about = page.getByText('Om oss', { exact: true })
  if ((await about.count()) > 0) {
    await about.first().click()
    await page.waitForTimeout(900)
  }
  await page.getByText('Omdömen').first().scrollIntoViewIfNeeded().catch(() => {})
  await page.waitForTimeout(500)
  await page.screenshot({ path: `${OUT}/07-reviews.png` })
  results.push(['reviews — phone field in form (want 1)', await page.getByPlaceholder('07X XXX XX XX').count()])
  results.push(['reviews — old name placeholder gone (want 0)', await page.getByPlaceholder('För- och efternamn').count()])

  log('\n===== ASSERTIONS =====')
  for (const [k, v] of results) log(`  ${k}: ${v}`)
  log('\nDONE')
} catch (e) {
  console.error('VERIFY ERROR:', e instanceof Error ? e.message : String(e))
  log('\n===== partial assertions =====')
  for (const [k, v] of results) log(`  ${k}: ${v}`)
  await page.screenshot({ path: `${OUT}/ERROR-state.png` }).catch(() => {})
  process.exitCode = 1
} finally {
  await browser.close()
}

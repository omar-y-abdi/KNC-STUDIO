// Capture the cancellation popup (lookup + confirm steps) to verify its text now renders in the
// site font (SF Pro), not the browser default serif. Desktop, light + dark.
import { chromium } from 'playwright'
import { mkdirSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://localhost:4173'
const OUT = process.env.OUT ?? '/tmp/cancel'
mkdirSync(OUT, { recursive: true })

const browser = await chromium.launch()
try {
  for (const scheme of ['dark', 'light']) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: scheme, deviceScaleFactor: 1, reducedMotion: 'reduce' })
    const page = await ctx.newPage()
    await page.goto(BASE, { waitUntil: 'networkidle' })
    await page.waitForSelector('#root > *')
    await page.waitForTimeout(600)

    await page.getByRole('button', { name: 'Avbokning', exact: true }).first().click()
    await page.waitForTimeout(500)
    await page.getByRole('button', { name: 'SMS', exact: true }).first().click()
    await page.waitForTimeout(300)
    await page.getByPlaceholder('07X XXX XX XX').fill('0701234567')
    await page.waitForTimeout(200)
    await page.screenshot({ path: `${OUT}/cancel-lookup-${scheme}.png` })

    await page.getByRole('button', { name: 'Avboka tid', exact: true }).first().click()
    await page.waitForTimeout(1000)
    await page.screenshot({ path: `${OUT}/cancel-confirm-${scheme}.png` })
    console.log('captured', scheme)
    await ctx.close()
  }
  console.log('DONE')
} catch (e) {
  console.error('CAP ERROR:', e instanceof Error ? e.stack : String(e))
  process.exitCode = 1
} finally {
  await browser.close()
}

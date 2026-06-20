// Render tools/og/card.html -> public/og-image.png (1200x630). The card must be served so its
// /fonts and /assets URLs resolve. Usage: URL=<served card url> OUT=<png path> node render.mjs
import { chromium } from 'playwright'

const URL = process.env.URL
const OUT = process.env.OUT
if (!URL || !OUT) {
  console.error('Set URL and OUT')
  process.exit(1)
}

const browser = await chromium.launch()
try {
  const ctx = await browser.newContext({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
    reducedMotion: 'reduce',
  })
  const page = await ctx.newPage()
  await page.goto(URL, { waitUntil: 'networkidle', timeout: 30000 })
  await page.waitForTimeout(500)
  await page.screenshot({ path: OUT })
  console.log('OG card ->', OUT)
} finally {
  await browser.close()
}

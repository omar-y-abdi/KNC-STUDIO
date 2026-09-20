import assert from 'node:assert/strict'
import { chromium, webkit } from 'playwright'

const base = process.env.BASE_URL ?? 'http://127.0.0.1:4188'
for (const [name, engine] of Object.entries({ chromium, webkit })) {
  if (process.env.CMS_BROWSER && process.env.CMS_BROWSER !== name) continue
  const browser = await engine.launch()
  try {
    const page = await browser.newPage({ reducedMotion: 'reduce' })
    await page.goto(`${base}/tools/e2e/admin-harness.html`)
    const checks = await page.evaluate(async () => {
      const fixture = await import('/tools/e2e/cms-projection.tsx')
      return fixture.verifyNativeProjection()
    })
    assert.equal(checks.length, 15)
    await page.screenshot({ path: `/tmp/cms-native-${name}-component-projection.png` })
    console.log(`PASS ${name}: ${checks.join('; ')}`)
  } finally {
    await browser.close()
  }
}

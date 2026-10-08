import assert from 'node:assert/strict'
import { test } from './fixtures.mjs'
test.use({ reducedMotion: 'reduce' })
test('cms-projection', async ({ page, browserName }) => {
  const name = browserName
  const base = process.env.BASE_URL ?? 'http://127.0.0.1:4188'
  await page.goto(`${base}/tools/e2e/admin-harness.html`)
  const checks = await page.evaluate(async () => {
    const fixture = await import('/tools/e2e/cms-projection.tsx')
    return fixture.verifyNativeProjection()
  })
  assert.equal(checks.length, 18)
  await page.screenshot({ path: `/tmp/cms-native-${name}-component-projection.png` })
  console.log(`PASS ${name}: ${checks.join('; ')}`)
})

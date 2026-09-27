import assert from 'node:assert/strict'
import { chromium, firefox, webkit } from 'playwright'

const base = process.env.BASE_URL ?? 'http://127.0.0.1:4190'
assert.equal(new URL(base).hostname, '127.0.0.1')
for (const [name, engine] of Object.entries({ chromium, firefox, webkit })) {
  const browser = await engine.launch()
  try {
    for (const width of [1280, 390]) {
      const context = await browser.newContext({
        viewport: { width, height: 844 },
        reducedMotion: 'reduce',
      })
      const page = await context.newPage()
      page.setDefaultTimeout(10000)
      try {
        await page.route('https://challenges.cloudflare.com/**', (route) =>
          route.fulfill({
            contentType: 'application/javascript',
            // Delay only the provider's documented 300x65 normal widget, not the real dialog.
            body: `window.turnstile={render:(el,options)=>{
              window.releaseWidget=()=>{el.style.width='300px';el.style.height='65px';options.callback('fixture')};
              return 'fixture';
            },remove:()=>{}}`,
          }),
        )
        await page.goto(`${base}/tools/e2e/admin-harness.html`)
        await page.evaluate(async () => {
          // The shared admin harness installs an inert provider; exercise the real loader here.
          delete globalThis.window.turnstile
          const harness = await import('/tools/e2e/admin-harness.tsx')
          harness.mountContactHarness('booking', 'en')
        })
        await page.getByTestId('booking-barber-option').click()
        await page.getByRole('button', { name: 'Monday 14 September 2026', exact: true }).click()
        await page.getByTestId('booking-service-option').click()
        await page.getByRole('button', { name: '10:00', exact: true }).click()
        await page.getByRole('dialog').locator('input').first().fill('Typed name survives')
        await page.waitForFunction(() => typeof globalThis.window.releaseWidget === 'function')
        const close = page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true })
        const before = await close.boundingBox()
        assert.ok(before)
        await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2)
        await page.mouse.down()
        await page.evaluate(() => globalThis.window.releaseWidget())
        const after = await close.boundingBox()
        await page.mouse.up()
        assert.ok(after)
        assert.ok(
          Math.abs(after.y - before.y) < 1,
          `${name}/${width}: late widget moved Close by ${after.y - before.y}px`,
        )
        await page.getByRole('dialog').waitFor({ state: 'hidden' })
        await page.getByRole('button', { name: '10:00', exact: true }).click()
        assert.equal(
          await page.getByRole('dialog').locator('input').first().inputValue(),
          'Typed name survives',
        )
        console.log(
          `PASS ${name}/${width}: delayed verifier preserves the close click and booking draft`,
        )
      } finally {
        await context.close()
      }
    }
  } finally {
    await browser.close()
  }
}

import assert from 'node:assert/strict'

import { test } from './fixtures.mjs'
import { harnessOrigin } from './origins.mjs'
const base = harnessOrigin
for (const width of [1280, 390])
  test.describe('delayed widget ' + width, () => {
    test.use({ viewport: { width, height: 844 }, contextOptions: { reducedMotion: 'reduce' } })
    test('no placeholder before the widget loads; draft survives late verification', async ({
      page,
      browserName,
    }) => {
      const name = browserName
      page.setDefaultTimeout(10000)

      await page.route('https://challenges.cloudflare.com/**', (route) =>
        route.fulfill({
          contentType: 'application/javascript',
          // Delay only the provider's documented 300x65 normal widget, not the real dialog.
          body: `window.turnstile={render:(el,options)=>{
              el.dataset.testid='turnstile-container';
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
      // The widget container's height and the Book button's offset from the card top. An empty
      // placeholder would show as container height before release, and as Book moving by less
      // than the widget's own height after it. Measured inside the card, so the mobile card's CSS
      // zoom and the centered card's own movement cancel out.
      const geometry = () =>
        page.evaluate(() => {
          const card = globalThis.document.querySelector('[role="dialog"]')
          const container = card?.querySelector('[data-testid="turnstile-container"]')
          const book = card ? [...card.querySelectorAll('button')].at(-1) : undefined
          if (!card || !container || !book)
            throw new Error('Details dialog, widget container or Book button missing')
          return {
            container: container.getBoundingClientRect().height,
            book: book.getBoundingClientRect().top - card.getBoundingClientRect().top,
          }
        })
      const before = await geometry()
      assert.equal(
        before.container,
        0,
        `${name}/${width}: pending widget container reserved ${before.container}px`,
      )
      await page.evaluate(() => globalThis.window.releaseWidget())
      const after = await geometry()
      assert.ok(
        after.container > 0,
        `${name}/${width}: the released widget did not size its container`,
      )
      const pushed = after.book - before.book
      assert.ok(
        Math.abs(pushed - after.container) < 1,
        `${name}/${width}: loaded widget moved Book by ${pushed}px while its container is ${after.container}px tall`,
      )
      await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
      await page.getByRole('dialog').waitFor({ state: 'hidden' })
      await page.getByRole('button', { name: '10:00', exact: true }).click()
      assert.equal(
        await page.getByRole('dialog').locator('input').first().inputValue(),
        'Typed name survives',
      )
      console.log(
        `PASS ${name}/${width}: no placeholder before the widget; late verification keeps the draft`,
      )
    })
  })

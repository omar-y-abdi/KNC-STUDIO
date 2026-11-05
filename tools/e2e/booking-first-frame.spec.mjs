import { test, expect } from './fixtures.mjs'
import { publicOrigin } from './origins.mjs'
import { installStoredBackend } from './public-fixtures.mjs'

for (const reducedMotion of ['reduce', 'no-preference'])
  test(`invisible booking verification is compact from its first frame (${reducedMotion})`, async ({
    page,
    context,
    evidenceDir,
  }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.emulateMedia({ reducedMotion, colorScheme: 'dark' })
    await page.clock.setFixedTime(new Date('2026-09-14T07:00:00Z'))
    await installStoredBackend(context)
    await context.addCookies([
      { name: 'bladeblend_storage_preferences', value: 'essential', url: publicOrigin },
    ])
    await context.route('https://admin-harness.invalid/rest/v1/rpc/available_slots*', (route) =>
      route.fulfill({
        json: ['10:00'],
        headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' },
      }),
    )
    let releaseScript
    const scriptGate = new Promise((resolve) => {
      releaseScript = resolve
    })
    let requested = false
    await page.route('https://challenges.cloudflare.com/**', async (route) => {
      requested = true
      await scriptGate
      await route.fulfill({
        contentType: 'application/javascript',
        body: `window.turnstile={render:(container,options)=>{
        const frame=document.createElement('iframe'); frame.title='Invisible verification'; frame.style.cssText='width:0;height:0;border:0;display:block'; container.appendChild(frame);
        window.finishVerification=()=>options.callback('fixture-token'); return 'fixture';
      },remove:()=>{}}`,
      })
    })
    try {
      await page.goto(`${publicOrigin}/?mode=dark`)
      await page.evaluate(() => globalThis.document.fonts.ready)
      await page.getByRole('button', { name: 'Boka tid', exact: true }).click()
      await page.getByTestId('booking-barber-option').first().click()
      await page.getByRole('button', { name: /måndag 14 september 2026/i }).click()
      await page.getByTestId('booking-service-option').first().click()
      await page.evaluate(() => {
        const read = () => {
          const card = globalThis.document.querySelector('[aria-labelledby="knc-details-title"]')
          if (!card) return null
          const book = [...card.querySelectorAll('button')].at(-1)
          return {
            height: card.offsetHeight,
            buttonTop: book.offsetTop,
            buttonHeight: book.offsetHeight,
            disabled: book.disabled,
          }
        }
        globalThis.bookingFrames = []
        globalThis.readBookingFrame = read
        let started = false
        const observer = new globalThis.MutationObserver(() => {
          if (started || !read()) return
          started = true
          globalThis.bookingFrames.push(read())
          const sample = () => {
            if (!globalThis.stopBookingFrames) {
              globalThis.bookingFrames.push(read())
              globalThis.requestAnimationFrame(sample)
            }
          }
          globalThis.requestAnimationFrame(sample)
          observer.disconnect()
        })
        observer.observe(globalThis.document.body, { childList: true, subtree: true })
      })
      await page.getByRole('button', { name: '10:00', exact: true }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await expect.poll(() => requested).toBe(true)
      await dialog.getByRole('textbox', { name: 'Namn', exact: true }).fill('Test Person')
      await dialog.getByRole('textbox', { name: 'Telefon', exact: true }).fill('0701234567')
      await dialog.getByRole('textbox', { name: 'E-post', exact: true }).fill('test@example.test')
      const book = dialog.getByRole('button', { name: 'Boka tid', exact: true })
      await expect(book).toBeDisabled()
      await page.waitForFunction(() => globalThis.bookingFrames.length >= 90)
      await page.screenshot({ path: `${evidenceDir}/pending-first-frame.png` })
      releaseScript()
      await page.waitForFunction(() => typeof globalThis.finishVerification === 'function')
      await expect(book).toBeDisabled()
      await page.evaluate(() => globalThis.finishVerification())
      await expect(book).toBeEnabled()
      const frames = await page.evaluate(() => {
        globalThis.stopBookingFrames = true
        return {
          first: globalThis.bookingFrames[0],
          pending: globalThis.bookingFrames,
          ready: globalThis.readBookingFrame(),
        }
      })
      testInfo.annotations.push({ type: 'geometry', description: JSON.stringify(frames) })
      for (const frame of frames.pending) {
        expect(frame.height).toBe(frames.ready.height)
        expect(frame.buttonTop).toBe(frames.ready.buttonTop)
        expect(frame.buttonHeight).toBe(frames.ready.buttonHeight)
      }
      await page.screenshot({ path: `${evidenceDir}/verified.png` })
    } finally {
      releaseScript()
    }
  })

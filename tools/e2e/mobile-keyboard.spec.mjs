import { test, expect } from './fixtures.mjs'
import { harnessOrigin } from './origins.mjs'
import { installStoredBackend } from './public-fixtures.mjs'

for (const field of ['phone', 'review'])
  test(`folded header retains its CSS viewport geometry while ${field} keyboard opens`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await installStoredBackend(context)
    await context.addCookies([
      { name: 'bladeblend_storage_preferences', value: 'essential', url: harnessOrigin },
    ])
    await page.goto(`${harnessOrigin}/?mode=light`)
    const input =
      field === 'phone'
        ? page.getByRole('textbox', { name: /Telefonnummer/ })
        : page.getByRole('textbox', { name: 'Ditt omdöme', exact: true })
    await input.scrollIntoViewIfNeeded()
    await input.fill(field === 'phone' ? '0701234567' : 'Ett testomdöme')
    const panel = page.locator('[data-knc-fold="panel"]')
    await expect.poll(() => panel.evaluate((element) => element.offsetHeight)).toBe(112)
    const before = await page
      .getByTestId('mobile-site-scroll')
      .evaluate((element) => ({ height: element.clientHeight, scroll: element.scrollTop }))
    await page.evaluate(() => {
      const original = Object.getOwnPropertyDescriptor(globalThis.window, 'innerHeight')
      globalThis.restoreKeyboardViewport = () => {
        Object.defineProperty(globalThis.window, 'innerHeight', original)
        delete globalThis.visualViewport.height
        delete globalThis.visualViewport.offsetTop
        globalThis.dispatchEvent(new globalThis.Event('resize'))
      }
      // Model Safari's keyboard-visible viewport independently from the CSS 100dvh layout box.
      // This is a geometry/event regression, not a claim that desktop WebKit opens an iOS keyboard.
      globalThis.keyboardViewport = (height, offsetTop) => {
        Object.defineProperty(globalThis.window, 'innerHeight', {
          value: height,
          configurable: true,
        })
        Object.defineProperty(globalThis.visualViewport, 'height', {
          value: height,
          configurable: true,
        })
        Object.defineProperty(globalThis.visualViewport, 'offsetTop', {
          value: offsetTop,
          configurable: true,
        })
        globalThis.dispatchEvent(new globalThis.Event('resize'))
        globalThis.visualViewport.dispatchEvent(new globalThis.Event('resize'))
        globalThis.visualViewport.dispatchEvent(new globalThis.Event('scroll'))
      }
    })
    for (const [height, offset] of [
      [600, 0],
      [420, 0],
      [390, 120],
      [420, 0],
    ]) {
      await page.evaluate(
        ([height, offset]) => globalThis.keyboardViewport(height, offset),
        [height, offset],
      )
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve)),
          ),
      )
      expect(
        await page.getByTestId('mobile-site-scroll').evaluate((element) => element.clientHeight),
      ).toBe(before.height)
      expect(await panel.evaluate((element) => element.offsetHeight)).toBe(112)
      await expect(input).toBeFocused()
    }
    await page.evaluate(() => globalThis.restoreKeyboardViewport())
    await expect.poll(() => panel.evaluate((element) => element.offsetHeight)).toBe(112)
    await expect(input).toHaveValue(field === 'phone' ? '0701234567' : 'Ett testomdöme')
    // Real layout-viewport changes still update the fold, unlike the independent keyboard model.
    await page.setViewportSize({ width: 667, height: 390 })
    await page.setViewportSize({ width: 390, height: 667 })
    await input.scrollIntoViewIfNeeded()
    await expect.poll(() => panel.evaluate((element) => element.offsetHeight)).toBe(112)
    await expect(input).toHaveValue(field === 'phone' ? '0701234567' : 'Ett testomdöme')
  })

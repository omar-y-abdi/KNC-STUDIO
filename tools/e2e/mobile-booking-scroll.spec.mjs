import { test, expect } from './fixtures.mjs'
import { harnessOrigin } from './origins.mjs'
import { installPublicBackend, installStoredBackend } from './public-fixtures.mjs'
for (const stored of [false, true]) {
  test(`hero navigation retains the original 660 ms transition (${stored ? 'stored' : 'source'})`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await (stored ? installStoredBackend : installPublicBackend)(context)
    await context.addCookies([
      { name: 'bladeblend_storage_preferences', value: 'essential', url: harnessOrigin },
    ])
    await page.goto(`${harnessOrigin}/?mode=light`)
    await expect(page.getByRole('button', { name: 'Boka tid', exact: true })).toBeVisible()
    for (const name of ['Om oss', 'Till startsidan', 'Boka tid', 'Till startsidan']) {
      const result = await page.evaluate(async (name) => {
        const root = globalThis.document.querySelector('[data-testid="mobile-site-scroll"]')
        const button = [...root.querySelectorAll('button')].find(
          (button) =>
            (button.getAttribute('aria-label') ?? button.getAttribute('title') ?? button.textContent.trim()) === name,
        )
        const samples = []
        let timing = null
        const start = performance.now()
        button.click()
        await new Promise((resolve) => {
          const sample = () => {
            samples.push(root.scrollTop)
            const animation = root.getAnimations()[0]
            if (animation) {
              const current = animation.effect.getTiming()
              timing = { duration: current.duration, easing: current.easing.replace(/\s/g, '') }
            }
            if (performance.now() - start >= 850) resolve()
            else requestAnimationFrame(sample)
          }
          requestAnimationFrame(sample)
        })
        return { samples, timing }
      }, name)
      // These values come from the pre-regression height transition, not Safari's unspecified
      // smooth-scroll duration. Both directions must show intermediate poses before settling.
      expect(result.timing).toEqual({ duration: 660, easing: 'cubic-bezier(0.32,0.72,0,1)' })
      expect(new Set(result.samples.filter((position) => position > 0 && position < 732)).size)
        .toBeGreaterThan(3)
      expect(result.samples.at(-1)).toBe(name === 'Till startsidan' ? 0 : 732)
    }
  })

  test(`a manual gesture interrupts hero navigation without a delayed jump (${stored ? 'stored' : 'source'})`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await (stored ? installStoredBackend : installPublicBackend)(context)
    await context.addCookies([
      { name: 'bladeblend_storage_preferences', value: 'essential', url: harnessOrigin },
    ])
    await page.goto(`${harnessOrigin}/?mode=light`)
    await expect(page.getByRole('button', { name: 'Boka tid', exact: true })).toBeVisible()
    const result = await page.evaluate(async () => {
      const root = globalThis.document.querySelector('[data-testid="mobile-site-scroll"]')
      const book = [...root.querySelectorAll('button')].find(
        (button) => button.textContent.trim() === 'Boka tid',
      )
      book.click()
      await new Promise((resolve) => {
        const wait = () => root.scrollTop > 0 ? resolve() : requestAnimationFrame(wait)
        requestAnimationFrame(wait)
      })
      root.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true }))
      root.scrollTop = 100
      await new Promise((resolve) => setTimeout(resolve, 800))
      const interrupted = root.scrollTop
      const body = root.querySelector('[data-knc-fold="body"]')
      const before = body.getBoundingClientRect().top
      root.scrollTop = 200
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      return { interrupted, bodyTravel: before - body.getBoundingClientRect().top }
    })
    expect(result).toEqual({ interrupted: 100, bodyTravel: 100 })
  })

  test(`booking can return to its full hero without losing selections (${stored ? 'stored' : 'source'})`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await (stored ? installStoredBackend : installPublicBackend)(context)
    await context.addCookies([
      { name: 'bladeblend_storage_preferences', value: 'essential', url: harnessOrigin },
    ])
    await page.goto(`${harnessOrigin}/?mode=light`)
    const book = page.getByRole('button', { name: 'Boka tid', exact: true })
    await book.click()
    const root = page.getByTestId('mobile-site-scroll')
    await expect.poll(() => root.evaluate((root) => root.scrollTop)).toBe(732)
    await expect(page.locator('[data-knc-fold="mark"]')).toHaveCSS('opacity', '1')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await expect(page.locator('[data-knc-brand-runtime]')).toBeVisible()
    await expect(page.locator('[data-knc-brand-runtime]')).toHaveCSS('opacity', '1')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.getByRole('button', { name: 'Växla ljust/mörkt' }).click()
    await expect.poll(() => root.evaluate((root) => root.scrollTop)).toBe(732)
    const firstBarber = page.getByTestId('booking-barber-option').first()
    await firstBarber.click()
    await expect(firstBarber).toHaveAttribute('aria-pressed', 'true')
    await page.evaluate(() => {
      globalThis.preservedBarber = globalThis.document.querySelector(
        '[data-testid="booking-barber-option"]',
      )
    })
    await root.evaluate((root) => {
      root.scrollTop = 0
    })
    await expect
      .poll(() =>
        page.locator('[data-knc-fold="panel"]').evaluate((p) => p.getBoundingClientRect().bottom),
      )
      .toBe(844)
    await expect(book).toBeVisible()
    await book.click()
    await expect.poll(() => root.evaluate((root) => root.scrollTop)).toBe(732)
    await expect(firstBarber).toHaveAttribute('aria-pressed', 'true')
    expect(
      await page.evaluate(
        () =>
          globalThis.preservedBarber ===
          globalThis.document.querySelector('[data-testid="booking-barber-option"]'),
      ),
    ).toBe(true)
    await page.getByRole('button', { name: 'Till startsidan' }).click()
    await expect.poll(() => root.evaluate((root) => root.scrollTop)).toBe(0)
    await expect(book).toBeVisible()
    await page.goto(`${harnessOrigin}/booking?mode=light`)
    await expect.poll(() => root.evaluate((root) => root.scrollTop)).toBe(732)
    await root.evaluate((root) => {
      root.scrollTop = 0
    })
    await expect
      .poll(() =>
        page
          .locator('[data-knc-fold="panel"]')
          .evaluate((panel) => panel.getBoundingClientRect().bottom),
      )
      .toBe(844)
  })
}

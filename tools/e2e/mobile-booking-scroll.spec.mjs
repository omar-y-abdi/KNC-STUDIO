import { test, expect } from './fixtures.mjs'
import { harnessOrigin } from './origins.mjs'
import { installPublicBackend, installStoredBackend } from './public-fixtures.mjs'
for (const stored of [false, true]) {
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

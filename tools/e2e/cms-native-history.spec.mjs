// The native routes share one app: the address follows the view (`/`, `/booking`) and the dialog a
// button opens (`/my-bookings`), and Back, Forward and a reload follow the address. Runs against the
// stored presentation, whose surfaces change with the route.
import { test, expect } from './fixtures.mjs'
import { harnessOrigin } from './origins.mjs'
import { installStoredBackend } from './public-fixtures.mjs'

const OUTSIDE = `${harnessOrigin}/tools/e2e/admin-harness.html`
const HOME = `${harnessOrigin}/?mode=light`
const BOOKING = `${harnessOrigin}/booking?mode=light`
const DIALOG = `${harnessOrigin}/my-bookings?mode=light`
const INDEXABLE = 'index, follow, max-image-preview:large'

async function openSite(page, context, width) {
  await page.setViewportSize({ width, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await installStoredBackend(context)
  // No customer session: the dialog lands on its lookup step.
  await context.route('**/api/customer-bookings', (route) =>
    route.request().postDataJSON()?.action === 'list'
      ? route.fulfill({ json: { ok: false, error: 'access_denied' } })
      : route.fallback(),
  )
  await context.addCookies([
    { name: 'bladeblend_storage_preferences', value: 'essential', url: harnessOrigin },
  ])
  // A document before the site, so the last Back of the test has somewhere to leave to.
  await page.goto(OUTSIDE)
  await page.goto(HOME)
}

const canonical = (page) => page.locator('link[rel="canonical"]')
const robots = (page) => page.locator('meta[name="robots"]')
const entries = (page) => page.evaluate(() => globalThis.history.length)

for (const width of [390, 1280]) {
  test(`Back, Forward and reload follow the view, and Back closes the dialog (${width})`, async ({
    page,
    context,
  }) => {
    await openSite(page, context, width)
    const book = page.getByRole('button', { name: 'Boka tid', exact: true }).first()
    const about = page.locator('#om-oss')
    const barber = page.getByTestId('booking-barber-option').first()
    await expect(about).toBeAttached()
    const atHome = await entries(page)
    // The site names itself by the origin of the canonical the shell came with (VITE_SITE_URL).
    const site = new URL(await canonical(page).getAttribute('href')).origin

    // Home -> booking, by keyboard: one new entry, with the booking route's own head.
    await book.focus()
    await page.keyboard.press('Enter')
    await expect(barber).toBeVisible()
    await expect(page).toHaveURL(BOOKING)
    await expect(about).toHaveCount(0)
    await expect(page).toHaveTitle(/^Boka tid – /)
    await expect(canonical(page)).toHaveAttribute('href', `${site}/booking`)
    // The desktop toggle stays usable: it keeps the focus and tells its state. The mobile hero
    // folds away with its button, so the focus moves into the booking view.
    if (width === 1280) {
      await expect(book).toHaveAttribute('aria-expanded', 'true')
      await expect(book).toBeFocused()
    } else await expect(page.locator('[role="main"]')).toBeFocused()
    expect(await entries(page)).toBe(atHome + 1)

    // Back -> home, Forward -> booking, without a further entry.
    await page.goBack()
    await expect(page).toHaveURL(HOME)
    await expect(about).toBeAttached()
    await expect(book).toBeVisible()
    await expect(canonical(page)).toHaveAttribute('href', `${site}/`)
    await expect(page.locator('link[rel="alternate"][hreflang]')).toHaveCount(3)
    if (width === 1280) await expect(book).toHaveAttribute('aria-expanded', 'false')
    await page.goForward()
    await expect(page).toHaveURL(BOOKING)
    await expect(barber).toBeVisible()
    await expect(about).toHaveCount(0)
    expect(await entries(page)).toBe(atHome + 1)

    // A reload stays on booking.
    await page.reload()
    await expect(page).toHaveURL(BOOKING)
    await expect(barber).toBeVisible()
    await expect(about).toHaveCount(0)

    // The language is part of the same entry: `lang=en` is added and removed in place.
    await page.getByRole('button', { name: 'Byt språk till engelska', exact: true }).click()
    await expect(page).toHaveURL(`${BOOKING}&lang=en`)
    await expect(page.locator('html')).toHaveAttribute('lang', 'en')
    await expect(canonical(page)).toHaveAttribute('href', `${site}/booking?lang=en`)
    await expect(page.locator('meta[property="og:locale"]')).toHaveAttribute('content', 'en_US')
    await page.getByRole('button', { name: 'Switch language to Swedish', exact: true }).click()
    await expect(page).toHaveURL(BOOKING)
    await expect(page.locator('html')).toHaveAttribute('lang', 'sv')
    expect(await entries(page)).toBe(atHome + 1)

    // The dialog a button opens has an entry of its own, kept out of the index; Back closes it.
    await page.goBack()
    await expect(page).toHaveURL(HOME)
    await expect(about).toBeAttached()
    const dialog = page.getByRole('dialog', { name: 'Mina bokningar', exact: true })
    await page.getByRole('button', { name: 'Mina bokningar', exact: true }).first().click()
    await expect(dialog).toBeVisible()
    await expect(page).toHaveURL(DIALOG)
    await expect(robots(page)).toHaveAttribute('content', 'noindex, follow')
    await expect(canonical(page)).toHaveCount(0)
    await page.goBack()
    await expect(dialog).toHaveCount(0)
    await expect(page).toHaveURL(HOME)
    await expect(robots(page)).toHaveAttribute('content', INDEXABLE)
    await expect(canonical(page)).toHaveAttribute('href', `${site}/`)
    // Keyboard focus is back on the page: on the button that opened the dialog, or on the main
    // landmark in an engine whose buttons take no focus from a click.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const active = globalThis.document.activeElement
          return active !== null && active !== globalThis.document.body
        }),
      )
      .toBe(true)

    // Forward opens it again; its own close button returns to the entry it was opened from.
    await page.goForward()
    await expect(dialog).toBeVisible()
    await expect(page).toHaveURL(DIALOG)
    await dialog.getByRole('button', { name: 'Stäng', exact: true }).click()
    await expect(dialog).toHaveCount(0)
    await expect(page).toHaveURL(HOME)

    // One step back from the first entry of the site leaves it.
    await page.goBack()
    await expect(page).toHaveURL(OUTSIDE)
  })

  test(`the skip link is the first stop and moves focus to the main landmark (${width})`, async ({
    page,
    context,
  }) => {
    await openSite(page, context, width)
    await expect(page.locator('#om-oss')).toBeAttached()
    const skip = page.locator('a.knc-skip-link')
    await expect(skip).toHaveText('Hoppa till innehållet')
    await expect(skip).not.toBeInViewport()
    expect(
      await page.evaluate(() =>
        globalThis.document
          .querySelector('a[href],button,input,select,textarea,[tabindex]')
          ?.classList.contains('knc-skip-link'),
      ),
    ).toBe(true)
    const scroll = () =>
      page.evaluate(() => [
        globalThis.scrollY,
        globalThis.document.querySelector('[data-testid="mobile-site-scroll"]')?.scrollTop ?? 0,
      ])
    const atRest = await scroll()
    await skip.focus()
    await expect(skip).toBeInViewport()
    expect(await scroll()).toEqual(atRest)
    await page.keyboard.press('Enter')
    const main = page.locator('main,[role="main"]')
    await expect(main).toHaveCount(1)
    await expect(main).toBeFocused()
    await expect(main).toHaveCSS('outline-style', 'none')
    await expect(page).toHaveURL(HOME)
  })
}

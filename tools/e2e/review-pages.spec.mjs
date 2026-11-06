import { test, expect } from './fixtures.mjs'
import { harnessOrigin } from './origins.mjs'
import { installStoredBackend } from './public-fixtures.mjs'

// The About reviews show five a page, newest first, under a row of at most five page buttons; with
// five reviews or fewer there is no row. The arrows move only the row: ">" to the next five page
// numbers or to the five that end on the last page, "<" back toward page 1. 37 reviews make 8
// pages, so ">" turns 1-5 into 4-8. Page 1 is long and later pages short, yet a pressed button
// stays exactly where it was. Review 7 is one 120-letter word, which must wrap inside its card.
const LONG_WORD = 'Klipp'.repeat(24)
const LONG_TEXT = 'Skarpa kanter, lugn stämning och tiden höll. '.repeat(10).trim()
const reviewsOf = (count) =>
  Array.from({ length: count }, (_, index) => ({
    id: `paged-review-${index + 1}`,
    name: `Kund ${index + 1}.`,
    rating: 5,
    text: index < 5 ? LONG_TEXT : index === 6 ? LONG_WORD : `Omdöme nummer ${index + 1}.`,
  }))
const labels = {
  about: 'Om oss',
  pages: 'Sidor med omdömen',
  previous: 'Föregående sidor',
  next: 'Fler sidor',
  form: 'Lämna ett omdöme',
}
const names = (from, to) =>
  Array.from({ length: to - from + 1 }, (_, index) => `Kund ${from + index}.`)
const pageNames = (from, to) => names(from, to).map((_, index) => `Sida ${from + index}`)

// Replaces the fixture's empty reviews answer: the last registered context route wins.
async function serveReviews(context, reviews) {
  await context.route(
    (url) => url.hostname === 'admin-harness.invalid' && url.pathname === '/rest/v1/reviews',
    (route) => {
      const request = route.request()
      const headers = {
        'access-control-allow-origin': request.headers()['origin'] ?? '*',
        'access-control-allow-headers': request.headers()['access-control-request-headers'] ?? '*',
        'access-control-allow-methods': 'GET,OPTIONS',
      }
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
      return route.fulfill({ headers, json: reviews })
    },
  )
}

async function openAbout(page, context, width, reviews) {
  await page.setViewportSize({ width, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await installStoredBackend(context)
  await serveReviews(context, reviews)
  await context.addCookies([
    { name: 'bladeblend_storage_preferences', value: 'essential', url: harnessOrigin },
  ])
  await page.goto(`${harnessOrigin}/?mode=light&lang=sv`)
  await page.getByRole('button', { name: labels.about, exact: true }).click()
}

/** Presses `button` and returns how far it moved on screen once `settled` holds. */
async function pressInPlace(button, settled) {
  await button.scrollIntoViewIfNeeded()
  const before = await button.boundingBox()
  await button.click()
  await settled()
  const after = await button.boundingBox()
  return { x: Math.abs(after.x - before.x), y: Math.abs(after.y - before.y) }
}

for (const width of [390, 1440]) {
  test(`About reviews page five at a time under a page row that holds still (${width}, sv)`, async ({
    page,
    context,
  }) => {
    await openAbout(page, context, width, reviewsOf(37))
    const row = page.getByRole('navigation', { name: labels.pages, exact: true })
    const cards = row.locator('xpath=..').locator(':scope > div')
    const cardNames = () =>
      cards.evaluateAll((nodes) => nodes.map((node) => node.firstElementChild.textContent.trim()))
    const rowNames = () =>
      row
        .getByRole('button')
        .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label')))
    const pageButton = (number) => row.getByRole('button', { name: `Sida ${number}`, exact: true })

    await expect(row).toBeVisible()
    await expect.poll(cardNames).toEqual(names(1, 5))
    await expect.poll(rowNames).toEqual([...pageNames(1, 5), labels.next])
    await expect(pageButton(1)).toHaveAttribute('aria-current', 'page')

    // Page 2 is far shorter than page 1, yet the pressed button does not move. It holds the long
    // word, which wraps inside its card.
    const toPage2 = await pressInPlace(pageButton(2), () =>
      expect.poll(cardNames).toEqual(names(6, 10)),
    )
    expect(toPage2.x).toBeLessThanOrEqual(1)
    expect(toPage2.y).toBeLessThanOrEqual(1)
    await expect(pageButton(2)).toHaveAttribute('aria-current', 'page')
    await expect(pageButton(1)).not.toHaveAttribute('aria-current')
    const spill = await cards.nth(1).evaluate((card) => {
      const range = globalThis.document.createRange()
      range.selectNodeContents(card.querySelector('p'))
      return {
        text: card.querySelector('p').textContent,
        pastEdge: range.getBoundingClientRect().right - card.getBoundingClientRect().right,
        scrolls: card.scrollWidth > card.clientWidth,
      }
    })
    expect(spill.text).toBe(LONG_WORD)
    expect(spill.pastEdge).toBeLessThanOrEqual(0)
    expect(spill.scrolls).toBe(false)

    // ">" moves the row to the five pages that end on the last one; the page being read stays,
    // and the first page slot stays where page 1 was.
    const firstSlot = await pageButton(1).boundingBox()
    await row.getByRole('button', { name: labels.next, exact: true }).click()
    await expect.poll(rowNames).toEqual([labels.previous, ...pageNames(4, 8)])
    expect(await cardNames()).toEqual(names(6, 10))
    expect(Math.abs((await pageButton(4).boundingBox()).x - firstSlot.x)).toBeLessThanOrEqual(1)
    const toPage8 = await pressInPlace(pageButton(8), () =>
      expect.poll(cardNames).toEqual(names(36, 37)),
    )
    expect(toPage8.x).toBeLessThanOrEqual(1)
    expect(toPage8.y).toBeLessThanOrEqual(1)

    // "<" returns the row to page 1; from the keyboard, focus stays in the row when ">" goes.
    await row.getByRole('button', { name: labels.previous, exact: true }).click()
    await expect.poll(rowNames).toEqual([...pageNames(1, 5), labels.next])
    expect(await cardNames()).toEqual(names(36, 37))
    await row.getByRole('button', { name: labels.next, exact: true }).focus()
    await page.keyboard.press('Enter')
    await expect.poll(rowNames).toEqual([labels.previous, ...pageNames(4, 8)])
    await expect(pageButton(8)).toBeFocused()

    // The row sits between the list and the review form.
    const rowBox = await row.boundingBox()
    const formBox = await page.getByText(labels.form, { exact: true }).first().boundingBox()
    expect(rowBox.y + rowBox.height).toBeLessThanOrEqual(formBox.y)
  })

  test(`five reviews or fewer show no page row (${width}, sv)`, async ({ page, context }) => {
    await openAbout(page, context, width, reviewsOf(5))
    const first = page.getByText('Kund 1.', { exact: true })
    await expect(first).toBeVisible()
    await expect(page.getByText(/^Kund \d+\.$/)).toHaveCount(5)
    await expect(page.getByRole('navigation', { name: labels.pages, exact: true })).toHaveCount(0)
  })
}

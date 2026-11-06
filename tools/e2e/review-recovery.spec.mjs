import { test, expect } from './fixtures.mjs'
import { harnessOrigin } from './origins.mjs'
import { installStoredBackend, storedPresentationResponse } from './public-fixtures.mjs'

const phone = '0701234567'
const receiptCookie = 'fixture_booking_receipt'
const row = {
  id: '76000000-0000-4000-8000-000000000001',
  barber_id: 'hassan',
  barber_name: 'Hassan',
  service_name: 'Fixture haircut',
  price: 350,
  duration_min: 30,
  start_at: '2026-11-04T09:00:00Z',
}
const copy = {
  sv: {
    about: 'Om oss',
    reviewsEmpty: 'Inga publicerade omdömen ännu.',
    galleryLoading: 'Hämtar bilder …',
    phone: 'Telefonnummer',
    text: 'Ditt omdöme',
    submit: 'Lämna ett omdöme',
    editedHeading: 'Dela din upplevelse',
    bookings: 'Mina bokningar',
    past: 'Visa tidigare bokningar',
    details: /Visa detaljer$/,
    close: 'Stäng',
    denied: 'Kontrollera telefonnumret och bokningen i Mina bokningar.',
    thanks: 'Tack för ditt omdöme!',
    email: 'E-post',
    send: 'Skicka säker länk',
  },
  en: {
    about: 'About',
    reviewsEmpty: 'No published reviews yet.',
    galleryLoading: 'Loading photos …',
    phone: 'Phone number',
    text: 'Your review',
    submit: 'Leave a review',
    editedHeading: 'Share your experience',
    bookings: 'My appointments',
    past: 'Show past appointments',
    details: /Show details$/,
    close: 'Close',
    denied: 'Check the phone number and your booking under My appointments.',
    thanks: 'Thanks for your review!',
    email: 'Email',
    send: 'Send secure link',
  },
}

for (const width of [390, 1440]) {
  for (const lang of ['sv', 'en']) {
    test(`device booking access also submits its own review (${width}, ${lang})`, async ({
      page,
      context,
    }) => {
      const labels = copy[lang]
      await page.setViewportSize({ width, height: 844 })
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.clock.setFixedTime(new Date('2026-11-05T12:00:00Z'))
      await installStoredBackend(context)
      const custom = globalThis.structuredClone(storedPresentationResponse())
      const about = custom.presentation.pages.find((page) => page.path === '/about')
      const edited = await page.evaluate(
        ({ html, original, edited }) => {
          const doc = new globalThis.DOMParser().parseFromString(html, 'text/html')
          const heading = [...doc.querySelectorAll('span')].find(
            (node) => node.textContent === original,
          )
          if (!heading) throw new Error('Missing captured review heading')
          heading.textContent = edited
          return { html: doc.body.innerHTML, id: heading.id }
        },
        { html: about.content[lang].html, original: labels.submit, edited: labels.editedHeading },
      )
      about.content[lang].html = edited.html
      await context.route(
        (url) => url.pathname === '/api/cms/presentation',
        (route) => route.fulfill({ json: custom }),
      )
      await context.addCookies([
        { name: 'bladeblend_storage_preferences', value: 'functional', url: harnessOrigin },
      ])
      const setReceipt = (value) =>
        context.addCookies([
          { name: receiptCookie, value, url: harnessOrigin, httpOnly: true, sameSite: 'Lax' },
        ])
      await setReceipt('own-booking')
      let requests = 0
      let submissions = 0
      let deviceLists = 0
      // The HttpOnly cookie store is real, but this is a browser UI fixture. Route interception
      // precedes Cookie attachment in WebKit; actual Worker/Edge/SQL authorization is tested by
      // the customer-stack flow. The fixture scopes both list and review to the same receipt.
      await context.route('**/api/customer-bookings', async (route) => {
        const body = route.request().postDataJSON()
        const cookies = await context.cookies(route.request().url())
        const receipt = cookies.find((cookie) => cookie.name === receiptCookie)?.value
        if (body.action === 'list') {
          if (receipt === 'own-booking') deviceLists++
          return route.fulfill({
            json:
              receipt === 'own-booking'
                ? {
                    ok: true,
                    authority: 'device',
                    session_proof: 'c'.repeat(64),
                    receipt_proof: 'c'.repeat(64),
                    bookings: [row],
                  }
                : { ok: false, error: 'access_denied' },
          })
        }
        if (body.action === 'request_access') {
          expect(body.email).toBe('customer@example.test')
          requests++
          return route.fulfill({ json: { ok: true } })
        }
        expect(body.action).toBe('review')
        submissions++
        expect(body).not.toHaveProperty('accessToken')
        return route.fulfill({
          json:
            receipt === 'own-booking' && body.phone === phone
              ? {
                  ok: true,
                  review: {
                    id: 'fixture-review',
                    name: 'Fixture C.',
                    rating: body.rating,
                    text: body.text,
                  },
                }
              : { ok: false, error: 'no_booking' },
        })
      })
      await page.goto(`${harnessOrigin}/?mode=light&lang=${lang}`)
      const openBookings = page.getByRole('button', { name: labels.bookings, exact: true }).first()
      const dialog = page.getByRole('dialog', { name: labels.bookings, exact: true })
      await openBookings.click()
      await dialog.getByRole('button', { name: labels.past, exact: true }).click()
      await dialog.getByRole('button', { name: labels.details }).click()
      await expect(
        dialog.getByText(`${row.service_name} · ${row.price} kr`, { exact: true }),
      ).toBeVisible()
      expect(deviceLists).toBeGreaterThan(0)
      await dialog.getByRole('button', { name: labels.close, exact: true }).click()
      // Enter About before filling its form. WebKit's locator.fill can mutate offscreen
      // fields while still showing the hero; the first later click then starts lazy data/layout.
      await page.getByRole('button', { name: labels.about, exact: true }).click()
      await expect(page.getByText(labels.reviewsEmpty, { exact: true })).toBeVisible()
      await expect(page.getByText(labels.galleryLoading, { exact: true })).toHaveCount(0)
      await expect(page.locator(`[id="${edited.id}"]`)).toHaveText(labels.editedHeading)
      const number = page.getByRole('textbox', { name: labels.phone })
      const text = page.getByRole('textbox', { name: labels.text, exact: true })
      const rating = page.getByRole('radio').last()
      const submit = page.getByRole('button', { name: labels.submit, exact: true })
      await number.scrollIntoViewIfNeeded()
      await number.fill('0701111111')
      await text.fill('My completed booking on this device.')
      await rating.click()
      await expect(rating).toBeChecked()
      await submit.click()
      await expect.poll(() => submissions).toBe(1)
      await expect(page.getByRole('alert')).toContainText(labels.denied)
      await expect(text).toHaveValue('My completed booking on this device.')
      await expect(rating).toBeChecked()
      await number.fill(phone)
      await setReceipt('another-booking')
      await submit.click()
      await expect.poll(() => submissions).toBe(2)
      await expect(page.getByRole('alert')).toContainText(labels.denied)
      await expect(number).toHaveValue(phone)
      await expect(text).toHaveValue('My completed booking on this device.')
      await expect(rating).toBeChecked()
      await setReceipt('own-booking')
      await submit.click()
      await expect(page.getByText(labels.thanks, { exact: true })).toBeVisible()
      expect(submissions).toBe(3)
      expect(requests).toBe(0)
      const cookies = await context.cookies(harnessOrigin)
      expect(cookies.find((cookie) => cookie.name === receiptCookie)?.httpOnly).toBe(true)
      expect(cookies.some((cookie) => cookie.name === '__Host-bladeblend_customer_session')).toBe(
        false,
      )
      expect(await page.evaluate(() => globalThis.document.cookie)).not.toContain(receiptCookie)

      // Losing device access still offers the existing recovery inside My Bookings.
      await context.clearCookies({ name: receiptCookie })
      await openBookings.click()
      await dialog
        .getByRole('textbox', { name: labels.email, exact: true })
        .fill('customer@example.test')
      await dialog.getByRole('button', { name: labels.send, exact: true }).click()
      await expect.poll(() => requests).toBe(1)
    })
  }
}

import { test, expect } from './fixtures.mjs'
import { harnessOrigin } from './origins.mjs'
import { installStoredBackend, storedPresentationResponse } from './public-fixtures.mjs'

const phone = '0701234567'
const ownToken = 'a'.repeat(64)
const otherToken = 'b'.repeat(64)
const row = {
  id: '76000000-0000-4000-8000-000000000001',
  barber_id: 'hassan',
  barber_name: 'Hassan',
  service_name: 'Fixture haircut',
  price: 350,
  duration_min: 30,
  start_at: '2026-11-04T09:00:00Z',
}

for (const [width, access] of [
  [390, 'tab'],
  [390, 'hash'],
  [1440, 'tab'],
]) {
  test(`review verification preserves the original draft (${width}, ${access})`, async ({
    page,
    context,
    request,
  }) => {
    await page.setViewportSize({ width, height: 844 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.clock.setFixedTime(new Date('2026-11-05T12:00:00Z'))
    await installStoredBackend(context)
    const custom = globalThis.structuredClone(storedPresentationResponse())
    const about = custom.presentation.pages.find((page) => page.path === '/about')
    const edited = await page.evaluate((html) => {
      const doc = new globalThis.DOMParser().parseFromString(html, 'text/html')
      const heading = [...doc.querySelectorAll('span')].find(
        (node) => node.textContent === 'Lämna ett omdöme',
      )
      if (!heading) throw new Error('Missing captured review heading')
      heading.textContent = 'Dela din upplevelse'
      return { html: doc.body.innerHTML, id: heading.id }
    }, about.content.sv.html)
    about.content.sv.html = edited.html
    await context.route(
      (url) => url.pathname === '/api/cms/presentation',
      (route) => route.fulfill({ json: custom }),
    )
    // Vite proxies opaque customer paths to a local Worker; this fixture supplies that route's
    // App shell from the guarded loopback server, preserving the actual email-link URL shape.
    const shell = await request.get(harnessOrigin)
    await context.route(
      (url) => [ownToken, otherToken].some((token) => url.pathname === `/${token}`),
      (route) => route.fulfill({ response: shell }),
    )
    await context.addCookies([
      { name: 'bladeblend_storage_preferences', value: 'functional', url: harnessOrigin },
      {
        name: 'fixture_booking_receipt',
        value: 'present',
        url: harnessOrigin,
        httpOnly: true,
        sameSite: 'Lax',
      },
    ])
    if (access === 'hash')
      await context.addCookies([
        {
          name: 'fixture_review_session',
          value: 'expired',
          url: harnessOrigin,
          httpOnly: true,
          sameSite: 'Lax',
        },
      ])
    let requests = 0,
      submissions = 0,
      restoredLists = 0,
      waitingForList = false
    let releaseList
    let released = false
    const listGate = new Promise((resolve) => {
      releaseList = resolve
    })
    // Set-Cookie and cross-tab cookie sharing are real. Route interception runs before WebKit
    // attaches Cookie, so this mock reads the browser's URL-filtered cookie store rather than
    // claiming to inspect wire headers. Production authorization has separate gateway/SQL tests.
    await context.route('**/api/customer-bookings', async (route) => {
      const body = route.request().postDataJSON()
      const cookies = await context.cookies(route.request().url())
      const session = cookies.find((cookie) => cookie.name === 'fixture_review_session')?.value
      const existing = session === 'own' || session === 'other' ? session : undefined
      if (body.action === 'list') {
        const scope =
          body.accessToken === ownToken
            ? 'own'
            : body.accessToken === otherToken
              ? 'other'
              : existing
        if (!scope && !released) {
          waitingForList = true
          await listGate
          restoredLists++
        }
        return route.fulfill({
          headers: body.accessToken
            ? { 'set-cookie': `fixture_review_session=${scope}; Path=/; HttpOnly; SameSite=Lax` }
            : {},
          json: !scope
            ? {
                ok: true,
                authority: 'device',
                session_proof: 'c'.repeat(64),
                receipt_proof: 'c'.repeat(64),
                bookings: [row],
              }
            : {
                ok: true,
                authority: 'verified',
                session_proof: (scope === 'own' ? 'd' : 'e').repeat(64),
                name: 'Fixture Customer',
                phone: scope === 'own' ? phone : '0709999999',
                email: scope === 'own' ? 'customer@example.test' : 'other@example.test',
                bookings: scope === 'own' ? [row] : [],
              },
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
          existing === 'own' && body.phone === phone
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
    try {
      await page.goto(`${harnessOrigin}/?mode=light`)
      const number = page.getByRole('textbox', { name: /Telefonnummer/ })
      const text = page.getByRole('textbox', { name: 'Ditt omdöme', exact: true })
      const rating = page.getByRole('radio').last()
      const submit = page.getByRole('button', { name: 'Lämna ett omdöme', exact: true })
      const verify = page.getByRole('button', { name: 'Verifiera bokning via e-post', exact: true })
      await expect(verify).toBeVisible() // Available before a rejected submission or a long draft.
      await expect(page.locator(`[id="${edited.id}"]`)).toContainText('Dela din upplevelse')
      await number.fill(phone)
      await text.fill('Draft survives secure access.')
      await rating.click()
      await submit.click()
      await expect.poll(() => submissions).toBe(1)
      await expect(page.getByRole('alert')).toContainText('Öppna bokningens säkra mejllänk')
      await expect.poll(() => waitingForList).toBe(true)
      await verify.click()
      const dialog = page.getByRole('dialog', { name: 'Mina bokningar', exact: true })
      const email = dialog.getByRole('textbox', { name: 'E-post', exact: true })
      await expect(email).toBeVisible()
      released = true
      releaseList()
      await expect.poll(() => restoredLists).toBeGreaterThan(0)
      await expect(email).toBeVisible() // Late receipt hydration must not replace explicit lookup.
      await email.fill('customer@example.test')
      await dialog.getByRole('button', { name: 'Skicka säker länk', exact: true }).click()
      await expect.poll(() => requests).toBe(1)
      const openLink = async (token, expectedEmail) => {
        if (access === 'hash') {
          await page.evaluate((token) => {
            globalThis.location.hash = `booking_token=${token}`
          }, token)
          await dialog.getByRole('button', { name: 'Hantera mejladresser', exact: true }).click()
          await expect(dialog.getByText(expectedEmail, { exact: true }).first()).toBeVisible()
        } else {
          const linked = await context.newPage()
          await linked.setViewportSize({ width, height: 844 })
          await linked.goto(`${harnessOrigin}/${token}`)
          await linked
            .getByRole('dialog')
            .getByRole('button', { name: 'Hantera mejladresser', exact: true })
            .click()
          await expect(
            linked.getByRole('dialog').getByText(expectedEmail, { exact: true }).first(),
          ).toBeVisible()
          await linked.close()
          await page.bringToFront()
        }
      }
      await openLink(otherToken, 'other@example.test')
      await dialog.getByRole('button', { name: 'Stäng', exact: true }).click()
      await expect(number).toHaveValue(phone)
      await expect(text).toHaveValue('Draft survives secure access.')
      await expect(rating).toBeChecked()
      await submit.click()
      await expect.poll(() => submissions).toBe(2)
      await expect(page.getByRole('alert')).toContainText('kontrollera telefonnumret')
      await openLink(ownToken, 'customer@example.test')
      if (access === 'hash')
        await dialog.getByRole('button', { name: 'Stäng', exact: true }).click()
      await expect(text).toHaveValue('Draft survives secure access.')
      await number.fill('0701111111')
      await submit.click()
      await expect.poll(() => submissions).toBe(3)
      await expect(page.getByRole('alert')).toContainText('kontrollera telefonnumret')
      await number.fill(phone)
      await submit.click()
      await expect(page.getByText('Tack för ditt omdöme!', { exact: true })).toBeVisible()
      expect(submissions).toBe(4)
      expect(await page.evaluate(() => globalThis.document.cookie)).not.toContain(
        'fixture_review_session',
      )
    } finally {
      released = true
      releaseList()
    }
  })
}

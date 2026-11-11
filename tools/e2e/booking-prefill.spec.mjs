import { test, expect } from './fixtures.mjs'
import { harnessOrigin } from './origins.mjs'
import { installPublicBackend } from './public-fixtures.mjs'

const contact = { name: 'Returning Customer', phone: '0701234567', email: 'returning@example.test' }
const receiptProof = 'a'.repeat(64)
const bookingId = '76000000-0000-4000-8000-000000000001'
const row = {
  id: bookingId,
  barber_id: 'e2e-barber-1',
  barber_name: 'Fixture Barber 1',
  service_name: 'Fixture haircut',
  price: 400,
  duration_min: 30,
  start_at: '2099-01-01T10:00:00Z',
}

async function setup(context, { consent = true, remembered = false } = {}) {
  await installPublicBackend(context)
  await context.addCookies([
    {
      name: 'bladeblend_storage_preferences',
      value: consent ? 'functional' : 'essential',
      url: harnessOrigin,
    },
  ])
  const state = {
    contact: remembered ? contact : undefined,
    hold: null,
    listCalls: 0,
    submitCalls: 0,
  }
  await context.route('**/rest/v1/rpc/available_slots_for_service', (route) =>
    route.fulfill({ headers: { 'access-control-allow-origin': '*' }, json: ['10:00', '11:00'] }),
  )
  await context.route('**/api/customer-bookings', async (route) => {
    const action = route.request().postDataJSON().action
    if (action === 'forget_device') {
      state.contact = undefined
      return route.fulfill({ json: { ok: true } })
    }
    expect(action).toBe('list')
    state.listCalls++
    const snapshot = state.contact
    if (state.hold) await state.hold
    return route.fulfill({
      json:
        state.listOverride ??
        (snapshot
          ? {
              ok: true,
              authority: 'device',
              session_proof: receiptProof,
              receipt_proof: receiptProof,
              bookings: [row],
              booking_contact: snapshot,
            }
          : { ok: false, error: 'access_denied' }),
    })
  })
  await context.route('**/api/bookings', (route) => {
    const body = route.request().postDataJSON()
    state.submitCalls++
    if (body.rememberBookings)
      state.contact = {
        name: body.booking.customerName,
        phone: body.booking.phone,
        email: body.booking.email,
      }
    return route.fulfill({
      json: {
        ok: true,
        booking: { id: bookingId },
        ...(body.rememberBookings ? { receipt_proof: receiptProof } : {}),
      },
    })
  })
  return state
}

async function service(page, open = true) {
  if (open) await page.getByRole('button', { name: 'Boka tid', exact: true }).first().click()
  await page.getByTestId('booking-barber-option').first().click()
  await page
    .getByRole('button', { name: /^\S+ \d+ \S+ \d{4}$/ })
    .and(page.locator(':not([disabled])'))
    .first()
    .click()
  await page.getByTestId('booking-service-option').first().click()
}
async function details(page, open = true) {
  await service(page, open)
  await page.getByRole('button', { name: '10:00', exact: true }).click()
  return page.getByRole('dialog').locator('input:not([type="hidden"])')
}
async function values(fields, expected) {
  for (const [index, value] of Object.values(expected).entries())
    await expect(fields.nth(index)).toHaveValue(value)
}
// Desktop keeps the booking flow and its selections mounted while the fold is closed. Closing the
// details sheet, folding home and entering booking again is the remaining list trigger short of a
// completed booking; the selected slot then reopens the sheet with that entry's hint state.
async function reenterDesktopBooking(page, state, listCalls) {
  await page.getByRole('dialog').getByRole('button', { name: 'Stäng', exact: true }).click()
  const book = page.getByRole('button', { name: 'Boka tid', exact: true }).first()
  await book.click()
  await book.click()
  await expect.poll(() => state.listCalls).toBe(listCalls)
  await page.getByRole('button', { name: '10:00', exact: true }).click()
  return page.getByRole('dialog').locator('input:not([type="hidden"])')
}

for (const width of [390, 1280]) {
  test(`booking contact returns after submission and reload (${width})`, async ({
    page,
    context,
  }) => {
    await page.setViewportSize({ width, height: 844 })
    const state = await setup(context)
    await page.goto(harnessOrigin)
    let fields = await details(page)
    await values(fields, { name: '', phone: '', email: '' })
    for (const [index, value] of Object.values(contact).entries())
      await fields.nth(index).fill(value)
    await page.getByRole('dialog').getByRole('button', { name: 'Boka tid', exact: true }).click()
    await page.getByRole('button', { name: 'Boka en ny tid', exact: true }).click()
    fields = await details(page, false)
    await values(fields, contact)
    expect(state.submitCalls).toBe(1)
    // The address has followed the view to /booking, so the reload opens in booking.
    await page.reload()
    await values(await details(page, false), contact)
    expect(
      await page.evaluate(() => [globalThis.localStorage.length, globalThis.sessionStorage.length]),
    ).toEqual([0, 0])
  })
}

test('late device hydration preserves edits; withdrawal clears only untouched hints without a list', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const state = await setup(context, { remembered: true })
  let release
  state.hold = new Promise((resolve) => {
    release = resolve
  })
  await page.goto(harnessOrigin)
  const fields = await details(page)
  await fields.nth(0).fill('My edit')
  release()
  state.hold = null
  await values(fields, { ...contact, name: 'My edit' })
  // Withdrawal clears the untouched hints through the consent callback alone; no list follows.
  await page.evaluate(async () =>
    (await import('/modules/public-web/src/site/storageConsent.ts')).saveStoragePreferences({
      functional: false,
    }),
  )
  await values(fields, { name: 'My edit', phone: '', email: '' })
  expect(state.listCalls).toBe(2)
  await page.reload()
  await values(await details(page, false), { name: '', phone: '', email: '' })
})

test('the details sheet takes focus as it opens, so an edit typed at once survives late hydration', async ({
  page,
  context,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const state = await setup(context, { remembered: true })
  let release
  state.hold = new Promise((resolve) => {
    release = resolve
  })
  await page.clock.install()
  await page.goto(harnessOrigin)
  await service(page)
  // Freeze frames and timers so work the sheet defers past its opening frame stays pending while
  // the name is typed. fill() is these two steps: select+focus the input, then insert the text
  // into whatever holds focus; a CI frame can fall between them.
  const time = page.getByRole('button', { name: '10:00', exact: true })
  await expect(time).toBeVisible()
  await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
  await time.click()
  const fields = page.getByRole('dialog').locator('input:not([type="hidden"])')
  await fields.nth(0).selectText()
  await page.clock.runFor(100)
  await page.keyboard.insertText('My edit')
  await page.clock.resume()
  release()
  state.hold = null
  await values(fields, { ...contact, name: 'My edit' })
  expect(state.listCalls).toBe(2)
})

test('rejected optional storage never prefills device hints', async ({ page, context }) => {
  const state = await setup(context, { consent: false, remembered: true })
  await page.goto(harnessOrigin)
  await values(await details(page), { name: '', phone: '', email: '' })
  expect(state.contact).toBeUndefined()
})

test('receipt revocation clears untouched hints on the next booking entry', async ({
  page,
  context,
}) => {
  const state = await setup(context, { remembered: true })
  await page.goto(harnessOrigin)
  let fields = await details(page)
  await values(fields, contact)
  await fields.nth(0).fill('Keep this edit')
  state.contact = undefined
  fields = await reenterDesktopBooking(page, state, 3)
  await values(fields, { name: 'Keep this edit', phone: '', email: '' })
})

test('mailbox-link selection clears the prior device hint before its list resolves', async ({
  page,
  context,
}) => {
  const state = await setup(context, { remembered: true })
  await page.goto(harnessOrigin)
  const fields = await details(page)
  await values(fields, contact)
  let release
  state.hold = new Promise((resolve) => {
    release = resolve
  })
  await page.evaluate(() => {
    globalThis.location.hash = `email_link=${'b'.repeat(64)}`
  })
  // Details stays mounted beneath the customer dialog; even hidden fields must lose old hints.
  await expect(page.locator('input[type="tel"]')).toHaveValue('')
  const listed = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/customer-bookings') &&
      response.request().postDataJSON()?.action === 'list',
  )
  release()
  await listed
})

test('a booking re-entry does not cancel an in-flight email-link exchange or replace its verified profile', async ({
  page,
  context,
}) => {
  const state = await setup(context, { remembered: true })
  await page.goto(harnessOrigin)
  let fields = await details(page)
  await values(fields, contact)
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  let exchanging = false
  await context.route('**/api/customer-bookings', async (route) => {
    if (route.request().postDataJSON().action !== 'exchange_access') return route.fallback()
    exchanging = true
    await gate
    return route.fulfill({ json: { ok: true, session_proof: receiptProof } })
  })
  await page.evaluate(() => {
    globalThis.location.hash = `booking_access=${'b'.repeat(64)}`
  })
  await expect.poll(() => exchanging).toBe(true)
  // The entry list resolves with the device hint while the exchange is still pending.
  fields = await reenterDesktopBooking(page, state, 3)
  await values(fields, contact)
  const verified = { name: 'Verified Other', phone: '0709999999', email: 'other@example.test' }
  state.listOverride = {
    ok: true,
    authority: 'verified',
    session_proof: receiptProof,
    ...verified,
    bookings: [],
  }
  release()
  await expect(page.getByRole('dialog', { name: 'Mina bokningar' })).toBeVisible()
  await expect(page.locator('input[type="tel"]')).toHaveValue(verified.phone)
})

test('confirmation retains submitted contact while the next-booking refresh is pending or denied', async ({
  page,
  context,
}) => {
  const state = await setup(context, { remembered: true })
  await page.goto(harnessOrigin)
  await values(await details(page), contact)
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  let afterSubmitReads = 0
  await context.route('**/api/customer-bookings', async (route) => {
    if (route.request().postDataJSON().action !== 'list' || state.submitCalls === 0)
      return route.fallback()
    afterSubmitReads++
    // The adapter first proves its receipt; the following read hydrates the next booking.
    if (afterSubmitReads === 1) return route.fallback()
    await gate
    return route.fulfill({ json: { ok: false, error: 'access_denied' } })
  })
  await page.getByRole('dialog').getByRole('button', { name: 'Boka tid', exact: true }).click()
  await expect.poll(() => afterSubmitReads).toBe(2)
  const confirmation = page.getByRole('dialog')
  const refreshed = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/customer-bookings') &&
      response.request().postDataJSON()?.action === 'list',
  )
  try {
    await expect(confirmation).toContainText(
      `En bokningsbekräftelse har skickats till ${contact.email}.`,
    )
  } finally {
    release()
  }
  await refreshed
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve)),
      ),
  )
  await expect(confirmation).toContainText(
    `En bokningsbekräftelse har skickats till ${contact.email}.`,
  )
})

test('withdrawing and re-enabling storage cannot resurrect a revoked in-flight receipt hint', async ({
  page,
  context,
}) => {
  const state = await setup(context, { remembered: true })
  await page.goto(harnessOrigin)
  let fields = await details(page)
  await values(fields, contact)
  let release
  state.hold = new Promise((resolve) => {
    release = resolve
  })
  fields = await reenterDesktopBooking(page, state, 3)
  await page.evaluate(async () =>
    (await import('/modules/public-web/src/site/storageConsent.ts')).saveStoragePreferences({
      functional: false,
    }),
  )
  // The server revocation completes before consent is enabled again; only the old response has PII.
  await expect.poll(() => state.contact).toBeUndefined()
  await page.evaluate(async () =>
    (await import('/modules/public-web/src/site/storageConsent.ts')).saveStoragePreferences({
      functional: true,
    }),
  )
  const listed = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/customer-bookings') &&
      response.request().postDataJSON()?.action === 'list',
  )
  release()
  state.hold = null
  await listed
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve)),
      ),
  )
  await values(fields, { name: '', phone: '', email: '' })
})

for (const { refreshDuringRevocation, verified } of [
  { refreshDuringRevocation: false, verified: false },
  { refreshDuringRevocation: true, verified: false },
  { refreshDuringRevocation: false, verified: true },
])
  test(`reads during optional-storage revocation preserve authority (fresh refresh: ${refreshDuringRevocation}, verified: ${verified})`, async ({
    page,
    context,
  }) => {
    const state = await setup(context, { consent: false, remembered: true })
    if (verified)
      state.listOverride = {
        ok: true,
        authority: 'verified',
        session_proof: receiptProof,
        ...contact,
        bookings: [],
      }
    let releaseList
    state.hold = new Promise((resolve) => {
      releaseList = resolve
    })
    let releaseForget
    const forgetting = new Promise((resolve) => {
      releaseForget = resolve
    })
    let forgetStarted = false
    let listedResponses = 0
    page.on('response', (response) => {
      if (
        response.url().endsWith('/api/customer-bookings') &&
        response.request().postDataJSON()?.action === 'list'
      )
        listedResponses++
    })
    await context.route('**/api/customer-bookings', async (route) => {
      if (route.request().postDataJSON().action !== 'forget_device') return route.fallback()
      forgetStarted = true
      await forgetting
      state.contact = undefined
      return route.fulfill({ json: { ok: true } })
    })
    await page.goto(harnessOrigin)
    let fields = await details(page)
    await expect.poll(() => forgetStarted).toBe(true)
    await expect.poll(() => state.listCalls).toBe(2)
    if (!verified)
      await page.evaluate(async () =>
        (await import('/modules/public-web/src/site/storageConsent.ts')).saveStoragePreferences({
          functional: true,
        }),
      )
    if (refreshDuringRevocation) fields = await reenterDesktopBooking(page, state, 3)
    if (refreshDuringRevocation || verified) {
      const revoked = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/customer-bookings') &&
          response.request().postDataJSON()?.action === 'forget_device',
      )
      releaseForget()
      await revoked
    }
    releaseList()
    state.hold = null
    await expect.poll(() => listedResponses).toBe(state.listCalls)
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve)),
        ),
    )
    try {
      await values(fields, verified ? contact : { name: '', phone: '', email: '' })
    } finally {
      releaseForget()
    }
    await expect.poll(() => state.contact).toBeUndefined()
  })

test('verified profile hydration remains available with optional storage off', async ({
  page,
  context,
}) => {
  const state = await setup(context, { consent: false })
  state.listOverride = {
    ok: true,
    authority: 'verified',
    session_proof: receiptProof,
    ...contact,
    bookings: [],
  }
  await page.goto(harnessOrigin)
  await values(await details(page), contact)
})

// The sheet says the booking is on its way, for at least 900 ms unless reduced motion is asked
// for; the confirmation's check then plays once and rests as before. Reduced motion has no
// minimum, so there the answer is held back while the sheet is looked at.
for (const reducedMotion of ['no-preference', 'reduce'])
  test(`the details sheet shows the booking on its way, then the check lands (${reducedMotion})`, async ({
    page,
    context,
  }) => {
    const moving = reducedMotion === 'no-preference'
    await page.setViewportSize({ width: 390, height: 844 })
    await page.emulateMedia({ reducedMotion })
    await setup(context)
    let release = () => undefined
    const gate = new Promise((resolve) => {
      release = resolve
    })
    let held = false
    if (!moving)
      await context.route('**/api/bookings', async (route) => {
        held = true
        await gate
        await route.fallback()
      })
    await page.goto(harnessOrigin)
    const fields = await details(page)
    for (const [index, value] of Object.values(contact).entries())
      await fields.nth(index).fill(value)
    const dialog = page.getByRole('dialog')
    const book = dialog.getByRole('button', { name: 'Boka tid', exact: true })
    // Times from the press; the check's animations as they are in the commit that shows it.
    await page.evaluate(() => {
      const doc = globalThis.document
      const seen = { pressedAt: 0, pendingAt: 0, confirmedAt: 0, pendingWithConfirmation: false }
      globalThis.bookingSeen = seen
      doc.addEventListener(
        'click',
        (event) => {
          if (!seen.pressedAt && event.target.closest('button')?.textContent === 'Boka tid')
            seen.pressedAt = globalThis.performance.now()
        },
        true,
      )
      const observer = new globalThis.MutationObserver(() => {
        if (!seen.pendingAt && doc.querySelector('.knc-pending'))
          seen.pendingAt = globalThis.performance.now()
        const title = doc.getElementById('knc-booked-title')
        if (!title) return
        observer.disconnect()
        seen.confirmedAt = globalThis.performance.now()
        seen.pendingWithConfirmation = doc.querySelector('.knc-pending') !== null
        const disc = title.previousElementSibling
        globalThis.checkAnimations = [
          ...disc.getAnimations(),
          ...disc.firstElementChild.getAnimations(),
        ]
      })
      observer.observe(doc.body, { childList: true, subtree: true })
    })
    await book.click()
    if (!moving) {
      await expect.poll(() => held).toBe(true)
      const pending = dialog.getByRole('status').filter({ hasText: 'Bokar din tid …' })
      await expect(pending).toBeVisible()
      await expect(pending).toContainText(', 10:00 · ')
      await expect(book).toHaveAttribute('aria-busy', 'true')
      release()
    }
    await expect(
      page.getByRole('heading', { name: 'Tack — din tid är bokad!', exact: true }),
    ).toBeVisible()
    const result = await page.evaluate(async () => {
      const animations = globalThis.checkAnimations
      const timings = animations.map((animation) => {
        const { delay, duration, fill } = animation.effect.getTiming()
        return [delay, duration, fill]
      })
      await Promise.all(animations.map((animation) => animation.finished))
      const disc = globalThis.document.getElementById('knc-booked-title').previousElementSibling
      const check = disc.firstElementChild
      const rest = (element) => {
        const style = globalThis.getComputedStyle(element)
        return [style.transform, style.opacity, style.boxShadow, style.clipPath]
      }
      return {
        seen: globalThis.bookingSeen,
        timings,
        states: animations.map((animation) => animation.playState),
        left: [...disc.getAnimations(), ...check.getAnimations()].length,
        disc: rest(disc),
        check: rest(check),
      }
    })
    expect(result.seen.pressedAt).toBeGreaterThan(0)
    expect(result.seen.pendingAt).toBeGreaterThanOrEqual(result.seen.pressedAt)
    expect(result.seen.pendingWithConfirmation).toBe(false)
    if (moving) expect(result.seen.confirmedAt - result.seen.pressedAt).toBeGreaterThanOrEqual(900)
    expect(result.timings).toEqual(
      moving
        ? [
            [140, 560, 'backwards'],
            [440, 700, 'none'],
            [360, 460, 'backwards'],
          ]
        : [],
    )
    expect(result.states).toEqual(moving ? ['finished', 'finished', 'finished'] : [])
    expect(result.left).toBe(0)
    expect(result.disc).toEqual(['none', '1', 'none', 'none'])
    expect(result.check).toEqual(['none', '1', 'none', 'none'])
  })

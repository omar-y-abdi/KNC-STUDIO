import { randomBytes, randomInt, randomUUID } from 'node:crypto'

import { join } from 'node:path'

import { verifyPublicFirstPaint } from './public-first-paint.mjs'
import { test } from './customer-fixtures.mjs'
import { phase, assert } from './public-checks.mjs'
const WAIT_TIMEOUT = 15000
test('customer access, booking, CMS publication and HTTPS cookie contracts', async ({
  browserName,
  customerStack,
  customerContexts,
}) => {
  const { db, origin, workerOrigin, work, cms, state, cleanupFixture, hash, removeQueuedMail } =
    customerStack
  phase(`customer ${browserName}: seed isolated fixtures`)
  const marker = randomUUID(),
    barber = `e2e-${marker.slice(0, 20)}`,
    service = randomUUID()
  const people = ['A', 'B'].map((label) => ({
    label,
    token: randomBytes(32).toString('hex'),
    booking: randomUUID(),
    name: `Customer ${label}`,
    phone: `070${String(randomInt(0, 10000000)).padStart(7, '0')}`,
    email: `${label.toLowerCase()}-${marker}@example.test`,
  }))
  state.fixture = { barber, people, attempts: [] }
  await db.query('begin')
  try {
    await db.query('set local session_replication_role=replica')
    await db.query(
      "insert into public.barbers(id,name,ig,active,sort_order) values($1,'Customer E2E Barber','e2e',true,999)",
      [barber],
    )
    await db.query(
      "insert into public.services(id,barber_id,name,price,duration_min,active,sort_order,available_weekdays) values($1,$2,'Customer E2E Cut',100,30,true,0,ARRAY[0,1,2,3,4,5,6])",
      [service, barber],
    )
    await db.query(
      'insert into public.barber_schedules(barber_id,weekday,working,start_min,end_min) select $1,day,true,540,1080 from generate_series(0,6) day',
      [barber],
    )
    for (const [index, person] of people.entries()) {
      await db.query(
        `insert into public.bookings(id,barber_id,service_id,service_name,price,duration_min,start_at,end_at,customer_name,method,phone,email,lang,status)
            values($1,$2,$3,$4,100,30,date_trunc('day',now())+interval '90 days'+make_interval(hours => $8),
            date_trunc('day',now())+interval '90 days 30 minutes'+make_interval(hours => $8),$5,'email',$6,$7,'sv','confirmed')`,
        [
          person.booking,
          barber,
          service,
          `Customer ${person.label} appointment`,
          person.name,
          person.phone,
          person.email,
          10 + index,
        ],
      )
      await db.query(
        'insert into public.customer_booking_access_tokens(email,phone,token_hash,token_ciphertext) values($1,$2,$3,$4)',
        [person.email, person.phone, hash(person.token), `v1.${'a'.repeat(80)}`],
      )
    }
    await db.query('commit')
  } catch (error) {
    await db.query('rollback')
    throw error
  }
  const [a, b] = people
  const showHistory = async (page, person) => {
    await page.getByRole('heading', { name: /kommande/i }).waitFor()
    await page
      .getByRole('button', { name: /Visa detaljer/ })
      .last()
      .click()
    await page
      .getByRole('dialog')
      .getByText(`Customer ${person.label} appointment`, { exact: false })
      .waitFor()
    assert(
      !(await page.getByRole('dialog').innerText()).includes(
        `Customer ${person.label === 'A' ? 'B' : 'A'} appointment`,
      ),
      'mixed customer histories',
    )
  }

  {
    phase('customer: publish actual desktop/mobile CMS through the owner UI')
    await cms.publish(customerContexts)
  }
  phase(`customer ${browserName}: verify public CMS first paint`)
  await verifyPublicFirstPaint(customerContexts, browserName, workerOrigin, work)
  for (const width of [1280, 390]) {
    phase(`customer ${browserName} ${width}: permanent link and browser cookie`)
    const context = await customerContexts({
      viewport: { width, height: 844 },
      ignoreHTTPSErrors: true,
      reducedMotion: 'reduce',
    })
    const page = await context.newPage()
    page.setDefaultTimeout(WAIT_TIMEOUT)
    await page.goto(`${origin}/${a.token}`, { waitUntil: 'domcontentloaded' })
    await cms.verify(page, width)
    await showHistory(page, a)
    assert(
      new URL(page.url()).pathname === '/' && !page.url().includes(a.token),
      'email credential remains in URL',
    )
    const cookie = (await context.cookies()).find(
      (item) => item.name === '__Host-bladeblend_customer_session',
    )
    assert(
      cookie?.httpOnly &&
        cookie.secure &&
        cookie.sameSite === 'Lax' &&
        cookie.domain === '127.0.0.1' &&
        cookie.path === '/',
      'browser did not accept the required first-party cookie',
    )
    assert(
      !(await page.evaluate(() =>
        globalThis.document.cookie.includes('bladeblend_customer_session'),
      )),
      'customer credential readable by JavaScript',
    )
    await page.getByRole('button', { name: 'Stäng', exact: true }).click()
    const dismiss = page.getByRole('button', { name: 'Avvisa valfri lagring', exact: true })
    if (await dismiss.isVisible()) await dismiss.click()
    await page.getByRole('button', { name: 'Mina bokningar', exact: true }).click()
    await showHistory(page, a)
    await page.getByRole('button', { name: 'Stäng', exact: true }).click()
    await page.reload({ waitUntil: 'domcontentloaded' })
    await cms.verify(page, width)
    await page.screenshot({
      path: join(work, `cms-published-${browserName}-${width}.png`),
    })
    const dismissAgain = page.getByRole('button', {
      name: 'Avvisa valfri lagring',
      exact: true,
    })
    if (await dismissAgain.isVisible()) await dismissAgain.click()
    await page.getByRole('button', { name: 'Mina bokningar', exact: true }).click()
    await showHistory(page, a)
    if (width === 1280) {
      phase(`customer ${browserName}: shared-cookie customer switch and real profile hydration`)
      await page.getByRole('button', { name: 'Stäng', exact: true }).click()
      await page.getByRole('button', { name: 'Boka tid', exact: true }).first().click()
      await page
        .getByTestId('booking-barber-option')
        .filter({ hasText: 'Customer E2E Barber' })
        .click()
      const date = new Date(Date.now() + 2 * 86400000)
      const fmt = (options) =>
        new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', ...options }).format(date)
      const dateLabel = `${fmt({ weekday: 'long' })} ${fmt({ day: 'numeric' })} ${fmt({ month: 'long' })} ${fmt({ year: 'numeric' })}`
      await page.getByRole('button', { name: dateLabel, exact: true }).click()
      await page
        .getByTestId('booking-service-option')
        .filter({ hasText: 'Customer E2E Cut' })
        .click()
      await page.getByRole('button', { name: '10:00', exact: true }).click()
      const fields = page.getByRole('dialog').locator('input')
      assert(
        (await fields.nth(0).inputValue()) === a.name &&
          (await fields.nth(1).inputValue()) === a.phone &&
          (await fields.nth(2).inputValue()) === a.email,
        'successful real session hydration did not populate customer A',
      )
      await fields.nth(0).fill('Typed name survives')
      // Keep the real click and closure assertion; retain its layout/network boundary
      // if an engine reports a completed click without dismissing the dialog.
      await page.getByRole('button', { name: 'Stäng', exact: true }).click()
      await page
        .getByRole('dialog', { name: 'Dina uppgifter', exact: true })
        .waitFor({ state: 'hidden' })
      const second = await context.newPage()
      second.setDefaultTimeout(WAIT_TIMEOUT)
      await second.goto(`${origin}/${b.token}`, { waitUntil: 'domcontentloaded' })
      await showHistory(second, b)
      // Return to the original tab before acting: Firefox may defer its fold animation
      // while backgrounded, making the first click race the visibility transition.
      await page.bringToFront()
      await page.getByRole('button', { name: 'Mina bokningar', exact: true }).click()
      await showHistory(page, b)
      await page.getByRole('button', { name: 'Stäng', exact: true }).click()
      await page.getByRole('button', { name: '10:00', exact: true }).click()
      assert(
        (await fields.nth(0).inputValue()) === 'Typed name survives' &&
          (await fields.nth(1).inputValue()) === b.phone &&
          (await fields.nth(2).inputValue()) === b.email,
        'verified customer B retained customer A auto-fill or erased typed input',
      )
    }
    await context.close()
  }
  for (const existingCookie of [false, true]) {
    phase(`customer ${browserName}: rejected cookie ${existingCookie ? 'replacement' : 'creation'}`)
    const context = await customerContexts({ ignoreHTTPSErrors: true })
    const page = await context.newPage()
    page.setDefaultTimeout(WAIT_TIMEOUT)
    let previous
    if (existingCookie) {
      await page.goto(`${origin}/${a.token}`, { waitUntil: 'domcontentloaded' })
      await showHistory(page, a)
      previous = (await context.cookies()).find(
        (item) => item.name === '__Host-bladeblend_customer_session',
      )
      assert(previous, 'old-cookie fixture did not establish an actual session')
    }
    await context.route('**/api/customer-bookings', async (route) => {
      const response = await route.fetch(),
        headers = response.headers()
      delete headers['set-cookie']
      await context.clearCookies()
      if (previous) await context.addCookies([previous])
      await route.fulfill({ response, headers })
    })
    await page.goto(`${origin}/${b.token}`, { waitUntil: 'domcontentloaded' })
    await page
      .getByText(
        'Den säkra åtkomsten kunde inte sparas. Öppna mejllänken igen. Kontrollera webbplatsens cookieinställningar om felet kvarstår.',
        { exact: true },
      )
      .waitFor()
    assert(
      (await page.getByRole('heading', { name: /kommande/i }).count()) === 0,
      'rejected session cookie exposed a customer history',
    )
    await context.close()
  }
  phase(`customer ${browserName}: two fresh tabs book and share one optional receipt`)
  const receiptContext = await customerContexts({
    viewport: { width: 390, height: 844 },
    ignoreHTTPSErrors: true,
    reducedMotion: 'reduce',
  })
  const receiptPages = await Promise.all([receiptContext.newPage(), receiptContext.newPage()])
  // The supported cancellation cutoff reaches seven days. A fixed 11:00 appointment
  // three dates ahead can already be inside a 72-hour cutoff in an afternoon run.
  const bookingDate = new Date(Date.now() + 9 * 86400000)
  const datePart = (options, date = bookingDate) =>
    new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', ...options }).format(date)
  const bookingDateLabel = `${datePart({ weekday: 'long' })} ${datePart({ day: 'numeric' })} ${datePart({ month: 'long' })} ${datePart({ year: 'numeric' })}`
  const prepareBooking = async (page, person, time, consent) => {
    page.setDefaultTimeout(WAIT_TIMEOUT)
    await page.goto(origin, { waitUntil: 'domcontentloaded' })
    await cms.verify(page, page.viewportSize().width)
    const choose = page.getByRole('button', {
      name: consent ? 'Godkänn valfri lagring' : 'Avvisa valfri lagring',
      exact: true,
    })
    if (await choose.isVisible()) await choose.click()
    await page.getByRole('button', { name: 'Boka tid', exact: true }).first().click()
    await page
      .getByTestId('booking-barber-option')
      .filter({ hasText: 'Customer E2E Barber' })
      .click()
    const monthFormat = { year: 'numeric', month: 'numeric' }
    if (datePart(monthFormat) !== datePart(monthFormat, new Date()))
      await page.getByRole('button', { name: 'Nästa månad', exact: true }).click()
    await page.getByRole('button', { name: bookingDateLabel, exact: true }).click()
    await page.getByTestId('booking-service-option').filter({ hasText: 'Customer E2E Cut' }).click()
    await page.getByRole('button', { name: time, exact: true }).click()
    const fields = page.getByRole('dialog').locator('input:not([type="hidden"])')
    assert(
      (await fields.nth(0).inputValue()) === '' &&
        (await fields.nth(1).inputValue()) === '' &&
        (await fields.nth(2).inputValue()) === '',
      'device or unverified contact prefilled private customer data',
    )
    await fields.nth(0).fill(person.name)
    await fields.nth(1).fill(person.phone)
    await fields.nth(2).fill(person.email)
  }
  // Sequential preparation, simultaneous submit: both tabs start with no receipt cookie.
  await prepareBooking(receiptPages[0], a, '11:00', true)
  await prepareBooking(receiptPages[1], a, '11:30', true)
  assert(
    !(await receiptContext.cookies()).some(
      (item) => item.name === '__Host-bladeblend_booking_receipts',
    ),
    'fresh context unexpectedly has receipt',
  )
  const listFrom = (page) =>
    page.evaluate(async () =>
      (
        await fetch('/api/customer-bookings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'list' }),
        })
      ).json(),
    )
  const submitBooking = async (page) => {
    const response = page.waitForResponse(
      (r) => new URL(r.url()).pathname === '/api/bookings' && r.request().method() === 'POST',
    )
    await page.getByRole('dialog').getByRole('button', { name: 'Boka tid', exact: true }).click()
    const body = await (await response).json()
    assert(body.ok === true, `real booking failed: ${body.error ?? 'invalid result'}`)
    // Track this fixture's exact IP-attempt rows without truncating unrelated local data.
    const attempts = await db.query(
      `select id from public.booking_attempts where created_at = (select created_at from public.bookings where id=$1) and ip_hash=$2`,
      [body.booking.id, hash('127.0.0.1' + 'ci-booking-ip-salt-not-for-production')],
    )
    state.fixture.attempts.push(...attempts.rows.map((row) => row.id))
    return body
  }
  const receipts = await Promise.all(receiptPages.map(submitBooking))
  for (const page of receiptPages)
    await page
      .getByText('Din bokning finns nu under Mina bokningar på den här enheten.', {
        exact: true,
      })
      .waitFor()
  const deviceCookie = (await receiptContext.cookies()).find(
    (item) => item.name === '__Host-bladeblend_booking_receipts',
  )
  assert(
    deviceCookie?.httpOnly &&
      deviceCookie.secure &&
      deviceCookie.sameSite === 'Lax' &&
      deviceCookie.path === '/' &&
      deviceCookie.domain === '127.0.0.1',
    'browser rejected/failed to protect optional receipt',
  )
  assert(
    receipts[0].receipt_proof === receipts[1].receipt_proof,
    'simultaneous first bookings lost their shared collection',
  )
  const receiptList = await listFrom(receiptPages[0])
  assert(
    receiptList.ok &&
      receiptList.authority === 'device' &&
      !('email' in receiptList) &&
      !('phone' in receiptList) &&
      !('name' in receiptList),
    'device receipt became verified identity',
  )
  assert(
    receiptList.bookings.length === 2 &&
      receipts.every((item) =>
        receiptList.bookings.some((booking) => booking.id === item.booking.id),
      ),
    'receipt omitted a concurrent booking or imported older email history',
  )
  await receiptPages[0]
    .getByRole('dialog')
    .getByRole('button', { name: 'Mina bokningar', exact: true })
    .click()
  await receiptPages[0]
    .getByText(
      'Här visas bokningar skapade på den här enheten. Öppna mejllänken för tidigare bokningar.',
      { exact: true },
    )
    .waitFor()
  assert(
    (await receiptPages[0].getByRole('button', { name: /Visa detaljer/ }).count()) === 2,
    'confirmation did not open both new bookings immediately',
  )
  const refused = await receiptPages[0].evaluate(
    async (bookingId) =>
      (
        await fetch('/api/customer-bookings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'cancel', bookingId }),
        })
      ).json(),
    a.booking,
  )
  assert(refused.ok === false, 'device receipt cancelled an older booking at the same email')
  await receiptPages[0]
    .getByRole('button', { name: /Visa detaljer/ })
    .first()
    .click()
  await receiptPages[0].getByRole('button', { name: 'Avboka tid', exact: true }).first().click()
  const confirmCancel = receiptPages[0].getByRole('button', {
    name: 'Ja, avboka tid',
    exact: true,
  })
  const cancellationResponse = receiptPages[0].waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/customer-bookings' &&
      response.request().postDataJSON()?.action === 'cancel',
  )
  await confirmCancel.click()
  const cancellation = await (await cancellationResponse).json()
  assert(cancellation.ok === true, `device cancellation rejected: ${JSON.stringify(cancellation)}`)
  await receiptPages[0].getByText('Tiden är avbokad.', { exact: true }).waitFor()
  assert(
    (await listFrom(receiptPages[0])).bookings.length === 1,
    'device cancellation did not persist',
  )

  phase(`customer ${browserName}: withdrawing optional storage removes only receipt access`)
  const preferencesPage = await receiptContext.newPage()
  await preferencesPage.goto(origin, { waitUntil: 'domcontentloaded' })
  // Live About content can move this footer between pointerdown and pointerup. This auth
  // scenario uses the real keyboard action; the About UI gate covers pointer interaction.
  const preferencesLink = preferencesPage.getByRole('link', {
    name: 'Hantera integritetsinställningar',
    exact: true,
  })
  await preferencesLink.focus()
  await preferencesPage.keyboard.press('Enter')
  await preferencesPage.getByRole('checkbox', { name: /Valfri lagring/ }).uncheck()
  const forgot = preferencesPage.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === '/api/customer-bookings' &&
      r.request().postDataJSON()?.action === 'forget_device',
  )
  await preferencesPage.getByRole('button', { name: 'Spara val', exact: true }).click()
  await forgot
  assert(
    !(await receiptContext.cookies()).some(
      (item) => item.name === '__Host-bladeblend_booking_receipts',
    ),
    'withdrawal retained optional credential',
  )
  assert(
    (await listFrom(preferencesPage)).error === 'access_denied',
    'withdrawal retained receipt authority',
  )
  assert(
    (
      await db.query(
        'select count(*)::int as count from public.bookings where id=any($1::uuid[])',
        [receipts.map((item) => item.booking.id)],
      )
    ).rows[0].count === 2,
    'withdrawal deleted customer bookings',
  )
  await receiptContext.close()

  phase(`customer ${browserName}: rejected consent still books without optional cookie`)
  const rejectedContext = await customerContexts({
    ignoreHTTPSErrors: true,
    reducedMotion: 'reduce',
  })
  const rejectedPage = await rejectedContext.newPage()
  await prepareBooking(rejectedPage, b, '12:00', false)
  const rejectedBooking = await submitBooking(rejectedPage)
  await rejectedPage
    .getByText('Öppna länken i bekräftelsemejlet för att se dina bokningar.', { exact: true })
    .waitFor()
  assert(
    !rejectedBooking.receipt_proof &&
      !(await rejectedContext.cookies()).some(
        (item) => item.name === '__Host-bladeblend_booking_receipts',
      ),
    'rejected storage issued optional receipt',
  )
  assert(
    (await listFrom(rejectedPage)).error === 'access_denied',
    'rejected consent authenticated submitted contact',
  )
  await rejectedContext.close()

  phase(`customer ${browserName}: invalid link and rotation revocation`)
  const context = await customerContexts({ ignoreHTTPSErrors: true })
  const page = await context.newPage()
  page.setDefaultTimeout(WAIT_TIMEOUT)
  await page.goto(`${origin}/${a.token}`, { waitUntil: 'domcontentloaded' })
  await showHistory(page, a)
  const fullSession = (await context.cookies()).find(
    (cookie) => cookie.name === '__Host-bladeblend_customer_session',
  )
  assert(fullSession !== undefined, 'verified customer session cookie missing')
  await page.evaluate(async () => {
    const response = await fetch('/api/customer-bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'forget_device' }),
    })
    if (!response.ok || (await response.json()).ok !== true)
      throw new Error('forget_device did not accept the verified-session request')
  })
  assert(
    (await context.cookies()).find((cookie) => cookie.name === fullSession.name)?.value ===
      fullSession.value && (await listFrom(page)).authority === 'verified',
    'forgetting optional device access revoked the full email session',
  )
  const invalid = await page.evaluate(async () =>
    (
      await fetch('/api/customer-bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list', accessToken: 'f'.repeat(64) }),
      })
    ).json(),
  )
  assert(
    invalid.ok === false && invalid.error === 'access_denied',
    'invalid explicit link fell back to an old cookie',
  )
  const cross = await context.request.post(`${origin}/api/customer-bookings`, {
    headers: { Origin: 'https://attacker.example' },
    data: { action: 'list' },
  })
  assert(cross.status() === 403, 'cross-origin customer request was accepted')
  const replacement = randomBytes(32).toString('hex')
  await db.query('begin')
  try {
    await db.query('select public.rotate_customer_booking_access_token($1,$2,$3,$4,$5)', [
      a.email,
      hash(replacement),
      `v1.${'b'.repeat(80)}`,
      replacement,
      'sv',
    ])
    // The browser gate tests revocation, not provider sending. No mail job escapes this transaction.
    await removeQueuedMail([a.email])
    await db.query('commit')
  } catch (error) {
    await db.query('rollback')
    throw error
  }
  const revoked = await page.evaluate(async () =>
    (
      await fetch('/api/customer-bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'list' }),
      })
    ).json(),
  )
  assert(
    revoked.ok === false && revoked.error === 'access_denied',
    'rotation left old browser session authorized',
  )
  await page.goto(`${origin}/${replacement}`, { waitUntil: 'domcontentloaded' })
  await showHistory(page, a)
  await context.close()
  console.log(
    `Customer browser passed: ${browserName}, mobile/desktop, actual cookie/profile switch, blocked cookies, invalid link, rotation, concurrent first bookings, consent and device cancellation.`,
  )

  await cleanupFixture()
})

import { chromium } from 'playwright'

const baseUrl = (process.env.BASE_URL ?? 'http://127.0.0.1:4188').replace(/\/$/, '')

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function mount(page, name, argument, path, shellMinHeight = '0px') {
  await page.goto(`${baseUrl}${path}`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(
    async ({ name: exportName, argument: value }) => {
      const harness = await import('/tools/e2e/admin-harness.tsx')
      if (exportName === 'navigation') harness.mountAdminNavigationHarness(value)
      else harness.mountSiteViewHarness()
    },
    { name, argument },
  )
  await page.evaluate((minHeight) => {
    const shell = globalThis.document.querySelector('.knc-admin-shell')
    if (shell instanceof globalThis.HTMLElement) shell.style.minHeight = minHeight
  }, shellMinHeight)
}

async function waitForScroll(page, expected, label) {
  try {
    await page.waitForFunction(
      (target) => Math.round(globalThis.window.scrollY) === target,
      expected,
      { timeout: 5_000 },
    )
  } catch {
    const actual = await page.evaluate(() => ({
      scrollY: Math.round(globalThis.window.scrollY),
      state: globalThis.window.history.state,
      storage: { ...globalThis.window.sessionStorage },
    }))
    throw new Error(`${label}: ${JSON.stringify(actual)}`)
  }
}

async function waitForSavedScroll(page, tab, expected) {
  await page.waitForFunction(
    ({ expectedTab, expectedScroll }) => {
      const navigation = globalThis.window.history.state?.kncAdminNavigation
      return navigation?.tab === expectedTab && navigation.scrollY === expectedScroll
    },
    { expectedTab: tab, expectedScroll: expected },
  )
}

async function verifyNavigation(page) {
  await mount(page, 'navigation', 'owner', '/tools/e2e/admin-harness.html?tab=schedule', '22000px')
  await page.getByRole('button', { name: 'My schedule', exact: true }).waitFor()
  await waitForSavedScroll(page, 'schedule', 0)
  await page.evaluate(() => globalThis.window.scrollTo(0, 875))
  await waitForSavedScroll(page, 'schedule', 875)
  await page.getByRole('button', { name: 'Mail', exact: true }).click()
  await waitForScroll(page, 0, 'Mail did not start at top')
  await waitForSavedScroll(page, 'mail', 0)
  await page.evaluate(() => globalThis.window.scrollTo(0, 425))
  await waitForSavedScroll(page, 'mail', 425)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.evaluate(async () => {
    const harness = await import('/tools/e2e/admin-harness.tsx')
    harness.mountAdminNavigationHarness('owner')
    const shell = globalThis.document.querySelector('.knc-admin-shell')
    if (shell instanceof globalThis.HTMLElement) shell.style.minHeight = '22000px'
  })
  assert(
    (await page.getByRole('button', { name: 'Mail', exact: true }).getAttribute('aria-current')) ===
      'page',
    'Reload did not restore Mail tab',
  )
  await waitForScroll(page, 425, 'Reload did not restore Mail scroll')
  await page.goBack()
  assert(
    (await page
      .getByRole('button', { name: 'My schedule', exact: true })
      .getAttribute('aria-current')) === 'page',
    'Back did not restore Schedule tab',
  )
  await waitForScroll(page, 875, 'Back did not restore schedule scroll')
  const backScroll = await page.evaluate(() => Math.round(globalThis.window.scrollY))
  assert(backScroll === 875, `Back lost schedule scroll: ${backScroll}`)
  await page.goForward()
  assert(
    (await page.getByRole('button', { name: 'Mail', exact: true }).getAttribute('aria-current')) ===
      'page',
    'Forward did not restore Mail tab',
  )
  await waitForScroll(page, 425, 'Forward did not restore mail scroll')
  const forwardScroll = await page.evaluate(() => Math.round(globalThis.window.scrollY))
  assert(forwardScroll === 425, `Forward lost mail scroll: ${forwardScroll}`)

  await mount(page, 'navigation', 'barber', '/tools/e2e/admin-harness.html?tab=mail')
  assert(
    (await page.getByRole('button', { name: 'Mail', exact: true }).count()) === 0,
    'barber restored hidden Mail tab',
  )
  assert(
    (await page
      .getByRole('button', { name: 'My schedule', exact: true })
      .getAttribute('aria-current')) === 'page',
    'barber did not fall back to Schedule',
  )
}

async function verifyDelayedRestore(page) {
  await mount(page, 'navigation', 'owner', '/tools/e2e/admin-harness.html?tab=schedule', '22000px')
  await waitForSavedScroll(page, 'schedule', 0)
  await page.evaluate(() => globalThis.window.scrollTo(0, 5000))
  await waitForSavedScroll(page, 'schedule', 5000)
  await page.getByRole('button', { name: 'Mail', exact: true }).click()
  await waitForScroll(page, 0, 'Mail did not start at top before delayed restore')
  await waitForSavedScroll(page, 'mail', 0)
  await page.evaluate(() => {
    const shell = globalThis.document.querySelector('.knc-admin-shell')
    if (shell instanceof globalThis.HTMLElement) shell.style.minHeight = '0px'
    globalThis.window.scrollTo(0, 0)
  })
  await page.goBack()
  await page.waitForTimeout(10_100)
  await page.evaluate(() => {
    const shell = globalThis.document.querySelector('.knc-admin-shell')
    if (shell instanceof globalThis.HTMLElement) shell.style.minHeight = '22000px'
  })
  await page.waitForFunction(() => Math.round(globalThis.window.scrollY) === 5000)
}

async function verifyPresentationDraft(page) {
  await mount(page, 'site', undefined, '/tools/e2e/admin-harness.html?view=site')
  await page.getByLabel('Logo scale').waitFor()
  assert(
    (await page.locator('script[src*="challenges.cloudflare.com"]').count()) === 0,
    'read-only CMS replica loaded external Turnstile challenge',
  )
  await page.getByLabel('Logo scale').selectOption('xl')
  await page.getByLabel('Image style').selectOption('monochrome')
  assert(
    (await page.evaluate(() => globalThis.window.__adminHarnessWrites?.length ?? -1)) === 0,
    'draft scale wrote before publish',
  )
  const focusedSvg = page.getByTestId('homepage-logo-focused-preview').locator('svg')
  assert((await focusedSvg.count()) === 1, 'focused logo preview did not render one SVG')
  assert((await focusedSvg.getAttribute('height')) === '188', 'draft scale did not reach preview')
  assert(
    (await focusedSvg.evaluate((element) => globalThis.getComputedStyle(element).filter)).includes(
      'grayscale(1)',
    ),
    'draft monochrome style did not reach focused preview',
  )
  const replica = page.getByTestId('homepage-replica-preview')
  assert(
    (await replica.getByText('BARBERSHOP · GOTHENBURG', { exact: true }).count()) === 1,
    'English preview copy missing',
  )
  const previewToolbar = page.getByRole('toolbar', { name: 'Preview controls' })
  await previewToolbar.getByRole('button', { name: 'SV', exact: true }).click()
  assert(
    (await replica.getByText('BARBERSHOP · GÖTEBORG', { exact: true }).count()) === 1,
    'preview language toggle kept wrong-language CMS copy',
  )
  const swedishPreviewToolbar = page.getByRole('toolbar', { name: 'Förhandsvisningskontroller' })
  const replicaScroll = page.getByTestId('homepage-replica-scroll')
  const replicaPanel = replica.getByTestId('desktop-top-panel')
  await swedishPreviewToolbar.getByRole('button', { name: 'Om oss', exact: true }).click()
  await page.waitForFunction(() => {
    const host = globalThis.document.querySelector('[data-testid="homepage-replica-scroll"]')
    const about = host?.querySelector('#om-oss')
    if (!(host instanceof globalThis.HTMLElement) || !(about instanceof globalThis.HTMLElement))
      return false
    return Math.abs(about.getBoundingClientRect().top - host.getBoundingClientRect().top - 61) <= 1
  })
  await page.waitForFunction(() => {
    const host = globalThis.document.querySelector('[data-testid="homepage-replica-scroll"]')
    const panel = host?.querySelector('[data-testid="desktop-top-panel"]')
    if (!(host instanceof globalThis.HTMLElement) || !(panel instanceof globalThis.HTMLElement))
      return false
    return Math.abs(panel.getBoundingClientRect().top - host.getBoundingClientRect().top) <= 1
  })
  const [aboutHostBox, aboutPanelBox] = await Promise.all([
    replicaScroll.boundingBox(),
    replicaPanel.boundingBox(),
  ])
  assert(aboutHostBox !== null && aboutPanelBox !== null, 'replica scroll geometry unavailable')
  assert(
    Math.abs(aboutPanelBox.y - aboutHostBox.y) <= 1,
    `replica panel escaped embedded scroll viewport: ${JSON.stringify({ aboutHostBox, aboutPanelBox })}`,
  )
  await swedishPreviewToolbar.getByRole('button', { name: 'Bokning', exact: true }).click()
  await replica.getByTestId('booking-step-barber').waitFor()
  await page.waitForFunction(() => {
    const host = globalThis.document.querySelector('[data-testid="homepage-replica-scroll"]')
    const booking = host?.querySelector('[data-testid="fold-booking"]')
    if (!(host instanceof globalThis.HTMLElement) || !(booking instanceof globalThis.HTMLElement))
      return false
    const hostRect = host.getBoundingClientRect()
    const bookingRect = booking.getBoundingClientRect()
    return bookingRect.top < hostRect.bottom && bookingRect.bottom > hostRect.top + 61
  })
  await page.waitForFunction(() => {
    const host = globalThis.document.querySelector('[data-testid="homepage-replica-scroll"]')
    const panel = host?.querySelector('[data-testid="desktop-top-panel"]')
    if (!(host instanceof globalThis.HTMLElement) || !(panel instanceof globalThis.HTMLElement))
      return false
    return Math.abs(panel.getBoundingClientRect().top - host.getBoundingClientRect().top) <= 1
  })
  await page.getByRole('button', { name: 'Publish presentation', exact: true }).click()
  const writes = await page.evaluate(
    () => globalThis.window.__adminHarnessWrites?.map((entry) => Object.fromEntries(entry)) ?? [],
  )
  assert(writes.length === 1, 'publish did not write exactly once')
  assert(writes[0]?.homepage_logo_scale === 'xl', 'published logo scale missing')
  assert(writes[0]?.homepage_scale === 'md', 'published homepage scale missing')
  assert(writes[0]?.homepage_logo_style === 'monochrome', 'published logo style missing')
}

async function mutationControl(page, action, target) {
  return page.evaluate(
    async ({ action, target }) => {
      const harness = await import('/tools/e2e/admin-harness.tsx')
      return harness.adminMutationControl(action, target)
    },
    { action, target },
  )
}

async function verifyMutationReentry(page, kind, reentry = 'target', failFirst = false) {
  await page.goto(`${baseUrl}/tools/e2e/admin-harness.html`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(
    async ({ kind, failFirst }) => {
      const harness = await import('/tools/e2e/admin-harness.tsx')
      harness.mountAdminMutationHarness(kind, failFirst)
    },
    { kind, failFirst },
  )
  if (kind === 'services') {
    await page.getByLabel('Price (kr)', { exact: true }).first().fill('200')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
  } else if (kind === 'profile') {
    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: 'first.png', mimeType: 'image/png', buffer: Buffer.from('first') })
  } else {
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: /cancel booking/i })
      .click()
  }
  await page.waitForFunction(
    async () =>
      (await import('/tools/e2e/admin-harness.tsx')).adminMutationControl('snapshot').writes === 1,
  )
  if (reentry === 'remount') await mutationControl(page, 'remount')
  else {
    await mutationControl(page, 'target', 'b')
    await page.getByRole('heading', { name: /B$/ }).waitFor()
    await mutationControl(page, 'target', 'a')
    await page.getByRole('heading', { name: /A$/ }).waitFor()
  }
  // Let the target effect run; the original write is still explicitly held before persistence.
  await page.waitForTimeout(100)
  const mutable =
    kind === 'services'
      ? page.getByRole('button', { name: 'Save', exact: true })
      : kind === 'profile'
        ? page.locator('input[type="file"]')
        : page.getByRole('button', { name: 'Cancel', exact: true })
  assert(
    (await mutable.count()) === 0 || (await mutable.first().isDisabled()),
    `${kind}: returning A allows another mutation before its earlier write settles`,
  )
  assert(
    (await mutationControl(page, 'snapshot')).writes === 1,
    `${kind}: pending write was duplicated`,
  )
  await mutationControl(page, 'release')
  if (kind === 'services') {
    await page.waitForFunction(
      (price) =>
        [...globalThis.document.querySelectorAll('input')].some((input) => input.value === price),
      failFirst ? '100' : '200',
    )
    await page.getByLabel('Price (kr)', { exact: true }).first().fill('300')
    await page.getByRole('button', { name: 'Save', exact: true }).click()
    await page.waitForFunction(
      async () =>
        (await import('/tools/e2e/admin-harness.tsx')).adminMutationControl('snapshot').writes ===
        2,
    )
    assert(
      (await mutationControl(page, 'snapshot')).price === 300,
      'older service price overwrote newer persisted intent',
    )
    assert(
      (await page.getByLabel('Price (kr)', { exact: true }).first().inputValue()) === '300',
      'service UI disagrees with persisted price',
    )
  } else if (kind === 'profile') {
    if (!failFirst) await page.locator('img[src$="#first.png"]').waitFor()
    else await page.locator('input[type="file"]').waitFor({ state: 'attached' })
    await page
      .locator('input[type="file"]')
      .setInputFiles({ name: 'latest.png', mimeType: 'image/png', buffer: Buffer.from('latest') })
    await page.locator('img[src$="#latest.png"]').waitFor()
    assert(
      (await mutationControl(page, 'snapshot')).photo === 'latest.png',
      'older upload overwrote newer persisted photo',
    )
  } else {
    if (failFirst) {
      await page.getByRole('button', { name: 'Cancel', exact: true }).click()
      await page
        .getByRole('dialog')
        .getByRole('button', { name: 'Cancel booking', exact: true })
        .click()
    }
    await page.getByRole('button', { name: /^Cancelled/ }).click()
    await page.getByText('A customer', { exact: true }).waitFor()
    assert(
      (await mutationControl(page, 'snapshot')).status === 'cancelled',
      'cancellation never persisted',
    )
  }
}

async function hydrationControl(page, action) {
  return page.evaluate(
    async (action) => (await import('/tools/e2e/admin-harness.tsx')).adminHydrationControl(action),
    action,
  )
}

async function verifyInitialHydration(page, kind, failLoad = false) {
  await page.goto(`${baseUrl}/tools/e2e/admin-harness.html`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(
    async ({ kind, failLoad }) =>
      (await import('/tools/e2e/admin-harness.tsx')).mountAdminHydrationHarness(kind, failLoad),
    { kind, failLoad },
  )
  const control =
    kind === 'site'
      ? page.locator('label').filter({ hasText: 'About section' }).locator('select')
      : page.locator('input[type="file"]')
  await control.waitFor({ state: 'attached' })
  assert(await control.isDisabled(), `${kind}: control enabled before authoritative load`)
  if (kind === 'site')
    assert(
      await page.locator('#site-font-heading').locator('..').locator('select').first().isDisabled(),
      'homepage draft editable before hydration',
    )
  await hydrationControl(page, 'load')
  if (failLoad) {
    await page.getByText('Synthetic load failure', { exact: true }).first().waitFor()
    assert(await control.isDisabled(), `${kind}: failed hydration enabled mutations`)
    assert(
      (await hydrationControl(page, 'snapshot')).writes === 0,
      'write occurred despite failed hydration',
    )
    return
  }
  await page.waitForFunction(() =>
    [...globalThis.document.querySelectorAll('select,input[type="file"]')].some(
      (input) => !input.disabled,
    ),
  )
  if (kind === 'site') {
    await control.selectOption('sm')
    await page.waitForFunction(
      async () =>
        (await import('/tools/e2e/admin-harness.tsx')).adminHydrationControl('snapshot').writes ===
        1,
    )
    assert(await control.isDisabled(), 'About autosave permits out-of-order writes')
    await hydrationControl(page, 'write')
    await page.waitForFunction(
      () =>
        ![...globalThis.document.querySelectorAll('select')].find((select) => select.value === 'sm')
          ?.disabled,
    )
    await control.selectOption('xl')
    await page.waitForFunction(
      async () =>
        (await import('/tools/e2e/admin-harness.tsx')).adminHydrationControl('snapshot').writes ===
        2,
    )
    assert(
      (await hydrationControl(page, 'snapshot')).about === 'xl',
      'published About size differs from final selection',
    )
    assert((await control.inputValue()) === 'xl', 'About size UI differs from published state')
  } else {
    await page.locator('#alt-salon').fill('New uploaded photo')
    await control.setInputFiles({
      name: 'new.png',
      mimeType: 'image/png',
      buffer: Buffer.from('new'),
    })
    await page.locator('figure img[alt="New uploaded photo"]').waitFor()
    assert(
      (await hydrationControl(page, 'snapshot')).gallery === 1,
      'gallery success lacks persisted upload',
    )
    await page.locator('figure').getByRole('button', { name: 'Remove', exact: true }).click()
    await page.getByRole('dialog').getByRole('button', { name: 'Remove', exact: true }).click()
    await page.locator('figure').waitFor({ state: 'detached' })
    assert(
      (await hydrationControl(page, 'snapshot')).gallery === 0,
      'gallery removal did not persist',
    )
  }
}

async function contactControl(page, identity) {
  await page.evaluate(
    async (identity) => (await import('/tools/e2e/admin-harness.tsx')).setHarnessContact(identity),
    identity,
  )
}
async function verifyContactOwnership(page, kind) {
  await page.route('https://challenges.cloudflare.com/**', (route) =>
    route.fulfill({
      contentType: 'application/javascript',
      body: 'window.turnstile={render:()=>"test",remove:()=>{},reset:()=>{}}',
    }),
  )
  await page.goto(`${baseUrl}/tools/e2e/admin-harness.html`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(
    async (kind) => (await import('/tools/e2e/admin-harness.tsx')).mountContactHarness(kind),
    kind,
  )
  if (kind === 'booking') {
    await page.getByTestId('booking-barber-option').click()
    await page.getByRole('button', { name: 'Monday 14 September 2026', exact: true }).click()
    await page.getByTestId('booking-service-option').click()
    await page.getByRole('button', { name: '10:00', exact: true }).click()
    const inputs = page.getByRole('dialog').locator('input')
    await inputs.nth(0).fill('Typed name')
    await contactControl(page, 'a')
    await page.waitForFunction(
      () =>
        globalThis.document.querySelector('[role="dialog"] input[type="email"]')?.value ===
        'a@example.test',
    )
    assert(
      (await inputs.nth(0).inputValue()) === 'Typed name',
      'late successful hydration overwrote typed name',
    )
    assert(
      (await inputs.nth(1).inputValue()) === '0701111111',
      'late successful hydration never populated untouched phone',
    )
    await contactControl(page, 'b')
    await page.waitForFunction(
      () =>
        globalThis.document.querySelector('[role="dialog"] input[type="email"]')?.value ===
        'b@example.test',
    )
    assert(
      (await inputs.nth(1).inputValue()) === '0702222222',
      'customer B retained customer A auto-fill',
    )
    await inputs.nth(1).fill('')
    await contactControl(page, 'a')
    await page.waitForFunction(
      () =>
        globalThis.document.querySelector('[role="dialog"] input[type="email"]')?.value ===
        'a@example.test',
    )
    assert(
      (await inputs.nth(1).inputValue()) === '',
      'explicitly cleared phone was auto-filled again',
    )
    await contactControl(page, 'clear')
    await page.waitForFunction(
      () => globalThis.document.querySelector('[role="dialog"] input[type="email"]')?.value === '',
    )
    assert((await inputs.nth(0).inputValue()) === 'Typed name', 'profile clear deleted typed name')
    assert((await inputs.nth(1).inputValue()) === '', 'profile clear changed typed empty phone')
  } else {
    const phone = page.locator('input[type="tel"]')
    await contactControl(page, 'a')
    await page.waitForFunction(
      () => globalThis.document.querySelector('input[type="tel"]')?.value === '0701111111',
    )
    await contactControl(page, 'b')
    await page.waitForFunction(
      () => globalThis.document.querySelector('input[type="tel"]')?.value === '0702222222',
    )
    await contactControl(page, 'clear')
    await page.waitForFunction(
      () => globalThis.document.querySelector('input[type="tel"]')?.value === '',
    )
    await phone.fill('0703333333')
    await contactControl(page, 'a')
    await page.waitForTimeout(100)
    assert((await phone.inputValue()) === '0703333333', 'review auto-fill overwrote typed phone')
  }
}

async function verifyDelayedCatalog(page, embedded) {
  await page.setViewportSize({ width: 1280, height: 600 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(`${baseUrl}/tools/e2e/admin-harness.html`, { waitUntil: 'domcontentloaded' })
  // Disable native scroll anchoring so this proves the application reveal, not browser compensation.
  await page.addStyleTag({ content: '* { overflow-anchor: none !important; }' })
  await page.evaluate(
    async (embedded) =>
      (await import('/tools/e2e/admin-harness.tsx')).mountDelayedCatalogHarness(embedded),
    embedded,
  )
  await page.getByTestId('booking-step-barber').waitFor()
  await page.evaluate(() => globalThis.document.fonts.ready)
  // Longer than the former 1200ms geometry deadline. The pending work is catalog data, not JS.
  await page.waitForTimeout(1600)
  assert(
    (await page.getByTestId('booking-barber-option').count()) === 0,
    'catalog fixture was not delayed',
  )
  await page.evaluate(async () =>
    (await import('/tools/e2e/admin-harness.tsx')).finishCatalogLoad(),
  )
  await page.getByTestId('booking-barber-option').last().waitFor()
  assert(
    (await page.getByTestId('booking-barber-option').count()) === 12,
    'catalog did not hydrate all real controls',
  )
  await page.waitForFunction((embedded) => {
    const box = globalThis.document
      .querySelector('[data-testid="booking-step-barber"]')
      .getBoundingClientRect()
    const host = globalThis.document
      .querySelector('[data-testid="catalog-scroll-root"]')
      .getBoundingClientRect()
    return (
      box.top >= (embedded ? host.top : 0) &&
      box.bottom <= (embedded ? host.bottom : globalThis.innerHeight) + 1
    )
  }, embedded)
  await page.waitForTimeout(200)
  const before = await page.evaluate(
    (embedded) =>
      embedded
        ? globalThis.document.querySelector('[data-testid="catalog-scroll-root"]').scrollTop
        : globalThis.scrollY,
    embedded,
  )
  await page.evaluate(() => {
    globalThis.document.querySelector('[data-testid="fold-booking"]').style.paddingBottom = '500px'
  })
  await page.waitForTimeout(200)
  const after = await page.evaluate(
    (embedded) =>
      embedded
        ? globalThis.document.querySelector('[data-testid="catalog-scroll-root"]').scrollTop
        : globalThis.scrollY,
    embedded,
  )
  assert(Math.abs(before - after) < 1, 'later layout change caused an unsolicited reveal jump')
}

const browser = await chromium.launch()
let passed = 0
try {
  for (const verify of [
    verifyNavigation,
    verifyDelayedRestore,
    verifyPresentationDraft,
    ...['services', 'profile', 'bookings'].flatMap((kind) => [
      (page) => verifyMutationReentry(page, kind),
      (page) => verifyMutationReentry(page, kind, 'remount'),
      (page) => verifyMutationReentry(page, kind, 'target', true),
    ]),
    ...['site', 'gallery'].flatMap((kind) => [
      (page) => verifyInitialHydration(page, kind),
      (page) => verifyInitialHydration(page, kind, true),
    ]),
    ...['booking', 'review'].map((kind) => (page) => verifyContactOwnership(page, kind)),
    ...[false, true].map((embedded) => (page) => verifyDelayedCatalog(page, embedded)),
  ]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    page.setDefaultTimeout(10_000)
    try {
      await verify(page)
      passed++
    } finally {
      await page.close()
    }
  }
  console.log(
    `Browser regressions passed (${passed} scenarios): history, draft publish, persisted admin ordering/re-entry/failures, hydration gates, customer identity and delayed catalog.`,
  )
} finally {
  await browser.close()
}

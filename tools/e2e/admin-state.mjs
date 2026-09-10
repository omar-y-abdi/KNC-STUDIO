import { chromium, firefox, webkit } from 'playwright'

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

const AUTH_USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const AUTH_USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const PRIVATE_CUSTOMER = 'Synthetic customer for admin revocation'

function adminSession(id) {
  const now = Math.floor(Date.now() / 1000)
  const email = `${id === AUTH_USER_A ? 'a' : 'b'}@audit.invalid`
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(
    JSON.stringify({
      sub: id,
      exp: now + 3600,
      iat: now,
      role: 'authenticated',
      email,
      aud: 'authenticated',
    }),
  ).toString('base64url')
  return {
    access_token: `${header}.${payload}.synthetic-signature`,
    refresh_token: `synthetic-refresh-${id}`,
    expires_at: now + 3600,
    expires_in: 3600,
    token_type: 'bearer',
    user: {
      id,
      email,
      aud: 'authenticated',
      role: 'authenticated',
      app_metadata: {},
      user_metadata: {},
      created_at: '2026-01-01T00:00:00Z',
    },
  }
}

function gate() {
  let release
  const promise = new Promise((resolve) => {
    release = resolve
  })
  return { promise, release }
}

async function mountRealAdmin(page, tab = 'bookings') {
  await page.evaluate(async (tab) => {
    ;(await import('/tools/e2e/admin-harness.tsx')).mountAdminAppHarness(tab)
  }, tab)
}

async function verifyAdminSession(page, scenario) {
  const queuedWrite = ['queued-write', 'notification-gap'].includes(scenario)
  const holds = { profile: gate(), logout: gate(), presentation: gate(), password: gate() }
  const state = {
    enabled: true,
    mustChangePassword: true,
    networkFailure: false,
    calls: [],
    errors: [],
    settings: new Map([['business_name', 'Synthetic Studio']]),
  }
  const origin = new URL(baseUrl).origin
  const count = (path) => state.calls.filter((call) => call.path === path).length
  await page.clock.install()
  await page.addInitScript(
    (session) => globalThis.localStorage.setItem('knc-admin-auth', JSON.stringify(session)),
    adminSession(AUTH_USER_A),
  )
  if (scenario === 'notification-gap' || scenario === 'late-reset-logout') {
    await page.addInitScript(() => {
      const NativeChannel = globalThis.BroadcastChannel
      globalThis.__heldAuthMessages = []
      const nativeListen = globalThis.addEventListener.bind(globalThis)
      globalThis.addEventListener = (type, callback, options) => {
        if (type !== 'storage') return nativeListen(type, callback, options)
        return nativeListen(
          type,
          (event) => {
            globalThis.__heldAuthMessages.push(() => callback.call(globalThis, event))
          },
          options,
        )
      }
      globalThis.BroadcastChannel = class extends NativeChannel {
        addEventListener(type, callback, options) {
          if (type !== 'message' || this.name !== 'knc-admin-auth')
            return super.addEventListener(type, callback, options)
          return super.addEventListener(
            type,
            (event) => {
              globalThis.__heldAuthMessages.push(() => callback.call(this, event))
            },
            options,
          )
        }
      }
    })
  }
  page.on('pageerror', (error) => state.errors.push(error.message))
  // Intercept before importing/mounting anything: no real Auth, DB, provider or production writes.
  await page.context().route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.origin === origin) return route.continue()
    const reply = (body, status = 200) =>
      route.fulfill({
        status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Allow-Methods': '*',
        },
        body: status === 204 ? undefined : JSON.stringify(body),
      })
    if (request.method() === 'OPTIONS') return reply(null, 204)
    let body = null
    try {
      body = request.postDataJSON()
    } catch {
      /* GET has no JSON body. */
    }
    let who = null
    try {
      who = JSON.parse(
        Buffer.from(request.headers().authorization.split('.')[1], 'base64url').toString(),
      ).sub
    } catch {
      /* Anonymous requests have no user. */
    }
    state.calls.push({ path: url.pathname, method: request.method(), who, body })
    if (url.pathname === '/auth/v1/logout') {
      if (scenario === 'slow-signout' || scenario === 'late-reset-logout')
        await holds.logout.promise
      return reply(null, 204)
    }
    if (url.pathname === '/auth/v1/token') {
      if (scenario === 'late-settings-password' && body.email.startsWith('a@'))
        await holds.password.promise
      return reply(adminSession(body.email.startsWith('b@') ? AUTH_USER_B : AUTH_USER_A))
    }
    if (url.pathname === '/auth/v1/user') {
      if (request.method() === 'PUT' && scenario === 'late-password') await holds.password.promise
      return reply(adminSession(who ?? AUTH_USER_A).user)
    }
    if (url.pathname === '/rest/v1/profiles') {
      const snapshot = {
        role: 'owner',
        barber_id: null,
        must_change_password:
          ['late-password', 'password-completes'].includes(scenario) && state.mustChangePassword,
        account_enabled: state.enabled,
      }
      if (scenario === 'late-profile') await holds.profile.promise
      return state.networkFailure
        ? reply({ message: 'Temporary transport failure' }, 503)
        : reply(snapshot)
    }
    if (url.pathname === '/rest/v1/barbers')
      return reply([
        {
          id: 'audit-barber',
          name: 'Audit Barber',
          ig: '',
          role_sv: 'Barberare',
          role_en: 'Barber',
          bio_sv: '',
          bio_en: '',
          active: true,
          sort_order: 0,
        },
      ])
    if (url.pathname === '/rest/v1/bookings') {
      if (!who || !state.enabled)
        return reply({ code: '42501', message: 'Denied by inert authoritative boundary' }, 403)
      const start = new Date(Date.now() + 3 * 86400_000)
      return reply([
        {
          id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          barber_id: 'audit-barber',
          service_name: 'Audit service',
          price: 350,
          duration_min: 30,
          start_at: start.toISOString(),
          end_at: new Date(start.getTime() + 1800_000).toISOString(),
          customer_name: PRIVATE_CUSTOMER,
          method: 'email',
          phone: '0700000055',
          email: 'customer@audit.invalid',
          lang: 'sv',
          status: 'confirmed',
        },
      ])
    }
    if (url.pathname === '/rest/v1/site_content') return reply([])
    if (url.pathname === '/rest/v1/rpc/set_own_password_changed') {
      state.mustChangePassword = false
      return reply(null)
    }
    if (url.pathname === '/rest/v1/site_settings') {
      if (request.method() === 'GET')
        return reply([...state.settings].map(([key, value]) => ({ key, value })))
      if (Array.isArray(body) && queuedWrite) await holds.presentation.promise
      for (const row of Array.isArray(body) ? body : [body]) state.settings.set(row.key, row.value)
      return reply(body)
    }
    if (url.pathname.startsWith('/rest/v1/')) return reply([])
    state.errors.push(`Unexpected external request: ${url.origin}${url.pathname}`)
    return route.abort()
  })
  const waitCall = async (predicate) => {
    const deadline = Date.now() + 10_000
    while (!state.calls.some(predicate)) {
      assert(Date.now() < deadline, `Admin ${scenario}: expected request missing`)
      await new Promise((resolve) => globalThis.setTimeout(resolve, 10))
    }
  }
  const signOut = () =>
    page.evaluate(async () =>
      (await import('/src/admin/adminClient.ts')).getAdminClient().auth.signOut({ scope: 'local' }),
    )
  const focus = () =>
    page.evaluate(() => {
      globalThis.window.dispatchEvent(new globalThis.Event('focus'))
      globalThis.document.dispatchEvent(new globalThis.Event('visibilitychange'))
    })
  const data = page.getByText(PRIVATE_CUSTOMER, { exact: true })
  try {
    await page.goto(`${baseUrl}/tools/e2e/admin-harness.html`, { waitUntil: 'networkidle' })
    const configured = await page.evaluate(async () =>
      (await import('/src/backend/config.ts')).isBackendConfigured(),
    )
    assert(
      configured,
      'Admin source server requires fake VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY',
    )
    await mountRealAdmin(
      page,
      queuedWrite ? 'site' : scenario === 'late-settings-password' ? 'settings' : 'bookings',
    )
    if (scenario === 'late-reset-logout') {
      await data.waitFor()
      await page.evaluate(async () => {
        const { setNewPassword } = await import('/src/admin/auth.ts')
        globalThis.__resetResult = null
        void setNewPassword('Synthetic-new-password-123!').then((result) => {
          globalThis.__resetResult = result
        })
      })
      await waitCall((call) => call.path === '/auth/v1/logout')
      const other = await page.context().newPage()
      try {
        await other.goto(`${baseUrl}/tools/e2e/admin-harness.html`, {
          waitUntil: 'domcontentloaded',
        })
        const login = await other.evaluate(async () =>
          (await import('/src/admin/adminClient.ts')).getAdminClient().auth.signInWithPassword({
            email: 'b@audit.invalid',
            password: 'Synthetic-password-123!',
          }),
        )
        assert(
          login.data.user.id === AUTH_USER_B,
          'Other tab did not sign in while reset logout waited',
        )
        holds.logout.release()
        await page.waitForFunction(() => globalThis.__resetResult !== null)
        assert(
          await page.evaluate(
            (id) => JSON.parse(globalThis.localStorage.getItem('knc-admin-auth'))?.user.id === id,
            AUTH_USER_B,
          ),
          'Late reset logout cleared the new B session',
        )
        assert(
          state.calls
            .filter((call) => call.path === '/auth/v1/logout')
            .every((call) => call.who === AUTH_USER_A),
          'Reset logout targeted another account',
        )
      } finally {
        await other.close()
      }
    } else if (scenario === 'late-profile') {
      await waitCall((call) => call.path === '/rest/v1/profiles')
      await signOut()
      holds.profile.release()
      await page.waitForTimeout(150)
      assert(
        (await page.locator('.knc-admin-shell').count()) === 0,
        'Stale profile reopened the protected shell after sign-out',
      )
      assert(
        await page.evaluate(() => globalThis.localStorage.getItem('knc-admin-auth') === null),
        'Auth storage survived sign-out',
      )
    } else if (scenario === 'late-password' || scenario === 'password-completes') {
      await page.locator('#fp-next').fill('Synthetic-new-password-123!')
      await page.locator('#fp-confirm').fill('Synthetic-new-password-123!')
      await page.locator('form button[type="submit"]').click()
      await waitCall((call) => call.path === '/auth/v1/user' && call.method === 'PUT')
      if (scenario === 'password-completes') {
        await data.waitFor()
        assert(
          !state.mustChangePassword,
          'Successful password flow never cleared the forced-change flag',
        )
        assert(count('/auth/v1/logout') === 0, 'Forced change signed out the active staff member')
      } else {
        await signOut()
        holds.password.release()
        await page.waitForTimeout(150)
        assert(
          !state.calls.some((call) => call.path === '/rest/v1/rpc/set_own_password_changed'),
          'Unmounted forced-change form continued with a later session',
        )
        assert(
          (await page.locator('.knc-admin-shell').count()) === 0,
          'Late password result reopened protected UI',
        )
        assert(
          await page.evaluate(() => globalThis.localStorage.getItem('knc-admin-auth') === null),
          'Late password result restored the signed-out session in storage',
        )
      }
    } else if (scenario === 'late-settings-password') {
      await page.locator('#settings-current-password').fill('Synthetic-old-password-123!')
      await page.locator('#settings-new-password').fill('Synthetic-new-password-123!')
      await page.locator('#settings-confirm-password').fill('Synthetic-new-password-123!')
      await page
        .locator('form[aria-labelledby="settings-password-heading"] button[type="submit"]')
        .click()
      await waitCall((call) => call.path === '/auth/v1/token')
      const login = await page.evaluate(async () =>
        (await import('/src/admin/adminClient.ts')).getAdminClient().auth.signInWithPassword({
          email: 'b@audit.invalid',
          password: 'Synthetic-password-123!',
        }),
      )
      assert(login.data.user.id === AUTH_USER_B, 'B did not establish a session')
      holds.password.release()
      await page.waitForTimeout(200)
      assert(
        await page.evaluate(
          (id) => JSON.parse(globalThis.localStorage.getItem('knc-admin-auth')).user.id === id,
          AUTH_USER_B,
        ),
        'Late password verification replaced B with the previous A session',
      )
      assert(
        !state.calls.some((call) => call.path === '/auth/v1/user' && call.method === 'PUT'),
        'Old password intent continued after account change',
      )
    } else if (queuedWrite) {
      await page.getByLabel('Logotypstorlek').selectOption('xl')
      await page.getByRole('button', { name: 'Publicera utseende', exact: true }).click()
      await waitCall((call) => Array.isArray(call.body))
      await page.getByLabel('Företagsnamn', { exact: true }).fill('OLD A INTENT')
      await page
        .getByLabel('Företagsnamn', { exact: true })
        .locator('..')
        .getByRole('button', { name: 'Spara', exact: true })
        .click()
      assert(
        !state.calls.some((call) => call.body?.key === 'business_name'),
        'A write was not queued',
      )
      if (scenario === 'notification-gap') {
        const other = await page.context().newPage()
        try {
          await other.goto(`${baseUrl}/tools/e2e/admin-harness.html`, {
            waitUntil: 'domcontentloaded',
          })
          const login = await other.evaluate(async () =>
            (await import('/src/admin/adminClient.ts')).getAdminClient().auth.signInWithPassword({
              email: 'b@audit.invalid',
              password: 'Synthetic-password-123!',
            }),
          )
          assert(login.data.user.id === AUTH_USER_B, 'Other tab did not sign in as B')
          await page.waitForFunction(() => globalThis.__heldAuthMessages.length > 0)
          assert(
            await page.evaluate(
              (id) => JSON.parse(globalThis.localStorage.getItem('knc-admin-auth')).user.id === id,
              AUTH_USER_B,
            ),
            'A tab cannot see the changed shared storage',
          )
          holds.presentation.release()
          const save = page
            .getByLabel('Företagsnamn', { exact: true })
            .locator('..')
            .getByRole('button', { name: 'Spara', exact: true })
          const deadline = Date.now() + 10_000
          while (!(await save.isEnabled())) {
            assert(Date.now() < deadline, 'Queued intent never settled after the first write')
            await new Promise((resolve) => globalThis.setTimeout(resolve, 10))
          }
        } finally {
          await other.close()
        }
      } else {
        await page.getByRole('button', { name: 'Logga ut', exact: true }).first().click()
        await page.waitForFunction(() => globalThis.location.pathname === '/login')
        const login = await page.evaluate(async () =>
          (await import('/src/admin/auth.ts')).signIn('b@audit.invalid', 'Synthetic-password-123!'),
        )
        assert(login.ok && login.value.userId === AUTH_USER_B, 'Second user never signed in')
        await mountRealAdmin(page, 'site')
        holds.presentation.release()
        await page.getByLabel('Företagsnamn', { exact: true }).waitFor()
      }
      assert(
        !state.calls.some((call) => call.body?.key === 'business_name'),
        'Old A intent was sent under a later account',
      )
      assert(
        state.settings.get('business_name') === 'Synthetic Studio',
        'Old queued write mutated the inert ledger',
      )
      assert(
        state.settings.get('homepage_logo_scale') === 'xl',
        'In-flight A write was not reconciled before B read',
      )
    } else {
      await data.waitFor()
      if (scenario === 'focus') {
        await page.getByRole('button', { name: 'Avboka', exact: true }).first().click()
        await page.getByRole('dialog').waitFor()
      }
      if (scenario === 'network') {
        state.networkFailure = true
        await focus()
        await page.getByRole('status').filter({ hasText: 'Kunde inte nå servern' }).waitFor()
        assert(await data.isVisible(), 'Temporary network failure discarded the loaded view')
        assert(count('/auth/v1/logout') === 0, 'Network failure was treated as revocation')
        state.networkFailure = false
      }
      if (scenario === 'slow-signout') {
        await page.getByRole('button', { name: 'Logga ut', exact: true }).first().click()
        await waitCall((call) => call.path === '/auth/v1/logout')
        await data.waitFor({ state: 'detached' })
        holds.logout.release()
      } else if (scenario === 'auth-event') await signOut()
      else {
        state.enabled = false
        if (scenario === 'poll') await page.clock.runFor(30_010)
        else await focus()
      }
      await data.waitFor({ state: 'detached' })
      await page.waitForFunction(() => globalThis.location.pathname === '/login')
      assert((await page.getByRole('dialog').count()) === 0, 'Protected dialog survived revocation')
      assert(
        await page.evaluate(
          () =>
            !Object.keys(globalThis.sessionStorage).some((key) =>
              key.startsWith('knc-admin-navigation:'),
            ),
        ),
        'User navigation storage survived revocation',
      )
      const reads = count('/rest/v1/profiles')
      await focus()
      await page.clock.runFor(60_000)
      assert(
        count('/rest/v1/profiles') === reads,
        'Locked gate kept revalidating/reopening the old session',
      )
    }
    assert(state.errors.length === 0, `Admin ${scenario}: ${state.errors.join('; ')}`)
  } finally {
    for (const hold of Object.values(holds)) hold.release()
  }
}

async function verifyPrivacy(
  page,
  { width, height, lang, dark, blocked = false, dismissFirst = false },
) {
  await page.setViewportSize({ width, height })
  await page.emulateMedia({ colorScheme: dark ? 'dark' : 'light', reducedMotion: 'reduce' })
  if (blocked) {
    await page.addInitScript(() => {
      Object.defineProperty(globalThis.document, 'cookie', {
        configurable: true,
        get: () => '',
        set: () => {
          // Browser rejects persistence while the current App can still retain its choice.
        },
      })
    })
  }
  const origin = new URL(baseUrl).origin
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.routeWebSocket('**/*', (socket) => socket.close())
  await page.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const reply = (body, status = 200) =>
      route.fulfill({
        status,
        headers: {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': origin,
          'Access-Control-Allow-Headers': '*',
          'Access-Control-Allow-Methods': '*',
        },
        body: status === 204 ? undefined : JSON.stringify(body),
      })
    if (url.origin === origin && url.pathname === '/api/customer-bookings') {
      if (request.postDataJSON().action === 'forget_device') return reply({ ok: true })
      assert(request.postDataJSON().action === 'list', 'Privacy test attempted a customer mutation')
      return reply({ ok: false, error: 'access_denied' })
    }
    if (url.origin === origin) return route.continue()
    if (request.method() === 'OPTIONS') return reply(null, 204)
    if (url.pathname === '/rest/v1/rpc/public_booking_catalog')
      return reply({ barbers: [], services: [] })
    if (url.pathname === '/rest/v1/rpc/public_business_discovery')
      return reply({ settings: {}, barbers: [], services: [], schedules: [] })
    if (request.method() === 'GET' && url.pathname.startsWith('/rest/v1/')) return reply([])
    errors.push(`Unexpected privacy request: ${request.method()} ${url.origin}${url.pathname}`)
    return route.abort()
  })
  await page.goto(`${baseUrl}/tools/e2e/admin-harness.html`, { waitUntil: 'domcontentloaded' })
  const strings = await page.evaluate(async (lang) => {
    ;(await import('/tools/e2e/admin-harness.tsx')).mountPrivacyHarness()
    const { appStrings, privacyStrings, myBookingsStrings } = await import('/src/i18n/index.ts')
    return {
      app: appStrings(lang),
      privacy: privacyStrings(lang),
      bookings: myBookingsStrings(lang),
    }
  }, lang)
  if (lang === 'en') await page.getByRole('button', { name: 'EN', exact: true }).click()
  const notice = page.getByRole('region', { name: strings.privacy.title, exact: true })
  await notice.waitFor({ state: 'attached' })
  const choice = () =>
    page.evaluate(async () =>
      (await import('/src/site/storageConsent.ts')).readStoragePreferences(),
    )
  assert((await choice()) === null, 'Fresh visitor already had an optional-storage choice')
  const assertFixedNotice = async (context) => {
    assert(
      await notice.evaluate((element) => {
        const box = element.getBoundingClientRect()
        return (
          globalThis.getComputedStyle(element).position === 'fixed' &&
          box.top >= 0 &&
          box.bottom <= globalThis.innerHeight &&
          globalThis.innerHeight - box.bottom <= 36 &&
          !globalThis.document.querySelector('#om-oss')?.contains(element)
        )
      }),
      `Privacy panel is not fixed at the viewport bottom: ${context}`,
    )
  }
  await assertFixedNotice('initial hero')
  const heroManage = page.locator(`button[aria-label="${strings.privacy.manageLabel}"]`)
  assert((await heroManage.count()) === 0, 'Hero reopening control appeared before a choice')
  const book = page.getByRole('button', { name: strings.app.book, exact: true }).first()
  const appointments = page
    .getByRole('button', { name: strings.app.myBookings, exact: true })
    .first()
  // Ordinary locator clicks must scroll the real controls clear of the fixed notice.
  await appointments.click()
  await page.getByRole('dialog').waitFor()
  await page
    .getByRole('dialog')
    .getByRole('button', { name: strings.bookings.ariaClose, exact: true })
    .click()
  if (dismissFirst) {
    await notice.getByRole('button', { name: strings.privacy.reject, exact: true }).click()
    await notice.waitFor({ state: 'detached' })
    await appointments.click()
    await page.getByRole('dialog').waitFor()
    assert((await choice())?.functional === false, 'Dismissal lost the explicit rejection')
    assert(errors.length === 0, `Privacy dismissal: ${errors.join('; ')}`)
    return
  }
  await book.click()
  await page.getByTestId('booking-step-barber').waitFor()
  await assertFixedNotice('booking')
  assert((await heroManage.count()) === 0, 'Hero reopening control appeared in booking')
  assert((await choice()) === null, 'Opening booking changed storage permission')
  if (width < 768)
    await page.getByRole('button', { name: strings.app.ariaBackHome, exact: true }).click()
  else await book.click()
  await page.getByRole('button', { name: strings.app.aboutLink, exact: true }).click()
  const manage = page.getByRole('link', { name: strings.privacy.manageLabel, exact: true })
  await manage.scrollIntoViewIfNeeded()
  await assertFixedNotice('About')
  if (width < 768) {
    await page.getByRole('button', { name: strings.app.ariaBackHome, exact: true }).click()
    await page.waitForFunction(
      () =>
        globalThis.document.querySelector('[data-testid="mobile-site-scroll"]')?.scrollTop === 0,
    )
    assert((await choice()) === null, 'Back navigation required an optional-storage choice')
    await appointments.click()
    await page.getByRole('dialog').waitFor()
    await page
      .getByRole('dialog')
      .getByRole('button', { name: strings.bookings.ariaClose, exact: true })
      .click()
    await page.getByRole('button', { name: strings.app.aboutLink, exact: true }).click()
    await manage.scrollIntoViewIfNeeded()
    await assertFixedNotice('About after Back navigation')
  }
  await manage.focus()
  await page.keyboard.press('Enter')
  const heading = notice.getByRole('heading', { name: strings.privacy.title, exact: true })
  await page.waitForFunction(() => globalThis.document.activeElement?.tagName === 'H2')
  await assertFixedNotice('preferences opened from About')
  assert(
    await heading.evaluate((element) => {
      const box = element.getBoundingClientRect()
      return box.top >= 0 && box.bottom < globalThis.innerHeight
    }),
    'Reopened privacy heading was outside the viewport',
  )
  const functional = notice.locator('input[type="checkbox"]')
  assert(!(await functional.isChecked()), 'No-choice preferences started accepted')
  await functional.check()
  await notice.getByRole('button', { name: strings.privacy.save, exact: true }).click()
  await notice.waitFor({ state: 'detached' })
  assert((await choice())?.functional === true, 'Explicit acceptance did not reach shared getter')
  await page.waitForFunction(
    (label) => globalThis.document.activeElement?.getAttribute('aria-label') === label,
    strings.privacy.manageLabel,
  )
  assert(
    await heroManage.evaluate((element) => {
      const box = element.getBoundingClientRect()
      return (
        globalThis.getComputedStyle(element).position === 'absolute' &&
        !globalThis.document.querySelector('#om-oss')?.contains(element) &&
        (element.closest('[inert]') !== null ||
          box.bottom <= 0 ||
          box.top >= globalThis.innerHeight)
      )
    }),
    'Hero reopening control followed the visitor into About',
  )
  const cookies = await page.context().cookies()
  assert(
    cookies.some((cookie) => cookie.name === 'bladeblend_storage_preferences') === !blocked,
    'Preference persistence did not match the cookie policy',
  )

  // Same App state survives the desktop/mobile boundary, including blocked-cookie sessions.
  await page.setViewportSize({ width: width < 768 ? 1280 : 390, height: 844 })
  await page.getByTestId(width < 768 ? 'desktop-top-panel' : 'mobile-site-scroll').waitFor()
  assert((await notice.count()) === 0, 'Changing layout forgot the saved choice')
  await manage.scrollIntoViewIfNeeded()
  await manage.click()
  await functional.waitFor()
  await assertFixedNotice('preferences after layout change')
  assert(await functional.isChecked(), 'Reopening after layout change lost accepted choice')
  await functional.uncheck()
  await notice.getByRole('button', { name: strings.privacy.save, exact: true }).click()
  await notice.waitFor({ state: 'detached' })
  assert((await choice())?.functional === false, 'Explicit rejection became no choice')
  await page.evaluate(() => {
    globalThis.document.querySelector('[data-testid="mobile-site-scroll"]')?.scrollTo({ top: 0 })
    globalThis.scrollTo({ top: 0 })
  })
  await heroManage.click()
  await functional.waitFor()
  assert(!(await functional.isChecked()), 'Hero control lost the rejected preference')
  await assertFixedNotice('preferences from hero control')
  await notice.getByRole('button', { name: strings.privacy.save, exact: true }).click()
  await notice.waitFor({ state: 'detached' })
  await book.click()
  await page.getByTestId('booking-step-barber').waitFor()
  assert((await heroManage.count()) === 0, 'Hero reopening control remained in booking')
  assert(errors.length === 0, `Privacy ${width}/${lang}: ${errors.join('; ')}`)
}

const privacyCases = [
  { width: 320, height: 568, lang: 'sv', dark: false },
  { width: 390, height: 844, lang: 'sv', dark: true },
  { width: 360, height: 800, lang: 'en', dark: false, blocked: true },
  { width: 1280, height: 720, lang: 'en', dark: true },
  { width: 390, height: 844, lang: 'sv', dark: false, dismissFirst: true },
]

const browser = await chromium.launch()
let passed = 0
try {
  for (const verify of [
    verifyNavigation,
    verifyDelayedRestore,
    verifyPresentationDraft,
    ...[
      'focus',
      'poll',
      'auth-event',
      'slow-signout',
      'late-profile',
      'late-password',
      'password-completes',
      'late-settings-password',
      'queued-write',
      'notification-gap',
      'late-reset-logout',
      'network',
    ].map((scenario) => (page) => verifyAdminSession(page, scenario)),
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
    ...privacyCases.map((options) => (page) => verifyPrivacy(page, options)),
  ]) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
    const page = await context.newPage()
    page.setDefaultTimeout(10_000)
    try {
      await verify(page)
      passed++
    } finally {
      await context.close()
    }
  }
  console.log(
    `Browser regressions passed (${passed} scenarios): history, draft publish, admin lifecycle/ordering, hydration, customer identity, delayed catalog and responsive privacy controls.`,
  )
} finally {
  await browser.close()
}

for (const engine of [firefox, webkit]) {
  const browser = await engine.launch()
  try {
    for (const options of privacyCases) {
      const page = await browser.newPage()
      page.setDefaultTimeout(10_000)
      try {
        await verifyPrivacy(page, options)
      } finally {
        await page.close()
      }
    }
    console.log(`Responsive privacy passed (${privacyCases.length} scenarios): ${engine.name()}.`)
  } finally {
    await browser.close()
  }
}

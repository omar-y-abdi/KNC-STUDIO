import { chromium, firefox, webkit } from 'playwright'

const baseUrl = (process.env.BASE_URL ?? 'http://127.0.0.1:4188').replace(/\/$/, '')
const scenario = process.env.ADMIN_E2E_SCENARIO ?? 'all'
if (!['all', 'cms-shell'].includes(scenario)) throw new Error('Unsupported admin E2E scenario')

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

async function mountCmsStudio(page) {
  const { nativeBackend } = await import('./cms-native.mjs')
  await nativeBackend(page.context())
  const origin = new URL(baseUrl).origin
  const requests = []
  const browserErrors = []
  page.on('request', (request) => {
    if (request.url().startsWith('https://admin-harness.invalid/'))
      requests.push(`${request.method()} ${request.url()}`)
  })
  page.on('pageerror', (error) => browserErrors.push(error.message))
  page.on('console', (message) => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  await page.route('https://admin-harness.invalid/**', async (route) => {
    const request = route.request()
    const headers = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': 'authorization,apikey,content-type,x-client-info',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Content-Type': 'application/json',
    }
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
    const url = new URL(request.url())
    if (url.pathname === '/functions/v1/cms-studio') {
      const body = request.postDataJSON()
      if (body?.operation === 'state')
        return route.fulfill({
          status: 200,
          headers,
          body: JSON.stringify({
            revision: 1,
            fingerprint: 'cms-shell-e2e',
            assets: [],
            document: {
              schema: 1,
              site: {},
              about: {},
              settings: {},
              barbers: [],
              photos: {},
              gallery: [],
              emails: [],
              presentation: {
                copy: {},
                styles: {},
                images: {},
                themes: { light: {}, dark: {} },
                pages: [],
                regions: {},
              },
            },
          }),
        })
      if (body?.operation === 'history')
        return route.fulfill({ status: 200, headers, body: JSON.stringify({ items: [] }) })
      throw new Error(`Unexpected CMS shell operation: ${JSON.stringify(body)}`)
    }
    return route.fallback()
  })
  await page.goto(`${baseUrl}/tools/e2e/admin-harness.html?view=cms-studio`, {
    waitUntil: 'domcontentloaded',
  })
  await page.evaluate(async () => {
    const harness = await import('/tools/e2e/admin-harness.tsx')
    harness.mountCmsStudioHarness()
  })
  try {
    await page.locator('.cms-canvas-shell').waitFor({ state: 'visible' })
  } catch (error) {
    const notice = await page.locator('.cms-notice').allTextContents()
    const body = await page
      .locator('body')
      .innerText()
      .catch(() => '')
    throw new Error(
      `CMS studio did not mount: ${error.message}; notice=${JSON.stringify(notice)}; requests=${JSON.stringify(requests)}; browserErrors=${JSON.stringify(browserErrors)}; body=${JSON.stringify(body.slice(0, 1200))}`,
    )
  }
}

async function verifyCmsStudioShell(page) {
  await page.setViewportSize({ width: 390, height: 844 })
  await mountCmsStudio(page)
  assert(
    JSON.stringify(await page.evaluate(() => [globalThis.innerWidth, globalThis.innerHeight])) ===
      JSON.stringify([390, 844]),
    'CMS studio did not run at the real phone-sized viewport',
  )

  const tools = page.getByRole('navigation', { name: 'Mobilverktyg' })
  const pages = tools.getByRole('button', { name: 'Sidor', exact: true })
  const properties = tools.getByRole('button', { name: 'Egenskaper', exact: true })
  const library = page.locator('#cms-library')
  const inspector = page.locator('#cms-inspector')
  await tools.waitFor({ state: 'visible' })
  assert(!(await library.isVisible()), 'Mobile CMS library starts open')
  assert(!(await inspector.isVisible()), 'Mobile CMS inspector starts open')

  await pages.click()
  assert(await library.isVisible(), 'Sidor did not open the mobile library drawer')
  assert(!(await inspector.isVisible()), 'Opening Sidor also opened Egenskaper')
  await properties.click()
  assert(!(await library.isVisible()), 'Opening Egenskaper left Sidor open')
  assert(await inspector.isVisible(), 'Egenskaper did not open the mobile inspector drawer')

  const tabs = page.getByRole('tablist', { name: 'Egenskapspanel' })
  for (const name of ['Design', 'Lager', 'Lägg till']) {
    const tab = tabs.getByRole('tab', { name, exact: true })
    await tab.click()
    assert((await tab.getAttribute('aria-selected')) === 'true', `${name} is not touch-usable`)
  }

  const commandbar = page.locator('.cms-bottom')
  await commandbar.waitFor({ state: 'visible' })
  for (const name of ['Ångra', 'Gör om', 'Publicera', 'Revert', 'Historik', 'Lås vy']) {
    const button = commandbar.getByRole('button', { name, exact: true })
    assert((await button.count()) === 1, `Bottom command bar is missing ${name}`)
    await button.scrollIntoViewIfNeeded()
    assert(await button.isVisible(), `Bottom command ${name} is not reachable on mobile`)
  }
  const box = await commandbar.boundingBox()
  assert(
    box !== null && box.y >= 0 && box.y + box.height <= 844,
    `Mobile command bar escaped the viewport: ${JSON.stringify(box)}`,
  )

  await page.getByRole('button', { name: 'Stäng panel', exact: true }).click()
  assert(!(await inspector.isVisible()), 'Backdrop did not close the mobile inspector')

  await page.setViewportSize({ width: 1280, height: 900 })
  const geometry = await page.evaluate(() => {
    const library = globalThis.document.querySelector('#cms-library')?.getBoundingClientRect()
    const canvas = globalThis.document.querySelector('.cms-editor-canvas')?.getBoundingClientRect()
    const inspector = globalThis.document.querySelector('#cms-inspector')?.getBoundingClientRect()
    if (!library || !canvas || !inspector) return null
    return {
      libraryRight: library.right,
      canvasLeft: canvas.left,
      canvasRight: canvas.right,
      inspectorLeft: inspector.left,
    }
  })
  assert(
    geometry !== null &&
      geometry.libraryRight <= geometry.canvasLeft &&
      geometry.canvasRight <= geometry.inspectorLeft,
    `Desktop CMS is not left-library / canvas / right-inspector: ${JSON.stringify(geometry)}`,
  )
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
  const readMutation = await page.evaluateHandle(
    async () => (await import('/tools/e2e/admin-harness.tsx')).adminMutationControl,
  )
  await page.waitForFunction((read) => read('snapshot').writes === 1, readMutation)
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
    await page.waitForFunction((read) => read('snapshot').writes === 2, readMutation)
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
  await readMutation.dispose()
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
    const readHydration = await page.evaluateHandle(
      async () => (await import('/tools/e2e/admin-harness.tsx')).adminHydrationControl,
    )
    await control.selectOption('sm')
    await page.waitForFunction((read) => read('snapshot').writes === 1, readHydration)
    assert(await control.isDisabled(), 'About autosave permits out-of-order writes')
    await hydrationControl(page, 'write')
    await page.waitForFunction(
      () =>
        ![...globalThis.document.querySelectorAll('select')].find((select) => select.value === 'sm')
          ?.disabled,
    )
    await control.selectOption('xl')
    await page.waitForFunction((read) => read('snapshot').writes === 2, readHydration)
    await readHydration.dispose()
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

async function verifyBookingTerms(page, lang) {
  await page.setViewportSize(
    lang === 'sv' ? { width: 320, height: 568 } : { width: 1280, height: 720 },
  )
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page
    .context()
    .route('**/terms', (route) =>
      route.fulfill({ contentType: 'text/html', body: '<h1>Terms destination</h1>' }),
    )
  await page.goto(`${baseUrl}/tools/e2e/admin-harness.html`, { waitUntil: 'domcontentloaded' })
  const strings = await page.evaluate(async (lang) => {
    ;(await import('/tools/e2e/admin-harness.tsx')).mountContactHarness('booking', lang)
    return (await import('/src/i18n/index.ts')).bookingStrings(lang)
  }, lang)
  const barber = page.getByTestId('booking-barber-option')
  await barber.focus()
  await page.keyboard.press('Enter')
  assert(
    (await barber.getAttribute('aria-pressed')) === 'true',
    'Keyboard barber selection is not exposed',
  )
  await page.getByRole('button', { name: /14 september 2026/i }).click()
  await page.getByTestId('booking-service-option').click()
  await page.getByRole('button', { name: '10:00', exact: true }).click()
  const dialog = page.getByRole('dialog')
  const name = dialog.locator('input[type="text"]')
  await name.fill('Preserved booking draft')
  const link = dialog.getByRole('link', { name: strings.termsLinkLabel, exact: true })
  assert(
    (await link.getAttribute('href')) === '/terms' &&
      (await link.getAttribute('target')) === '_blank',
    'Final booking terms do not preserve the draft in a separate tab',
  )
  const opened = page.waitForEvent('popup')
  await link.focus()
  await page.keyboard.press('Enter')
  const popup = await opened
  await popup.getByRole('heading', { name: 'Terms destination' }).waitFor()
  await popup.close()
  assert(
    (await name.inputValue()) === 'Preserved booking draft',
    'Reading terms lost the booking draft',
  )
}

function calendarStatusResult(overrides = {}) {
  return {
    ok: true,
    value: {
      connected: false,
      disconnectPending: false,
      repairRequired: false,
      googleEmail: null,
      lastSyncError: null,
      ...overrides,
    },
  }
}

function calendarErrorResult(message = 'Synthetic Calendar status failure') {
  return { ok: false, error: { kind: 'network', message } }
}

async function mountCalendarHarness(page, lang = 'en', mode = 'component') {
  // Preact schedules passive effects through the module's original timer reference. Let the first
  // effect run on a resumed fake clock, then pause at the observed instant before exact timer checks.
  await page.clock.resume()
  await page.goto(`${baseUrl}/tools/e2e/admin-harness.html`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(
    async ({ lang: currentLang, mode: currentMode }) =>
      (await import('/tools/e2e/admin-harness.tsx')).mountCalendarHarness(currentLang, currentMode),
    { lang, mode },
  )
  await page.getByTestId('calendar-harness').waitFor()
  await waitCalendarCalls(page, 'statusCalls', 'a', 1, 'initial Calendar status read missing')
  await page.clock.pauseAt(await page.evaluate(() => Date.now()))
  return page.evaluate(async (currentLang) => {
    const { adminText } = await import('/src/i18n/adminStrings.ts')
    return adminText(currentLang)
  }, lang)
}

async function calendarControl(page, action, port = 'a', index = 0, result) {
  const snapshot = await page.evaluate(
    async ({
      action: currentAction,
      port: currentPort,
      index: currentIndex,
      result: currentResult,
    }) =>
      (await import('/tools/e2e/admin-harness.tsx')).calendarControl(
        currentAction,
        currentPort,
        currentIndex,
        currentResult,
      ),
    { action, port, index, result },
  )
  if (action !== 'snapshot') await page.clock.fastForward(1)
  return snapshot
}

async function calendarCalls(page, field, port) {
  const snapshot = await calendarControl(page, 'snapshot')
  return snapshot?.[field]?.[port] ?? 0
}

async function waitCalendarCalls(page, field, port, count, label) {
  const control = await page.evaluateHandle(
    async () => (await import('/tools/e2e/admin-harness.tsx')).calendarControl,
  )
  try {
    await page.waitForFunction(
      ({ control: read, field: currentField, port: currentPort, count: expected }) => {
        const snapshot = read('snapshot')
        return (snapshot?.[currentField]?.[currentPort] ?? 0) >= expected
      },
      { control, field, port, count },
      { timeout: 5_000 },
    )
  } catch {
    throw new Error(`${label}: ${JSON.stringify(await calendarControl(page, 'snapshot'))}`)
  } finally {
    await control.dispose()
  }
}

async function setCalendarVisibility(page, state) {
  await page.evaluate((next) => {
    Object.defineProperty(globalThis.document, 'visibilityState', {
      configurable: true,
      value: next,
    })
    globalThis.document.dispatchEvent(new globalThis.Event('visibilitychange'))
  }, state)
}

async function verifyCalendarSync(page) {
  await page.clock.install({ time: new Date('2026-01-01T00:00:00.000Z') })

  // Disconnect acknowledgement is immediately visible as pending, then the authoritative status
  // read and the visible 15s poll are the only paths that may clear it.
  {
    const t = await mountCalendarHarness(page)
    await waitCalendarCalls(page, 'statusCalls', 'a', 1, 'initial Calendar status read missing')
    await calendarControl(
      page,
      'resolve-status',
      'a',
      0,
      calendarStatusResult({ connected: true, googleEmail: 'barber@example.test' }),
    )
    await page.getByRole('status').filter({ hasText: t.calendarConnected }).waitFor()
    await page.getByRole('button', { name: t.calendarDisconnect, exact: true }).click()
    await waitCalendarCalls(page, 'disconnectCalls', 'a', 1, 'disconnect mutation missing')
    await calendarControl(page, 'resolve-disconnect', 'a', 0, { ok: true })
    await page.getByRole('status').filter({ hasText: t.calendarDisconnecting }).waitFor()
    await waitCalendarCalls(
      page,
      'statusCalls',
      'a',
      2,
      'acknowledged disconnect did not refresh status',
    )
    await calendarControl(
      page,
      'resolve-status',
      'a',
      1,
      calendarStatusResult({ disconnectPending: true }),
    )
    await page.getByRole('status').filter({ hasText: t.calendarDisconnecting }).waitFor()
    assert(
      (await calendarCalls(page, 'statusCalls', 'a')) === 2,
      `Calendar status read unexpectedly duplicated before the 15s poll: ${JSON.stringify(await calendarControl(page, 'snapshot'))}`,
    )
    // calendarControl advances one millisecond to flush Preact; the interval began at the
    // acknowledgement tick, so 14_998 more milliseconds is the strict pre-15s boundary.
    await page.clock.fastForward(14_998)
    const beforePoll = await calendarCalls(page, 'statusCalls', 'a')
    assert(
      beforePoll === 2,
      `Calendar pending poll ran before its visible 15s deadline: ${JSON.stringify(await calendarControl(page, 'snapshot'))}`,
    )
    await page.clock.fastForward(1)
    await waitCalendarCalls(page, 'statusCalls', 'a', 3, 'visible 15s Calendar poll missing')
    await calendarControl(page, 'resolve-status', 'a', 2, calendarStatusResult())
    await page.getByRole('button', { name: t.calendarConnect, exact: true }).waitFor()
  }

  // Hidden pages do not poll. Returning to visible and receiving focus each request a fresh read.
  {
    const t = await mountCalendarHarness(page)
    await waitCalendarCalls(page, 'statusCalls', 'a', 1, 'visibility scenario initial read missing')
    await calendarControl(
      page,
      'resolve-status',
      'a',
      0,
      calendarStatusResult({ disconnectPending: true }),
    )
    await page.getByRole('status').filter({ hasText: t.calendarDisconnecting }).waitFor()
    await setCalendarVisibility(page, 'hidden')
    await page.clock.fastForward(30_000)
    assert(
      (await calendarCalls(page, 'statusCalls', 'a')) === 1,
      'Hidden Calendar page continued polling',
    )
    await setCalendarVisibility(page, 'visible')
    await waitCalendarCalls(
      page,
      'statusCalls',
      'a',
      2,
      'visibilitychange did not refresh Calendar',
    )
    await calendarControl(
      page,
      'resolve-status',
      'a',
      1,
      calendarStatusResult({ disconnectPending: true }),
    )
    await page.waitForTimeout(0)
    await page.evaluate(() => globalThis.window.dispatchEvent(new globalThis.Event('focus')))
    await waitCalendarCalls(page, 'statusCalls', 'a', 3, 'focus did not refresh Calendar')
    await calendarControl(
      page,
      'resolve-status',
      'a',
      2,
      calendarStatusResult({ disconnectPending: true }),
    )
  }

  // An initial status failure must remain unknown and offer retry. A later read failure preserves
  // the last known status while exposing the localized status error.
  {
    const t = await mountCalendarHarness(page)
    await waitCalendarCalls(page, 'statusCalls', 'a', 1, 'status-error initial read missing')
    await calendarControl(page, 'resolve-status', 'a', 0, calendarErrorResult())
    await page.getByRole('status').filter({ hasText: t.calendarStatusUnavailable }).waitFor()
    await page.getByRole('alert').filter({ hasText: t.calendarStatusError }).waitFor()
    await page.getByRole('button', { name: t.calendarRefresh, exact: true }).waitFor()
    assert(
      (await page.getByRole('button', { name: t.calendarConnect, exact: true }).count()) === 0 &&
        (await page.getByRole('button', { name: t.calendarDisconnect, exact: true }).count()) === 0,
      'Initial Calendar status error exposed a false connected/disconnected action',
    )
    await page.getByRole('button', { name: t.calendarRefresh, exact: true }).click()
    await waitCalendarCalls(page, 'statusCalls', 'a', 2, 'Calendar retry did not read status')
    await calendarControl(page, 'resolve-status', 'a', 1, calendarStatusResult())
    await page.getByRole('button', { name: t.calendarConnect, exact: true }).waitFor()
    assert(
      (await page.getByRole('alert').count()) === 0,
      'Recovered Calendar status kept the error',
    )
    await page.evaluate(() => globalThis.window.dispatchEvent(new globalThis.Event('focus')))
    await waitCalendarCalls(page, 'statusCalls', 'a', 3, 'later Calendar status read missing')
    await calendarControl(
      page,
      'resolve-status',
      'a',
      2,
      calendarErrorResult('Later status failure'),
    )
    await page.getByRole('alert').filter({ hasText: t.calendarStatusError }).waitFor()
    await page.getByRole('button', { name: t.calendarConnect, exact: true }).waitFor()
    await page.getByRole('status').filter({ hasText: 'Google Calendar' }).waitFor()
  }

  // A read has a 10s deadline and late completion cannot resurrect a stale status. Retry recovers.
  {
    await mountCalendarHarness(page, 'en', 'hook')
    await waitCalendarCalls(page, 'statusCalls', 'a', 1, 'deadline initial read missing')
    await page.clock.fastForward(9_000)
    assert(
      (await page.getByTestId('calendar-loading').textContent()) === 'true',
      'Calendar status read timed out before 10s',
    )
    // The read starts in the passive effect just before the helper pauses the clock; allow a small
    // deterministic margin after the 10s deadline without weakening the 9s pre-deadline assertion.
    await page.clock.fastForward(2_000)
    await page.waitForFunction(
      () =>
        globalThis.document.querySelector('[data-testid="calendar-loading"]')?.textContent ===
          'false' &&
        globalThis.document.querySelector('[data-testid="calendar-error"]')?.textContent ===
          'status',
    )
    assert(
      (await page.getByTestId('calendar-connected').textContent()) === 'unknown',
      'Timed-out Calendar read invented a disconnected state',
    )
    await calendarControl(
      page,
      'resolve-status',
      'a',
      0,
      calendarStatusResult({ connected: true, googleEmail: 'late@example.test' }),
    )
    await page.waitForTimeout(100)
    assert(
      (await page.getByTestId('calendar-connected').textContent()) === 'unknown',
      'Late timed-out Calendar response wrote back into state',
    )
    await calendarControl(page, 'invoke-refresh')
    await waitCalendarCalls(page, 'statusCalls', 'a', 2, 'deadline retry read missing')
    await calendarControl(page, 'resolve-status', 'a', 1, calendarStatusResult())
    await page.waitForFunction(
      () =>
        globalThis.document.querySelector('[data-testid="calendar-connected"]')?.textContent ===
        'false',
    )
  }

  // Reads coalesce and are fenced against an action. Port A -> B and unmount also fence late data.
  {
    await mountCalendarHarness(page, 'en', 'hook')
    await waitCalendarCalls(page, 'statusCalls', 'a', 1, 'race initial read missing')
    await calendarControl(page, 'resolve-status', 'a', 0, calendarStatusResult({ connected: true }))
    await page.waitForFunction(
      () =>
        globalThis.document.querySelector('[data-testid="calendar-connected"]')?.textContent ===
        'true',
    )
    await calendarControl(page, 'invoke-refresh')
    await calendarControl(page, 'invoke-refresh')
    await waitCalendarCalls(page, 'statusCalls', 'a', 2, 'coalesced Calendar read missing')
    assert(
      (await calendarCalls(page, 'statusCalls', 'a')) === 2,
      'Two same-turn Calendar refreshes started two status reads',
    )
    await calendarControl(page, 'invoke-disconnect')
    await waitCalendarCalls(page, 'disconnectCalls', 'a', 1, 'hook disconnect mutation missing')
    await calendarControl(page, 'resolve-disconnect', 'a', 0, { ok: true })
    await page.waitForFunction(
      () =>
        globalThis.document.querySelector('[data-testid="calendar-pending"]')?.textContent ===
        'true',
    )
    await waitCalendarCalls(
      page,
      'statusCalls',
      'a',
      3,
      'hook disconnect acknowledgement read missing',
    )
    await calendarControl(page, 'resolve-status', 'a', 1, calendarStatusResult({ connected: true }))
    await page.waitForTimeout(100)
    assert(
      (await page.getByTestId('calendar-pending').textContent()) === 'true',
      'Stale read before disconnect overwrote acknowledged pending state',
    )
    await calendarControl(
      page,
      'resolve-status',
      'a',
      2,
      calendarStatusResult({ disconnectPending: true }),
    )
    await calendarControl(page, 'invoke-refresh')
    await waitCalendarCalls(page, 'statusCalls', 'a', 4, 'port-race pending read missing')
    await page.clock.resume()
    await calendarControl(page, 'switch-port', 'b')
    await page.waitForTimeout(25)
    await page.clock.pauseAt(await page.evaluate(() => Date.now()))
    await waitCalendarCalls(page, 'statusCalls', 'b', 1, 'port B initial read missing')
    await calendarControl(page, 'resolve-status', 'b', 0, calendarStatusResult())
    await page.waitForFunction(
      () =>
        globalThis.document.querySelector('[data-testid="calendar-connected"]')?.textContent ===
        'false',
    )
    await calendarControl(page, 'resolve-status', 'a', 3, calendarStatusResult({ connected: true }))
    await page.waitForTimeout(100)
    assert(
      (await page.getByTestId('calendar-connected').textContent()) === 'false',
      'Late port A Calendar response overwrote port B state',
    )
    await page.clock.resume()
    await calendarControl(page, 'switch-port', 'a')
    await page.waitForTimeout(25)
    await page.clock.pauseAt(await page.evaluate(() => Date.now()))
    await waitCalendarCalls(page, 'statusCalls', 'a', 5, 'port A remount read missing')
    await calendarControl(page, 'unmount')
    await calendarControl(page, 'resolve-status', 'a', 4, calendarStatusResult({ connected: true }))
    await page.waitForTimeout(100)
    assert(
      (await page.getByTestId('calendar-harness').count()) === 0,
      'Calendar late response recreated UI after unmount',
    )
  }

  // A late connect URL may not navigate after a port switch or unmount. A fresh port may still
  // start its own action independently.
  {
    await mountCalendarHarness(page, 'en', 'hook')
    await waitCalendarCalls(page, 'statusCalls', 'a', 1, 'connect-race initial read missing')
    await calendarControl(page, 'resolve-status', 'a', 0, calendarStatusResult())
    await page.waitForFunction(
      () =>
        globalThis.document.querySelector('[data-testid="calendar-connected"]')?.textContent ===
        'false',
    )
    await calendarControl(page, 'invoke-connect')
    await waitCalendarCalls(page, 'connectCalls', 'a', 1, 'connect-race mutation missing')
    const beforeSwitch = page.url()
    await page.clock.resume()
    await calendarControl(page, 'switch-port', 'b')
    await page.waitForTimeout(25)
    await page.clock.pauseAt(await page.evaluate(() => Date.now()))
    await waitCalendarCalls(page, 'statusCalls', 'b', 1, 'connect-race port B read missing')
    await calendarControl(page, 'resolve-status', 'b', 0, calendarStatusResult())
    await calendarControl(page, 'resolve-connect', 'a', 0, {
      ok: true,
      value: 'https://accounts.google.com/o/oauth2/authorize?synthetic=stale',
    })
    await page.waitForTimeout(100)
    assert(page.url() === beforeSwitch, 'Late port A connect URL navigated after port switch')

    await calendarControl(page, 'invoke-connect')
    await waitCalendarCalls(page, 'connectCalls', 'b', 1, 'port B connect mutation missing')
    await calendarControl(page, 'unmount')
    await calendarControl(page, 'resolve-connect', 'b', 0, {
      ok: true,
      value: 'https://accounts.google.com/o/oauth2/authorize?synthetic=unmounted',
    })
    await page.waitForTimeout(100)
    assert(page.url() === beforeSwitch, 'Late connect URL navigated after component unmount')
  }

  // Action guards are synchronous and action promises have no read deadline/overlap timeout.
  {
    const t = await mountCalendarHarness(page)
    await waitCalendarCalls(page, 'statusCalls', 'a', 1, 'connect guard initial read missing')
    await calendarControl(page, 'resolve-status', 'a', 0, calendarStatusResult())
    await page.getByRole('button', { name: t.calendarConnect, exact: true }).waitFor()
    await page.evaluate((label) => {
      const button = [...globalThis.document.querySelectorAll('button')].find(
        (candidate) => candidate.textContent === label,
      )
      button?.click()
      button?.click()
    }, t.calendarConnect)
    await waitCalendarCalls(page, 'connectCalls', 'a', 1, 'connect mutation missing')
    assert(
      (await calendarCalls(page, 'connectCalls', 'a')) === 1,
      'Two same-turn connect clicks started two mutations',
    )
    await page.clock.fastForward(10_000)
    assert(
      (await calendarCalls(page, 'connectCalls', 'a')) === 1,
      'Connect action was replaced after a 10s deadline',
    )
    await calendarControl(page, 'resolve-connect', 'a', 0, calendarErrorResult('connect failed'))
    await page.getByRole('alert').filter({ hasText: t.calendarActionError }).waitFor()

    const disconnectT = await mountCalendarHarness(page)
    await waitCalendarCalls(page, 'statusCalls', 'a', 1, 'disconnect guard initial read missing')
    await calendarControl(
      page,
      'resolve-status',
      'a',
      0,
      calendarStatusResult({ connected: true, googleEmail: 'barber@example.test' }),
    )
    await page.getByRole('button', { name: disconnectT.calendarDisconnect, exact: true }).waitFor()
    await page.evaluate((label) => {
      const button = [...globalThis.document.querySelectorAll('button')].find(
        (candidate) => candidate.textContent === label,
      )
      button?.click()
      button?.click()
    }, disconnectT.calendarDisconnect)
    await waitCalendarCalls(page, 'disconnectCalls', 'a', 1, 'disconnect mutation missing')
    assert(
      (await calendarCalls(page, 'disconnectCalls', 'a')) === 1,
      'Two same-turn disconnect clicks started two mutations',
    )
    await page.clock.fastForward(10_000)
    assert(
      (await calendarCalls(page, 'disconnectCalls', 'a')) === 1,
      'Disconnect action was replaced after a 10s deadline',
    )
    await calendarControl(
      page,
      'resolve-disconnect',
      'a',
      0,
      calendarErrorResult('disconnect failed'),
    )
    await page.getByRole('alert').filter({ hasText: disconnectT.calendarActionError }).waitFor()
  }
}

function customerVerifiedResult(email = 'source@example.test', aliases = [email]) {
  return {
    ok: true,
    authority: 'verified',
    bookings: { upcoming: [], past: [] },
    profile: {
      name: 'Verified Customer',
      phone: '0701234567',
      email,
      emails: aliases,
      phones: ['0701234567'],
    },
  }
}

function customerDeviceResult() {
  return {
    ok: true,
    authority: 'device',
    bookings: { upcoming: [], past: [] },
  }
}

function customerUpcomingResult(email = 'source@example.test') {
  return {
    ...customerVerifiedResult(email),
    bookings: {
      upcoming: [
        {
          id: 'customer-booking-a',
          barber: { id: 'customer-barber', name: 'Test Barber', ig: '' },
          serviceName: 'Haircut',
          price: 300,
          durationMin: 30,
          start: '2026-09-14T10:00:00.000Z',
          whenLabel: 'Monday 14 September at 10:00',
        },
      ],
      past: [],
    },
  }
}

function customerErrorResult(error = 'system') {
  return { ok: false, error }
}

let customerHarnessVisit = 0

async function mountCustomerHarness(page, lang = 'en', code, accessToken = '') {
  await page.setViewportSize({ width: 320, height: 568 })
  customerHarnessVisit += 1
  await page.goto(
    `${baseUrl}/tools/e2e/admin-harness.html?customer-harness=${customerHarnessVisit}`,
    { waitUntil: 'domcontentloaded' },
  )
  await page.evaluate(
    async ({ lang: currentLang, code: currentCode, accessToken: currentToken }) =>
      (await import('/tools/e2e/admin-harness.tsx')).mountCustomerHarness(
        currentLang,
        currentCode,
        currentToken,
      ),
    { lang, code, accessToken },
  )
  await page.getByRole('dialog').waitFor()
  await waitCustomerCalls(page, 'listCalls', 'a', 1, 'customer initial list read missing')
}

async function customerControl(page, action, port = 'a', index = 0, result) {
  const snapshot = await page.evaluate(
    async ({
      action: currentAction,
      port: currentPort,
      index: currentIndex,
      result: currentResult,
    }) =>
      (await import('/tools/e2e/admin-harness.tsx')).customerControl(
        currentAction,
        currentPort,
        currentIndex,
        currentResult,
      ),
    { action, port, index, result },
  )
  await page.waitForTimeout(0)
  return snapshot
}

async function customerSnapshot(page) {
  return customerControl(page, 'snapshot')
}

async function waitCustomerCalls(page, field, port, count, label) {
  // Import before polling: a Promise itself is truthy to Playwright's polling predicate.
  const control = await page.evaluateHandle(
    async () => (await import('/tools/e2e/admin-harness.tsx')).customerControl,
  )
  try {
    await page.waitForFunction(
      ({ control: read, field: currentField, port: currentPort, count: expected }) => {
        const snapshot = read('snapshot')
        return (snapshot?.[currentField]?.[currentPort] ?? 0) >= expected
      },
      { control, field, port, count },
      { timeout: 5_000 },
    )
  } catch {
    throw new Error(`${label}: ${JSON.stringify(await customerSnapshot(page))}`)
  } finally {
    await control.dispose()
  }
}

async function installCustomerAppRoutes(page) {
  const origin = new URL(baseUrl).origin
  const actions = []
  const consoleOutput = []
  const pageErrors = []
  page.on('console', (message) => consoleOutput.push(message.text()))
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const reply = (body, status = 200) =>
      route.fulfill({
        status,
        headers: { 'Content-Type': 'application/json' },
        body: status === 204 ? undefined : JSON.stringify(body),
      })
    if (url.origin === origin && url.pathname === '/api/customer-bookings') {
      const body = request.postDataJSON()
      actions.push(body)
      if (body.action === 'list')
        return reply({
          ok: true,
          authority: 'verified',
          session_proof: 'a'.repeat(64),
          name: 'Verified Customer',
          phone: '0701234567',
          email: 'source@example.test',
          emails: ['source@example.test', 'old@example.test'],
          phones: ['0701234567'],
          bookings: [],
        })
      if (body.action === 'confirm_link') return reply({ ok: true, status: 'waiting' })
      if (body.action === 'request_link') return reply({ ok: true, status: 'queued' })
      return reply({ ok: false, error: 'access_denied' })
    }
    if (url.origin === origin) return route.continue()
    if (request.method() === 'OPTIONS') return reply(null, 204)
    if (url.pathname === '/rest/v1/rpc/public_booking_catalog')
      return reply({
        barbers: [],
        services: [],
      })
    if (url.pathname === '/rest/v1/rpc/public_business_discovery')
      return reply({ settings: {}, barbers: [], services: [], schedules: [] })
    if (url.pathname.startsWith('/rest/v1/')) return reply([])
    pageErrors.push(`Unexpected customer request: ${request.method()} ${url.origin}${url.pathname}`)
    return route.abort()
  })
  return { actions, consoleOutput, pageErrors }
}

async function verifyCustomerEmail(page) {
  await mountCustomerHarness(page)
  const t = await page.evaluate(async () =>
    (await import('/src/i18n/customerEmailLinkStrings.ts')).customerEmailLinkStrings('en'),
  )

  // Verified authority exposes aliases and the manage control. The source email passed to the
  // port is the server-verified profile email, and same-turn submit/Enter cannot duplicate it.
  {
    await customerControl(
      page,
      'resolve-list',
      'a',
      0,
      customerVerifiedResult('source@example.test', ['source@example.test', 'old@example.test']),
    )
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('button', { name: t.manage, exact: true }).click()
    await dialog.getByText('old@example.test', { exact: true }).waitFor()
    const email = dialog.getByLabel(t.email, { exact: true })
    await email.fill('target@example.test')
    await page.evaluate((label) => {
      const button = [...globalThis.document.querySelectorAll('button')].find(
        (candidate) => candidate.textContent === label,
      )
      button?.click()
      button?.click()
    }, t.request)
    await waitCustomerCalls(page, 'requestCalls', 'a', 1, 'email-link request mutation missing')
    let snapshot = await customerSnapshot(page)
    assert(
      snapshot.requestCalls.a === 1 &&
        snapshot.requestArgs.a[0]?.email === 'target@example.test' &&
        snapshot.requestArgs.a[0]?.lang === 'en' &&
        snapshot.requestArgs.a[0]?.sourceEmail === 'source@example.test',
      `request payload did not use the verified source email: ${JSON.stringify(snapshot)}`,
    )
    await customerControl(page, 'resolve-request', 'a', 0, { ok: true, status: 'queued' })
    await dialog.getByRole('status').filter({ hasText: t.queued }).waitFor()
    assert(
      (await dialog.getByRole('button', { name: t.request, exact: true }).count()) === 0,
      'queued email-link request left a submit button available',
    )
    await email.press('Enter')
    await page.waitForTimeout(100)
    snapshot = await customerSnapshot(page)
    assert(snapshot.requestCalls.a === 1, 'Enter duplicated a completed email-link request')

    await email.fill('second-target@example.test')
    await dialog.getByRole('button', { name: t.request, exact: true }).click()
    await waitCustomerCalls(
      page,
      'requestCalls',
      'a',
      2,
      'second explicit email-link request missing',
    )
    await customerControl(page, 'resolve-request', 'a', 1, { ok: true, status: 'already_linked' })
    await dialog.getByRole('status').filter({ hasText: t.alreadyLinked }).waitFor()
    await waitCustomerCalls(page, 'listCalls', 'a', 2, 'already-linked result did not refresh list')
    snapshot = await customerSnapshot(page)
    assert(
      snapshot.listParams.a[1]?.accessToken === '',
      `already-linked refresh did not use the cookie session: ${JSON.stringify(snapshot)}`,
    )
    await customerControl(page, 'resolve-list', 'a', 1, customerVerifiedResult())
  }

  // Device authority and a verified response without a real profile email expose no link action.
  {
    await mountCustomerHarness(page)
    await customerControl(page, 'resolve-list', 'a', 0, customerDeviceResult())
    await page.getByText('You have no upcoming appointments.', { exact: true }).waitFor()
    assert(
      (await page.getByRole('button', { name: t.manage, exact: true }).count()) === 0,
      'device authority exposed email-link controls',
    )
    assert(
      (await customerSnapshot(page)).requestCalls.a === 0,
      'device path attempted email linking',
    )

    await mountCustomerHarness(page)
    await customerControl(page, 'resolve-list', 'a', 0, {
      ...customerVerifiedResult(),
      profile: { ...customerVerifiedResult().profile, email: '', emails: [] },
    })
    await page.getByText('You have no upcoming appointments.', { exact: true }).waitFor()
    assert(
      (await page.getByRole('button', { name: t.manage, exact: true }).count()) === 0,
      'empty verified profile exposed email-link controls',
    )
    assert(
      (await customerSnapshot(page)).requestCalls.a === 0,
      'empty profile attempted email linking',
    )
  }

  // Confirmation is explicit, binds to the current code/session, surfaces wrong-session guidance,
  // and refreshes the list/profile after waiting -> linked.
  {
    const wrongSessionCode = 'd'.repeat(64)
    await mountCustomerHarness(page, 'en', wrongSessionCode)
    await customerControl(page, 'resolve-list', 'a', 0, customerVerifiedResult())
    const dialog = page.getByRole('dialog')
    await dialog.getByRole('heading', { name: t.confirmTitle, exact: true }).waitFor()
    assert((await customerSnapshot(page)).confirmCalls.a === 0, 'confirm_link ran on mount')
    await dialog.getByRole('button', { name: t.confirm, exact: true }).click()
    await waitCustomerCalls(page, 'confirmCalls', 'a', 1, 'confirm-link mutation missing')
    assert(
      (await customerSnapshot(page)).confirmCodes.a[0] === wrongSessionCode,
      'confirm-link did not use the supplied code',
    )
    await customerControl(page, 'resolve-confirm', 'a', 0, customerErrorResult('access_denied'))
    await dialog.getByRole('alert').filter({ hasText: t.accessDenied }).waitFor()
    assert(
      (await customerSnapshot(page)).listCalls.a === 1,
      'wrong-session confirmation refreshed data',
    )

    const waitingCode = 'e'.repeat(64)
    await mountCustomerHarness(page, 'en', waitingCode)
    await customerControl(page, 'resolve-list', 'a', 0, customerVerifiedResult())
    await page.getByRole('button', { name: t.confirm, exact: true }).click()
    await waitCustomerCalls(page, 'confirmCalls', 'a', 1, 'waiting confirmation mutation missing')
    await customerControl(page, 'resolve-confirm', 'a', 0, { ok: true, status: 'waiting' })
    await page.getByRole('status').filter({ hasText: t.waiting }).waitFor()

    const linkedCode = 'f'.repeat(64)
    await customerControl(page, 'set-code', 'a', 0, linkedCode)
    await page.getByRole('button', { name: t.confirm, exact: true }).waitFor()
    await page.getByRole('button', { name: t.confirm, exact: true }).click()
    await waitCustomerCalls(page, 'confirmCalls', 'a', 2, 'linked confirmation mutation missing')
    await customerControl(page, 'resolve-confirm', 'a', 1, { ok: true, status: 'linked' })
    await page.getByRole('status').filter({ hasText: t.linked }).waitFor()
    await waitCustomerCalls(page, 'listCalls', 'a', 2, 'linked result did not refresh list/profile')
    await customerControl(
      page,
      'resolve-list',
      'a',
      1,
      customerVerifiedResult('refreshed@example.test'),
    )
    await page.getByText('refreshed@example.test', { exact: true }).waitFor()
  }

  // Cancellation is serialized with reads: a stale list response may not resurrect the booking,
  // and two same-turn confirmations produce one port mutation.
  {
    const bookingsText = await page.evaluate(async () =>
      (await import('/src/i18n/index.ts')).myBookingsStrings('en'),
    )
    await mountCustomerHarness(page, 'en', '9'.repeat(64))
    await customerControl(page, 'resolve-list', 'a', 0, customerUpcomingResult())
    await page.getByRole('button', { name: t.confirm, exact: true }).click()
    await waitCustomerCalls(page, 'confirmCalls', 'a', 1, 'cancel ordering confirmation missing')
    await customerControl(page, 'resolve-confirm', 'a', 0, { ok: true, status: 'linked' })
    await page.getByRole('status').filter({ hasText: t.linked }).waitFor()
    await waitCustomerCalls(page, 'listCalls', 'a', 2, 'cancel ordering linked reload missing')
    const booking = page.getByRole('button', {
      name: /Monday 14 September at 10:00/,
    })
    await booking.click()
    await page.getByRole('button', { name: bookingsText.cancelBtn, exact: true }).click()
    await page.evaluate((label) => {
      const button = [...globalThis.document.querySelectorAll('button')].find(
        (candidate) => candidate.textContent === label,
      )
      button?.click()
      button?.click()
    }, bookingsText.cancelConfirmYes)
    await waitCustomerCalls(page, 'cancelCalls', 'a', 1, 'cancel mutation missing')
    let snapshot = await customerSnapshot(page)
    assert(
      snapshot.cancelCalls.a === 1 && snapshot.cancelIds.a[0] === 'customer-booking-a',
      `same-turn cancellation was duplicated or targeted the wrong booking: ${JSON.stringify(snapshot)}`,
    )
    await customerControl(page, 'resolve-cancel', 'a', 0, { ok: true, id: 'customer-booking-a' })
    await waitCustomerCalls(page, 'listCalls', 'a', 3, 'post-cancel reload missing')
    await customerControl(page, 'resolve-list', 'a', 1, customerUpcomingResult())
    await page.waitForTimeout(100)
    assert(
      (await page.getByRole('button', { name: /Monday 14 September at 10:00/ }).count()) === 0,
      'stale in-flight list response resurrected the cancelled booking',
    )
    await customerControl(page, 'resolve-list', 'a', 2, customerVerifiedResult())
    await page.getByText('You have no upcoming appointments.', { exact: true }).waitFor()
    snapshot = await customerSnapshot(page)
    assert(
      snapshot.listParams.a[2]?.accessToken === '',
      `post-cancel reload did not use the cookie session: ${JSON.stringify(snapshot)}`,
    )
  }

  // Port changes, code nonce changes and unmount invalidate late action responses.
  {
    await mountCustomerHarness(page)
    await customerControl(page, 'resolve-list', 'a', 0, customerVerifiedResult())
    await page.getByRole('button', { name: t.manage, exact: true }).click()
    await page.getByLabel(t.email, { exact: true }).fill('late@example.test')
    await page.getByRole('button', { name: t.request, exact: true }).click()
    await waitCustomerCalls(page, 'requestCalls', 'a', 1, 'port-fence request missing')
    await customerControl(page, 'switch-port', 'b')
    await waitCustomerCalls(page, 'listCalls', 'b', 1, 'port B list read missing')
    await customerControl(page, 'resolve-list', 'b', 0, customerVerifiedResult('b@example.test'))
    await page.getByRole('button', { name: t.manage, exact: true }).waitFor()
    await customerControl(page, 'resolve-request', 'a', 0, { ok: true, status: 'queued' })
    await page.waitForTimeout(100)
    assert(
      (await page.getByRole('status').filter({ hasText: t.queued }).count()) === 0,
      'late port A request response wrote into port B UI',
    )
    assert((await customerSnapshot(page)).requestCalls.b === 0, 'port B inherited port A action')

    await mountCustomerHarness(page)
    await customerControl(page, 'resolve-list', 'a', 0, customerVerifiedResult())
    await page.getByRole('button', { name: t.manage, exact: true }).click()
    await page.getByLabel(t.email, { exact: true }).fill('unmounted@example.test')
    await page.getByRole('button', { name: t.request, exact: true }).click()
    await waitCustomerCalls(page, 'requestCalls', 'a', 1, 'unmount-fence request missing')
    await customerControl(page, 'unmount')
    await customerControl(page, 'resolve-request', 'a', 0, { ok: true, status: 'queued' })
    await page.waitForTimeout(100)
    assert(
      (await page.getByRole('dialog').count()) === 0,
      'late response recreated an unmounted dialog',
    )

    const nonceA = '1'.repeat(64)
    const nonceB = '2'.repeat(64)
    await mountCustomerHarness(page, 'en', nonceA)
    await customerControl(page, 'resolve-list', 'a', 0, customerVerifiedResult())
    await page.getByRole('button', { name: t.confirm, exact: true }).click()
    await waitCustomerCalls(page, 'confirmCalls', 'a', 1, 'nonce A confirmation missing')
    await customerControl(page, 'set-code', 'a', 0, nonceB)
    await page.getByRole('button', { name: t.confirm, exact: true }).waitFor()
    await customerControl(page, 'resolve-confirm', 'a', 0, { ok: true, status: 'waiting' })
    await page.waitForTimeout(100)
    assert(
      (await page.getByRole('status').filter({ hasText: t.waiting }).count()) === 0,
      'late nonce A response wrote into nonce B UI',
    )
  }

  // The real App consumes email-link proofs at initial mount and hashchange. Mixed booking tokens
  // are removed without invoking exchange_access or confirm_link, and the proof never reaches
  // storage, DOM text, or console output.
  {
    const appState = await installCustomerAppRoutes(page)
    const appT = await page.evaluate(async () =>
      (await import('/src/i18n/customerEmailLinkStrings.ts')).customerEmailLinkStrings('sv'),
    )
    const codeA = '3'.repeat(64)
    const codeB = '4'.repeat(64)
    const legacy = '5'.repeat(64)
    await page.setViewportSize({ width: 320, height: 568 })
    await page.goto(`${baseUrl}/tools/e2e/admin-harness.html`, { waitUntil: 'domcontentloaded' })
    await page.evaluate(() => {
      globalThis.document.cookie = 'bladeblend_storage_preferences=essential; Path=/'
    })
    await page.evaluate(
      async (href) => (await import('/tools/e2e/admin-harness.tsx')).mountActualAppHarness(href),
      `/?booking_access=${legacy}#email_link=${codeA}&booking_token=${'6'.repeat(64)}&keep=1`,
    )
    await page.getByRole('heading', { name: appT.confirmTitle, exact: true }).waitFor()
    await page.waitForFunction(() => !globalThis.location.href.includes('email_link'))
    const initialLeak = await page.evaluate(
      (code) => ({
        href: globalThis.location.href,
        storage: JSON.stringify({
          local: Object.keys(globalThis.localStorage).map((key) => [
            key,
            globalThis.localStorage.getItem(key),
          ]),
          session: Object.keys(globalThis.sessionStorage).map((key) => [
            key,
            globalThis.sessionStorage.getItem(key),
          ]),
        }),
        dom: globalThis.document.documentElement.outerHTML.includes(code),
      }),
      codeA,
    )
    assert(
      initialLeak.href.endsWith('/#keep=1'),
      `initial App link cleanup failed: ${JSON.stringify(initialLeak)}`,
    )
    assert(
      !initialLeak.href.includes('booking_access') && !initialLeak.href.includes('booking_token'),
      'mixed booking credential survived URL cleanup',
    )
    assert(
      !initialLeak.storage.includes(codeA) && !initialLeak.dom,
      'email-link proof leaked into storage or DOM',
    )
    assert(
      !appState.actions.some(
        (body) => body.action === 'exchange_access' || body.action === 'confirm_link',
      ),
      `email-link mount auto-called a credential action: ${JSON.stringify(appState.actions)}`,
    )

    await page.evaluate((code) => {
      globalThis.location.hash = `email_link=${code}&booking_token=${'7'.repeat(64)}&keep=2`
    }, codeB)
    await page.waitForFunction(() => globalThis.location.href.endsWith('/#keep=2'))
    await page.waitForFunction(
      () => globalThis.document.querySelector('[aria-label="Bekräfta mejlkoppling"]') !== null,
    )
    const hashLeak = await page.evaluate(
      (code) => ({
        href: globalThis.location.href,
        storage: JSON.stringify({
          local: Object.keys(globalThis.localStorage).map((key) => [
            key,
            globalThis.localStorage.getItem(key),
          ]),
          session: Object.keys(globalThis.sessionStorage).map((key) => [
            key,
            globalThis.sessionStorage.getItem(key),
          ]),
        }),
        dom: globalThis.document.documentElement.outerHTML.includes(code),
      }),
      codeB,
    )
    assert(!hashLeak.storage.includes(codeB) && !hashLeak.dom, 'hashchange email-link proof leaked')
    assert(
      !appState.actions.some(
        (body) => body.action === 'exchange_access' || body.action === 'confirm_link',
      ),
      `hashchange auto-called a credential action: ${JSON.stringify(appState.actions)}`,
    )
    assert(
      !appState.consoleOutput.some((message) => message.includes(codeA) || message.includes(codeB)),
      'email-link proof leaked to console',
    )
    assert(
      appState.pageErrors.length === 0,
      `actual App customer hash flow errored: ${appState.pageErrors.join('; ')}`,
    )
    await page.screenshot({
      path: '/tmp/knc-ui-2026-09-13/customer-email-app-hash-320.png',
      fullPage: false,
    })
  }

  // Long valid source email remains readable at the requested 320px confirmation width.
  {
    const longEmail = 'verylongsourceaddresswithoutbreaks1234567890@example.test'
    const aliases = [longEmail, 'another.long.alias.for.mobile@example.test']
    await mountCustomerHarness(page, 'en', '8'.repeat(64))
    await customerControl(page, 'resolve-list', 'a', 0, customerVerifiedResult(longEmail, aliases))
    await page.getByRole('heading', { name: t.confirmTitle, exact: true }).waitFor()
    const dimensions = await page.getByRole('dialog').evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }))
    await page.screenshot({
      path: '/tmp/knc-ui-2026-09-13/customer-email-confirm-320.png',
      fullPage: false,
    })
    assert(
      dimensions.scrollWidth <= dimensions.clientWidth,
      `customer confirmation overflow at 320px: ${JSON.stringify(dimensions)}`,
    )
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
      return reply({
        barbers: [
          {
            id: 'privacy-barber',
            name: 'UI Test Barber',
            ig: '',
            role_sv: '',
            role_en: '',
            bio_sv: '',
            bio_en: '',
            active: true,
            sort_order: 0,
            photo_path: null,
          },
        ],
        services: [],
      })
    if (url.pathname === '/rest/v1/rpc/public_business_discovery')
      return reply({ settings: {}, barbers: [], services: [], schedules: [] })
    if (request.method() === 'GET' && url.pathname.startsWith('/rest/v1/')) return reply([])
    errors.push(`Unexpected privacy request: ${request.method()} ${url.origin}${url.pathname}`)
    return route.abort()
  })
  await page.goto(`${baseUrl}/tools/e2e/admin-harness.html`, { waitUntil: 'domcontentloaded' })
  const strings = await page.evaluate(async (lang) => {
    ;(await import('/tools/e2e/admin-harness.tsx')).mountPrivacyHarness()
    const { appStrings, privacyStrings, myBookingsStrings, aboutStrings } =
      await import('/src/i18n/index.ts')
    return {
      app: appStrings(lang),
      privacy: privacyStrings(lang),
      bookings: myBookingsStrings(lang),
      about: aboutStrings(lang),
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
  const assertDesktopHeroInfo = async (label) => {
    if (page.viewportSize().width <= 768) return
    const geometry = await page.getByText(strings.app.hours, { exact: true }).evaluate((hours) => {
      const info = hours.parentElement
      const hero = globalThis.document.querySelector('main')?.firstElementChild
      if (info === null || hero === null || hero === undefined) return null
      return {
        inHero: hero.contains(info),
        heroBottom: hero.getBoundingClientRect().bottom,
        infoBottom: info.getBoundingClientRect().bottom,
      }
    })
    assert(
      geometry !== null &&
        geometry.inHero &&
        Math.abs(geometry.infoBottom - geometry.heroBottom) <= 1,
      `Opening hours/address left the hero bottom (${label}): ${JSON.stringify(geometry)}`,
    )
  }
  const textContrast = async (locator) =>
    locator.evaluate((element) => {
      const rgba = (color) => {
        const values = color.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 0]
        return [values[0], values[1], values[2], values[3] ?? 1]
      }
      const over = (front, back) => {
        const alpha = front[3] + back[3] * (1 - front[3])
        return alpha === 0
          ? [0, 0, 0, 0]
          : [
              ...front
                .slice(0, 3)
                .map((value, i) => (value * front[3] + back[i] * back[3] * (1 - front[3])) / alpha),
              alpha,
            ]
      }
      let foreground = rgba(globalThis.getComputedStyle(element).color)
      let background = [0, 0, 0, 0]
      for (let node = element; node !== null; node = node.parentElement) {
        const style = globalThis.getComputedStyle(node)
        foreground = over(foreground, rgba(style.backgroundColor))
        background = over(background, rgba(style.backgroundColor))
        foreground[3] *= Number(style.opacity)
        background[3] *= Number(style.opacity)
      }
      const luminance = (color) =>
        over(color, [255, 255, 255, 1])
          .slice(0, 3)
          .map((value) => {
            value /= 255
            return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
          })
          .reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0)
      const l1 = luminance(foreground),
        l2 = luminance(background)
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
    })
  const infoText = page
    .getByText(strings.app.hours, { exact: true })
    .locator('..')
    .locator(':scope > span')
  assert((await infoText.count()) === 2, 'Hero opening hours/address are missing')
  for (const label of [
    ...(await infoText.all()),
    ...(width > 768 ? [page.getByText(strings.app.kicker, { exact: true })] : []),
  ]) {
    const ratio = await textContrast(label)
    assert(
      ratio >= 4.5,
      `Public small text contrast is ${ratio.toFixed(2)}:1: ${await label.textContent()}`,
    )
  }
  await assertDesktopHeroInfo('initial home')
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
  await assertDesktopHeroInfo('booking open')
  const barberOption = page.getByTestId('booking-barber-option')
  await barberOption.waitFor()
  const animatedShell =
    width > 768
      ? page.getByTestId('fold-booking')
      : page.getByTestId('mobile-site-scroll').locator(':scope > div').first()
  assert(
    await animatedShell.evaluate((element) =>
      globalThis
        .getComputedStyle(element)
        .transitionDuration.split(',')
        .every((duration) => Number.parseFloat(duration) === 0),
    ),
    'Shell still animates with reduced motion',
  )
  await page.waitForFunction(() => {
    const option = globalThis.document
      .querySelector('[data-testid="booking-barber-option"]')
      ?.getBoundingClientRect()
    const panel = globalThis.document.getElementById('privacy-preferences')?.getBoundingClientRect()
    return (
      option !== undefined && panel !== undefined && option.top >= 0 && option.bottom <= panel.top
    )
  })
  await barberOption.click()
  assert(
    (await barberOption.getAttribute('aria-pressed')) === 'true',
    'Visible first booking option was not selectable above the cookie panel',
  )

  const currentScroll = () =>
    page.evaluate(
      () =>
        globalThis.document.querySelector('[data-testid="mobile-site-scroll"]')?.scrollTop ??
        globalThis.scrollY,
    )
  const scrollBeforeMotionChange = await currentScroll()
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.waitForFunction((desktop) => {
    const shell = desktop
      ? globalThis.document.querySelector('[data-testid="fold-booking"]')
      : globalThis.document.querySelector('[data-testid="mobile-site-scroll"] > div')
    return (
      shell !== null &&
      globalThis
        .getComputedStyle(shell)
        .transitionDuration.split(',')
        .some((duration) => Number.parseFloat(duration) > 0)
    )
  }, width > 768)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForFunction((desktop) => {
    const shell = desktop
      ? globalThis.document.querySelector('[data-testid="fold-booking"]')
      : globalThis.document.querySelector('[data-testid="mobile-site-scroll"] > div')
    return (
      shell !== null &&
      globalThis
        .getComputedStyle(shell)
        .transitionDuration.split(',')
        .every((duration) => Number.parseFloat(duration) === 0)
    )
  }, width > 768)
  assert(
    Math.abs((await currentScroll()) - scrollBeforeMotionChange) < 1,
    'Changing motion preference restarted the booking reveal',
  )
  assert((await heroManage.count()) === 0, 'Hero reopening control appeared in booking')
  assert((await choice()) === null, 'Opening booking changed storage permission')
  if (width < 768)
    await page.getByRole('button', { name: strings.app.ariaBackHome, exact: true }).click()
  else await book.click()
  await page.getByRole('button', { name: strings.app.aboutLink, exact: true }).click()
  const manage = page.getByRole('link', { name: strings.privacy.manageLabel, exact: true })
  await manage.scrollIntoViewIfNeeded()
  await assertFixedNotice('About')
  for (const [href, label] of [
    ['/terms', strings.about.termsLink],
    ['/privacy', strings.about.privacyLink],
  ]) {
    const link = page.locator('#om-oss footer').getByRole('link', { name: label, exact: true })
    assert((await link.getAttribute('href')) === href, `Missing localized About link: ${href}`)
    await link.focus()
    assert(
      await link.evaluate((element) => element === globalThis.document.activeElement),
      `About link is not keyboard focusable: ${href}`,
    )
  }

  await assertDesktopHeroInfo('scrolled to About')
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
  await assertDesktopHeroInfo('layout change')
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
const chromiumScenarios =
  scenario === 'cms-shell'
    ? [verifyCmsStudioShell]
    : [
        verifyNavigation,
        verifyDelayedRestore,
        verifyPresentationDraft,
        verifyCmsStudioShell,
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
        ...['sv', 'en'].map((lang) => (page) => verifyBookingTerms(page, lang)),
        verifyCalendarSync,
        verifyCustomerEmail,
        ...privacyCases.map((options) => (page) => verifyPrivacy(page, options)),
      ]
let passed = 0
try {
  for (const verify of chromiumScenarios) {
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

const secondaryEngines = scenario === 'cms-shell' ? [webkit] : [firefox, webkit]
for (const engine of secondaryEngines) {
  const browser = await engine.launch()
  try {
    if (scenario !== 'cms-shell')
      for (const options of privacyCases) {
        const page = await browser.newPage()
        page.setDefaultTimeout(10_000)
        try {
          await verifyPrivacy(page, options)
        } finally {
          await page.close()
        }
      }
    const cmsPage = await browser.newPage()
    cmsPage.setDefaultTimeout(10_000)
    try {
      await verifyCmsStudioShell(cmsPage)
    } finally {
      await cmsPage.close()
    }
    console.log(
      scenario === 'cms-shell'
        ? `CMS mobile shell passed: ${engine.name()}.`
        : `Responsive privacy passed (${privacyCases.length} scenarios) plus CMS mobile shell: ${engine.name()}.`,
    )
  } finally {
    await browser.close()
  }
}

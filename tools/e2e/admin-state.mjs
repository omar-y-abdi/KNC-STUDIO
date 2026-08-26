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
  await mount(page, 'navigation', 'owner', '/admin-harness?tab=schedule', '22000px')
  await page.getByRole('button', { name: 'My schedule', exact: true }).waitFor()
  await waitForSavedScroll(page, 'schedule', 0)
  await page.evaluate(() => globalThis.window.scrollTo(0, 875))
  await waitForSavedScroll(page, 'schedule', 875)
  await page.getByRole('button', { name: 'Mail', exact: true }).click()
  await waitForScroll(page, 0, 'Mail did not start at top')
  await waitForSavedScroll(page, 'mail', 0)
  await page.evaluate(() => globalThis.window.scrollTo(0, 425))
  await waitForSavedScroll(page, 'mail', 425)
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

  await mount(page, 'navigation', 'barber', '/admin-harness?tab=mail')
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
  await mount(page, 'navigation', 'owner', '/admin-harness?tab=schedule', '22000px')
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
  await mount(page, 'site', undefined, '/admin-harness?view=site')
  await page.getByLabel('Logo scale').waitFor()
  await page.getByLabel('Logo scale').selectOption('xl')
  assert(
    (await page.evaluate(() => globalThis.window.__adminHarnessWrites?.length ?? -1)) === 0,
    'draft scale wrote before publish',
  )
  const focusedSvg = page.getByTestId('homepage-logo-focused-preview').locator('svg')
  assert((await focusedSvg.count()) === 1, 'focused logo preview did not render one SVG')
  assert((await focusedSvg.getAttribute('height')) === '188', 'draft scale did not reach preview')
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
  await page.getByRole('button', { name: 'Publish presentation', exact: true }).click()
  const writes = await page.evaluate(
    () => globalThis.window.__adminHarnessWrites?.map((entry) => Object.fromEntries(entry)) ?? [],
  )
  assert(writes.length === 1, 'publish did not write exactly once')
  assert(writes[0]?.homepage_logo_scale === 'xl', 'published logo scale missing')
  assert(writes[0]?.homepage_scale === 'md', 'published homepage scale missing')
  assert(writes[0]?.homepage_logo_style === 'classic', 'published logo style missing')
}

const browser = await chromium.launch()
try {
  for (const verify of [verifyNavigation, verifyDelayedRestore, verifyPresentationDraft]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    try {
      await verify(page)
    } finally {
      await page.close()
    }
  }
  console.log(
    'Admin browser regressions passed: history, delayed scroll, role safety, draft publish.',
  )
} finally {
  await browser.close()
}

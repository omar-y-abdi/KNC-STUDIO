import assert from 'node:assert/strict'
import { writeFile, mkdir } from 'node:fs/promises'
import { chromium, webkit } from 'playwright'
import { emptyDocument, EMAIL_NAMES, defaultEmailDesign } from '../../shared/cms.ts'
import { defaultEmailTemplate } from '../../supabase/functions/_shared/email.ts'
import { nativeBackend } from './cms-native.mjs'

// Real CMS components and canvas, isolated HTTP fixtures. Never contact a live owner account.
const base = process.env.BASE_URL ?? 'http://127.0.0.1:4188'
const out = process.env.CMS_EVIDENCE ?? '/tmp/cms-evidence'
await mkdir(out, { recursive: true })
const failures = []
const captures = []
const seed = emptyDocument()
seed.emails = EMAIL_NAMES.flatMap((template) =>
  ['sv', 'en'].map((lang) => {
    const copy = defaultEmailTemplate(template, lang)
    return {
      template,
      lang,
      subject: copy.subject,
      preheader: copy.preheader,
      title: copy.title,
      intro: copy.intro,
      section_title: copy.sectionTitle,
      note: copy.note,
      cta_label: copy.ctaLabel,
      contact_lead: copy.contactLead,
      design: defaultEmailDesign(),
    }
  }),
)
const assets = [
  {
    id: '22222222-2222-4222-8222-222222222222',
    bucket: 'gallery',
    path: 'logo/studio.webp',
    name: 'Salongens logotyp',
    alt: 'Studio logotyp',
    mime: 'image/webp',
    bytes: 24000,
    width: 1200,
    height: 630,
    archived: false,
    version: 1,
  },
  {
    id: '33333333-3333-4333-8333-333333333333',
    bucket: 'cms-library',
    path: 'fonts/studio.woff2',
    name: 'Studio sans',
    alt: '',
    mime: 'font/woff2',
    bytes: 12000,
    archived: false,
    version: 1,
  },
]

for (const [engine, name] of [
  [chromium, 'chromium'],
  [webkit, 'webkit'],
]) {
  if (process.env.CMS_BROWSER && process.env.CMS_BROWSER !== name) continue
  const browser = await engine.launch()
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    reducedMotion: 'reduce',
  })
  context.setDefaultTimeout(15000)
  const backend = await nativeBackend(context, seed, assets)
  await context.route('**/storage/v1/object/public/**', (route) =>
    route.fulfill({ contentType: 'image/png', path: 'public/og-image.png' }),
  )
  await context.route('**/functions/v1/cms-studio', (route) => {
    if (
      route.request().method() !== 'OPTIONS' &&
      route.request().postDataJSON().operation === 'asset_usage'
    )
      return route.fulfill({
        json: { currentReferences: 0, historyReferences: 0 },
        headers: { 'Access-Control-Allow-Origin': new URL(base).origin },
      })
    return route.fallback()
  })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  const library = page.locator('#cms-library')
  const inspector = page.locator('#cms-inspector')
  const frame = page.frameLocator('.gjs-frame').first()
  const capture = async (label) => {
    const filename = `cms-workspace-${name}-${page.viewportSize().width}-${label}.png`
    await page.screenshot({ path: `/tmp/${filename}`, animations: 'disabled' })
    captures.push({ filename, browser: name, viewport: page.viewportSize(), state: label })
  }
  const check = (condition, message) => {
    if (!condition) failures.push(`${name}/${page.viewportSize().width}: ${message}`)
  }
  const overflow = async () => {
    const result = await page.evaluate(() =>
      [
        ...document.querySelectorAll(
          '.cms-topbar,.cms-workspace-view,.cms-workspace-content,.cms-dialog[open],.cms-mobile-tools',
        ),
      ]
        .filter((node) => node.checkVisibility())
        .filter((node) => node.scrollWidth > node.clientWidth + 1)
        .map((node) => node.className),
    )
    check(result.length === 0, `Horizontal overflow: ${result.join(', ')}`)
  }
  const openLibrary = async () => {
    if (page.viewportSize().width <= 900 && !(await library.isVisible()))
      await page
        .locator('.cms-mobile-tools')
        .getByRole('button', { name: 'Sidor', exact: true })
        .click()
  }
  const closeView = async () => {
    await page.getByRole('button', { name: 'Tillbaka till sidan', exact: false }).click()
    await page.locator('.cms-workspace-view').waitFor({ state: 'detached' })
  }
  try {
    await page.goto(`${base}/tools/e2e/admin-harness.html?view=cms-studio`)
    await page.evaluate(async () =>
      (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness(),
    )
    await frame.getByText('KNC source sv', { exact: true }).first().waitFor({ timeout: 90000 })
    await page.locator('.cms-notice').getByRole('button', { name: 'Stäng', exact: true }).click()
    await page.getByRole('button', { name: 'Fit', exact: true }).click()
    await frame.locator('html').evaluate(async () => {
      await globalThis.document.fonts.ready
    })
    await capture('editor')

    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 960 })
      await page
        .getByRole('button', { name: width === 390 ? 'Mobil' : 'Dator', exact: true })
        .click()
      await page.getByRole('button', { name: 'Fit', exact: true }).click()
      check(await page.locator('.cms-status').isVisible(), 'Publication status is hidden')
      await capture('canvas')
      await openLibrary()
      await capture('pages')
      await library.getByRole('searchbox', { name: 'Sök sidor' }).fill('there-is-no-such-page')
      check(
        await library.getByText('Inga sidor hittades.').isVisible(),
        'Page search has no explicit empty state',
      )
      await capture('page-search-empty')
      await library.getByRole('searchbox', { name: 'Sök sidor' }).fill('')
      if (width === 390) {
        const close = library.getByRole('button', { name: 'Stäng sidor', exact: true })
        check((await close.count()) === 1, 'Page drawer lacks its own close button')
        await page.keyboard.press('Escape')
        check(!(await library.isVisible()), 'Escape did not dismiss the page drawer')
        await page
          .locator('.cms-mobile-tools')
          .getByRole('button', { name: 'Egenskaper', exact: true })
          .click()
      }
      await inspector.waitFor({ state: 'visible' })
      for (const title of ['Design', 'Lager', 'Lägg till']) {
        await inspector.getByRole('tab', { name: title, exact: true }).click()
        await capture(
          `inspector-${title === 'Design' ? 'design' : title === 'Lager' ? 'layers' : 'blocks'}`,
        )
      }
      await inspector.getByRole('tab', { name: 'Design', exact: true }).click()
      await page.keyboard.press('ArrowRight')
      assert.equal(
        await inspector
          .getByRole('tab', { name: 'Lager', exact: true })
          .getAttribute('aria-selected'),
        'true',
      )
      await page.keyboard.press('Home')
      assert.equal(
        await inspector
          .getByRole('tab', { name: 'Design', exact: true })
          .getAttribute('aria-selected'),
        'true',
      )
      if (width === 390) {
        const close = inspector.getByRole('button', { name: 'Stäng egenskaper', exact: true })
        check((await close.count()) === 1, 'Inspector lacks its own close button')
        if (await close.count()) await close.click()
        else await page.getByRole('button', { name: 'Stäng panel', exact: true }).click()
      }
      for (const [trigger, state] of [
        ['Webbplatsens stil', 'style'],
        ['Resurser', 'resources'],
        ['Business / SEO', 'business'],
        ['Mejl', 'email'],
      ]) {
        await openLibrary()
        await library
          .getByRole('button', { name: trigger, exact: trigger !== 'Webbplatsens stil' })
          .click()
        await page.locator('.cms-workspace-view h1').waitFor()
        await overflow()
        await capture(state)
        if (state === 'style') {
          await page.getByRole('button', { name: 'Mörkt tema', exact: true }).click()
          await capture('style-dark')
          await page.getByRole('button', { name: 'Ljust tema', exact: true }).click()
        }
        if (state === 'resources') {
          await page.getByRole('searchbox', { name: 'Sök resurser' }).fill('no such asset')
          await capture('resource-search-empty')
          await page.getByRole('searchbox', { name: 'Sök resurser' }).fill('')
          await page.locator('.cms-resource-card').first().getByRole('button').click()
          await page.locator('.cms-resource-detail').waitFor()
          await capture('resource-detail')
        }
        const view = page.locator('.cms-workspace-view')
        const scroll = await view.evaluate((node) => ({
          height: node.clientHeight,
          extent: node.scrollHeight,
        }))
        for (let offset = scroll.height; offset < scroll.extent; offset += scroll.height) {
          await view.evaluate((node, top) => {
            node.scrollTop = top
          }, offset)
          await capture(`${state}-scroll-${offset}`)
        }
        await closeView()
      }
      await openLibrary()
      await library.getByRole('button', { name: '+ Ny sida', exact: true }).click()
      await page.getByRole('dialog', { name: 'Ny sida', exact: true }).waitFor()
      await capture('new-page-dialog')
      await overflow()
      await page.keyboard.press('Escape')
      await openLibrary()
      await library.getByRole('button', { name: 'Utkast & backup', exact: true }).click()
      await capture('backup-dialog')
      await page.keyboard.press('Escape')
      if (width === 390 && (await library.isVisible()))
        await page.getByRole('button', { name: 'Stäng panel', exact: true }).click()
      await page.getByRole('button', { name: 'History', exact: true }).click()
      await page.locator('.cms-history-row').first().waitFor()
      await capture('history')
      await page.getByRole('button', { name: 'Granska', exact: true }).first().click()
      await page.getByRole('dialog').waitFor()
      await capture('revision-review')
      await page.keyboard.press('Escape')
      await closeView()
    }
    for (const size of [
      { width: 320, height: 568 },
      { width: 768, height: 1024 },
      { width: 900, height: 600 },
      { width: 1024, height: 768 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(size)
      await overflow()
      const targets = await page.evaluate(() =>
        [
          ...document.querySelectorAll(
            '.cms-topbar button,.cms-mobile-tools button,.cms-bottom button',
          ),
        ]
          .filter((node) => node.checkVisibility())
          .map((node) => ({
            name: node.textContent.trim(),
            height: node.getBoundingClientRect().height,
          })),
      )
      if (size.width <= 900)
        check(
          targets.every((node) => node.height >= 44),
          `Small touch controls: ${JSON.stringify(targets.filter((node) => node.height < 44))}`,
        )
      await capture('responsive')
    }
    check(errors.length === 0, `Browser errors: ${errors.join('; ')}`)
    assert.deepEqual(backend.writes, [], 'Visual navigation must not publish or send anything')
  } catch (error) {
    failures.push(`${name}: ${error.stack}`)
    await capture('failure')
  } finally {
    await context.close()
    await browser.close()
  }
}
await writeFile(`${out}/workspace-manifest.json`, JSON.stringify({ captures, failures }, null, 2))
console.log(JSON.stringify({ screenshots: captures.length, failures }, null, 2))
assert.deepEqual(failures, [], 'CMS workspace visual/interaction contracts failed')

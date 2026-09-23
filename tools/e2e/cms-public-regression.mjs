import assert from 'node:assert/strict'
import fs from 'node:fs'
import { chromium, webkit } from 'playwright'
import { nativeBackend } from './cms-native.mjs'
import { emptyDocument } from '../../shared/cms.ts'
const base = process.env.BASE_URL ?? 'http://127.0.0.1:4188'
const languageToggleSelector =
  'button[aria-label="Byt språk till engelska"],button[aria-label="Switch language to Swedish"]'
const languageOwnerColor = 'rgb(31, 79, 118)'

async function legacyLanguageTemplate(page, html, lang) {
  return page.evaluate(
    ({ html, lang }) => {
      const doc = new globalThis.DOMParser().parseFromString(html, 'text/html')
      const surfaces = new Set()
      const rootIds = []
      for (const button of doc.querySelectorAll('button[data-knc-source]')) {
        const label = button.getAttribute('aria-label') ?? ''
        const spans = [...button.children].filter((node) => node.tagName === 'SPAN')
        if (
          !/språk|language/i.test(label) ||
          spans.length !== 2 ||
          spans.map((node) => node.textContent?.trim()).join('|') !== 'SV|EN'
        )
          continue
        const surface = button.closest('[data-knc-surface]')?.getAttribute('data-knc-surface')
        if (!['desktop-home', 'mobile-home'].includes(surface)) continue
        if (surfaces.has(surface)) throw new Error(`Duplicate legacy language control: ${surface}`)
        surfaces.add(surface)
        const rootId = button.id
        if (!rootId || button.getAttribute('data-knc-source') !== rootId)
          throw new Error(`Language wrapper identity is missing for ${surface}`)

        const wrapper = doc.createElement('div')
        for (const attr of [...button.attributes]) {
          if (
            ['aria-label', 'title', 'type', 'aria-pressed', 'data-knc-required'].includes(attr.name)
          )
            continue
          wrapper.setAttribute(attr.name, attr.value)
        }
        wrapper.setAttribute(
          'data-knc-light',
          'display:flex;align-items:center;gap:6px;background:rgba(0,0,0,.06);border-radius:999px;padding:2px;flex:none',
        )
        for (const span of spans) {
          const text = span.textContent?.trim() ?? ''
          const legacyButton = doc.createElement('button')
          for (const attr of [...span.attributes]) {
            if (attr.name === 'aria-hidden' || attr.name === 'style') continue
            legacyButton.setAttribute(attr.name, attr.value)
          }
          legacyButton.setAttribute('type', 'button')
          legacyButton.setAttribute('aria-pressed', String((text === 'SV') === (lang === 'sv')))
          legacyButton.setAttribute('data-knc-required', 'true')
          legacyButton.textContent = text
          wrapper.append(legacyButton)
        }
        button.replaceWith(wrapper)
        rootIds.push({
          surface,
          id: rootId,
          legacyTag: wrapper.tagName,
          legacyButtonCount: [...wrapper.children].filter((node) => node.tagName === 'BUTTON')
            .length,
        })
      }
      if (surfaces.size !== 2)
        throw new Error(`Expected desktop and mobile legacy controls, got ${[...surfaces]}`)
      return { html: doc.body.innerHTML, rootIds }
    },
    { html, lang },
  )
}

async function installLegacyLanguageFixture(page, backend) {
  const home = backend.document.presentation.pages.find((candidate) => candidate.path === '/')
  assert.ok(home, 'Published Home fixture is available for the legacy language case')
  const roots = {}
  for (const lang of ['sv', 'en']) {
    const legacy = await legacyLanguageTemplate(page, home.content[lang].html, lang)
    assert.ok(
      legacy.rootIds.every(
        ({ legacyTag, legacyButtonCount }) => legacyTag === 'DIV' && legacyButtonCount === 2,
      ),
      `${lang} fixture reproduces the published two-button wrapper shape`,
    )
    home.content[lang].html = legacy.html
    roots[lang] = Object.fromEntries(legacy.rootIds.map(({ surface, id }) => [surface, id]))
    const ownerRules = legacy.rootIds
      .map(
        ({ id }) =>
          `#${id}{outline:3px solid ${languageOwnerColor}!important;outline-offset:1px!important}`,
      )
      .join('\n')
    for (const mode of ['light', 'dark']) home.content[lang].css[mode] += `\n${ownerRules}`
  }
  return roots
}

async function verifyLanguageToggle(page, { viewport, surface, ownerIds }) {
  await page.setViewportSize(viewport)
  await page.goto(`${base}/?lang=sv&mode=light`, { waitUntil: 'domcontentloaded' })
  const waitForLanguage = async (lang) => {
    const switchName = lang === 'sv' ? 'Byt språk till engelska' : 'Switch language to Swedish'
    const actionName = lang === 'sv' ? 'Boka tid' : 'Book appointment'
    await page.getByRole('button', { name: switchName, exact: true }).waitFor()
    await page.getByRole('button', { name: actionName, exact: true }).first().waitFor()
  }
  const assertPill = async (lang) => {
    const switchName = lang === 'sv' ? 'Byt språk till engelska' : 'Switch language to Swedish'
    const pill = page.getByRole('button', { name: switchName, exact: true })
    assert.equal(
      await pill.count(),
      1,
      `${surface ?? 'fresh'} ${lang}: one language pill is exposed`,
    )
    assert.equal(await page.locator(languageToggleSelector).count(), 1)
    assert.equal(await page.getByRole('button', { name: 'SV', exact: true }).count(), 0)
    assert.equal(await page.getByRole('button', { name: 'EN', exact: true }).count(), 0)
    const state = await pill.evaluate((node) => {
      const style = globalThis.getComputedStyle(node)
      return {
        tag: node.tagName,
        id: node.id,
        sourceId: node.getAttribute('data-knc-source'),
        surface: node.closest('[data-knc-surface]')?.getAttribute('data-knc-surface') ?? null,
        childTags: [...node.children].map((child) => child.tagName),
        childText: [...node.children].map((child) => child.textContent?.trim() ?? ''),
        outlineColor: style.outlineColor,
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
      }
    })
    assert.equal(state.tag, 'BUTTON', `${surface ?? 'fresh'}: the whole pill is a button`)
    assert.deepEqual(state.childTags, ['SPAN', 'SPAN'])
    assert.deepEqual(state.childText, ['SV', 'EN'])
    if (surface) {
      const ownerId = ownerIds?.[lang]?.[surface]
      assert.ok(ownerId, `legacy fixture has an original owner ID for ${lang}/${surface}`)
      assert.equal(state.id, ownerId, 'The new control retains the published wrapper ID')
      assert.equal(state.sourceId, ownerId)
      assert.equal(state.surface, surface)
      assert.equal(
        state.outlineColor,
        languageOwnerColor,
        'ID-scoped owner CSS still reaches the control',
      )
      assert.equal(state.outlineStyle, 'solid')
      assert.equal(state.outlineWidth, '3px')
    } else {
      assert.equal(
        state.surface,
        null,
        'Fresh source renders the code-owned control without a CMS wrapper',
      )
    }
  }
  const switchAt = async (fraction, expectedLang) => {
    const beforeName =
      expectedLang === 'en' ? 'Byt språk till engelska' : 'Switch language to Swedish'
    const pill = page.getByRole('button', { name: beforeName, exact: true })
    const bounds = await pill.boundingBox()
    assert.ok(bounds, `${surface ?? 'fresh'}: pill has a clickable box`)
    await pill.click({
      position: {
        x: Math.min(bounds.width - 1, Math.max(1, Math.floor(bounds.width * fraction))),
        y: Math.floor(bounds.height / 2),
      },
    })
    await waitForLanguage(expectedLang)
    await assertPill(expectedLang)
  }

  await waitForLanguage('sv')
  await assertPill('sv')
  await switchAt(0.15, 'en')
  await switchAt(0.5, 'sv')
  await switchAt(0.85, 'en')
  const englishPill = page.getByRole('button', {
    name: 'Switch language to Swedish',
    exact: true,
  })
  await englishPill.focus()
  await page.keyboard.press('Enter')
  await waitForLanguage('sv')
  await assertPill('sv')
  await page.getByRole('button', { name: 'Byt språk till engelska', exact: true }).focus()
  await page.keyboard.press('Space')
  await waitForLanguage('en')
  await assertPill('en')
}

async function verifyFreshLanguageToggle(browser) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    colorScheme: 'dark',
    reducedMotion: 'reduce',
  })
  context.setDefaultTimeout(15000)
  await nativeBackend(context, emptyDocument())
  const page = await context.newPage()
  try {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ])
      await verifyLanguageToggle(page, { viewport, surface: null })
  } finally {
    await context.close()
  }
}

for (const [name, engine] of Object.entries({ chromium, webkit })) {
  const browser = await engine.launch()
  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      colorScheme: 'dark',
    })
    context.setDefaultTimeout(15000)
    const seed = emptyDocument()
    if (process.env.CMS_PRESENTATION_FILE)
      seed.presentation = JSON.parse(
        fs
          .readFileSync(process.env.CMS_PRESENTATION_FILE, 'utf8')
          .replaceAll('https://soktgawvexeumqvtyhda.supabase.co', 'https://admin-harness.invalid'),
      ).presentation
    const backend = await nativeBackend(context, seed)
    const page = await context.newPage()
    await verifyFreshLanguageToggle(browser)
    const check = async (mode) => {
      await page.waitForFunction(
        (mode) => globalThis.document.documentElement.style.colorScheme === mode,
        mode,
      )
      return page.evaluate(() => ({
        scheme: globalThis.getComputedStyle(globalThis.document.documentElement).colorScheme,
        body: globalThis.getComputedStyle(globalThis.document.body).backgroundColor,
        html: globalThis.getComputedStyle(globalThis.document.documentElement).backgroundColor,
        meta: globalThis.document.querySelector('meta[name="theme-color"]').content,
      }))
    }
    await page.goto(`${base}/?lang=sv&mode=dark`)
    assert.equal((await check('dark')).body, 'rgb(36, 36, 39)')
    await page.getByRole('button', { name: 'Växla ljust/mörkt' }).click()
    assert.equal((await check('light')).body, 'rgb(244, 243, 240)')
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto(base + '/tools/e2e/admin-harness.html?view=cms-studio')
    await page.evaluate(async () =>
      (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness(),
    )
    await page.locator('.cms-canvas-shell').waitFor({ timeout: 90000 })
    // Exercise actual native export/composition repeatedly, including the already-published shape.
    const result = await page.evaluate(async () => {
      const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
      const { stripComposedCanvas } = await import('/src/admin/cms/composedCanvas.ts')
      const { exportNativeCanvas } = await import('/src/admin/cms/nativeCanvas.ts')
      const editor = cmsGrapes.editors.at(-1)
      const first = exportNativeCanvas(
        editor.getHtml({ cleanId: false }),
        editor.getCss({ keepUnusedStyles: true }),
        'light',
      )
      const clean = stripComposedCanvas(first.html, first.css)
      const repeated = stripComposedCanvas(clean.html, clean.css)
      return {
        bytes: first.html.length + first.css.length,
        cleanBytes: clean.html.length + clean.css.length,
        stable: JSON.stringify(clean) === JSON.stringify(repeated),
        html: clean.html,
        css: clean.css,
      }
    })
    assert.ok(
      result.cleanBytes < result.bytes,
      'Derived About trees must not be persisted into Home',
    )
    assert.ok(result.stable, 'Repeated export must not accumulate preview CSS')
    assert.ok(!result.css.includes('#preview-shared-'))
    let firstPublishedBytes
    for (let round = 1; round <= 3; round++) {
      if (round > 1) {
        await page.setViewportSize({ width: 1440, height: 900 })
        await page.goto(base + '/tools/e2e/admin-harness.html?view=cms-studio')
        await page.evaluate(async () =>
          (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness(),
        )
        await page.locator('.cms-canvas-shell').waitFor({ timeout: 90000 })
      }
      await page.getByRole('button', { name: 'Mobil', exact: true }).click()
      const frame = page.frameLocator('.gjs-frame').first()
      const surface = frame.locator('[data-knc-surface="mobile-home"]')
      await surface.waitFor({ state: 'visible' })
      const id = await surface.evaluate(
        (root) =>
          [...root.querySelectorAll('[data-knc-source]')].find(
            (node) =>
              ['DIV', 'P', 'SPAN'].includes(node.tagName) &&
              !node.closest('[data-knc-slot]') &&
              !node.hasAttribute('data-knc-required') &&
              !node.closest('button,a,input,select,textarea,[role="button"],[role="link"]') &&
              [...node.childNodes].some(
                (child) => child.nodeType === 3 && child.textContent.trim(),
              ) &&
              node.getBoundingClientRect().height > 0,
          )?.id,
      )
      assert.ok(id, 'Editable homepage copy must exist')
      await frame.locator(`[id="${id}"]`).click()
      const copy = `Regression publication ${round}`
      await page.locator('#cms-inspector').getByLabel('Text', { exact: true }).fill(copy)
      await page.getByRole('button', { name: 'Publicera', exact: true }).click()
      await page.waitForFunction(() =>
        globalThis.document.querySelector('.cms-status')?.textContent?.includes('Publicerad'),
      )
      const home = backend.document.presentation.pages.find((p) => p.path === '/')
      const bytes = JSON.stringify(home.content.sv).length
      fs.writeFileSync(
        `/tmp/cms-public-${name}-${round}.json`,
        JSON.stringify(home.content.sv, null, 2),
      )
      firstPublishedBytes ??= bytes
      assert.ok(
        bytes <= firstPublishedBytes + 1000,
        `Home grew after publication ${round}: ${firstPublishedBytes} -> ${bytes}`,
      )
      await page.setViewportSize({ width: 390, height: 844 })
      await page.goto(base + '/?mode=dark')
      await page.getByText(copy, { exact: true }).waitFor()
      assert.equal(
        (await check('dark')).body,
        'rgb(36, 36, 39)',
        'Copy edits must preserve viewport color',
      )
    }
    const ownerIds = await installLegacyLanguageFixture(page, backend)
    for (const { viewport, surface } of [
      { viewport: { width: 1440, height: 900 }, surface: 'desktop-home' },
      { viewport: { width: 390, height: 844 }, surface: 'mobile-home' },
    ])
      await verifyLanguageToggle(page, { viewport, surface, ownerIds })
    // New site themes must paint viewport edges too, independently of the component tree.
    backend.document.presentation.themes.dark = { surface: '#123456' }
    await page.goto(base + '/?mode=dark')
    await page.waitForFunction(
      () =>
        globalThis.getComputedStyle(globalThis.document.body).backgroundColor === 'rgb(18, 52, 86)',
    )
    const themed = await check('dark')
    assert.equal(themed.html, themed.body)
    assert.equal(themed.meta, 'rgb(18, 52, 86)')
    console.log(
      `PASS ${name}: public language toggle, legacy two-button projection, dark/light viewport, CMS edge color, and three bounded publications`,
    )
  } finally {
    await browser.close()
  }
}

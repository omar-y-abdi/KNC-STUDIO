import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { gunzipSync } from 'node:zlib'
import { emptyDocument } from '../../packages/content-contracts/src/cms.ts'
import { nativeBackend } from './cms-backend.mjs'
import { test } from './fixtures.mjs'
import { harnessOrigin } from './origins.mjs'

test('derived About CSS preserves owner geometry through Undo and remount', async ({ page }) => {
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto(`${harnessOrigin}/tools/e2e/admin-harness.html`)
  const result = await page.evaluate(async () => {
    const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
    const { emptyDocument } = await import('/packages/content-contracts/src/cms.ts')
    const { validateMarkup } = await import('/packages/content-contracts/src/cms-markup.ts')
    const {
      composedCanvasPasses,
      installHomeAboutPreview,
      extractComposedAbout,
      stripComposedCanvas,
    } = await import('/modules/studio/src/composedCanvas.ts')
    const { connectCanvasStyles, parseCanvasCss, readCanvasCss } =
      await import('/modules/studio/src/nativeCanvas.ts')
    const { bindCmsRootStyles, canonicalizeCmsRootStyles } =
      await import('/modules/studio/src/cmsRootStyles.ts')
    const policy = {
      siteOrigin: globalThis.location.origin,
      storageOrigin: 'https://storage.example.test',
    }
    const homeHtml =
      '<div class="theme dark" data-knc-native="1"><div data-knc-surface="desktop-home"><h1 id="home-heading">Home</h1><div data-knc-slot="desktop-about"><section aria-labelledby="about-heading"></section></div></div><div data-knc-surface="mobile-home"><div data-knc-slot="mobile-about"><section aria-labelledby="about-heading"></section></div></div></div>'
    const aboutHtml =
      '<div data-knc-native="1"><section id="about-root" class="owner-root" data-knc-surface="about" aria-labelledby="about-heading"><h2 id="about-heading">About</h2><div class="barber-group" data-knc-fold="barber-marquee" data-knc-source="owner-strip"><div id="owner-card" class="card" data-knc-source="owner-card"><svg width="20" height="20" viewBox="0 0 20 20"><defs><clipPath id="owner-clip"><rect width="10" height="10"></rect></clipPath></defs><rect class="card-fill" width="20" height="20" clip-path="url(#owner-clip)"></rect></svg><span id="owner-label">Owner</span><a class="card-link" href="#owner-label" aria-labelledby="owner-label">Jump</a></div></div></section></div>'
    const ownerGeometry =
      '[data-knc-fold="barber-marquee"][data-knc-source] > [data-knc-source]{--owner-card-width:70%;width:var(--owner-card-width);@media(min-width:769px){&:where(#owner-card){width:44.846714%}}}'
    const aboutCss =
      ':root{--owner-paint:rgb(32,64,96)}body{--owner-active:0;--owner-nested-active:0}' +
      '.barber-group{width:500px}.card{box-sizing:border-box;padding:0;background-color:rgb(250,250,250)}' +
      ownerGeometry +
      '.card[id="owner-card"]:is(.card):not(.excluded){border:2px solid var(--owner-paint)}' +
      '.theme:is(.theme):not(.dark) .card{background-color:rgb(250,0,0)}' +
      '.card::before{content:"owner-paint";display:block;width:7px;height:7px;color:var(--owner-paint)}' +
      '.card-fill{clip-path:url(#owner-clip)}' +
      'body:has(.card.active){--owner-active:1}' +
      'body{&:has(.card.active){--owner-nested-active:1}}' +
      '@keyframes owner-still{from{opacity:.8}to{opacity:.8}}' +
      '.card{animation:owner-still 10s linear paused}'
    validateMarkup(homeHtml, '', policy, { native: true })
    validateMarkup(aboutHtml, aboutCss, policy, { native: true })
    const make = (path, html, css) => ({
      id: path,
      path,
      kind: 'page',
      name: { sv: path, en: path },
      title: { sv: '', en: '' },
      description: { sv: '', en: '' },
      inMenu: true,
      content: {
        sv: { html, css: { light: css, dark: css } },
        en: { html, css: { light: css, dark: css } },
      },
    })
    const runs = []
    for (const deferAbout of [true, false]) {
      const document = emptyDocument()
      const home = make('/', homeHtml, '')
      const about = make('/about', aboutHtml, aboutCss)
      document.presentation.pages = [home, about]
      const run = { deferAbout, stages: [], persisted: [], previewIds: [] }
      for (let mount = 0; mount < 2; mount++) {
        const passes = composedCanvasPasses(
          home,
          document.presentation,
          'sv',
          'light',
          'default',
          'Desktop',
          deferAbout,
        )
        let step = passes.next()
        while (!step.done) step = passes.next()
        const canvas = step.value
        const host = globalThis.document.createElement('div')
        host.style.width = '1500px'
        host.style.height = '900px'
        globalThis.document.body.append(host)
        const editor = cmsGrapes.init({
          container: host,
          storageManager: false,
          cssIcons: '',
          telemetry: false,
          avoidInlineStyle: true,
          protectedCss: '',
          mediaCondition: 'min-width',
          selectorManager: { componentFirst: true },
          components: canvas.html,
          deviceManager: {
            devices: [{ id: 'Desktop', width: '1440px', widthMedia: '769px' }],
          },
        })
        const release = connectCanvasStyles(editor, canvas.projectStyles)
        await new Promise((resolve) => editor.on('load', resolve))
        editor.setDevice('Desktop')
        const doc = editor.Canvas.getDocument()
        const view = doc.defaultView
        const settle = async () => {
          await new Promise((resolve) => view.requestAnimationFrame(resolve))
          await new Promise((resolve) => view.requestAnimationFrame(resolve))
        }
        const read = (card) => {
          if (!card) return null
          const style = view.getComputedStyle(card)
          const fill = card.querySelector('.card-fill')
          const link = card.querySelector('.card-link')
          const label = card.querySelector('span')
          const clip = card.querySelector('clipPath')
          return {
            width: card.getBoundingClientRect().width,
            parentWidth: card.parentElement.getBoundingClientRect().width,
            padding: style.paddingTop,
            background: style.backgroundColor,
            border: style.borderTopColor,
            borderWidth: style.borderTopWidth,
            pseudoContent: view.getComputedStyle(card, '::before').content,
            pseudoColor: view.getComputedStyle(card, '::before').color,
            opacity: style.opacity,
            active: style.getPropertyValue('--owner-active').trim(),
            nestedActive: style.getPropertyValue('--owner-nested-active').trim(),
            localHref: link.getAttribute('href') === '#' + label.id,
            localAria: link.getAttribute('aria-labelledby') === label.id,
            localClipAttribute: fill.getAttribute('clip-path') === 'url(#' + clip.id + ')',
            localClipCss: view.getComputedStyle(fill).clipPath.includes('#' + clip.id),
          }
        }
        const capture = (phase) => {
          const owner = doc.getElementById('owner-card')
          const preview = doc.querySelector('.card[id^="preview-shared-"]')
          run.stages.push({ mount, phase, owner: read(owner), preview: read(preview) })
        }
        try {
          const wrapperId = editor.getWrapper().getId()
          editor.Css.getAll().reset(
            globalThis.structuredClone(
              parseCanvasCss(bindCmsRootStyles(canvas.sheet, wrapperId), editor),
            ),
          )
          await settle()
          capture('initial')
          if (canvas.aboutPreview) {
            installHomeAboutPreview(editor, canvas.aboutPreview)
            await settle()
          }
          capture('materialized')
          const preview = doc.querySelector('.card[id^="preview-shared-"]')
          const previewComponent = editor.Components.getById(preview.id)
          editor.UndoManager.skip(() => previewComponent.addClass('active'))
          await settle()
          capture('preview-active')
          const previewRoot = preview.closest('section')
          run.previewIds.push(
            ...[previewRoot, ...previewRoot.querySelectorAll('[id]')].map((node) => node.id),
          )
          editor.UndoManager.clear()
          editor.Components.getById('owner-card').addStyle({ padding: '9px' })
          await settle()
          capture('edited')
          const undoable = editor.UndoManager.hasUndo()
          editor.UndoManager.undoAll()
          await settle()
          capture('undone')
          const html = editor.getHtml({ cleanId: false })
          const css = canonicalizeCmsRootStyles(readCanvasCss(editor), wrapperId)
          const storedHome = home.content.sv.css.light
          const extracted = extractComposedAbout(html, css, about.content.sv.html, {
            about: about.content.sv.css.light,
            home: storedHome,
          })
          const stripped = stripComposedCanvas(html, css, 'default', {
            about: extracted.css,
            home: storedHome,
            aboutHtml: about.content.sv.html,
          })
          validateMarkup(extracted.html, extracted.css, policy, { native: true })
          validateMarkup(stripped.html, stripped.css, policy, { native: true })
          run.persisted.push({ undoable, about: extracted, home: stripped })
          home.content.sv = {
            html: stripped.html,
            css: { light: stripped.css, dark: stripped.css },
          }
          about.content.sv = {
            html: extracted.html,
            css: { light: extracted.css, dark: extracted.css },
          }
        } finally {
          release()
          editor.destroy()
          host.remove()
        }
      }
      runs.push(run)
    }
    return runs
  })
  await test.info().attach('preview-css-isolation', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  })
  for (const run of result) {
    for (const stage of run.stages) {
      const context = JSON.stringify({ deferAbout: run.deferAbout, ...stage })
      assert.ok(Math.abs(stage.owner.width / stage.owner.parentWidth - 0.44846714) < 0.001, context)
      assert.equal(stage.owner.active, '0', context)
      assert.equal(stage.owner.nestedActive, '0', context)
      assert.equal(stage.owner.padding, stage.phase === 'edited' ? '9px' : '0px', context)
      if (run.deferAbout && stage.phase === 'initial') {
        assert.equal(stage.preview, null, context)
        continue
      }
      assert.ok(stage.preview, context)
      assert.ok(
        Math.abs(stage.preview.width / stage.preview.parentWidth - 0.44846714) < 0.001,
        context,
      )
      for (const card of [stage.owner, stage.preview]) {
        assert.equal(card.parentWidth, 500, context)
        assert.equal(card.background, 'rgb(250, 250, 250)', context)
        assert.equal(card.border, 'rgb(32, 64, 96)', context)
        assert.equal(card.borderWidth, '2px', context)
        assert.equal(card.pseudoContent, '"owner-paint"', context)
        assert.equal(card.pseudoColor, 'rgb(32, 64, 96)', context)
        assert.equal(card.opacity, '0.8', context)
        assert.equal(card.localHref, true, context)
        assert.equal(card.localAria, true, context)
        assert.equal(card.localClipAttribute, true, context)
        assert.equal(card.localClipCss, true, context)
      }
    }
    for (const persisted of run.persisted) {
      assert.equal(persisted.undoable, true)
      for (const page of [persisted.home, persisted.about]) {
        assert.doesNotMatch(page.html + page.css, /data-editor-|--cms-internal-/)
        for (const id of run.previewIds) {
          assert.ok(!page.html.includes(id), 'A derived ID must not be persisted in HTML')
          assert.ok(!page.css.includes(id), 'A derived ID must not be persisted in CSS')
        }
      }
      assert.ok(persisted.about.css.includes('44.846714%'))
    }
  }
  assert.deepEqual(errors, [])
})

test('Home saves keep owner CSS and match the public About cascade', async ({ page }) => {
  await page.goto(`${harnessOrigin}/tools/e2e/admin-harness.html`)
  const orphans = [
    '@media (min-width:1px){.orphan-media{color:red}}',
    '@supports (display:grid){.orphan-supports{color:red}}',
    'html body{--home-root:1}',
  ]
  const result = await page.evaluate(async (orphans) => {
    const { emptyDocument } = await import('/packages/content-contracts/src/cms.ts')
    const { composedCanvas, extractComposedAbout, stripComposedCanvas } =
      await import('/modules/studio/src/composedCanvas.ts')
    const homeHtml =
      '<div data-knc-native="1"><div data-knc-surface="desktop-home"><h1 id="home-heading" class="shared">Home</h1><div data-knc-slot="desktop-about"><section aria-labelledby="about-heading"></section></div></div><div data-knc-surface="mobile-home"><div data-knc-slot="mobile-about"><section aria-labelledby="about-heading"></section></div></div></div>'
    const aboutHtml =
      '<div data-knc-native="1"><section id="about-root" data-knc-surface="about" aria-labelledby="about-heading"><h2 id="about-heading">About</h2><div id="owner-card" class="card shared"></div></section></div>'
    const homeCss =
      orphans.join('') +
      '.shared{width:30%;@media (min-width:1px){&:where(#home-heading){width:50%}&:where(#owner-card){width:60%}}}'
    const aboutCss =
      '.card{width:70%!important;@media (min-width:1px){&:where(#owner-card){width:40%!important}}}' +
      '.only{&:where(#owner-card){color:red}}' +
      'html body{--about-root:1}'
    const make = (path, html, css) => ({
      id: path,
      path,
      kind: 'page',
      name: { sv: path, en: path },
      title: { sv: '', en: '' },
      description: { sv: '', en: '' },
      inMenu: true,
      content: {
        sv: { html, css: { light: css, dark: css } },
        en: { html, css: { light: css, dark: css } },
      },
    })
    const presentation = (home, about) => ({
      ...emptyDocument().presentation,
      pages: [home, about],
    })
    const cardWidth = (sheets) => {
      const frame = globalThis.document.createElement('iframe')
      frame.style.width = '1000px'
      globalThis.document.body.append(frame)
      const doc = frame.contentDocument
      doc.body.innerHTML =
        '<div style="width:500px"><div id="owner-card" class="card shared"></div></div>'
      for (const css of sheets) {
        const style = doc.createElement('style')
        style.textContent = css
        doc.body.append(style)
      }
      const width = doc.getElementById('owner-card').getBoundingClientRect().width
      frame.remove()
      return width
    }
    const home = make('/', homeHtml, homeCss)
    const about = make('/about', aboutHtml, aboutCss)
    const pages = presentation(home, about)
    const saves = []
    for (let round = 0; round < 4; round++) {
      const canvas = composedCanvas(home, pages, 'sv', 'light')
      const storedHome = home.content.sv.css.light
      const extracted = extractComposedAbout(canvas.html, canvas.css, about.content.sv.html, {
        about: about.content.sv.css.light,
        home: storedHome,
      })
      const owners = { about: extracted.css, home: storedHome, aboutHtml: about.content.sv.html }
      const stripped = stripComposedCanvas(canvas.html, canvas.css, 'default', owners)
      const repeated = stripComposedCanvas(stripped.html, stripped.css, 'default', owners)
      const partial = stripComposedCanvas(canvas.html, canvas.css).css
      home.content.sv = { html: stripped.html, css: { light: stripped.css, dark: stripped.css } }
      about.content.sv = {
        html: extracted.html,
        css: { light: extracted.css, dark: extracted.css },
      }
      saves.push({
        home: stripped.css,
        about: extracted.css,
        partial,
        stable: JSON.stringify(stripped) === JSON.stringify(repeated),
        published: cardWidth([stripped.css, extracted.css]),
        preview: cardWidth([composedCanvas(home, pages, 'sv', 'light').css]),
      })
    }
    return { saves, aboutOnly: cardWidth([aboutCss]) }
  }, orphans)
  assert.equal(result.aboutOnly, 200)
  const emptied = /@(media|supports)[^{]*\{\}|\.only\{\}/
  for (const [round, save] of result.saves.entries()) {
    const context = JSON.stringify(save)
    assert.ok(save.home.startsWith(orphans.join('')), context)
    for (const orphan of orphans) assert.ok(!save.about.includes(orphan), context)
    assert.ok(save.about.includes('--about-root'), context)
    if (round) {
      assert.equal(save.home, result.saves[round - 1].home, context)
      assert.equal(save.about, result.saves[round - 1].about, context)
    }
    assert.ok(save.home.includes('&:where(#home-heading)'), context)
    assert.ok(!save.home.includes('#owner-card'), context)
    assert.ok(save.about.includes('&:where(#owner-card)'), context)
    assert.ok(!save.about.includes('#home-heading'), context)
    for (const css of [save.home, save.about, save.partial])
      assert.doesNotMatch(css, emptied, context)
    assert.ok(!save.partial.includes('.only'), context)
    assert.equal(save.stable, true, context)
    assert.equal(save.published, 200, context)
    assert.equal(save.preview, 200, context)
  }
})

// Home saves in the Studio itself, on the adopted presentation. About's light Swedish sheet holds,
// per case, a rule for its heading that the canvas import marks !important: a bare-ID rule of a
// baseline element inside an at-rule. No baseline or stored rule sets the heading property this
// rule sets, so the heading's paint changes only when the rule is lost or overtaken.
const mediaHeading = '@media (min-width:769px){#om-oss-heading{text-transform:uppercase}}'
// A rule for About's first element that names Home's first element only inside :not(). Its subject
// is About's element, so About keeps it through a Home save and Home takes in none of it.
const negatedHomeId = '#knc-about-0-i0:not(#knc-desktop-home-0-i0){padding-left:17px!important}'
const importedHeading = new Map([
  [mediaHeading, '@media (min-width:769px){#om-oss-heading{text-transform:uppercase!important}}'],
])
const homeCopy = 'knc-desktop-home-0-i1-i0-i1'
const desktopAboutSlot =
  /<div id="knc-desktop-home-0-i1-i2" data-knc-slot="knc-desktop-home-0-i1-i2"[^>]*><section aria-labelledby="preview-shared-3" data-knc-baseline="\{\}"><\/section><\/div>/g
const studioSaves = [
  { name: 'a Home without a Desktop About slot', slot: false, about: [] },
  {
    name: 'a Home without a Desktop About slot, About with a heading rule inside @media',
    slot: false,
    about: [mediaHeading],
  },
  {
    name: 'a Home with its Desktop About slot, About with a heading rule inside @media',
    slot: true,
    about: [mediaHeading],
  },
  {
    name: 'a Home with its Desktop About slot, About with a rule that negates a Home ID',
    slot: true,
    about: [negatedHomeId],
  },
]
const lightSv = (document, path) =>
  document.presentation.pages.find((item) => item.path === path).content.sv
const aboutPage = (document) => document.presentation.pages.find((item) => item.path === '/about')

// Public paint as the Worker serves Home: Home's markup, then About's, each baseline element with
// its source style inline (the fixture sets no theme tokens), Home's sheet, then About's. About
// alone renders only in the Studio, on its own sheet.
function studioPaint(page, document) {
  return page.evaluate(
    ({ home, about }) => {
      const render = (html, sheets) => {
        const frame = globalThis.document.createElement('iframe')
        frame.style.width = '1000px'
        frame.style.border = '0'
        globalThis.document.body.append(frame)
        const doc = frame.contentDocument
        const styles = sheets.map((sheet) => `<style>${sheet}</style>`).join('')
        doc.open()
        doc.write(`<!doctype html><html><head>${styles}</head><body>${html}</body></html>`)
        doc.close()
        for (const element of doc.querySelectorAll('[data-knc-baseline][data-knc-light]'))
          element.setAttribute('style', element.getAttribute('data-knc-light'))
        const view = doc.defaultView
        const heading = view.getComputedStyle(doc.getElementById('om-oss-heading'))
        const measured = { transform: heading.textTransform }
        frame.remove()
        return measured
      }
      return {
        home: render(home.html + about.html, [home.css.light, about.css.light]),
        about: render(about.html, [about.css.light]),
      }
    },
    { home: lightSv(document, '/'), about: lightSv(document, '/about') },
  )
}

// Each sheet's top-level items as the CSSOM reads them, without empty rules, which paint nothing.
// A conditional block of plain rules counts rule by rule, as the canvas keeps each rule on its
// own. Also the items that name an ID in About's section.
function studioItems(page, sheets, aboutHtml) {
  return page.evaluate(
    ({ sheets, aboutHtml }) => {
      const section = new globalThis.DOMParser()
        .parseFromString(aboutHtml, 'text/html')
        .querySelector('[data-knc-surface="about"]')
      const ids = new Set([section, ...section.querySelectorAll('[id]')].map((node) => node.id))
      const filled = (rule) =>
        !(rule instanceof globalThis.CSSStyleRule) ||
        rule.style.length > 0 ||
        (rule.cssRules?.length ?? 0) > 0
      return sheets.map((css) => {
        const sheet = new globalThis.CSSStyleSheet()
        sheet.replaceSync(css)
        const items = [...sheet.cssRules].flatMap((rule) => {
          if (
            !(rule instanceof globalThis.CSSConditionRule) ||
            ![...rule.cssRules].every((child) => child instanceof globalThis.CSSStyleRule)
          )
            return filled(rule) ? [rule.cssText] : []
          const condition = rule.cssText.slice(0, rule.cssText.indexOf('{'))
          return [...rule.cssRules].filter(filled).map((child) => `${condition}{${child.cssText}}`)
        })
        return {
          items,
          about: items.filter((item) =>
            [...item.matchAll(/#([\w-]+)/g)].some(([, id]) => ids.has(id)),
          ),
        }
      })
    },
    { sheets, aboutHtml },
  )
}

// The items of `items` left over once each item of `other` has matched one equal item.
function unmatched(items, other) {
  const left = new Map()
  for (const item of other) left.set(item, (left.get(item) ?? 0) + 1)
  return items.filter((item) => {
    const count = left.get(item) ?? 0
    if (count) left.set(item, count - 1)
    return !count
  })
}

for (const { name, slot, about: aboutRules } of studioSaves) {
  test(`Studio Home saves keep Home's sheet and About's (${name})`, async ({ page, context }) => {
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setViewportSize({ width: 1440, height: 900 })
    const raw = {
      ...emptyDocument(),
      presentation: JSON.parse(
        gunzipSync(await readFile(new URL('./fixtures/presentation.json.gz', import.meta.url))),
      ).presentation,
    }
    const rawHome = lightSv(raw, '/')
    assert.equal(rawHome.html.match(desktopAboutSlot)?.length, 1, 'Home has one Desktop About slot')
    if (!slot) rawHome.html = rawHome.html.replace(desktopAboutSlot, '')
    lightSv(raw, '/about').css.light += aboutRules.join('')
    await page.goto(`${harnessOrigin}/tools/e2e/admin-harness.html`)
    // The backend holds the adopted document, so each save shows only what that save writes.
    const { stored, adopted } = await page.evaluate(async (document) => {
      const { normalizeDocument } = await import('/modules/studio/src/normalizeDocument.ts')
      const stored = normalizeDocument(document)
      return { stored, adopted: normalizeDocument(stored) === stored }
    }, raw)
    assert.equal(adopted, true, 'The stored document is already adopted')
    assert.deepEqual(stored.presentation.themes.light, {}, 'The fixture sets no theme tokens')
    const backend = await nativeBackend(context, stored)
    await context.route('**/cms-public/source', (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><html data-knc-source-listening="1"><script>addEventListener("message",e=>{document.documentElement.dataset.kncSourceError=e.data.id;document.documentElement.dataset.kncSourceFailure="Offline source"})</script></html>',
      }),
    )
    const before = await studioPaint(page, stored)
    const paints = { transform: aboutRules.includes(mediaHeading) ? 'uppercase' : 'none' }
    const saves = []
    for (const round of [1, 2]) {
      // Each save opens the Studio on the stored document, as an owner's next visit does.
      if (round > 1) await page.goto(`${harnessOrigin}/tools/e2e/admin-harness.html`)
      await page.evaluate(async () =>
        (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness(),
      )
      const frame = page.frameLocator('.gjs-frame').first()
      await frame.locator('[data-knc-surface="desktop-home"]').waitFor({ timeout: 90000 })
      // Save after the deferred About preview exists: its copy must not reach Home either.
      await page
        .locator('.cms-editor-canvas[data-cms-about-preview-ready="true"]')
        .waitFor({ timeout: 90000 })
      const slots = await frame.locator('[data-editor-about-slot]').count()
      const copy = `Studio Home save ${round}`
      await frame.locator(`[data-knc-surface="desktop-home"] [id="${homeCopy}"]`).click()
      await page.locator('#cms-inspector').getByLabel('Text', { exact: true }).fill(copy)
      await page.getByRole('button', { name: 'Publicera', exact: true }).click()
      await page.waitForFunction(
        (revision) =>
          globalThis.document.querySelector('.cms-status')?.textContent ===
          `Publicerad · rev ${revision}`,
        round + 1,
        { timeout: 45000 },
      )
      const saved = globalThis.structuredClone(backend.document)
      saves.push({ slots, copy, saved, paint: await studioPaint(page, saved) })
    }
    // About's sheet as the canvas imports it: its heading rules gain !important.
    let expectedAbout = lightSv(stored, '/about').css.light
    for (const rule of aboutRules) {
      assert.equal(expectedAbout.split(rule).length, 2, `About stores ${rule} once`)
      expectedAbout = expectedAbout.replace(rule, importedHeading.get(rule) ?? rule)
    }
    const [storedHome, home1, home2, importedAbout, about1, about2] = await studioItems(
      page,
      [
        lightSv(stored, '/').css.light,
        ...saves.map(({ saved }) => lightSv(saved, '/').css.light),
        expectedAbout,
        ...saves.map(({ saved }) => lightSv(saved, '/about').css.light),
      ],
      lightSv(stored, '/about').html,
    )
    const homes = [home1, home2]
    const abouts = [about1, about2]
    await test.info().attach('studio-home-saves', {
      body: JSON.stringify(
        {
          before,
          saves: saves.map(({ slots, copy, paint }, index) => ({
            slots,
            copy,
            paint,
            aboutRulesInHome: homes[index].about.length,
            added: unmatched(homes[index].items, storedHome.items),
            dropped: unmatched(storedHome.items, homes[index].items),
          })),
        },
        null,
        2,
      ),
      contentType: 'application/json',
    })
    assert.deepEqual(errors, [])
    assert.deepEqual(before, { home: paints, about: paints }, 'The fixture paints as designed')
    assert.deepEqual(storedHome.about, [], "Home stores no rule for About's section")
    for (const [index, save] of saves.entries()) {
      const context = `${name}, save ${index + 1}`
      const home = homes[index]
      assert.equal(
        save.slots,
        slot ? 1 : 0,
        `About's section is on the Desktop canvas exactly when Home has its Desktop slot: ${context}`,
      )
      assert.ok(
        lightSv(save.saved, '/').html.includes(`>${save.copy}<`),
        `The Home text edit is saved: ${context}`,
      )
      assert.equal(
        home.about.length,
        0,
        `Home takes in no rule for About's section; it took ${home.about.length}, first ${JSON.stringify(home.about.slice(0, 3))}: ${context}`,
      )
      const added = unmatched(home.items, storedHome.items)
      const dropped = unmatched(storedHome.items, home.items)
      assert.equal(
        added.length + dropped.length,
        0,
        `Home keeps exactly its stored rules; added ${JSON.stringify(added.slice(0, 3))} (${added.length}), dropped ${JSON.stringify(dropped.slice(0, 3))} (${dropped.length}): ${context}`,
      )
      assert.deepEqual(
        save.paint,
        before,
        `Public Home and About alone paint as before: ${context}`,
      )
      if (!slot)
        assert.deepEqual(
          aboutPage(save.saved),
          aboutPage(stored),
          `About is never written: ${context}`,
        )
      else {
        const missing = unmatched(importedAbout.items, abouts[index].items)
        const gained = unmatched(abouts[index].items, importedAbout.items)
        assert.equal(
          missing.length + gained.length,
          0,
          `About keeps every rule, its heading rules as the canvas imported them; missing ${JSON.stringify(missing.slice(0, 3))}, gained ${JSON.stringify(gained.slice(0, 3))}: ${context}`,
        )
      }
    }
    if (slot)
      assert.deepEqual(
        aboutPage(saves[1].saved),
        aboutPage(saves[0].saved),
        `About holds from the first save on: ${name}`,
      )
    // The adopted Home sheet is not a fixed point of a Studio save. The canvas keeps each rule of
    // a conditional block on its own, and composing the canvas gives Home's copies of the rules
    // About shares the place of About's copies (composedCanvas.ts, where About's sheet is
    // imported). From the first save on, the sheet holds.
    assert.equal(
      lightSv(saves[1].saved, '/').css.light,
      lightSv(saves[0].saved, '/').css.light,
      `Home's sheet holds from the first save on: ${name}`,
    )
  })
}

// Home's export keeps no rule for an element of About's section, also when the canvas lacks that
// element, and keeps its own rules for an element of Home's markup that carries an About ID.
const aboutSectionRules = [
  {
    name: "an About element removed from the Desktop slot's section",
    slot: true,
    homeCss: '#home-heading{color:blue}',
    removed: 'owner-note',
    kept: ['#home-heading{color:blue}'],
    gone: '#owner-note',
  },
  {
    name: "a Home element with an ID of About's section",
    slot: false,
    homeMarkup: '<p id="owner-note">Home</p>',
    homeCss: '#home-heading{color:blue}#owner-note{color:green}',
    kept: ['#home-heading{color:blue}', '#owner-note{color:green}'],
  },
]

for (const { name, slot, homeMarkup = '', homeCss, removed, kept, gone } of aboutSectionRules) {
  test(`Home saves keep no rule for About's section (${name})`, async ({ page }) => {
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(`${harnessOrigin}/tools/e2e/admin-harness.html`)
    const result = await page.evaluate(
      async ({ slot, homeMarkup, homeCss, removed }) => {
        const { emptyDocument } = await import('/packages/content-contracts/src/cms.ts')
        const { composedCanvas, extractComposedAbout, stripComposedCanvas } =
          await import('/modules/studio/src/composedCanvas.ts')
        const { nativeCanvas } = await import('/modules/studio/src/nativeCanvas.ts')
        const desktopSlot = slot
          ? '<div data-knc-slot="desktop-about"><section aria-labelledby="about-heading"></section></div>'
          : ''
        const homeHtml =
          `<div data-knc-native="1"><div data-knc-surface="desktop-home"><h1 id="home-heading">Home</h1>${homeMarkup}${desktopSlot}</div>` +
          '<div data-knc-surface="mobile-home"><div data-knc-slot="mobile-about"><section aria-labelledby="about-heading"></section></div></div></div>'
        const aboutHtml =
          '<div data-knc-native="1"><section id="about-root" data-knc-surface="about" aria-labelledby="about-heading"><h2 id="about-heading">About</h2><div id="owner-card" class="card"></div><p id="owner-note">About</p></section></div>'
        const aboutCss = '.card{width:50%}#owner-note{color:red}'
        const make = (path, html, css) => ({
          id: path,
          path,
          kind: 'page',
          name: { sv: path, en: path },
          title: { sv: '', en: '' },
          description: { sv: '', en: '' },
          inMenu: true,
          content: {
            sv: { html, css: { light: css, dark: css } },
            en: { html, css: { light: css, dark: css } },
          },
        })
        const home = make('/', homeHtml, homeCss)
        const about = make('/about', aboutHtml, aboutCss)
        const pages = { ...emptyDocument().presentation, pages: [home, about] }
        const canvas = composedCanvas(home, pages, 'sv', 'light')
        // The owner deleted one of About's elements on the canvas; the canvas keeps its rule.
        const edited = new globalThis.DOMParser().parseFromString(canvas.html, 'text/html')
        if (removed) edited.querySelector(`[data-editor-about-slot] [id="${removed}"]`).remove()
        const html = edited.body.innerHTML
        // As Editor.tsx saves Home.
        const extracted = extractComposedAbout(html, canvas.css, aboutHtml, {
          about: aboutCss,
          home: homeCss,
        })
        const stripped = stripComposedCanvas(html, canvas.css, 'default', {
          about: extracted?.css ?? nativeCanvas(about.content.sv, 'light').css,
          home: homeCss,
          aboutHtml,
        })
        return { extracted: extracted !== null, canvas: canvas.css, home: stripped.css }
      },
      { slot, homeMarkup, homeCss, removed },
    )
    await test.info().attach('home-save-about-section-rules', {
      body: JSON.stringify(result, null, 2),
      contentType: 'application/json',
    })
    const context = JSON.stringify({ name, ...result })
    assert.deepEqual(errors, [])
    assert.equal(
      result.extracted,
      slot,
      `A Home save extracts About exactly when About's section is on the canvas: ${context}`,
    )
    assert.ok(
      result.canvas.includes('#owner-note{color:red}'),
      `The canvas holds About's rule: ${context}`,
    )
    for (const rule of kept) assert.ok(result.home.includes(rule), `Home keeps ${rule}: ${context}`)
    if (gone)
      assert.ok(
        !result.home.includes(gone),
        `Home keeps no rule for ${gone}, which About's section holds: ${context}`,
      )
  })
}

// A Home save keeps a rule on the page of its subject. Each rule names an element of the other page
// only inside :not(), which excludes that element and adds no element to those the rule styles, or
// inside :has(), which tests a relative of the subject; the control names no other element. Home's
// first element is knc-desktop-home-0-i0 and its main knc-desktop-home-0-i1, which holds the Desktop
// About slot; About's first element is knc-about-0-i0.
const negatedIds = [
  {
    name: 'a bare About ID',
    owner: '/about',
    rule: '#knc-about-0-i0{padding-left:17px!important}',
    subject: 'knc-about-0-i0',
  },
  {
    name: "an About ID with Home's ID inside :not()",
    owner: '/about',
    rule: negatedHomeId,
    subject: 'knc-about-0-i0',
  },
  {
    name: "a Home ID with About's ID inside :not()",
    owner: '/',
    rule: '#knc-desktop-home-0-i0:not(#knc-about-0-i0){padding-left:17px!important}',
    subject: 'knc-desktop-home-0-i0',
  },
  {
    // No ID names this subject, so only the ID inside :not() could claim the rule for About.
    name: "a Home attribute selector with About's ID inside :not()",
    owner: '/',
    rule: '[id="knc-desktop-home-0-i0"]:not(#knc-about-0-i0){padding-left:17px!important}',
    subject: 'knc-desktop-home-0-i0',
  },
  {
    name: "an About ID with Home's ID inside :has(:not())",
    owner: '/about',
    rule: '#knc-about-0-i0:has(:not(#knc-desktop-home-0-i0)){padding-left:17px!important}',
    subject: 'knc-about-0-i0',
  },
  {
    name: "Home's main with About's ID inside :has()",
    owner: '/',
    rule: '#knc-desktop-home-0-i1:has(#knc-about-0-i0){padding-left:17px!important}',
    subject: 'knc-desktop-home-0-i1',
  },
]

for (const { name, owner, rule, subject } of negatedIds) {
  test(`Home saves keep a rule on the page of its subject (${name})`, async ({ page }) => {
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    const document = {
      ...emptyDocument(),
      presentation: JSON.parse(
        gunzipSync(await readFile(new URL('./fixtures/presentation.json.gz', import.meta.url))),
      ).presentation,
    }
    lightSv(document, owner).css.light += rule
    await page.goto(`${harnessOrigin}/tools/e2e/admin-harness.html`)
    const result = await page.evaluate(
      async ({ document, rule }) => {
        const { validateDocument } = await import('/packages/content-contracts/src/cms.ts')
        const { validateDocumentMarkupPlacements } =
          await import('/packages/content-contracts/src/cms-markup.ts')
        const { CMS_BUILT_ASSETS } =
          await import('/packages/content-contracts/src/cms-built-assets.ts')
        const { composedCanvas, extractComposedAbout, stripComposedCanvas } =
          await import('/modules/studio/src/composedCanvas.ts')
        const { exportNativeCanvas } = await import('/modules/studio/src/nativeCanvas.ts')
        // The publication validators accept the document. They canonicalize a copy.
        const copy = globalThis.structuredClone(document)
        validateDocument(copy)
        validateDocumentMarkupPlacements(copy, {
          siteOrigin: globalThis.location.origin,
          storageOrigin: 'https://admin-harness.invalid',
          builtAssets: CMS_BUILT_ASSETS,
        })
        const home = document.presentation.pages.find((item) => item.path === '/')
        const about = document.presentation.pages.find((item) => item.path === '/about')
        const canvas = composedCanvas(home, document.presentation, 'sv', 'light')
        const matched = [
          ...new globalThis.DOMParser()
            .parseFromString(canvas.html, 'text/html')
            .querySelectorAll(rule.slice(0, rule.indexOf('{'))),
        ].map((node) => node.id)
        // As Editor.tsx saves Home: export the native canvas, then write both owners.
        const nativeExport = exportNativeCanvas(canvas.html, canvas.css, 'light')
        const storedHome = home.content.sv.css.light
        const extracted = extractComposedAbout(
          nativeExport.html,
          nativeExport.css,
          about.content.sv.html,
          { about: about.content.sv.css.light, home: storedHome },
        )
        const stripped = stripComposedCanvas(nativeExport.html, nativeExport.css, 'default', {
          about: extracted.css,
          home: storedHome,
          aboutHtml: about.content.sv.html,
        })
        return {
          matched,
          canvas: canvas.css.includes(rule),
          nativeExport: nativeExport.css.includes(rule),
          about: extracted.css.includes(rule),
          home: stripped.css.includes(rule),
        }
      },
      { document, rule },
    )
    await test.info().attach('home-save-negated-ids', {
      body: JSON.stringify({ rule, ...result }, null, 2),
      contentType: 'application/json',
    })
    const context = JSON.stringify({ name, rule, ...result })
    const aboutOwns = owner === '/about'
    assert.deepEqual(errors, [])
    assert.deepEqual(
      result.matched,
      [subject],
      `The rule styles its subject on the canvas: ${context}`,
    )
    assert.equal(result.canvas, true, `The composed canvas holds the rule: ${context}`)
    assert.equal(result.nativeExport, true, `The native export holds the rule: ${context}`)
    assert.equal(
      result.about,
      aboutOwns,
      aboutOwns
        ? `About keeps its rule through a Home save: ${context}`
        : `About takes in none of Home's rule: ${context}`,
    )
    assert.equal(
      result.home,
      !aboutOwns,
      aboutOwns
        ? `Home takes in none of About's rule: ${context}`
        : `Home keeps its rule through a Home save: ${context}`,
    )
  })
}

// The adopted fixture with each of `sheets` appended to one sheet of its path, the light Swedish
// one unless named, held by the publication harness behind an offline source frame. The publication
// validators accept the document; they canonicalize a copy.
async function adoptedHomeFixture(page, context, sheets, lang = 'sv', mode = 'light') {
  const raw = {
    ...emptyDocument(),
    presentation: JSON.parse(
      gunzipSync(await readFile(new URL('./fixtures/presentation.json.gz', import.meta.url))),
    ).presentation,
  }
  for (const [path, css] of Object.entries(sheets))
    raw.presentation.pages.find((item) => item.path === path).content[lang].css[mode] += css
  await page.goto(`${harnessOrigin}/tools/e2e/admin-harness.html`)
  const { stored, adopted } = await page.evaluate(async (document) => {
    const { validateDocument } = await import('/packages/content-contracts/src/cms.ts')
    const { validateDocumentMarkupPlacements } =
      await import('/packages/content-contracts/src/cms-markup.ts')
    const { CMS_BUILT_ASSETS } = await import('/packages/content-contracts/src/cms-built-assets.ts')
    const { normalizeDocument } = await import('/modules/studio/src/normalizeDocument.ts')
    const copy = globalThis.structuredClone(document)
    validateDocument(copy)
    validateDocumentMarkupPlacements(copy, {
      siteOrigin: globalThis.location.origin,
      storageOrigin: 'https://admin-harness.invalid',
      builtAssets: CMS_BUILT_ASSETS,
    })
    const stored = normalizeDocument(document)
    return { stored, adopted: normalizeDocument(stored) === stored }
  }, raw)
  assert.equal(adopted, true, 'The stored document is already adopted')
  assert.deepEqual(stored.presentation.themes.light, {}, 'The fixture sets no theme tokens')
  const backend = await nativeBackend(context, stored)
  await context.route('**/cms-public/source', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html data-knc-source-listening="1"><script>addEventListener("message",e=>{document.documentElement.dataset.kncSourceError=e.data.id;document.documentElement.dataset.kncSourceFailure="Offline source"})</script></html>',
    }),
  )
  return { stored, backend }
}

// Opens the Studio on the backend's stored document, as an owner's next visit does, once the
// deferred About preview exists.
async function openStudioHome(page) {
  await page.evaluate(async () =>
    (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness(),
  )
  const frame = page.frameLocator('.gjs-frame').first()
  await frame.locator('[data-knc-surface="desktop-home"]').waitFor({ timeout: 90000 })
  await page
    .locator('.cms-editor-canvas[data-cms-about-preview-ready="true"]')
    .waitFor({ timeout: 90000 })
  return frame
}

// One unrelated Home text edit through the Text inspector, published as revision round + 1.
async function publishHomeText(page, frame, backend, round) {
  const copy = `Studio Home save ${round}`
  await frame.locator(`[data-knc-surface="desktop-home"] [id="${homeCopy}"]`).click()
  await page.locator('#cms-inspector').getByLabel('Text', { exact: true }).fill(copy)
  await page.getByRole('button', { name: 'Publicera', exact: true }).click()
  await page.waitForFunction(
    (revision) =>
      globalThis.document.querySelector('.cms-status')?.textContent ===
      `Publicerad · rev ${revision}`,
    round + 1,
    { timeout: 45000 },
  )
  const saved = globalThis.structuredClone(backend.document)
  assert.ok(lightSv(saved, '/').html.includes(`>${copy}<`), `The Home text edit is saved: ${copy}`)
  return saved
}

// The listed properties of the first canvas element each selector matches; null when none does.
function canvasValues(frame, selectors, properties) {
  return frame.locator('[data-knc-surface="desktop-home"]').evaluate(
    (surface, { selectors, properties }) => {
      const doc = surface.ownerDocument
      return Object.fromEntries(
        Object.entries(selectors).map(([name, selector]) => {
          const element = doc.querySelector(selector)
          if (!element) return [name, null]
          const style = doc.defaultView.getComputedStyle(element)
          return [
            name,
            Object.fromEntries(
              properties.map((property) => [property, style.getPropertyValue(property).trim()]),
            ),
          ]
        }),
      )
    },
    { selectors, properties },
  )
}

// The listed properties of the first element each selector matches, rendered as studioPaint renders
// public Home, under four sets of the light Swedish sheets: both pages', Home's alone, About's
// alone and none.
function sheetValues(page, document, selectors, properties) {
  return page.evaluate(
    ({ home, about, selectors, properties }) => {
      const sets = {
        combined: [home.css.light, about.css.light],
        home: [home.css.light],
        about: [about.css.light],
        none: [],
      }
      return Object.fromEntries(
        Object.entries(sets).map(([set, sheets]) => {
          const frame = globalThis.document.createElement('iframe')
          frame.style.width = '1000px'
          frame.style.border = '0'
          globalThis.document.body.append(frame)
          const doc = frame.contentDocument
          const styles = sheets.map((sheet) => `<style>${sheet}</style>`).join('')
          doc.open()
          doc.write(
            `<!doctype html><html><head>${styles}</head><body>${home.html}${about.html}</body></html>`,
          )
          doc.close()
          for (const element of doc.querySelectorAll('[data-knc-baseline][data-knc-light]'))
            element.setAttribute('style', element.getAttribute('data-knc-light'))
          const view = doc.defaultView
          const values = Object.fromEntries(
            Object.entries(selectors).map(([name, selector]) => {
              const style = view.getComputedStyle(doc.querySelector(selector))
              return [
                name,
                Object.fromEntries(
                  properties.map((property) => [property, style.getPropertyValue(property).trim()]),
                ),
              ]
            }),
          )
          frame.remove()
          return [set, values]
        }),
      )
    },
    { home: lightSv(document, '/'), about: lightSv(document, '/about'), selectors, properties },
  )
}

// The canvas keeps neither a cascade layer nor a selector function with more than one alternative.
// Home, opened on its light Swedish sheets, is not edited while it stores either: in the open sheet
// of Home or About, which the canvas imports, or a layer in any other sheet of the two pages, which
// a Home edit writes its geometry to. The stored document stays as it is, and a page that stores
// neither still opens.
const unkeptSheets = [
  {
    name: "a cascade layer in Home's open sheet",
    path: '/',
    css: '@layer base{.unkept{color:red}}',
  },
  {
    name: "a cascade layer in another of Home's sheets",
    path: '/',
    lang: 'en',
    mode: 'dark',
    css: '@layer base{.unkept{color:red}}',
  },
  {
    name: "a layer statement in another of About's sheets",
    path: '/about',
    lang: 'en',
    mode: 'dark',
    css: '@layer base,overrides;',
  },
  {
    name: "selector alternatives in Home's open sheet",
    path: '/',
    css: ':is(.unkept,.other){color:red}',
  },
  {
    name: "selector alternatives in About's open sheet",
    path: '/about',
    css: '.unkept:not(.one,.other){color:red}',
  },
]

for (const { name, path, lang, mode, css } of unkeptSheets) {
  test(`the Studio does not open Home for editing with ${name}`, async ({ page, context }) => {
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setViewportSize({ width: 1440, height: 900 })
    const { stored, backend } = await adoptedHomeFixture(page, context, { [path]: css }, lang, mode)
    await page.evaluate(async () =>
      (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness(),
    )
    await page.getByRole('heading', { name: 'Sidan kunde inte öppnas i editorn' }).waitFor()
    const refusal = 'Sidans CSS innehåller syntax som inte kan bevaras. Källan har bevarats.'
    await page.getByText('Teknisk felinformation', { exact: true }).click()
    assert.ok(
      (await page.locator('.cms-loading details').innerText()).includes(refusal),
      'The refusal names the syntax the canvas cannot keep',
    )
    assert.equal(await page.locator('.gjs-frame').count(), 0, 'No canvas imports the page')
    await page
      .getByRole('navigation', { name: 'Sidor' })
      .getByRole('button', { name: 'Bokningsvillkor' })
      .click()
    await page.locator('.gjs-frame').first().waitFor()
    assert.equal(
      await page.getByRole('heading', { name: 'Sidan kunde inte öppnas i editorn' }).count(),
      0,
      'A page without the syntax opens',
    )
    assert.deepEqual(backend.document, stored, 'The stored document is untouched')
    // The development build also reports the error its boundary shows.
    assert.deepEqual(
      errors.filter((error) => error !== refusal),
      [],
    )
  })
}

// A Home save splits a selector list that styles a Home element and an About element between the
// two pages' sheets: Home's keeps the selector for Home's element and About's the one for About's,
// each under the condition the whole list stood in. So public Home, which renders Home's sheet and
// then About's, paints both elements as before, each sheet alone styles only its own page's
// element, and the canvas paints the same after a reload. Home's first element is
// knc-desktop-home-0-i0 and About's first element knc-about-0-i0. The separate ID rules and the
// About ID inside :not(), which only excludes an element, are controls.
const crossHome = 'knc-desktop-home-0-i0'
const crossAbout = 'knc-about-0-i0'
const crossSelectors = {
  '/': [
    `#${crossHome},#${crossAbout}{--cross-plain:19px}`,
    `#${crossHome}:not(#${crossAbout}){--cross-negated:1}`,
    `@media (min-width:1px){#${crossHome},#${crossAbout}{--cross-media-plain:1}}`,
    `#${crossHome}{--home-control:23px}`,
  ].join(''),
  '/about': [
    `#${crossHome},#${crossAbout}{--cross-about-plain:1}`,
    `#${crossAbout}{--about-control:25px}`,
  ].join(''),
}
const crossPaint = {
  [crossHome]: {
    '--cross-plain': '19px',
    '--cross-negated': '1',
    '--cross-media-plain': '1',
    '--home-control': '23px',
    '--cross-about-plain': '1',
    '--about-control': '',
  },
  [crossAbout]: {
    '--cross-plain': '19px',
    '--cross-negated': '',
    '--cross-media-plain': '1',
    '--home-control': '',
    '--cross-about-plain': '1',
    '--about-control': '25px',
  },
}

test('Studio Home saves keep each selector of a list on the page of its element', async ({
  page,
  context,
}) => {
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setViewportSize({ width: 1440, height: 900 })
  const { stored, backend } = await adoptedHomeFixture(page, context, crossSelectors)
  const properties = Object.keys(crossPaint[crossHome])
  const elements = { [crossHome]: `[id="${crossHome}"]`, [crossAbout]: `[id="${crossAbout}"]` }
  const onCanvas = {
    [crossHome]: `[data-knc-surface="desktop-home"] [id="${crossHome}"]`,
    [crossAbout]: `[data-editor-about-slot] [id="${crossAbout}"]`,
  }
  const before = await sheetValues(page, stored, elements, properties)
  assert.deepEqual(before.combined, crossPaint, 'Public Home paints the fixture as designed')
  const rounds = []
  for (const round of [1, 2]) {
    if (round > 1) await page.goto(`${harnessOrigin}/tools/e2e/admin-harness.html`)
    const frame = await openStudioHome(page)
    const canvas = await canvasValues(frame, onCanvas, properties)
    const saved = await publishHomeText(page, frame, backend, round)
    const { combined, home, about } = await sheetValues(page, saved, elements, properties)
    rounds.push({
      canvas,
      combined,
      home,
      about,
      sheets: { home: lightSv(saved, '/').css.light, about: lightSv(saved, '/about').css.light },
    })
  }
  await test.info().attach('studio-home-cross-page-selectors', {
    body: JSON.stringify({ before, rounds }, null, 2),
    contentType: 'application/json',
  })
  assert.deepEqual(errors, [])
  const kept = {
    canvas: before.combined,
    combined: before.combined,
    home: { [crossHome]: before.combined[crossHome], [crossAbout]: before.none[crossAbout] },
    about: { [crossHome]: before.none[crossHome], [crossAbout]: before.combined[crossAbout] },
  }
  assert.deepEqual(
    rounds.map(({ canvas, combined, home, about }) => ({ canvas, combined, home, about })),
    [kept, kept],
    "Each Home save keeps public Home's paint, styles each element from its own page's sheet only, and the reopened canvas paints as before",
  )
})

// The canvas drops stale rules for derived preview IDs, which older Home saves could persist. A
// mention of the preview prefix anywhere else in a selector is no such rule: in an attribute
// value, a class, an unrelated ID, an attribute name or a comment. Home's first element matches
// each of these rules on the canvas, through each Home save and on public Home. The rule for a
// derived ID is the stale rule that must still go. The comment, which no selector holds once
// parsed, and About's rule, which the canvas never drops on import, are controls.
const previewMentions = {
  '/': [
    // The gate review's rule.
    `#${crossHome}:not([title='preview-shared-hint']){--authored-class:29px}`,
    `#${crossHome}:not(.preview-shared-hint){--mention-class:1}`,
    `#${crossHome}:not(#preview-shared-hint){--mention-id:1}`,
    `#${crossHome}:not([data-preview-shared-hint]){--mention-attribute:1}`,
    `#${crossHome}/* preview-shared-hint */{--mention-comment:1}`,
    '#preview-shared-0{--stale-preview:1}',
  ].join(''),
  '/about': `#${crossAbout}:not([title='preview-shared-hint']){--mention-about:1}`,
}
const mentionPaint = {
  [crossHome]: {
    '--authored-class': '29px',
    '--mention-class': '1',
    '--mention-id': '1',
    '--mention-attribute': '1',
    '--mention-comment': '1',
    '--stale-preview': '',
    '--mention-about': '',
  },
  [crossAbout]: {
    '--authored-class': '',
    '--mention-class': '',
    '--mention-id': '',
    '--mention-attribute': '',
    '--mention-comment': '',
    '--stale-preview': '',
    '--mention-about': '1',
  },
}

test('Studio Home saves keep rules that only mention the preview prefix', async ({
  page,
  context,
}) => {
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setViewportSize({ width: 1440, height: 900 })
  const { stored, backend } = await adoptedHomeFixture(page, context, previewMentions)
  const properties = Object.keys(mentionPaint[crossHome])
  const elements = { [crossHome]: `[id="${crossHome}"]`, [crossAbout]: `[id="${crossAbout}"]` }
  const onCanvas = {
    [crossHome]: `[data-knc-surface="desktop-home"] [id="${crossHome}"]`,
    [crossAbout]: `[data-editor-about-slot] [id="${crossAbout}"]`,
  }
  const before = await sheetValues(page, stored, elements, properties)
  assert.deepEqual(before.combined, mentionPaint, 'Public Home paints the fixture as designed')
  const rounds = []
  for (const round of [1, 2]) {
    if (round > 1) await page.goto(`${harnessOrigin}/tools/e2e/admin-harness.html`)
    const frame = await openStudioHome(page)
    const canvas = await canvasValues(frame, onCanvas, properties)
    // Derived preview elements, and those the stale rule styles.
    const previews = await frame
      .locator('[data-knc-surface="desktop-home"]')
      .evaluate((surface) => {
        const doc = surface.ownerDocument
        const elements = [...doc.querySelectorAll('[id^="preview-shared-"]')]
        return {
          present: elements.length > 0,
          stale: elements.filter((element) =>
            doc.defaultView.getComputedStyle(element).getPropertyValue('--stale-preview').trim(),
          ).length,
        }
      })
    const saved = await publishHomeText(page, frame, backend, round)
    const { combined, home, about } = await sheetValues(page, saved, elements, properties)
    rounds.push({
      canvas,
      previews,
      combined,
      home,
      about,
      staleStored: lightSv(saved, '/').css.light.includes('preview-shared-0'),
      sheets: { home: lightSv(saved, '/').css.light, about: lightSv(saved, '/about').css.light },
    })
  }
  await test.info().attach('studio-home-preview-mentions', {
    body: JSON.stringify({ before, rounds }, null, 2),
    contentType: 'application/json',
  })
  assert.deepEqual(errors, [])
  const kept = {
    canvas: before.combined,
    previews: { present: true, stale: 0 },
    combined: before.combined,
    home: { [crossHome]: before.combined[crossHome], [crossAbout]: before.none[crossAbout] },
    about: { [crossHome]: before.none[crossHome], [crossAbout]: before.combined[crossAbout] },
    staleStored: false,
  }
  assert.deepEqual(
    rounds.map(({ canvas, previews, combined, home, about, staleStored }) => ({
      canvas,
      previews,
      combined,
      home,
      about,
      staleStored,
    })),
    [kept, kept],
    'Each Home save keeps every rule that only mentions the preview prefix on the canvas and on public Home, and drops the stale preview rule',
  )
})

// About's rules with a condition on a Home ancestor, as the derived About copy on the canvas must
// paint them in both devices: like the public page, which renders About's section in both Home
// surfaces. In each device one surface holds About's owner and the other a derived copy, whose own
// attributes are aliased; Home's surfaces keep theirs. The ancestor is Home's mobile surface, Home's
// desktop surface, About's own section (a control), or both Home's surface and About's section.
// Each condition sets its own property over a [id] rule, which sets them all.
const ancestorHeading = 'om-oss-heading'
const ancestorRules = [
  `[id="${ancestorHeading}"]{width:101px;min-width:11px;max-width:777px;max-height:999px}`,
  `[data-knc-surface="mobile-home"] #${ancestorHeading}{width:37px}`,
  `[data-knc-surface="desktop-home"] #${ancestorHeading}{min-width:53px}`,
  `[data-knc-surface="about"] #${ancestorHeading}{max-width:333px}`,
  `[data-knc-surface="mobile-home"] [data-knc-surface="about"] #${ancestorHeading}{max-height:41px}`,
].join('')
const ancestorPaint = {
  desktop: { width: '101px', 'min-width': '53px', 'max-width': '333px', 'max-height': '999px' },
  mobile: { width: '37px', 'min-width': '11px', 'max-width': '333px', 'max-height': '41px' },
}

test('Studio About copies keep their Home ancestor conditions in both devices', async ({
  page,
  context,
}) => {
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setViewportSize({ width: 1440, height: 900 })
  const { stored } = await adoptedHomeFixture(page, context, { '/about': ancestorRules })
  const properties = Object.keys(ancestorPaint.desktop)
  // Public Home: About's section in each Home slot, both pages' sheets, inline baseline styles.
  const published = await page.evaluate(
    ({ home, about, heading, properties }) => {
      const frame = globalThis.document.createElement('iframe')
      frame.style.width = '1000px'
      frame.style.border = '0'
      globalThis.document.body.append(frame)
      const doc = frame.contentDocument
      doc.open()
      doc.write(
        `<!doctype html><html><head><style>${home.css.light}</style><style>${about.css.light}</style></head><body>${home.html}</body></html>`,
      )
      doc.close()
      const section = new globalThis.DOMParser()
        .parseFromString(about.html, 'text/html')
        .querySelector('[data-knc-surface="about"]')
      for (const slot of doc.querySelectorAll('[data-knc-slot]'))
        if (slot.querySelector(':scope > section[aria-labelledby]'))
          slot.replaceChildren(doc.importNode(section, true))
      for (const element of doc.querySelectorAll('[data-knc-baseline][data-knc-light]'))
        element.setAttribute('style', element.getAttribute('data-knc-light'))
      const values = Object.fromEntries(
        ['desktop', 'mobile'].map((surface) => {
          const element = doc.querySelector(
            `[data-knc-surface="${surface}-home"] [id="${heading}"]`,
          )
          const style = doc.defaultView.getComputedStyle(element)
          return [
            surface,
            Object.fromEntries(
              properties.map((property) => [property, style.getPropertyValue(property).trim()]),
            ),
          ]
        }),
      )
      frame.remove()
      return values
    },
    {
      home: lightSv(stored, '/'),
      about: lightSv(stored, '/about'),
      heading: ancestorHeading,
      properties,
    },
  )
  assert.deepEqual(published, ancestorPaint, 'Public Home paints the fixture as designed')
  const frame = await openStudioHome(page)
  const owner = (surface) => `[data-knc-surface="${surface}-home"] [id="${ancestorHeading}"]`
  const copy = (surface) =>
    `[data-knc-surface="${surface}-home"] [data-editor-preview-id="${ancestorHeading}"]`
  const canvas = {
    Dator: await canvasValues(
      frame,
      { desktop: owner('desktop'), mobile: copy('mobile') },
      properties,
    ),
  }
  await page.getByRole('button', { name: 'Mobil', exact: true }).click()
  await frame.locator('[data-knc-surface="mobile-home"] [data-knc-surface="about"]').waitFor()
  canvas.Mobil = await canvasValues(
    frame,
    { desktop: copy('desktop'), mobile: owner('mobile') },
    properties,
  )
  await test.info().attach('studio-about-ancestor-conditions', {
    body: JSON.stringify({ published, canvas }, null, 2),
    contentType: 'application/json',
  })
  assert.deepEqual(errors, [])
  assert.deepEqual(
    canvas,
    { Dator: published, Mobil: published },
    "About's owner and its derived copy paint as public Home in each device",
  )
})

// The gate review's composition of a derived About copy, without the Studio: the composed canvas
// for each device, its projected styles, against the canonical page with About's section in both
// Home slots.
test('composed About copies keep their Home ancestor conditions in both devices', async ({
  page,
}) => {
  await page.goto(`${harnessOrigin}/tools/e2e/admin-harness.html`)
  const result = await page.evaluate(async () => {
    const { emptyDocument } = await import('/packages/content-contracts/src/cms.ts')
    const { validateMarkup } = await import('/packages/content-contracts/src/cms-markup.ts')
    const { composedCanvas } = await import('/modules/studio/src/composedCanvas.ts')
    const homeHtml =
      '<div data-knc-native="1"><div data-knc-surface="desktop-home"><h1 id="home">Home</h1><div data-knc-slot="desktop-about"><section aria-labelledby="intro"></section></div></div><div data-knc-surface="mobile-home"><div data-knc-slot="mobile-about"><section aria-labelledby="intro"></section></div></div></div>'
    const section =
      '<section data-knc-surface="about" aria-labelledby="intro"><h2 id="intro" class="intro">About</h2></section>'
    const aboutHtml = `<div data-knc-native="1">${section}</div>`
    // The gate review's rule and control, then one more condition per property.
    const aboutCss =
      '.intro{width:101px;min-width:11px;max-width:777px;max-height:999px}' +
      '[data-knc-surface="mobile-home"] #intro { width:37px }' +
      '[data-knc-surface="desktop-home"] #intro{min-width:53px}' +
      '[data-knc-surface="about"] #intro{max-width:333px}' +
      '[data-knc-surface="mobile-home"] [data-knc-surface="about"] #intro{max-height:41px}'
    const policy = {
      siteOrigin: globalThis.location.origin,
      storageOrigin: 'https://admin-harness.invalid',
    }
    validateMarkup(homeHtml, '', policy, { native: true })
    validateMarkup(aboutHtml, aboutCss, policy, { native: true })
    const make = (path, html, css) => ({
      id: path,
      path,
      kind: 'page',
      name: { sv: path, en: path },
      title: { sv: '', en: '' },
      description: { sv: '', en: '' },
      inMenu: true,
      content: {
        sv: { html, css: { light: css, dark: css } },
        en: { html, css: { light: css, dark: css } },
      },
    })
    const home = make('/', homeHtml, '')
    const about = make('/about', aboutHtml, aboutCss)
    const pages = { ...emptyDocument().presentation, pages: [home, about] }
    const frame = globalThis.document.createElement('iframe')
    frame.style.width = '1000px'
    frame.style.border = '0'
    globalThis.document.body.append(frame)
    const measure = (html, css) => {
      const doc = frame.contentDocument
      doc.open()
      doc.write(
        `<!doctype html><html><head><style>${css}</style></head><body>${html}</body></html>`,
      )
      doc.close()
      const values = {}
      const copies = {}
      for (const surface of ['desktop', 'mobile']) {
        const element = doc.querySelector(`[data-knc-surface="${surface}-home"] .intro`)
        const style = doc.defaultView.getComputedStyle(element)
        values[surface] = Object.fromEntries(
          ['width', 'min-width', 'max-width', 'max-height'].map((property) => [
            property,
            style.getPropertyValue(property).trim(),
          ]),
        )
        copies[surface] = element.hasAttribute('data-editor-preview-id') ? 'derived' : 'owner'
      }
      return { values, copies }
    }
    const canonical = measure(
      homeHtml.replaceAll('<section aria-labelledby="intro"></section>', section),
      aboutCss,
    )
    const canvas = Object.fromEntries(
      ['Desktop', 'Mobile'].map((device) => {
        const composed = composedCanvas(home, pages, 'sv', 'light', 'default', device, true)
        return [device, measure(composed.html, composed.css)]
      }),
    )
    frame.remove()
    return { canonical, canvas }
  })
  await test.info().attach('composed-about-ancestor-conditions', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  })
  assert.deepEqual(result.canonical.values, ancestorPaint, 'The canonical page paints as designed')
  assert.deepEqual(
    {
      Desktop: result.canvas.Desktop.copies,
      Mobile: result.canvas.Mobile.copies,
    },
    {
      Desktop: { desktop: 'owner', mobile: 'derived' },
      Mobile: { desktop: 'derived', mobile: 'owner' },
    },
    'Each device composes About in its own surface and a derived copy in the other',
  )
  assert.deepEqual(
    { Desktop: result.canvas.Desktop.values, Mobile: result.canvas.Mobile.values },
    { Desktop: result.canonical.values, Mobile: result.canonical.values },
    'Both copies paint as the canonical page in each device',
  )
})

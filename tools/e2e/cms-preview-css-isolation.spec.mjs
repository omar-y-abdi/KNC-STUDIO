import assert from 'node:assert/strict'
import { test } from './fixtures.mjs'
import { harnessOrigin } from './origins.mjs'

for (const layered of [false, true]) {
  test(`derived About CSS preserves owner geometry through Undo and remount (${layered ? 'anonymous layers' : 'unlayered'})`, async ({
    page,
  }) => {
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setViewportSize({ width: 1600, height: 1000 })
    await page.goto(`${harnessOrigin}/tools/e2e/admin-harness.html`)
    const result = await page.evaluate(async (layered) => {
      const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
      const { emptyDocument } = await import('/shared/cms.ts')
      const { validateMarkup } = await import('/shared/cms-markup.ts')
      const {
        composedCanvasPasses,
        installHomeAboutPreview,
        extractComposedAbout,
        stripComposedCanvas,
      } = await import('/src/admin/cms/composedCanvas.ts')
      const { connectCanvasStyles, parseCanvasCss, readCanvasCss } =
        await import('/src/admin/cms/nativeCanvas.ts')
      const { bindCmsRootStyles, canonicalizeCmsRootStyles } =
        await import('/src/admin/cms/cmsRootStyles.ts')
      const policy = {
        siteOrigin: globalThis.location.origin,
        storageOrigin: 'https://storage.example.test',
      }
      const homeHtml =
        '<div class="theme dark" data-knc-native="1"><div data-knc-surface="desktop-home"><h1 id="home-heading">Home</h1><div data-knc-slot="desktop-about"><section aria-labelledby="about-heading"></section></div></div><div data-knc-surface="mobile-home"><div data-knc-slot="mobile-about"><section aria-labelledby="about-heading"></section></div></div></div>'
      const aboutHtml =
        '<div data-knc-native="1"><section id="about-root" class="owner-root" data-knc-surface="about" aria-labelledby="about-heading"><h2 id="about-heading">About</h2><div class="barber-group" data-knc-fold="barber-marquee" data-knc-source="owner-strip"><div id="owner-card" class="card" data-knc-source="owner-card"><svg width="20" height="20" viewBox="0 0 20 20"><defs><clipPath id="owner-clip"><rect width="10" height="10"></rect></clipPath></defs><rect class="card-fill" width="20" height="20" clip-path="url(#owner-clip)"></rect></svg><span id="owner-label">Owner</span><a class="card-link" href="#owner-label" aria-labelledby="owner-label">Jump</a></div></div></section></div>'
      const priority = layered ? '!important' : ''
      const ownerGeometry =
        '[data-knc-fold="barber-marquee"][data-knc-source] > [data-knc-source]{--owner-card-width:70%;width:var(--owner-card-width)' +
        priority +
        ';@media(min-width:769px){&:where(#owner-card){width:44.846714%' +
        priority +
        '}}}'
      const aboutCss =
        ':root{--owner-paint:rgb(32,64,96)}body{--owner-active:0;--owner-nested-active:0}' +
        '.barber-group{width:500px}.card{box-sizing:border-box;padding:0;background-color:rgb(250,250,250)}' +
        (layered
          ? '@layer{' + ownerGeometry + '}@layer{.card{width:90%!important}}'
          : ownerGeometry) +
        '.card[id="owner-card"]:is(.card,.absent):not(.excluded){border:2px solid var(--owner-paint)}' +
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
    }, layered)
    await test.info().attach('preview-css-isolation', {
      body: JSON.stringify(result, null, 2),
      contentType: 'application/json',
    })
    for (const run of result) {
      for (const stage of run.stages) {
        const context = JSON.stringify({ layered, deferAbout: run.deferAbout, ...stage })
        assert.ok(
          Math.abs(stage.owner.width / stage.owner.parentWidth - 0.44846714) < 0.001,
          context,
        )
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
}

test('Home saves keep owner CSS and match the public About cascade', async ({ page }) => {
  await page.goto(`${harnessOrigin}/tools/e2e/admin-harness.html`)
  const orphans = [
    '@layer{.orphan-layer{color:red}}',
    '@media (min-width:1px){.orphan-media{color:red}}',
    '@supports (display:grid){.orphan-supports{color:red}}',
    '@layer home-order{}',
    '@layer{html body{--home-layer-root:1}}',
    'html body{--home-root:1}',
  ]
  const result = await page.evaluate(async (orphans) => {
    const { emptyDocument } = await import('/shared/cms.ts')
    const { composedCanvas, extractComposedAbout, stripComposedCanvas } =
      await import('/src/admin/cms/composedCanvas.ts')
    const homeHtml =
      '<div data-knc-native="1"><div data-knc-surface="desktop-home"><h1 id="home-heading" class="shared">Home</h1><div data-knc-slot="desktop-about"><section aria-labelledby="about-heading"></section></div></div><div data-knc-surface="mobile-home"><div data-knc-slot="mobile-about"><section aria-labelledby="about-heading"></section></div></div></div>'
    const aboutHtml =
      '<div data-knc-native="1"><section id="about-root" data-knc-surface="about" aria-labelledby="about-heading"><h2 id="about-heading">About</h2><div id="owner-card" class="card shared"></div></section></div>'
    const homeCss =
      orphans.join('') +
      '.shared{width:30%;@media (min-width:1px){&:where(#home-heading){width:50%}&:where(#owner-card){width:60%}}}'
    const aboutCss =
      '@layer{.card{width:70%!important;@media (min-width:1px){&:where(#owner-card){width:40%!important}}}}' +
      '@layer{.card{width:90%!important}}' +
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
      const owners = { about: extracted.css, home: storedHome }
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
    const legacyHome = make('/', homeHtml, '@layer{.card{width:90%!important}}')
    const legacyAbout = make('/about', aboutHtml, aboutCss)
    const legacy = composedCanvas(
      legacyHome,
      presentation(legacyHome, legacyAbout),
      'sv',
      'light',
    ).css
    return {
      saves,
      aboutOnly: cardWidth([aboutCss]),
      legacyPublished: cardWidth([legacyHome.content.sv.css.light, aboutCss]),
      legacyPreview: cardWidth([legacy]),
    }
  }, orphans)
  assert.equal(result.aboutOnly, 200)
  // A stored layer copy changes the public page, so the preview must show it, not hide it.
  assert.equal(result.legacyPublished, 450)
  assert.equal(result.legacyPreview, 450)
  const emptied = /@(media|supports)[^{]*\{\}|@layer\{\}|\.only\{\}/
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

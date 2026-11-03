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

test('Home text edits keep the red About layer on public Home', async ({ page }) => {
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.setViewportSize({ width: 1600, height: 1000 })
  await page.goto(`${harnessOrigin}/tools/e2e/admin-harness.html`)
  const result = await page.evaluate(async () => {
    const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
    const { emptyDocument } = await import('/shared/cms.ts')
    const { validateMarkup } = await import('/shared/cms-markup.ts')
    const { composedCanvasPasses, extractComposedAbout, stripComposedCanvas } =
      await import('/src/admin/cms/composedCanvas.ts')
    const { connectCanvasStyles, parseCanvasCss, readCanvasCss } =
      await import('/src/admin/cms/nativeCanvas.ts')
    const { bindCmsRootStyles, canonicalizeCmsRootStyles } =
      await import('/src/admin/cms/cmsRootStyles.ts')
    const policy = {
      siteOrigin: globalThis.location.origin,
      storageOrigin: 'https://storage.example.test',
    }
    const homeHtml =
      '<div data-knc-native="1"><div data-knc-surface="desktop-home"><h1 id="home-heading">Home</h1><div data-knc-slot="desktop-about"><section aria-labelledby="about-heading"></section></div></div><div data-knc-surface="mobile-home"><div data-knc-slot="mobile-about"><section aria-labelledby="about-heading"></section></div></div></div>'
    const aboutHtml =
      '<div data-knc-native="1"><section id="about-root" data-knc-surface="about" aria-labelledby="about-heading"><h2 id="about-heading">About</h2><div id="owner-card" class="card"></div></section></div>'
    // The blue layer also styles a Home ID, which About's own copy must not keep.
    const aboutCss =
      '@layer{.card{color:red!important}}@layer{.card{color:blue!important}#home-heading{padding:1px}}'
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
    const document = emptyDocument()
    document.presentation.pages = [home, about]
    const passes = composedCanvasPasses(
      home,
      document.presentation,
      'sv',
      'light',
      'default',
      'Desktop',
      false,
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
    try {
      const wrapperId = editor.getWrapper().getId()
      editor.Css.getAll().reset(
        globalThis.structuredClone(
          parseCanvasCss(bindCmsRootStyles(canvas.sheet, wrapperId), editor),
        ),
      )
      editor.Components.getById('home-heading').components('Hem')
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
      // Public Home renders Home's sheet, then About's sheet, in one document.
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
        const view = doc.defaultView
        const heading = doc.getElementById('home-heading')
        const measured = {
          card: view.getComputedStyle(doc.querySelector('.card')).color,
          padding: heading && view.getComputedStyle(heading).paddingTop,
        }
        frame.remove()
        return measured
      }
      const before = render(homeHtml + aboutHtml, ['', aboutCss])
      const after = render(stripped.html + extracted.html, [stripped.css, extracted.css])
      const aboutOwn = render(extracted.html, [extracted.css])
      // GrapesJS debounces its selector sync at 0 ms; that timer must not outlive the editor.
      const canvasView = editor.Canvas.getDocument().defaultView
      await new Promise((resolve) => canvasView.requestAnimationFrame(resolve))
      await new Promise((resolve) => canvasView.requestAnimationFrame(resolve))
      return {
        before,
        after,
        aboutOwn,
        storedHome: stripped.html,
        storedHomeCss: stripped.css,
        storedAboutCss: extracted.css,
      }
    } finally {
      release()
      editor.destroy()
      host.remove()
    }
  })
  await test.info().attach('home-text-edit-layers', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  })
  assert.deepEqual(errors, [])
  assert.equal(result.before.card, 'rgb(255, 0, 0)')
  assert.equal(result.after.card, 'rgb(255, 0, 0)')
  assert.equal(result.aboutOwn.card, 'rgb(255, 0, 0)')
  assert.equal(result.before.padding, '1px')
  assert.equal(result.after.padding, '1px')
  assert.ok(result.storedHome.includes('Hem'))
})

test('Home saves keep a stored layer copy ahead of the layer before it in About', async ({
  page,
}) => {
  await page.goto(`${harnessOrigin}/tools/e2e/admin-harness.html`)
  const blue = '@layer{.card{color:blue!important}}'
  const result = await page.evaluate(async (blue) => {
    const { emptyDocument } = await import('/shared/cms.ts')
    const { composedCanvas, extractComposedAbout, stripComposedCanvas } =
      await import('/src/admin/cms/composedCanvas.ts')
    const homeHtml =
      '<div data-knc-native="1"><div data-knc-surface="desktop-home"><h1 id="home-heading">Home</h1><div data-knc-slot="desktop-about"><section aria-labelledby="about-heading"></section></div></div><div data-knc-surface="mobile-home"><div data-knc-slot="mobile-about"><section aria-labelledby="about-heading"></section></div></div></div>'
    const aboutHtml =
      '<div data-knc-native="1"><section id="about-root" data-knc-surface="about" aria-labelledby="about-heading"><h2 id="about-heading">About</h2><div id="owner-card" class="card"></div></section></div>'
    const aboutCss = `@layer{.card{color:red!important}}${blue}`
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
    const home = make('/', homeHtml, blue)
    const about = make('/about', aboutHtml, aboutCss)
    const pages = { ...emptyDocument().presentation, pages: [home, about] }
    const canvas = composedCanvas(home, pages, 'sv', 'light')
    const extracted = extractComposedAbout(canvas.html, canvas.css, aboutHtml, {
      about: aboutCss,
      home: blue,
    })
    const stripped = stripComposedCanvas(canvas.html, canvas.css, 'default', {
      about: extracted.css,
      home: blue,
    })
    return { about: extracted.css, aboutCss, home: stripped.css }
  }, blue)
  // The red layer may not join Home: it would take the stored copy's place on the public page.
  assert.equal(result.home, blue)
  assert.equal(result.about, result.aboutCss)
})

// A Home save can leave a Home layer rule that styles an About ID in About's own sheet. After every
// save, public Home paints as it did before, and About opened on its own paints as it did before:
// a text change on Home never changes About's cascade. Where a dropped Home block named one of
// About's layers before that rule's layer, About's sheet keeps an empty copy of the block, inside
// the same conditions and directly before that rule, when the order decides a cascade: About's
// layers in About's own order, or a new layer whose !important declarations would outrank About's.
// Home's declarations never stay, and Home's order of About's layers never replaces About's own.
// About's layers a and b: an !important color prefers the earlier layer and a normal background
// the later one, so a before b paints both red, and b before a paints both blue.
const aboutLayers =
  '@layer a { .card { color: red !important; background-color: blue } } ' +
  '@layer b { .card { color: blue !important; background-color: red } }'
const savedAboutLayers =
  '@layer a{.card{color:red!important;background-color:blue}}' +
  '@layer b{.card{color:blue!important;background-color:red}}'
const layerOrders = [
  {
    name: 'an empty named layer orders an anonymous one',
    homeCss: '@layer first {} @layer { #owner-card { color: blue !important } }',
    aboutSaved:
      '@layer first{}@layer{#owner-card{color:blue!important}}@layer first{.card{color:red!important}}',
  },
  {
    name: 'a layer statement orders an anonymous one',
    homeCss: '@layer first; @layer { #owner-card { color: blue !important } }',
    aboutSaved:
      '@layer first{}@layer{#owner-card{color:blue!important}}@layer first{.card{color:red!important}}',
  },
  {
    name: 'the named layer styles an About ID itself',
    homeCss:
      '@layer first { #owner-card { --anchor: 1; } } @layer { #owner-card { color: blue !important } }',
    aboutSaved:
      '@layer first{#owner-card{--anchor:1}}@layer{#owner-card{color:blue!important}}@layer first{.card{color:red!important}}',
  },
  {
    name: 'the anonymous layer styles only Home',
    homeCss: '@layer first {} @layer { #home-heading { color: blue !important } }',
    aboutSaved: '@layer first{.card{color:red!important}}',
  },
  {
    name: 'Home names About layers in About order',
    homeCss: '@layer a {} @layer b {}',
    aboutCss: aboutLayers,
    aboutSaved: savedAboutLayers,
    wins: { card: 'rgb(255, 0, 0)', background: 'rgb(255, 0, 0)' },
  },
  {
    name: 'Home names About layers in the other order',
    homeCss: '@layer b {} @layer a {}',
    aboutCss: aboutLayers,
    aboutSaved: savedAboutLayers,
    wins: { card: 'rgb(0, 0, 255)', background: 'rgb(0, 0, 255)' },
    alone: { card: 'rgb(255, 0, 0)', background: 'rgb(255, 0, 0)' },
  },
  {
    name: 'a Home block with declarations names the layer first',
    homeCss:
      '@layer first { .home-note { color: green } #home-heading { color: green } } ' +
      '@layer { #owner-card { color: blue !important } }',
    aboutSaved:
      '@layer first{}@layer{#owner-card{color:blue!important}}@layer first{.card{color:red!important}}',
  },
  {
    name: 'a later Home block names a placed layer again',
    homeCss:
      '@layer b { .home-note { color: green } } ' +
      '@supports (display: block) { @layer a { .home-aside { color: green } } @layer b { .home-tail { color: green } } }',
    aboutCss: aboutLayers,
    aboutSaved: savedAboutLayers,
    wins: { card: 'rgb(0, 0, 255)', background: 'rgb(0, 0, 255)' },
    alone: { card: 'rgb(255, 0, 0)', background: 'rgb(255, 0, 0)' },
  },
  {
    name: 'About orders its layers against the order Home gives them',
    homeCss: '@layer a { .home-note { color: green } } @layer b {}',
    aboutCss:
      '@layer b { .card { color: blue !important } } @layer a {} @layer a { .card { color: red !important } }',
    aboutSaved:
      '@layer b{.card{color:blue!important}}@layer a{}@layer a{.card{color:red!important}}',
    wins: { card: 'rgb(255, 0, 0)' },
    alone: { card: 'rgb(0, 0, 255)' },
  },
  {
    name: 'a Home block names the layer first inside a condition',
    homeCss:
      '@media (max-width: 1px) { @layer first { .home-note { color: green } } } ' +
      '@media (max-width: 1px) { @layer { #owner-card { color: blue !important } } }',
    aboutSaved:
      '@media (max-width:1px){@layer first{}}' +
      '@media (max-width:1px){@layer{#owner-card{color:blue!important}}}' +
      '@layer first{.card{color:red!important}}',
  },
  {
    name: 'a new layer with normal declarations only needs no empty block',
    homeCss: '@layer first {} @layer { #owner-card { background-color: blue } }',
    aboutCss: '@layer first { .card { color: red !important; background-color: red } }',
    aboutSaved:
      '@layer{#owner-card{background-color:blue}}@layer first{.card{color:red!important;background-color:red}}',
    wins: { card: 'rgb(255, 0, 0)', background: 'rgb(0, 0, 255)' },
    alone: { card: 'rgb(255, 0, 0)', background: 'rgb(255, 0, 0)' },
  },
  {
    name: 'Home names the first About layer before a moved rule names the second',
    homeCss: '@layer a {} @layer b { #owner-card { --anchor: 1; } }',
    aboutCss: aboutLayers,
    aboutSaved: `@layer a{}@layer b{#owner-card{--anchor:1}}${savedAboutLayers}`,
    wins: { card: 'rgb(255, 0, 0)', background: 'rgb(255, 0, 0)' },
  },
  {
    name: 'a conditional Home block names the layer before an unconditional one',
    homeCss:
      '@media (max-width: 1px) { @layer first { .home-note { color: green } } } ' +
      '@layer first {} @layer { #owner-card { color: blue !important } }',
    aboutSaved:
      '@media (max-width:1px){@layer first{}}@layer first{}' +
      '@layer{#owner-card{color:blue!important}}@layer first{.card{color:red!important}}',
  },
  {
    name: 'a later conditional Home block names the layer again',
    homeCss:
      '@layer first { .home-note { color: green } } ' +
      '@supports (display: block) { @layer first { .home-tail { color: green } } } ' +
      '@layer { #owner-card { color: blue !important } }',
    aboutSaved:
      '@layer first{}@layer{#owner-card{color:blue!important}}@layer first{.card{color:red!important}}',
  },
  {
    name: 'a moved rule names the first About layer after Home names the second',
    homeCss: '@layer b {} @layer a { #owner-card { --anchor: 1; } }',
    aboutCss: aboutLayers,
    aboutSaved: `@layer a{#owner-card{--anchor:1}}${savedAboutLayers}`,
    wins: { card: 'rgb(0, 0, 255)', background: 'rgb(0, 0, 255)' },
    alone: { card: 'rgb(255, 0, 0)', background: 'rgb(255, 0, 0)' },
  },
  {
    name: 'a moved rule names the layer before the anonymous one',
    homeCss:
      '@layer first {} @layer first { #owner-card { --anchor: 1; } } ' +
      '@layer { #owner-card { color: blue !important } }',
    aboutSaved:
      '@layer first{#owner-card{--anchor:1}}@layer{#owner-card{color:blue!important}}@layer first{.card{color:red!important}}',
  },
  {
    name: "a new layer's !important meets only normal declarations",
    homeCss:
      '@layer first { .home-note { color: green !important } } ' +
      '@layer { #owner-card { border-color: blue !important; background-color: blue } }',
    aboutCss: '@layer first { .card { background-color: red } }',
    aboutSaved:
      '@layer{#owner-card{border-color:blue!important;background-color:blue}}@layer first{.card{background-color:red}}',
    wins: { background: 'rgb(0, 0, 255)' },
    alone: { background: 'rgb(255, 0, 0)' },
  },
  {
    name: 'a moved rule names its layer inside a condition, then outside it',
    homeCss:
      '@media (max-width: 1px) { @layer first { .home-note { color: green } } } ' +
      '@media (max-width: 1px) { @layer n { #owner-card { color: blue !important } } } ' +
      '@layer first {} @layer n { #owner-card { color: blue !important } }',
    aboutSaved:
      '@media (max-width:1px){@layer first{}}' +
      '@media (max-width:1px){@layer n{#owner-card{color:blue!important}}}' +
      '@layer first{}@layer n{#owner-card{color:blue!important}}@layer first{.card{color:red!important}}',
  },
  {
    name: 'a moved rule names the layer inside a condition before the anonymous one',
    homeCss:
      '@layer first {} @media (max-width: 1px) { @layer first { #owner-card { --anchor: 1; } } } ' +
      '@layer { #owner-card { color: blue !important } }',
    aboutSaved:
      '@media (max-width:1px){@layer first{#owner-card{--anchor:1}}}@layer first{}' +
      '@layer{#owner-card{color:blue!important}}@layer first{.card{color:red!important}}',
  },
  {
    name: 'About names its layers first inside a condition',
    homeCss: '@layer a {}',
    aboutCss: `@media (max-width: 1px) { @layer a {} @layer b {} } ${aboutLayers}`,
    aboutSaved: `@media (max-width:1px){@layer a{}@layer b{}}${savedAboutLayers}`,
    wins: { card: 'rgb(255, 0, 0)', background: 'rgb(255, 0, 0)' },
  },
]
// The name of the first layer a sheet mentions: '' for an anonymous layer.
const firstLayerName = (css) => /@layer\s*([^\s{;,]*)/.exec(css)?.[1]

for (const {
  name,
  homeCss,
  aboutCss = '@layer first { .card { color: red !important } }',
  aboutSaved,
  wins = { card: 'rgb(255, 0, 0)' },
  alone = wins,
} of layerOrders) {
  test(`Home text saves keep the About layer order About opens with (${name})`, async ({
    page,
  }) => {
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.setViewportSize({ width: 1600, height: 1000 })
    await page.goto(`${harnessOrigin}/tools/e2e/admin-harness.html`)
    const sheets = { homeCss, aboutCss }
    const result = await page.evaluate(async ({ homeCss, aboutCss }) => {
      const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
      const { emptyDocument, validateDocument } = await import('/shared/cms.ts')
      const { validateDocumentMarkupPlacements } = await import('/shared/cms-markup.ts')
      const { CORE_PAGE_IDS } = await import('/src/admin/cms/corePages.ts')
      const { composedCanvasPasses, extractComposedAbout, stripComposedCanvas } =
        await import('/src/admin/cms/composedCanvas.ts')
      const { connectCanvasStyles, exportNativeCanvas, parseCanvasCss, readCanvasCss } =
        await import('/src/admin/cms/nativeCanvas.ts')
      const { bindCmsRootStyles, canonicalizeCmsRootStyles } =
        await import('/src/admin/cms/cmsRootStyles.ts')
      const { syncResponsiveText } = await import('/src/admin/cms/responsiveText.ts')
      const { syncPageLayout } = await import('/src/admin/cms/responsiveStyles.ts')
      const policy = {
        siteOrigin: globalThis.location.origin,
        storageOrigin: 'https://storage.example.test',
      }
      const homeHtml =
        '<div data-knc-native="1"><div data-knc-surface="desktop-home"><h1 id="home-heading">Home</h1><div data-knc-slot="desktop-about"><section aria-labelledby="about-heading"></section></div></div><div data-knc-surface="mobile-home"><div data-knc-slot="mobile-about"><section aria-labelledby="about-heading"></section></div></div></div>'
      const aboutHtml =
        '<div data-knc-native="1"><section id="about-root" data-knc-surface="about" aria-labelledby="about-heading"><h2 id="about-heading">About</h2><div id="owner-card" class="card"></div></section></div>'
      const make = (id, path, html, css) => ({
        id,
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
      const document = emptyDocument()
      document.presentation.pages = [
        make(CORE_PAGE_IDS[0], '/', homeHtml, homeCss),
        make(CORE_PAGE_IDS[1], '/about', aboutHtml, aboutCss),
      ]
      // The publication validators accept every stored state. They canonicalize a copy.
      const validate = () => {
        const copy = globalThis.structuredClone(document)
        validateDocument(copy)
        validateDocumentMarkupPlacements(copy, policy)
      }
      validate()
      const stored = (path) => document.presentation.pages.find((item) => item.path === path)
      // Open a page as Editor.tsx does: its composed tree, then its bound and masked sheet.
      const mount = async (page) => {
        const passes = composedCanvasPasses(
          page,
          document.presentation,
          'sv',
          'light',
          'default',
          'Desktop',
          false,
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
        const wrapperId = editor.getWrapper().getId()
        editor.Css.getAll().reset(
          globalThis.structuredClone(
            parseCanvasCss(bindCmsRootStyles(canvas.sheet, wrapperId), editor),
          ),
        )
        const view = editor.Canvas.getDocument().defaultView
        const settle = async () => {
          await new Promise((resolve) => view.requestAnimationFrame(resolve))
          await new Promise((resolve) => view.requestAnimationFrame(resolve))
        }
        await settle()
        const close = async () => {
          // GrapesJS debounces its selector sync at 0 ms; that timer must not outlive the editor.
          await settle()
          release()
          editor.destroy()
          host.remove()
        }
        return { editor, view, wrapperId, close }
      }
      // The flush in Editor.tsx: read the canvas, sync responsive text, export both owners.
      const saveHomeText = async (text) => {
        const home = stored('/')
        const about = stored('/about')
        const session = await mount(home)
        try {
          const { editor, wrapperId } = session
          editor.Components.getById('home-heading').components(text)
          let html = editor.getHtml({ cleanId: false })
          const css = readCanvasCss(editor)
          syncResponsiveText(editor, home.content.sv.html, html)
          html = editor.getHtml({ cleanId: false })
          const nativeExport = exportNativeCanvas(html, css, 'light')
          const exportedCss = canonicalizeCmsRootStyles(nativeExport.css, wrapperId)
          const storedHome = home.content.sv.css.light
          const aboutExport = extractComposedAbout(
            nativeExport.html,
            exportedCss,
            about.content.sv.html,
            { about: about.content.sv.css.light, home: storedHome },
          )
          const exported = stripComposedCanvas(nativeExport.html, exportedCss, 'default', {
            about: aboutExport.css,
            home: storedHome,
          })
          const nextHome = globalThis.structuredClone(home)
          nextHome.content.sv = {
            html: exported.html,
            css: { ...home.content.sv.css, light: exported.css },
          }
          const nextAbout = globalThis.structuredClone(about)
          nextAbout.content.sv = {
            html: aboutExport.html,
            css: { ...about.content.sv.css, light: aboutExport.css },
          }
          const saved = [
            syncPageLayout(home, nextHome, 'sv', 'light'),
            syncPageLayout(about, nextAbout, 'sv', 'light'),
          ]
          document.presentation.pages = document.presentation.pages.map(
            (item) => saved.find((next) => next.id === item.id) ?? item,
          )
        } finally {
          await session.close()
        }
      }
      // Studio opens About on its own canvas, from the stored About page alone.
      const reopenAbout = async () => {
        const session = await mount(stored('/about'))
        try {
          const card = session.editor.Canvas.getDocument().getElementById('owner-card')
          const style = session.view.getComputedStyle(card)
          return {
            paint: { card: style.color, background: style.backgroundColor },
            css: canonicalizeCmsRootStyles(readCanvasCss(session.editor), session.wrapperId),
          }
        } finally {
          await session.close()
        }
      }
      // Public Home renders Home's sheet, then About's sheet, in one document.
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
        const card = doc.defaultView.getComputedStyle(doc.getElementById('owner-card'))
        const measured = { card: card.color, background: card.backgroundColor }
        frame.remove()
        return measured
      }
      const paint = () => {
        const home = stored('/').content.sv
        const about = stored('/about').content.sv
        return {
          home: render(home.html + about.html, [home.css.light, about.css.light]),
          about: render(about.html, [about.css.light]),
        }
      }
      const before = paint()
      const saves = []
      for (const text of ['Hem', 'Home']) {
        await saveHomeText(text)
        validate()
        saves.push({
          text,
          homeHtml: stored('/').content.sv.html,
          homeCss: stored('/').content.sv.css.light,
          aboutCss: stored('/about').content.sv.css.light,
          paint: paint(),
          reopened: await reopenAbout(),
        })
      }
      return { before, saves }
    }, sheets)
    await test.info().attach('home-save-layer-order', {
      body: JSON.stringify(result, null, 2),
      contentType: 'application/json',
    })
    assert.deepEqual(errors, [])
    for (const [property, value] of Object.entries(wins))
      assert.equal(result.before.home[property], value, `Public Home paints ${property} ${value}`)
    for (const [property, value] of Object.entries(alone))
      assert.equal(result.before.about[property], value, `About alone paints ${property} ${value}`)
    for (const [round, save] of result.saves.entries()) {
      const context = JSON.stringify({ name, round, ...save })
      assert.ok(save.homeHtml.includes(`>${save.text}</h1>`), context)
      if (round) {
        assert.equal(save.homeCss, result.saves[round - 1].homeCss, context)
        assert.equal(save.aboutCss, result.saves[round - 1].aboutCss, context)
      } else assert.equal(save.aboutCss, aboutSaved, `About's sheet after a Home save: ${context}`)
      assert.ok(!save.aboutCss.includes('#home-heading'), `About keeps no Home rule: ${context}`)
      assert.deepEqual(save.paint.home, result.before.home, context)
      assert.deepEqual(
        save.paint.about,
        result.before.about,
        `About opened on its own must paint as it did before the Home save: ${context}`,
      )
      assert.deepEqual(
        save.reopened.paint,
        result.before.about,
        `The reopened About canvas must paint as About did before the Home save: ${context}`,
      )
      for (const css of [save.aboutCss, save.reopened.css])
        assert.equal(
          firstLayerName(css),
          firstLayerName(aboutSaved),
          `About must name its first layer as its saved sheet does: ${context}`,
        )
    }
  })
}

// Every anonymous @layer block is a layer of its own, and a named layer takes its place at its
// first block. Equal block text therefore does not make two blocks interchangeable: a normal
// declaration prefers the later layer, an !important one the earlier.
const repeatedLayers = [
  {
    name: 'About !important layers red, blue, red',
    homeCss: '',
    aboutCss:
      '@layer{.card{color:red!important}}@layer{.card{color:blue!important}}@layer{.card{color:red!important}}',
    wins: { card: 'rgb(255, 0, 0)' },
  },
  {
    name: 'About normal layers red, blue, red',
    homeCss: '',
    aboutCss: '@layer{.card{color:red}}@layer{.card{color:blue}}@layer{.card{color:red}}',
    wins: { card: 'rgb(255, 0, 0)' },
  },
  {
    name: 'About layers red, blue, red in both priorities',
    homeCss: '',
    aboutCss:
      '@layer{.card{color:red!important;background-color:red}}' +
      '@layer{.card{color:blue!important;background-color:blue}}' +
      '@layer{.card{color:red!important;background-color:red}}',
    wins: { card: 'rgb(255, 0, 0)', background: 'rgb(255, 0, 0)' },
  },
  {
    name: 'Home !important layers red, blue, red',
    homeCss:
      '@layer{#home-heading{color:red!important}}@layer{#home-heading{color:blue!important}}@layer{#home-heading{color:red!important}}',
    aboutCss: '',
    wins: { heading: 'rgb(255, 0, 0)' },
  },
  {
    // The F1 layers: Home keeps the blue layer's copy, because that copy styles Home's heading.
    name: 'About layers red, then blue with a Home rule',
    homeCss: '',
    aboutCss:
      '@layer{.card{color:red!important}}@layer{.card{color:blue!important}#home-heading{padding:1px}}',
    wins: { card: 'rgb(255, 0, 0)', padding: '1px' },
  },
  {
    name: 'About named layers a, b, a',
    homeCss: '',
    aboutCss: '@layer a{.card{color:red}}@layer b{.card{color:blue}}@layer a{.card{color:red}}',
    wins: { card: 'rgb(0, 0, 255)' },
  },
  {
    name: 'Home named layers a, b, a in both priorities',
    homeCss:
      '@layer a { #home-heading { color: red; padding: 2px !important } } ' +
      '@layer b { #home-heading { color: blue; padding: 1px !important } } ' +
      '@layer a { #home-heading { color: red; padding: 2px !important } }',
    aboutCss: '',
    aboutSaved: '',
    wins: { heading: 'rgb(0, 0, 255)', padding: '2px' },
  },
  // Home's and About's sheets can hold the same block. Home's items come first on the canvas, so
  // each page keeps its own copy, and Home's empty layer stays ahead of Home's later layers.
  {
    name: 'Home keeps its empty named layer ahead of its own later layer',
    homeCss:
      '@layer first {} @layer z { .card { color: blue !important } } ' +
      '@layer { #owner-card { color: blue !important } }',
    aboutCss: '@layer first { .card { color: red !important } }',
    aboutSaved:
      '@layer first{}@layer{#owner-card{color:blue!important}}@layer first{.card{color:red!important}}',
    wins: { card: 'rgb(255, 0, 0)' },
  },
  {
    name: 'Home keeps its empty named layer ahead of a conditional block of that layer',
    homeCss:
      '@layer first {} @supports (display: block) { @layer first { .home-tail { color: green } } } ' +
      '@layer { #owner-card { color: blue !important } }',
    aboutCss: '@layer first { .card { color: red !important } }',
    aboutSaved:
      '@layer first{}@layer{#owner-card{color:blue!important}}@layer first{.card{color:red!important}}',
    wins: { card: 'rgb(255, 0, 0)' },
  },
  {
    name: 'a named layer orders a moved layer, then a Home-only layer follows',
    homeCss:
      '@layer first {} @layer { #owner-card { color: blue !important } } ' +
      '@layer { #home-heading { color: blue !important } }',
    aboutCss: '@layer first { .card { color: red !important } }',
    aboutSaved:
      '@layer first{}@layer{#owner-card{color:blue!important}}@layer first{.card{color:red!important}}',
    wins: { card: 'rgb(255, 0, 0)', heading: 'rgb(0, 0, 255)' },
  },
  {
    name: 'a Home block with declarations names the layer before a moved one',
    homeCss:
      '@layer first { .home-note { color: green } #home-heading { color: green } } ' +
      '@layer { #owner-card { color: blue !important } }',
    aboutCss: '@layer first { .card { color: red !important } }',
    aboutSaved:
      '@layer first{}@layer{#owner-card{color:blue!important}}@layer first{.card{color:red!important}}',
    wins: { card: 'rgb(255, 0, 0)', heading: 'rgb(0, 128, 0)' },
  },
  {
    name: 'Home and About hold the same empty layer and order their layers differently',
    homeCss: '@layer a {} @layer b {}',
    aboutCss:
      '@layer b { .card { color: blue !important } } @layer a {} @layer a { .card { color: red !important } }',
    aboutSaved:
      '@layer b{.card{color:blue!important}}@layer a{}@layer a{.card{color:red!important}}',
    wins: { card: 'rgb(255, 0, 0)' },
  },
  {
    // About opened on its own keeps About's order a, b; public Home keeps Home's order b, a.
    name: 'Home names About layers in the other order before a moved layer',
    homeCss: '@layer b {} @layer a {} @layer { #owner-card { color: green !important } }',
    aboutCss: aboutLayers,
    aboutSaved: `@layer a{}@layer b{}@layer{#owner-card{color:green!important}}${savedAboutLayers}`,
    wins: { card: 'rgb(0, 0, 255)', background: 'rgb(0, 0, 255)' },
  },
  {
    // The moved layer with normal declarations stays ahead of the empty copy, as it was ahead of
    // About's block: About's background still wins when About opens on its own.
    name: 'a moved layer with normal declarations precedes the one that needs the empty layer',
    homeCss:
      '@layer first {} @layer { #owner-card { background-color: blue } } ' +
      '@layer { #owner-card { color: blue !important } }',
    aboutCss: '@layer first { .card { color: red !important; background-color: red } }',
    aboutSaved:
      '@layer{#owner-card{background-color:blue}}@layer first{}' +
      '@layer{#owner-card{color:blue!important}}' +
      '@layer first{.card{color:red!important;background-color:red}}',
    wins: { card: 'rgb(255, 0, 0)', background: 'rgb(0, 0, 255)' },
  },
  {
    name: 'a moved conditional block names the layer between two moved layers',
    homeCss:
      '@layer first {} @layer { #owner-card { background-color: blue } } ' +
      '@media (max-width: 1px) { @layer first { #owner-card { --anchor: 1; } } } ' +
      '@layer { #owner-card { color: blue !important } }',
    aboutCss: '@layer first { .card { color: red !important; background-color: red } }',
    aboutSaved:
      '@layer{#owner-card{background-color:blue}}' +
      '@media (max-width:1px){@layer first{#owner-card{--anchor:1}}}@layer first{}' +
      '@layer{#owner-card{color:blue!important}}' +
      '@layer first{.card{color:red!important;background-color:red}}',
    wins: { card: 'rgb(255, 0, 0)', background: 'rgb(0, 0, 255)' },
  },
]

for (const { name, homeCss, aboutCss, wins, aboutSaved } of repeatedLayers) {
  test(`Home saves keep repeated layer blocks in their cascade order (${name})`, async ({
    page,
  }) => {
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(`${harnessOrigin}/tools/e2e/admin-harness.html`)
    const result = await page.evaluate(
      async ({ homeCss, aboutCss }) => {
        const { emptyDocument, validateDocument } = await import('/shared/cms.ts')
        const { validateDocumentMarkupPlacements } = await import('/shared/cms-markup.ts')
        const { CORE_PAGE_IDS } = await import('/src/admin/cms/corePages.ts')
        const { composedCanvas, extractComposedAbout, stripComposedCanvas } =
          await import('/src/admin/cms/composedCanvas.ts')
        const policy = {
          siteOrigin: globalThis.location.origin,
          storageOrigin: 'https://storage.example.test',
        }
        const homeHtml =
          '<div data-knc-native="1"><div data-knc-surface="desktop-home"><h1 id="home-heading">Home</h1><div data-knc-slot="desktop-about"><section aria-labelledby="about-heading"></section></div></div><div data-knc-surface="mobile-home"><div data-knc-slot="mobile-about"><section aria-labelledby="about-heading"></section></div></div></div>'
        const aboutHtml =
          '<div data-knc-native="1"><section id="about-root" data-knc-surface="about" aria-labelledby="about-heading"><h2 id="about-heading">About</h2><div id="owner-card" class="card"></div></section></div>'
        const make = (id, path, html, css) => ({
          id,
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
        const document = emptyDocument()
        document.presentation.pages = [
          make(CORE_PAGE_IDS[0], '/', homeHtml, homeCss),
          make(CORE_PAGE_IDS[1], '/about', aboutHtml, aboutCss),
        ]
        // The publication validators accept every stored state. They canonicalize a copy.
        const validate = () => {
          const copy = globalThis.structuredClone(document)
          validateDocument(copy)
          validateDocumentMarkupPlacements(copy, policy)
        }
        validate()
        const stored = (path) => document.presentation.pages.find((item) => item.path === path)
        // Public Home renders Home's sheet, then About's sheet, in one document.
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
          const view = doc.defaultView
          const card = view.getComputedStyle(doc.getElementById('owner-card'))
          const heading = doc.getElementById('home-heading')
          const measured = {
            card: card.color,
            background: card.backgroundColor,
            ...(heading && {
              heading: view.getComputedStyle(heading).color,
              padding: view.getComputedStyle(heading).paddingTop,
            }),
          }
          frame.remove()
          return measured
        }
        const paint = () => {
          const home = stored('/').content.sv
          const about = stored('/about').content.sv
          return {
            home: render(home.html + about.html, [home.css.light, about.css.light]),
            about: render(about.html, [about.css.light]),
          }
        }
        const before = paint()
        const saves = []
        for (let round = 0; round < 3; round++) {
          const home = stored('/')
          const about = stored('/about')
          const canvas = composedCanvas(home, document.presentation, 'sv', 'light')
          const storedHome = home.content.sv.css.light
          const extracted = extractComposedAbout(canvas.html, canvas.css, about.content.sv.html, {
            about: about.content.sv.css.light,
            home: storedHome,
          })
          const stripped = stripComposedCanvas(canvas.html, canvas.css, 'default', {
            about: extracted.css,
            home: storedHome,
          })
          home.content.sv = {
            html: stripped.html,
            css: { ...home.content.sv.css, light: stripped.css },
          }
          about.content.sv = {
            html: extracted.html,
            css: { ...about.content.sv.css, light: extracted.css },
          }
          validate()
          saves.push({ home: stripped.css, about: extracted.css, paint: paint() })
        }
        return { before, saves }
      },
      { homeCss, aboutCss },
    )
    await test.info().attach('home-save-repeated-layers', {
      body: JSON.stringify(result, null, 2),
      contentType: 'application/json',
    })
    assert.deepEqual(errors, [])
    for (const [property, value] of Object.entries(wins))
      assert.equal(result.before.home[property], value, `The fixture paints ${property} ${value}`)
    for (const [round, save] of result.saves.entries()) {
      const context = JSON.stringify({ name, round, before: result.before, ...save })
      assert.deepEqual(
        save.paint,
        result.before,
        `Home save ${round + 1} must keep the public Home and About cascade: ${context}`,
      )
      if (round) {
        assert.equal(save.home, result.saves[round - 1].home, context)
        assert.equal(save.about, result.saves[round - 1].about, context)
      } else if (aboutSaved !== undefined)
        assert.equal(save.about, aboutSaved, `About's sheet after a Home save: ${context}`)
    }
  })
}

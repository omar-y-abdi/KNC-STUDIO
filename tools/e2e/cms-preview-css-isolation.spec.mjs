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
        '.card.active{:is(body):has(&){--owner-nested-active:1}}' +
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
            selectorManager: { componentFirst: true },
            components: canvas.html,
            deviceManager: {
              devices: [{ id: 'Desktop', width: '1440px', widthMedia: '769px' }],
            },
          })
          const release = connectCanvasStyles(editor)
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
            const extracted = extractComposedAbout(html, css, about.content.sv.html)
            const stripped = stripComposedCanvas(html, css)
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

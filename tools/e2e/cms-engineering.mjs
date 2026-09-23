/* global window, document, DOMParser, location, structuredClone, getComputedStyle */
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, webkit } from 'playwright'

const base = process.env.BASE_URL ?? 'http://127.0.0.1:4188'
const out = process.env.CMS_EVIDENCE_DIR ?? '/tmp/cms-engineering'
await mkdir(out, { recursive: true })
const results = []

// Only the I/O boundary is replaced. These are the production Preact components,
// draft transforms, projection code and DOM events, with controllable latency.
async function resources(page, state = 'active') {
  await page.goto(`${base}/tools/e2e/admin-harness.html`)
  await page.evaluate(async (state) => {
    const { h, render } = await import('/tools/e2e/admin-harness.tsx')
    const { CmsResources } = await import('/src/admin/cms/Resources.tsx')
    const { cmsApi } = await import('/src/admin/cms/api.ts')
    const { emptyDocument } = await import('/shared/cms.ts')
    const first = {
      id: '20000000-0000-4000-8000-000000000001',
      bucket: 'cms-library',
      path: 'images/first.webp',
      name: 'First image',
      mime: 'image/webp',
      alt: '',
      bytes: 100,
      width: 10,
      height: 10,
      archived: state !== 'active',
      trashed_at: state === 'trash' ? '2026-01-01T00:00:00Z' : null,
      version: 1,
    }
    const second = {
      ...first,
      id: '20000000-0000-4000-8000-000000000002',
      path: 'images/second.webp',
      name: 'Second image',
    }
    const draft = emptyDocument()
    draft.presentation.images.hero = {
      ref: { bucket: first.bucket, path: first.path },
      alt: { sv: '', en: '' },
    }
    draft.settings.business_name = 'Before'
    const model = {
      document: draft,
      assets: [first, second],
      errors: [],
      lifecycle: [],
      pending: false,
    }
    window.cmsReview = model
    const host = document.createElement('div')
    document.body.replaceChildren(host)
    const draw = () =>
      render(
        h(CmsResources, {
          document: model.document,
          assets: model.assets,
          onDocument: (update) => {
            model.document = typeof update === 'function' ? update(model.document) : update
            draw()
          },
          onAssets: (update) => {
            model.assets = typeof update === 'function' ? update(model.assets) : update
            draw()
          },
          onError: (error) => model.errors.push(error),
        }),
        host,
      )
    model.redraw = draw
    const deferred = (response) => {
      model.pending = true
      return new Promise((resolve) => {
        model.resolve = () => resolve(response)
      })
    }
    cmsApi.assetUsage = async (id) => ({
      currentReferences: id === second.id ? 7 : 0,
      historyReferences: 0,
    })
    cmsApi.uploadAsset = async () =>
      deferred({
        ...first,
        id: '20000000-0000-4000-8000-000000000003',
        path: 'images/new.webp',
        name: 'Replacement',
      })
    cmsApi.asset = async (submitted) => deferred({ ...submitted, version: submitted.version + 1 })
    cmsApi.assetLifecycle = async (submitted, action) => {
      model.lifecycle.push({ id: submitted.id, action })
      return deferred({
        asset: { ...submitted, version: submitted.version + 1, archived: true },
        usage: { currentReferences: 0, historyReferences: 0 },
      })
    }
    draw()
  }, state)
  if (state !== 'active')
    await page
      .getByRole('button', { name: state === 'trash' ? 'Papperskorg' : 'Arkiverade', exact: true })
      .click()
  await page.getByRole('button', { name: /First image/ }).click()
  await page.waitForFunction(() =>
    document.querySelector('.cms-resource-detail')?.textContent.includes('Publicerat: 0'),
  )
}

async function repeatedCards(page) {
  await page.goto(`${base}/tools/e2e/admin-harness.html`)
  return page.evaluate(async () => {
    const { h, render } = await import('/tools/e2e/admin-harness.tsx')
    const { nativeTree, NativeRegion, NativeSiteProvider } =
      await import('/src/cms/NativeSurface.tsx')
    const { snapshotNative } = await import('/src/admin/cms/nativePages.ts')
    const { emptyDocument } = await import('/shared/cms.ts')
    const { validateMarkup } = await import('/shared/cms-markup.ts')
    const surface = 'my-booking-card'
    const make = () => {
      let deep = h('span', { class: 'review-deep' }, 'Original deep text')
      for (let i = 0; i < 34; i++) deep = h('div', {}, deep)
      return h('article', {}, h('p', { id: 'owner-edit' }, 'Original wording'), deep)
    }
    const host = document.createElement('div')
    document.body.replaceChildren(host)
    render(nativeTree(make(), surface).tree, host)
    const source = new DOMParser().parseFromString(
      snapshotNative(host.firstElementChild, surface),
      'text/html',
    )
    source.getElementById('owner-edit').textContent = 'Literal knc-my-booking-card-0 stays text'
    source.querySelector('.review-deep').textContent = 'Owner-edited deep text'
    const anchor = source.createElement('p')
    anchor.id = 'owner-anchor'
    anchor.textContent = 'Owner content'
    source.body.firstElementChild.appendChild(anchor)
    const link = source.createElement('a')
    link.href = '#owner-anchor'
    link.textContent = 'Jump within card'
    source.body.firstElementChild.appendChild(link)
    const css = '#owner-anchor{color:rgb(1,2,3)}'
    const html = validateMarkup(
      source.body.innerHTML,
      css,
      { siteOrigin: location.origin, storageOrigin: 'https://admin-harness.invalid' },
      { native: true },
    ).html
    const presentation = emptyDocument().presentation
    presentation.pages = [
      {
        id: '10000000-0000-4000-8000-000000000004',
        path: '/my-bookings',
        kind: 'page',
        name: { sv: 'Bookings', en: 'Bookings' },
        title: { sv: '', en: '' },
        description: { sv: '', en: '' },
        inMenu: false,
        content: Object.fromEntries(
          ['sv', 'en'].map((lang) => [lang, { html, css: { light: css, dark: '' } }]),
        ),
      },
    ]
    render(
      h(
        NativeSiteProvider,
        { presentation },
        ['30000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002'].map(
          (instance) =>
            h(
              NativeRegion,
              { key: instance, surface, instance, lang: 'sv', mode: 'light' },
              make(),
            ),
        ),
      ),
      host,
    )
    const cards = [...host.querySelectorAll('article')]
    const ids = [...host.querySelectorAll('[id]')].map((node) => node.id)
    return {
      deep: [...host.querySelectorAll('.review-deep')].map((node) => node.textContent),
      text: cards.map((card) => card.querySelector('p')?.textContent),
      uniqueIds: new Set(ids).size === ids.length,
      localLinks: cards.every((card) => {
        const link = [...card.querySelectorAll('a')].find(
          (node) => node.textContent === 'Jump within card',
        )
        return (
          link &&
          [...card.querySelectorAll('[id]')].some(
            (node) => `#${node.id}` === link.getAttribute('href'),
          )
        )
      }),
      styled: cards.every((card) =>
        [...card.querySelectorAll('p')].some(
          (node) =>
            node.textContent === 'Owner content' && getComputedStyle(node).color === 'rgb(1, 2, 3)',
        ),
      ),
    }
  })
}

for (const [name, engine] of Object.entries({ chromium, webkit })) {
  if (process.env.CMS_ENGINE && process.env.CMS_ENGINE !== name) continue
  const browser = await engine.launch()
  const check = async (title, scenario) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await context.newPage()
    page.setDefaultTimeout(15000)
    try {
      await scenario(page)
      results.push({ engine: name, title, passed: true })
    } catch (error) {
      results.push({ engine: name, title, passed: false, error: error.stack ?? String(error) })
      await page.screenshot({ path: `${out}/${name}-${results.length}-failure.png` }).catch(() => {
        /* The failed browser may already be closed. */
      })
    } finally {
      await context.close()
    }
  }
  try {
    await check('Replacement preserves edits made while upload is pending', async (page) => {
      await resources(page)
      await page.locator('.cms-resource-detail input[type=file]').setInputFiles({
        name: 'replacement.webp',
        mimeType: 'image/webp',
        buffer: Buffer.from('fixture'),
      })
      await page.waitForFunction(() => window.cmsReview.pending)
      await page.evaluate(() => {
        const model = window.cmsReview
        model.document = structuredClone(model.document)
        model.document.settings.business_name = 'Edited during upload'
        model.redraw()
        model.resolve()
      })
      await page.waitForFunction(
        () => window.cmsReview.document.presentation.images.hero.ref.path === 'images/new.webp',
      )
      assert.equal(
        await page.evaluate(() => window.cmsReview.document.settings.business_name),
        'Edited during upload',
      )
    })
    await check('Permanent deletion protects draft-only references', async (page) => {
      await resources(page, 'trash')
      assert.equal(
        await page.getByRole('button', { name: 'Radera permanent', exact: true }).isDisabled(),
        true,
      )
    })
    await check('Bulk trash preflights draft references before any write', async (page) => {
      await resources(page)
      await page.getByRole('checkbox', { name: 'Markera First image', exact: true }).check()
      await page.getByRole('button', { name: 'Till papperskorg', exact: true }).click()
      await page.waitForFunction(
        () => window.cmsReview.errors.length || window.cmsReview.lifecycle.length,
      )
      assert.deepEqual(await page.evaluate(() => window.cmsReview.lifecycle), [])
      assert.match(await page.evaluate(() => window.cmsReview.errors.join(' ')), /utkast/i)
    })
    await check('Metadata response preserves newer unsaved typing', async (page) => {
      await resources(page)
      await page.getByLabel('Namn', { exact: true }).fill('Submitted name')
      await page.getByRole('button', { name: 'Spara metadata', exact: true }).click()
      await page.waitForFunction(() => window.cmsReview.pending)
      await page.getByLabel('Namn', { exact: true }).fill('Newer unsaved name')
      await page.evaluate(() => window.cmsReview.resolve())
      await page.waitForFunction(() => window.cmsReview.assets[0].version === 2)
      assert.equal(
        await page.getByLabel('Namn', { exact: true }).inputValue(),
        'Newer unsaved name',
      )
    })
    await check('Archive response cannot change another assets usage', async (page) => {
      await resources(page)
      await page.getByRole('button', { name: 'Arkivera', exact: true }).click()
      await page.waitForFunction(() => window.cmsReview.pending)
      await page.getByRole('button', { name: /Second image/ }).click()
      await page.waitForFunction(() =>
        document.querySelector('.cms-resource-detail')?.textContent.includes('Publicerat: 7'),
      )
      await page.evaluate(() => window.cmsReview.resolve())
      await page.waitForFunction(() => window.cmsReview.assets[0].version === 2)
      assert.match(await page.locator('.cms-resource-detail').innerText(), /Publicerat: 7/)
    })
    await check(
      'Missing scene upgrade preserves owner CSS precedence and is idempotent',
      async (page) => {
        await page.goto(`${base}/tools/e2e/admin-harness.html`)
        const actual = await page.evaluate(async () => {
          const { emptyDocument } = await import('/shared/cms.ts')
          const { ensureCorePages } = await import('/src/admin/cms/corePages.ts')
          const draft = emptyDocument()
          const original = {
            id: '10000000-0000-4000-8000-000000000003',
            path: '/booking',
            kind: 'page',
            name: { sv: 'Booking', en: 'Booking' },
            title: { sv: '', en: '' },
            description: { sv: '', en: '' },
            inMenu: false,
            content: Object.fromEntries(
              ['sv', 'en'].map((lang) => [
                lang,
                {
                  html: '<div data-knc-native="1"><section data-knc-surface="desktop-booking"><p class="owner-color">Owner heading</p></section></div>',
                  css: {
                    light: '.owner-color{color:rgb(0,128,0)}',
                    dark: '.owner-color{color:rgb(0,128,0)}',
                  },
                },
              ]),
            ),
          }
          draft.presentation.pages = [original]
          const source = structuredClone(original)
          for (const lang of ['sv', 'en']) {
            source.content[lang].html = source.content[lang].html.replace(
              '</div>',
              '<section data-knc-surface="booking-details">New scene</section></div>',
            )
            for (const mode of ['light', 'dark'])
              source.content[lang].css[mode] = '.owner-color{color:rgb(255,0,0)}'
          }
          const upgraded = ensureCorePages(draft, [source])
          const host = document.createElement('div')
          const shadow = host.attachShadow({ mode: 'open' })
          const style = document.createElement('style')
          style.textContent = upgraded.presentation.pages[0].content.sv.css.light
          shadow.append(
            style,
            new DOMParser().parseFromString(
              upgraded.presentation.pages[0].content.sv.html,
              'text/html',
            ).body,
          )
          document.body.append(host)
          return {
            color: getComputedStyle(shadow.querySelector('.owner-color')).color,
            stable:
              JSON.stringify(upgraded) === JSON.stringify(ensureCorePages(upgraded, [source])),
            originalUnchanged:
              !draft.presentation.pages[0].content.sv.html.includes('booking-details'),
          }
        })
        assert.deepEqual(actual, { color: 'rgb(0, 128, 0)', stable: true, originalUnchanged: true })
      },
    )
    await check(
      'Repeated templates preserve edits below the identity hash boundary',
      async (page) => {
        assert.deepEqual((await repeatedCards(page)).deep, [
          'Owner-edited deep text',
          'Owner-edited deep text',
        ])
      },
    )
    await check('Instance scoping leaves literal prose unchanged', async (page) => {
      assert.deepEqual((await repeatedCards(page)).text, [
        'Literal knc-my-booking-card-0 stays text',
        'Literal knc-my-booking-card-0 stays text',
      ])
    })
    await check(
      'Repeated owner IDs have local links and styles without duplicates',
      async (page) => {
        const actual = await repeatedCards(page)
        assert.equal(actual.uniqueIds, true)
        assert.equal(actual.localLinks, true)
        assert.equal(actual.styled, true)
      },
    )
    await check(
      'Nested component instances retain hooks, refs and local label targets',
      async (page) => {
        await page.goto(`${base}/tools/e2e/admin-harness.html`)
        await page.evaluate(async () => {
          const { h, render } = await import('/tools/e2e/admin-harness.tsx')
          const { createRef, useState } = await import('/tools/e2e/cms-resources-harness.tsx')
          const { useNativeChild, NativeRegion, NativeSiteProvider } =
            await import('/src/cms/NativeSurface.tsx')
          const { snapshotNative } = await import('/src/admin/cms/nativePages.ts')
          const { emptyDocument } = await import('/shared/cms.ts')
          function Child({ reference }) {
            const [count, setCount] = useState(0)
            const project = useNativeChild()
            let deep = h('p', { class: 'nested-deep' }, 'Original nested text')
            for (let i = 0; i < 35; i++) deep = h('div', {}, deep)
            return project(
              h(
                'section',
                {},
                h('label', { htmlFor: 'local-input' }, 'Local input'),
                h('input', { id: 'local-input', ref: reference }),
                h(
                  'button',
                  { class: 'local-action', onClick: () => setCount((value) => value + 1) },
                  `Count ${count}`,
                ),
                deep,
              ),
            )
          }
          const host = document.createElement('div')
          document.body.replaceChildren(host)
          const surface = 'my-booking-card'
          const make = (reference) => h('article', {}, h(Child, { key: 'child', reference }))
          render(
            h(
              NativeSiteProvider,
              { source: true },
              h(NativeRegion, { surface, lang: 'sv', mode: 'light' }, make(createRef())),
            ),
            host,
          )
          const source = new DOMParser().parseFromString(
            snapshotNative(host.querySelector('article'), surface),
            'text/html',
          )
          source.querySelector('.nested-deep').textContent = 'Nested owner edit'
          const html = `<main data-knc-native="1">${source.body.innerHTML}</main>`
          const presentation = emptyDocument().presentation
          presentation.pages = [
            {
              id: '10000000-0000-4000-8000-000000000004',
              path: '/my-bookings',
              kind: 'page',
              name: { sv: 'Bookings', en: 'Bookings' },
              title: { sv: '', en: '' },
              description: { sv: '', en: '' },
              inMenu: false,
              content: {
                sv: { html, css: { light: '', dark: '' } },
                en: { html, css: { light: '', dark: '' } },
              },
            },
          ]
          const references = [createRef(), createRef()]
          const draw = () =>
            render(
              h(
                NativeSiteProvider,
                { presentation },
                ['a/b', 'a_b'].map((instance, index) =>
                  h(
                    NativeRegion,
                    { key: instance, surface, instance, lang: 'sv', mode: 'light' },
                    make(references[index]),
                  ),
                ),
              ),
              host,
            )
          window.nestedScope = { draw, references }
          draw()
        })
        await page.locator('.local-action').first().click()
        await page.waitForFunction(
          () => document.querySelector('.local-action')?.textContent === 'Count 1',
        )
        await page.evaluate(() => window.nestedScope.draw())
        const state = await page.evaluate(() => {
          const cards = [...document.querySelectorAll('article')]
          const ids = [...document.querySelectorAll('[id]')].map((node) => node.id)
          return {
            unique: ids.length === new Set(ids).size,
            text: cards.map((card) => card.querySelector('.nested-deep')?.textContent),
            counts: cards.map((card) => card.querySelector('button')?.textContent),
            refs: cards.every(
              (card, index) =>
                window.nestedScope.references[index].current === card.querySelector('input'),
            ),
            labels: cards.every(
              (card) => card.querySelector('label')?.htmlFor === card.querySelector('input')?.id,
            ),
          }
        })
        assert.deepEqual(state, {
          unique: true,
          text: ['Nested owner edit', 'Nested owner edit'],
          counts: ['Count 1', 'Count 0'],
          refs: true,
          labels: true,
        })
      },
    )
  } finally {
    await browser.close()
  }
}
await writeFile(`${out}/review-results.json`, JSON.stringify(results, null, 2))
for (const result of results)
  console.log(
    `${result.passed ? 'PASS' : 'FAIL'} ${result.engine}: ${result.title}${result.error ? `\n${result.error}` : ''}`,
  )
assert.equal(
  results.filter((result) => !result.passed).length,
  0,
  'Adversarial CMS contracts failed',
)

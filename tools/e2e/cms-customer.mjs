import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

function captureCmsRequestMetrics(page) {
  const completed = []
  const pending = new Map()
  const byteLength = (value) => Buffer.byteLength(typeof value === 'string' ? value : '', 'utf8')
  const finish = (request, response = null) => {
    const record = pending.get(request)
    if (!record) return
    pending.delete(request)
    const { startedAt, ...summary } = record
    completed.push({
      ...summary,
      responseStatus: response?.status() ?? null,
      elapsedMs: Math.round(globalThis.performance.now() - startedAt),
      ...(response ? {} : { requestFailed: true }),
    })
  }

  page.on('request', (request) => {
    if (
      request.method() !== 'POST' ||
      !new URL(request.url()).pathname.endsWith('/functions/v1/cms-studio')
    )
      return
    let body
    try {
      body = request.postDataJSON()
    } catch {
      return
    }
    if (!body || !['validate', 'publish'].includes(body.operation)) return
    const document = body.document
    const serializedDocument = JSON.stringify(document ?? null)
    const pages = Array.isArray(document?.presentation?.pages)
      ? document.presentation.pages.map((item, index) => {
          const variants = Object.values(item.content ?? {})
          return {
            index,
            path: typeof item.path === 'string' ? item.path : null,
            htmlBytes: variants.reduce((total, variant) => total + byteLength(variant?.html), 0),
            cssBytes: variants.reduce(
              (total, variant) =>
                total + byteLength(variant?.css?.light) + byteLength(variant?.css?.dark),
              0,
            ),
          }
        })
      : []
    pending.set(request, {
      operation: body.operation,
      requestBodyBytes: byteLength(request.postData()),
      documentBytes: byteLength(serializedDocument),
      pages,
      startedAt: globalThis.performance.now(),
    })
  })
  page.on('response', (response) => finish(response.request(), response))
  page.on('requestfailed', (request) => finish(request))
  return () => [
    ...completed,
    ...[...pending.values()].map(({ startedAt, ...record }) => ({
      ...record,
      responseStatus: null,
      elapsedMs: Math.round(globalThis.performance.now() - startedAt),
      requestPending: true,
    })),
  ]
}

/** Real owner, editor and publication; customer requests remain completely unintercepted. */
export async function customerCmsFixture({ db, stack, origin, workerOrigin, work }) {
  const original = (await db.query('select * from public.cms_site where id')).rows[0]
  assert.ok(original, 'CMS singleton is missing')
  const service = createClient(stack.API_URL, stack.SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const email = `cms-browser-${randomUUID()}@example.test`
  const password = `Local-only-${randomUUID()}`
  let owner
  const copy = {
    desktop: 'Published customer gate desktop',
    mobile: 'Published customer gate mobile',
  }
  const pageSuffix = randomUUID().replaceAll('-', '').slice(0, 10)
  const pageName = `CMS customer page ${pageSuffix}`
  const pagePath = `/cms-customer-${pageSuffix}`
  const pageCopy = {
    svHeading: `Independent Swedish heading ${pageSuffix}`,
    enHeading: `Independent English heading ${pageSuffix}`,
    svBlock: `Independent Swedish block ${pageSuffix}`,
    enBlock: `Independent English block ${pageSuffix}`,
  }
  return {
    async publish(browser) {
      const created = await service.auth.admin.createUser({ email, password, email_confirm: true })
      assert.equal(created.error, null, 'Temporary CMS owner could not be created')
      owner = created.data.user.id
      await db.query(
        `insert into public.profiles(id,role,account_enabled,must_change_password)
         values($1,'owner',true,false)`,
        [owner],
      )
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        ignoreHTTPSErrors: true,
        colorScheme: 'light',
        reducedMotion: 'reduce',
      })
      context.setDefaultTimeout(15000)
      let publicContext
      const page = await context.newPage()
      const cmsRequestMetrics = captureCmsRequestMetrics(page)
      try {
        const waitForCanvasWidth = async (width) =>
          page.waitForFunction((expectedWidth) => {
            const canvas = globalThis.document.querySelector('.gjs-frame')
            const frame = canvas?.contentWindow
            return (
              canvas?.clientWidth === expectedWidth &&
              frame?.innerWidth === expectedWidth &&
              frame.matchMedia('(max-width:768px)').matches === (expectedWidth === 390)
            )
          }, width)
        await page.goto(`${origin}/login`, { waitUntil: 'domcontentloaded' })
        await page.locator('#admin-email').fill(email)
        await page.locator('#admin-password').fill(password)
        await page.locator('form button[type="submit"]').click()
        await page.waitForURL(`${origin}/admin`)
        await page.goto(`${origin}/admin/cms/`, { waitUntil: 'domcontentloaded' })
        await page.locator('.cms-canvas-shell').waitFor({ timeout: 90000 })
        const frame = page.frameLocator('.gjs-frame').first()
        for (const [device, width] of [
          ['desktop', '1440'],
          ['mobile', '390'],
        ]) {
          await page
            .getByRole('button', { name: device === 'desktop' ? 'Dator' : 'Mobil', exact: true })
            .click()
          await page.waitForFunction((expected) => {
            const canvas = globalThis.document.querySelector('.gjs-frame')
            return canvas && globalThis.getComputedStyle(canvas).width === `${expected}px`
          }, width)
          await page.getByRole('button', { name: 'Anpassa vyn', exact: true }).click()
          const surface = frame.locator(`[data-knc-surface="${device}-home"]`)
          await surface.waitFor({ state: 'visible' })
          // Pick actual readable page copy. Labels inside controls are source-marked too, but
          // editing their text cannot persist because the surrounding control is code-owned.
          const target = await surface.evaluate((root) => {
            const node = [...root.querySelectorAll('[data-knc-source]')].find(
              (node) =>
                ['DIV', 'P', 'SPAN'].includes(node.tagName) &&
                !node.closest('[data-knc-slot]') &&
                !node.hasAttribute('data-knc-required') &&
                !node.closest('button,a,input,select,textarea,[role="button"],[role="link"]') &&
                [...node.childNodes].some(
                  (child) => child.nodeType === 3 && child.textContent.trim(),
                ) &&
                node.getBoundingClientRect().height > 0,
            )
            if (!node) return null
            return {
              id: node.id,
              text: [...node.childNodes]
                .filter((child) => child.nodeType === 3)
                .map((child) => child.textContent.trim())
                .join(' ')
                .trim(),
              interactiveAncestor: node.closest(
                'button,a,input,select,textarea,[role="button"],[role="link"]',
              )?.tagName,
            }
          })
          assert.ok(target, `Original ${device} copy is missing from the editor`)
          assert.equal(target.interactiveAncestor, undefined, 'Do not select code-owned controls')
          assert.ok(
            !['SV', 'EN'].includes(target.text),
            'Language labels are not editable site copy',
          )
          await frame.locator(`[id="${target.id}"]`).click()
          await page
            .locator('#cms-inspector')
            .getByLabel('Text', { exact: true })
            .fill(copy[device])
        }

        const openStyleSector = async (name) => {
          const sector = page.getByRole('button', { name, exact: true })
          if ((await sector.getAttribute('aria-expanded')) !== 'true') await sector.click()
        }

        // Edit both legal page background variants through the owner's inspector controls.
        await page.getByRole('button', { name: 'Bokningsvillkor', exact: true }).click()
        await page.getByRole('button', { name: 'Mörk', exact: true }).click()
        await page.getByRole('button', { name: 'Dator', exact: true }).click()
        await waitForCanvasWidth(1440)
        await frame.getByRole('heading', { name: 'Bokningsvillkor', exact: true }).waitFor()
        const setLegalBackground = async (color) => {
          await frame.locator('body').click({ position: { x: 8, y: 8 } })
          await openStyleSector('Yta & kanter')
          const background = page.getByRole('textbox', {
            name: 'Bakgrundsfärg',
            exact: true,
          })
          await background.fill(color)
          await background.press('Enter')
          assert.equal(await background.inputValue(), color)
        }
        await setLegalBackground('#123456')
        await page.getByRole('button', { name: 'Ljus', exact: true }).click()
        await frame.getByRole('heading', { name: 'Bokningsvillkor', exact: true }).waitFor()
        await setLegalBackground('#234567')

        // Exercise a genuinely authored page through the same owner controls used in production.
        // The mobile/dark header styling intentionally targets the real copied site chrome.
        await page.getByRole('button', { name: 'Mörk', exact: true }).click()
        await page.getByRole('button', { name: 'Mobil', exact: true }).click()
        await waitForCanvasWidth(390)
        await page.getByRole('button', { name: 'Skapa ny sida', exact: true }).click()
        const newPage = page.getByRole('dialog', { name: 'Ny sida', exact: true })
        await newPage.getByLabel('Sidnamn', { exact: true }).fill(pageName)
        await newPage.getByLabel('Adress', { exact: true }).fill(pagePath)
        await newPage.getByRole('button', { name: 'Skapa sida', exact: true }).click()
        await frame.locator('#cms-site-header > div').waitFor({ state: 'visible' })
        await frame.getByRole('heading', { name: pageName, exact: true }).waitFor()

        const setHeaderStyle = async (color) => {
          await frame.locator('#cms-site-header > div').click({ position: { x: 8, y: 8 } })
          await openStyleSector('Yta & kanter')
          const background = page.getByRole('textbox', {
            name: 'Bakgrundsfärg',
            exact: true,
          })
          await background.fill(color)
          await background.press('Enter')
          await openStyleSector('Avstånd')
          const padding = page
            .locator('#cms-styles .gjs-sm-property')
            .filter({
              has: page.locator('.gjs-sm-label').getByText('Inre avstånd', { exact: true }),
            })
            .first()
          await padding.getByLabel('Ovanför', { exact: true }).fill('33')
          await padding.getByLabel('Ovanför', { exact: true }).press('Enter')
        }
        await setHeaderStyle('#123456')

        const ownerHeader = frame.locator('#cms-site-header > div')
        const expectedHeader = { background: 'rgb(18, 52, 86)', padding: '33px' }
        await page.waitForFunction(() => {
          const frame = globalThis.document.querySelector('.gjs-frame')
          const header = frame?.contentDocument?.querySelector('#cms-site-header > div')
          if (!header) return false
          const style = globalThis.getComputedStyle(header)
          return style.backgroundColor === 'rgb(18, 52, 86)' && style.paddingTop === '33px'
        })
        assert.deepEqual(
          await ownerHeader.evaluate((node) => ({
            background: globalThis.getComputedStyle(node).backgroundColor,
            padding: globalThis.getComputedStyle(node).paddingTop,
          })),
          expectedHeader,
          'The independent page header should reflect owner color and spacing edits before publish',
        )

        await frame.locator('#cms-site-content h1').click()
        await page
          .locator('#cms-inspector')
          .getByLabel('Text', { exact: true })
          .fill(pageCopy.svHeading)
        await frame.locator('#cms-site-content main').click({ position: { x: 8, y: 8 } })
        await page.getByRole('tab', { name: 'Lägg till', exact: true }).click()
        await page.getByRole('button', { name: 'Lägg till text', exact: true }).click()
        await page.getByRole('tab', { name: 'Design', exact: true }).click()
        await page
          .locator('#cms-inspector')
          .getByLabel('Text', { exact: true })
          .fill(pageCopy.svBlock)
        const addedBlock = frame.getByText(pageCopy.svBlock, { exact: true })
        const topBeforeMove = await addedBlock.evaluate((node) => node.getBoundingClientRect().top)
        await page.getByRole('button', { name: 'Flytta uppåt', exact: true }).click({
          modifiers: ['Shift'],
        })
        await page.waitForFunction(
          ({ text, before }) => {
            const frame = globalThis.document.querySelector('.gjs-frame')
            const node = [...(frame?.contentDocument?.querySelectorAll('p') ?? [])].find(
              (item) => item.textContent === text,
            )
            return node && Math.round(before - node.getBoundingClientRect().top) === 10
          },
          { text: pageCopy.svBlock, before: topBeforeMove },
        )
        const topAfterMove = await addedBlock.evaluate((node) => node.getBoundingClientRect().top)
        assert.equal(Math.round(topBeforeMove - topAfterMove), 10, 'The new text block was moved')

        await page.getByRole('button', { name: 'Dator', exact: true }).click()
        await waitForCanvasWidth(1440)
        await page.getByRole('button', { name: 'EN', exact: true }).click()
        await page.getByRole('button', { name: 'Ljus', exact: true }).click()
        await frame.getByRole('heading', { name: pageName, exact: true }).waitFor()
        await setHeaderStyle('#234567')
        await frame.locator('#cms-site-content h1').click()
        await page
          .locator('#cms-inspector')
          .getByLabel('Text', { exact: true })
          .fill(pageCopy.enHeading)
        await frame.locator('#cms-site-content main').click({ position: { x: 8, y: 8 } })
        await page.getByRole('tab', { name: 'Lägg till', exact: true }).click()
        await page.getByRole('button', { name: 'Lägg till text', exact: true }).click()
        await page.getByRole('tab', { name: 'Design', exact: true }).click()
        await page
          .locator('#cms-inspector')
          .getByLabel('Text', { exact: true })
          .fill(pageCopy.enBlock)

        await page.getByRole('button', { name: 'SV', exact: true }).click()
        await page.getByRole('button', { name: 'Mörk', exact: true }).click()
        await page.getByRole('button', { name: 'Mobil', exact: true }).click()
        await waitForCanvasWidth(390)
        await frame.getByText(pageCopy.svBlock, { exact: true }).waitFor()

        const publication = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname.endsWith('/functions/v1/cms-studio') &&
            response.request().method() === 'POST' &&
            response.request().postDataJSON()?.operation === 'publish',
        )
        await page.getByRole('button', { name: 'Publicera', exact: true }).click()
        const response = await publication
        assert.equal(response.status(), 200, await response.text())
        await page.waitForFunction(() =>
          globalThis.document.querySelector('.cms-status')?.textContent?.includes('Publicerad'),
        )
        const stored = (await db.query('select presentation from public.cms_site where id')).rows[0]
        const home = stored.presentation.pages.find((item) => item.path === '/')
        assert.ok(home?.content.sv.html.includes(copy.desktop))
        assert.ok(home?.content.sv.html.includes(copy.mobile))
        const authoredPage = stored.presentation.pages.find((item) => item.path === pagePath)
        assert.equal(authoredPage?.layout, 'independent')
        assert.ok(authoredPage?.content.sv.html.includes(pageCopy.svHeading))
        assert.ok(authoredPage?.content.sv.html.includes(pageCopy.svBlock))
        assert.ok(authoredPage?.content.en.html.includes(pageCopy.enHeading))
        assert.ok(authoredPage?.content.en.html.includes(pageCopy.enBlock))
        assert.ok(authoredPage?.content.sv.css.dark.includes('#123456'))
        assert.ok(authoredPage?.content.sv.css.dark.includes('33px'))
        assert.ok(authoredPage?.content.en.css.light.includes('#234567'))
        assert.ok(authoredPage?.content.en.css.light.includes('33px'))
        const legalPage = stored.presentation.pages.find((item) => item.path === '/terms')
        assert.ok(legalPage, 'The legal page remains in the published CMS document')
        assert.ok(legalPage.content.sv.css.dark.includes('html body'))
        assert.ok(legalPage.content.sv.css.dark.includes('#123456'))
        assert.ok(legalPage.content.sv.css.light.includes('html body'))
        assert.ok(legalPage.content.sv.css.light.includes('#234567'))
        for (const slot of [
          'legal-business-details-sv',
          'legal-business-details-en',
          'cancellation-policy-sv',
          'cancellation-policy-en',
        ])
          assert.ok(legalPage.content.sv.html.includes(`id="${slot}"`), `${slot} survives publish`)

        publicContext = await browser.newContext({
          viewport: { width: 390, height: 844 },
          colorScheme: 'light',
          reducedMotion: 'reduce',
          ignoreHTTPSErrors: true,
        })
        publicContext.setDefaultTimeout(15000)
        const visitor = await publicContext.newPage()
        visitor.setDefaultTimeout(15000)
        const checkPublicPage = async ({ lang, mode, heading, block, expected, viewport }) => {
          await visitor.setViewportSize(viewport)
          const url = `${workerOrigin}${pagePath}?lang=${lang}&mode=${mode}`
          const response = await visitor.goto(url, { waitUntil: 'domcontentloaded' })
          assert.equal(response?.status(), 200, 'The Worker serves the authored CMS route')
          const html = await response.text()
          assert.ok(
            html.includes('data-cms-public="1"'),
            'The response is Worker-rendered CMS HTML',
          )
          assert.ok(
            html.includes(heading),
            'The fresh Worker response includes the authored heading',
          )
          await visitor.getByRole('heading', { name: heading, exact: true }).waitFor()
          await visitor.getByText(block, { exact: true }).waitFor()
          const publicHeader = visitor.locator('#cms-site-header > div')
          const readHeaderPixels = () =>
            publicHeader.evaluate((node) => ({
              background: globalThis.getComputedStyle(node).backgroundColor,
              padding: globalThis.getComputedStyle(node).paddingTop,
            }))
          assert.deepEqual(await readHeaderPixels(), expected, 'Worker response styles the header')
          const reloaded = await visitor.reload({ waitUntil: 'domcontentloaded' })
          assert.equal(reloaded?.status(), 200, 'The Worker reloads the authored CMS route')
          const reloadedHtml = await reloaded.text()
          assert.ok(reloadedHtml.includes('data-cms-public="1"'))
          assert.ok(reloadedHtml.includes(heading))
          await visitor.getByRole('heading', { name: heading, exact: true }).waitFor()
          await visitor.getByText(block, { exact: true }).waitFor()
          assert.deepEqual(
            await readHeaderPixels(),
            expected,
            'Header pixels survive a fresh reload',
          )
          if (lang === 'sv') {
            const movedOffset = await visitor
              .getByText(block, { exact: true })
              .evaluate((node) => globalThis.getComputedStyle(node).translate)
            assert.match(
              movedOffset,
              /^0px -10px(?: 0px)?$/,
              'The moved text block keeps its vertical offset after reload',
            )
          }
          await visitor.screenshot({
            path: join(work, `cms-independent-page-${lang}-${mode}.png`),
            fullPage: true,
          })
        }
        await checkPublicPage({
          lang: 'sv',
          mode: 'dark',
          heading: pageCopy.svHeading,
          block: pageCopy.svBlock,
          expected: expectedHeader,
          viewport: { width: 390, height: 844 },
        })
        await checkPublicPage({
          lang: 'en',
          mode: 'light',
          heading: pageCopy.enHeading,
          block: pageCopy.enBlock,
          expected: { background: 'rgb(35, 69, 103)', padding: '33px' },
          viewport: { width: 1440, height: 900 },
        })

        const checkPublicLegalPage = async ({ mode, expected }) => {
          await visitor.setViewportSize({ width: 1440, height: 900 })
          const url = `${workerOrigin}/terms?lang=sv&mode=${mode}`
          const response = await visitor.goto(url, { waitUntil: 'domcontentloaded' })
          assert.equal(response?.status(), 200, 'The Worker serves the published legal route')
          const html = await response.text()
          assert.ok(
            html.includes('data-cms-public="1"'),
            'The response is Worker-rendered CMS HTML',
          )
          for (const slot of [
            'legal-business-details-sv',
            'legal-business-details-en',
            'cancellation-policy-sv',
            'cancellation-policy-en',
          ])
            assert.ok(html.includes(`id="${slot}"`), `Worker response retains ${slot}`)
          const readBodyBackground = () =>
            visitor
              .locator('body')
              .evaluate((node) => globalThis.getComputedStyle(node).backgroundColor)
          await visitor.waitForFunction(
            (color) =>
              !!globalThis.document.body &&
              globalThis.getComputedStyle(globalThis.document.body).backgroundColor === color,
            expected,
          )
          assert.equal(await readBodyBackground(), expected)
          const reloaded = await visitor.reload({ waitUntil: 'domcontentloaded' })
          assert.equal(reloaded?.status(), 200, 'The Worker reloads the legal route')
          const reloadedHtml = await reloaded.text()
          assert.ok(reloadedHtml.includes('data-cms-public="1"'))
          for (const slot of [
            'legal-business-details-sv',
            'legal-business-details-en',
            'cancellation-policy-sv',
            'cancellation-policy-en',
          ])
            assert.ok(reloadedHtml.includes(`id="${slot}"`), `Reload retains ${slot}`)
          await visitor.waitForFunction(
            (color) =>
              !!globalThis.document.body &&
              globalThis.getComputedStyle(globalThis.document.body).backgroundColor === color,
            expected,
          )
          assert.equal(
            await readBodyBackground(),
            expected,
            `The ${mode} legal background survives reload`,
          )
          await visitor.screenshot({
            path: join(work, `cms-legal-terms-sv-${mode}.png`),
            fullPage: true,
          })
        }
        await checkPublicLegalPage({ mode: 'dark', expected: 'rgb(18, 52, 86)' })
        await checkPublicLegalPage({ mode: 'light', expected: 'rgb(35, 69, 103)' })

        const initial = await page.request.get(`${origin}/`)
        assert.equal(initial.status(), 200)
        const html = await initial.text()
        assert.ok(html.length < 50000, 'Native HTML must stay bounded as CMS content grows')
        assert.ok(
          !html.includes('id="cms-native-state"'),
          'Native HTML duplicates the CMS snapshot',
        )
        const publicState = await page.request.get(`${origin}/api/cms/presentation`)
        assert.equal(publicState.status(), 200)
        const published = (await publicState.json()).presentation.pages.find(
          (item) => item.path === '/',
        )
        assert.ok(published.content.sv.html.includes(copy.desktop))
        assert.ok(published.content.sv.html.includes(copy.mobile))
        await page.screenshot({ path: join(work, 'cms-published-owner.png') })
        console.log(
          'CMS customer fixture published through the real owner UI, Edge and database; bounded Worker HTML and public presentation verified.',
        )
      } catch (error) {
        console.error('CMS customer editor:', (await page.locator('body').innerText()).slice(-4000))
        await page.screenshot({ path: join(work, 'cms-owner-failure.png'), timeout: 3000 })
        throw error
      } finally {
        await publicContext?.close()
        await context.close()
        await writeFile(
          join(work, 'cms-studio-request-metrics.json'),
          JSON.stringify(cmsRequestMetrics(), null, 2),
        )
      }
    },
    async verify(page, width) {
      await page.getByText(width <= 768 ? copy.mobile : copy.desktop, { exact: true }).waitFor()
    },
    async cleanup() {
      if (!owner) return
      await db.query('begin')
      try {
        const current = (await db.query('select revision from public.cms_site where id for update'))
          .rows[0]
        if (String(current.revision) !== String(original.revision)) {
          const revision = (
            await db.query('select actor_id from public.cms_revisions where revision=$1', [
              current.revision,
            ])
          ).rows[0]
          assert.equal(
            revision?.actor_id,
            owner,
            'Another actor changed the CMS during the isolated browser gate',
          )
          await db.query(
            'update public.cms_site set revision=$1,presentation=$2,updated_at=$3 where id',
            [original.revision, original.presentation, original.updated_at],
          )
        }
        await db.query('delete from public.cms_revisions where actor_id=$1', [owner])
        await db.query('commit')
      } catch (error) {
        await db.query('rollback')
        throw error
      }
      const deleted = await service.auth.admin.deleteUser(owner)
      assert.equal(deleted.error, null, 'Temporary CMS owner cleanup failed')
    },
  }
}

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { createClient } from '@supabase/supabase-js'

/** Real owner, editor and publication; customer requests remain completely unintercepted. */
export async function customerCmsFixture({ db, stack, origin, work }) {
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
      const page = await context.newPage()
      try {
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
          await page.getByRole('button', { name: 'Fit', exact: true }).click()
          const surface = frame.locator(`[data-knc-surface="${device}-home"]`)
          await surface.waitFor({ state: 'visible' })
          // Pick ordinary existing copy without replacing handlers, runtime islands or controls.
          const id = await surface.evaluate(
            (root) =>
              [...root.querySelectorAll('[data-knc-source]')].find(
                (node) =>
                  ['DIV', 'P', 'SPAN'].includes(node.tagName) &&
                  !node.closest('[data-knc-slot]') &&
                  !node.hasAttribute('data-knc-required') &&
                  [...node.childNodes].some(
                    (child) => child.nodeType === 3 && child.textContent.trim(),
                  ) &&
                  node.getBoundingClientRect().height > 0,
              )?.id,
          )
          assert.ok(id, `Original ${device} copy is missing from the editor`)
          await frame.locator(`[id="${id}"]`).click()
          await page
            .locator('#cms-inspector')
            .getByLabel('Text', { exact: true })
            .fill(copy[device])
        }
        const publication = page.waitForResponse(
          (response) =>
            new URL(response.url()).pathname.endsWith('/functions/v1/cms-studio') &&
            response.request().method() === 'POST' &&
            response.request().postDataJSON()?.operation === 'publish',
        )
        await page.getByRole('button', { name: 'Save / Publicera', exact: true }).click()
        const response = await publication
        assert.equal(response.status(), 200, await response.text())
        await page.waitForFunction(() =>
          globalThis.document.querySelector('.cms-status')?.textContent?.includes('Publicerad'),
        )
        const stored = (await db.query('select presentation from public.cms_site where id')).rows[0]
        const home = stored.presentation.pages.find((item) => item.path === '/')
        assert.ok(home?.content.sv.html.includes(copy.desktop))
        assert.ok(home?.content.sv.html.includes(copy.mobile))
        const initial = await page.request.get(`${origin}/`)
        assert.equal(initial.status(), 200)
        const html = await initial.text()
        assert.ok(html.includes('id="cms-native-state"'), 'Worker native state is absent')
        assert.ok(html.includes('data-cms-public="1"'), 'Worker did not render the public document')
        const root = html.slice(html.indexOf('<div id="root"'))
        assert.ok(root.includes(copy.desktop), 'Desktop edit is absent from Worker HTML')
        assert.ok(root.includes(copy.mobile), 'Mobile edit is absent from Worker HTML')
        await page.screenshot({ path: join(work, 'cms-published-owner.png') })
        console.log(
          'CMS customer fixture published through the real owner UI, Edge and database; Worker HTML contains both edits.',
        )
      } catch (error) {
        console.error('CMS customer editor:', (await page.locator('body').innerText()).slice(-4000))
        await page.screenshot({ path: join(work, 'cms-owner-failure.png'), timeout: 3000 })
        throw error
      } finally {
        await context.close()
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

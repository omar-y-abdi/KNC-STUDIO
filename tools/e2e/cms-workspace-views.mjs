import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, webkit } from 'playwright'
import { emptyDocument, EMAIL_NAMES } from '../../shared/cms.ts'
import { defaultEmailTemplate } from '../../supabase/functions/_shared/email.ts'
import { nativeBackend } from './cms-native.mjs'

const base = process.env.BASE_URL ?? 'http://127.0.0.1:4188'
const out = process.env.CMS_EVIDENCE_DIR ?? '/tmp/cms-workspace-views'
await mkdir(out, { recursive: true })
const failures = []
const checks = []
const screenshots = []
const accessibility = []
const check = (passed, message, details) => {
  checks.push({ passed: Boolean(passed), message, details })
  if (!passed) failures.push(message)
}

// These are isolated example records. No production session, data, booking or email is used.
const seed = emptyDocument()
Object.assign(seed.settings, {
  business_name: 'Blade & Blend Studio',
  business_legal_name: 'Salongen Exempel AB',
  business_org_number: '556677-8899',
  business_email: 'salong@example.com',
  business_phone_display: '031-123 45 67',
  business_phone_tel: '+46311234567',
  business_street: 'Exempelgatan 12',
  business_postal_code: '411 01',
  business_city: 'Göteborg',
  business_maps_href: 'https://maps.google.com/',
  seo_title_sv: 'Blade & Blend Studio — din nästa klippning',
  seo_description_sv:
    'Klippning och skägg med omsorg om detaljerna. Boka din tid hos Blade & Blend Studio.',
  seo_title_en: 'Blade & Blend Studio — your next haircut',
  seo_description_en:
    'Haircuts and beard trims with attention to detail. Book your next visit at Blade & Blend Studio.',
})
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
      design: null,
    }
  }),
)
const assets = [
  'Salongens logotyp',
  'Profilbild — frisör',
  'Sommarklippning',
  'Salongen från entrén',
  'Inspiration för nästa besök',
  'Omslag med ett långt filnamn som ska rymmas',
].map((name, i) => ({
  id: `22222222-2222-4222-8222-${String(i + 1).padStart(12, '0')}`,
  bucket: 'cms-library',
  path: `images/22222222-2222-4222-8222-${String(i + 1).padStart(12, '0')}.webp`,
  name,
  alt: name,
  mime: 'image/webp',
  bytes: 98240 + i * 12600,
  width: 1200,
  height: 630,
  archived: i === 4 || i === 5,
  trashed_at: i === 5 ? '2026-09-20T12:00:00Z' : null,
  version: 1,
}))

for (const [engine, engineName, widths] of [
  [chromium, 'chromium', [1440, 1024, 390, 320]],
  [webkit, 'webkit', [1440, 390]],
].filter(([, name]) => !process.env.CMS_BROWSER || process.env.CMS_BROWSER === name)) {
  const browser = await engine.launch()
  try {
    for (const width of widths) {
      const compact = width <= 900
      const context = await browser.newContext({
        viewport: { width, height: compact ? 844 : 900 },
        reducedMotion: 'reduce',
        colorScheme: 'light',
      })
      context.setDefaultTimeout(12000)
      const backend = await nativeBackend(context, seed, assets)
      const headers = { 'Access-Control-Allow-Origin': new URL(base).origin }
      let failHistory = false
      await context.route('**/functions/v1/cms-studio', (route) => {
        const body = route.request().postDataJSON()
        if (body.operation === 'asset_usage')
          return route.fulfill({
            headers,
            json: { currentReferences: 0, historyReferences: 0 },
          })
        if (body.operation === 'history' && failHistory)
          return route.fulfill({
            headers,
            status: 503,
            json: { message: 'Historiken kunde inte läsas. Försök igen.' },
          })
        return route.fallback()
      })
      await context.route('**/storage/v1/object/public/**', (route) =>
        route.fulfill({
          contentType: 'image/png',
          path: 'public/og-image.png',
        }),
      )
      const page = await context.newPage()
      const prefix = `${engineName}-${width}`
      page.on('pageerror', (error) => failures.push(`${prefix}: browser error: ${error.message}`))
      const frame = page.frameLocator('.gjs-frame').first()
      const capture = async (name, audit = false) => {
        await page.evaluate(async () => {
          await globalThis.document.fonts.ready
        })
        const previews = page.locator('.cms-live-preview:visible')
        for (const preview of await previews.all()) {
          await page.waitForFunction(
            (node) => node?.dataset.previewState === 'ready',
            await preview.elementHandle(),
            { timeout: 30000 },
          )
        }
        const filename = `${prefix}-${name}.png`
        await page.screenshot({
          path: `${out}/${filename}`,
          animations: 'disabled',
        })
        screenshots.push({ filename, engine: engineName, width, state: name })
        const overflow = await page.evaluate(
          () => globalThis.document.documentElement.scrollWidth > globalThis.innerWidth,
        )
        check(!overflow, `${prefix}/${name}: no page-level horizontal overflow`)
        if (audit && process.env.AXE_PATH) {
          await page.addScriptTag({ path: process.env.AXE_PATH })
          const result = await page.evaluate(async () => {
            const result = await globalThis.window.axe.run('.knc-cms-studio', {
              iframes: false,
              runOnly: {
                type: 'tag',
                values: ['wcag2a', 'wcag2aa', 'wcag21aa'],
              },
            })
            return {
              violations: result.violations,
              incomplete: result.incomplete,
            }
          })
          accessibility.push({ state: `${prefix}/${name}`, ...result })
          for (const violation of result.violations)
            check(
              false,
              `${prefix}/${name}: accessibility ${violation.id}`,
              violation.nodes.map((node) => ({
                target: node.target,
                summary: node.failureSummary,
              })),
            )
        }
      }
      const scrollSeries = async (name, selector) => {
        const scroll = page.locator(selector).first()
        const { height, total } = await scroll.evaluate((node) => ({
          height: node.clientHeight,
          total: node.scrollHeight,
        }))
        if (!height) return
        for (let y = height * 0.85, number = 2; y < total; y += height * 0.85, number++) {
          await scroll.evaluate((node, value) => {
            node.scrollTop = value
          }, y)
          await capture(`${name}-${number}`)
          if (y + height >= total) break
        }
        await scroll.evaluate((node) => {
          node.scrollTop = 0
        })
      }
      const reset = async () => {
        for (const dialog of await page.locator('dialog[open]').all())
          await dialog.getByRole('button', { name: 'Stäng panel', exact: true }).click()
        if (
          await page
            .locator(
              '.knc-cms-studio[data-library-open="true"],.knc-cms-studio[data-inspector-open="true"]',
            )
            .count()
        )
          await page.keyboard.press('Escape')
        const back = page.getByRole('button', {
          name: 'Tillbaka till sidan',
          exact: false,
        })
        if (await back.isVisible()) await back.click()
      }
      const library = async () => {
        if (compact)
          await page
            .locator('.cms-mobile-tools')
            .getByRole('button', { name: 'Sidor', exact: true })
            .click()
      }
      const open = async (name) => {
        await reset()
        if (name !== 'History') await library()
        await page.getByRole('button', { name, exact: true }).click()
        await page.locator('.cms-workspace-view h1').waitFor()
      }
      const inspect = async (name, action) => {
        try {
          await reset()
          await action()
        } catch (error) {
          failures.push(`${prefix}/${name}: ${error.message}`)
          await capture(`${name}-failure`).catch(() => undefined)
        }
      }
      try {
        await page.goto(`${base}/tools/e2e/admin-harness.html?view=cms-studio`)
        await page.evaluate(async () =>
          (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness(),
        )
        await page.locator('.cms-canvas-shell').waitFor({ timeout: 90000 })
        await frame.locator(`[data-knc-surface="${compact ? 'mobile' : 'desktop'}-home"]`).waitFor()
        await page.getByRole('button', { name: 'Fit', exact: true }).click()
        await capture('01-editor-initial', true)
        await page.getByRole('button', { name: 'Save / Publicera', exact: true }).click()
        await page.waitForFunction(() =>
          globalThis.document.querySelector('.cms-status')?.textContent?.includes('Publicerad'),
        )
        check(
          !(await page.locator('.cms-notice-info').count()),
          `${prefix}: successful publication clears the unpublished-draft notice`,
        )
        await capture('02-editor-published')
        await inspect('03-library', async () => {
          await library()
          await capture('03-library', true)
          await page.getByRole('searchbox', { name: 'Sök sidor' }).fill('ingen sådan sida')
          await capture('04-library-search-empty')
          await page.getByRole('searchbox', { name: 'Sök sidor' }).fill('')
        })
        await inspect('05-inspector', async () => {
          if (compact)
            await frame.getByRole('button', { name: 'Boka tid', exact: true }).first().click()
          else await frame.getByText('KNC source sv', { exact: true }).first().click()
          if (compact)
            await page
              .locator('.cms-mobile-tools')
              .getByRole('button', { name: 'Egenskaper', exact: true })
              .click()
          await capture('05-inspector-design', true)
          await scrollSeries('05-inspector-design', '.cms-inspector-scroll')
          await page.getByRole('tab', { name: 'Lager', exact: true }).click()
          await capture('06-inspector-layers', true)
          await page.getByRole('tab', { name: 'Lägg till', exact: true }).click()
          await capture('07-inspector-blocks', true)
          await page.getByRole('tab', { name: 'Design', exact: true }).click()
          check(
            (await page.locator('.cms-status').innerText()).includes('Publicerad'),
            `${prefix}: naming editor chrome and browsing inspector tabs do not dirty the published model`,
          )
        })
        await inspect('08-page-dialog', async () => {
          await library()
          await page.getByRole('button', { name: '+ Ny sida', exact: true }).click()
          const dialog = page.getByRole('dialog', {
            name: 'Ny sida',
            exact: true,
          })
          await dialog.waitFor()
          await capture('08-new-page', true)
          for (const invalidPath of [
            '/',
            '',
            '/admin/settings',
            '/booking',
            '/Bad_Path',
            `/${'a'.repeat(101)}`,
          ]) {
            await dialog.getByLabel('Adress', { exact: true }).fill(invalidPath)
            await dialog.getByRole('button', { name: 'Skapa sida', exact: true }).click()
            await dialog.getByRole('alert').waitFor()
            check(
              await dialog.isVisible(),
              `${prefix}: invalid path ${JSON.stringify(invalidPath)} keeps its form and error visible`,
            )
          }
          await capture('09-new-page-validation')
          await dialog.getByRole('button', { name: 'Stäng panel', exact: true }).click()
          if (compact) {
            check(
              await page
                .locator('#cms-library')
                .evaluate((node) => node.contains(globalThis.document.activeElement)),
              `${prefix}: nested dialog returns focus to its active drawer`,
            )
            await page.keyboard.press('Escape')
          }
          if (await page.locator('.cms-notice[role="alert"]').count())
            await page
              .locator('.cms-notice[role="alert"]')
              .getByRole('button', { name: 'Stäng', exact: true })
              .click()
        })
        await inspect('10-backup', async () => {
          await library()
          await page.getByRole('button', { name: 'Utkast & backup', exact: true }).click()
          await capture('10-backup', true)
        })
        await inspect('11-business', async () => {
          await open('Business / SEO')
          await capture('11-business', true)
          await scrollSeries('11-business', '.cms-workspace-content')
          await page.keyboard.press('Escape')
          check(
            await page.evaluate(() => {
              const node = globalThis.document.activeElement
              const bounds = node.getBoundingClientRect()
              return (
                node.tagName !== 'BODY' &&
                bounds.width > 0 &&
                bounds.height > 0 &&
                bounds.right > 0 &&
                bounds.left < globalThis.innerWidth &&
                !node.closest('[inert]')
              )
            }),
            `${prefix}: closing a workspace restores focus to a visible control`,
          )
        })
        await inspect('12-resources', async () => {
          await open('Resurser')
          await page.locator('.cms-resource-card').first().waitFor()
          await capture('12-resources', true)
          await page.locator('.cms-resource-card button').first().click()
          await page.getByRole('heading', { name: assets[0].name, exact: true }).waitFor()
          if (compact) {
            const visible = await page.locator('.cms-resource-detail h2').evaluate((node) => {
              const r = node.getBoundingClientRect()
              return r.top >= 0 && r.bottom <= globalThis.innerHeight
            })
            check(visible, `${prefix}: selecting a resource brings its details into view`)
          }
          await page.locator('.cms-resource-detail').scrollIntoViewIfNeeded()
          await capture('13-resource-details', true)
          await page.locator('.cms-workspace-content').evaluate((node) => {
            node.scrollTop = 0
          })
          await page.getByRole('searchbox', { name: 'Sök resurser' }).fill('ingenting')
          await capture('14-resources-search-empty')
          await page.getByRole('searchbox', { name: 'Sök resurser' }).fill('')
          await page.getByRole('button', { name: 'Arkiverade', exact: true }).click()
          await capture('15-resources-archived')
          await page.getByRole('button', { name: 'Papperskorg', exact: true }).click()
          await capture('16-resources-trash')
        })
        await inspect('17-theme', async () => {
          await open('◐ Webbplatsens stil')
          await capture('17-theme-light', true)
          await scrollSeries('17-theme-light', '.cms-workspace-content')
          const mobilePreview = page.getByRole('button', {
            name: 'Förhandsvisa stil',
            exact: true,
          })
          if (compact) {
            check(
              await mobilePreview.isVisible(),
              `${prefix}: theme has an explicit mobile preview destination`,
            )
            if (await mobilePreview.isVisible()) await mobilePreview.click()
            else await page.locator('.cms-theme-preview').scrollIntoViewIfNeeded()
          }
          await capture('18-theme-preview')
          if (compact && (await mobilePreview.isVisible()))
            await page.getByRole('button', { name: 'Redigera stil', exact: true }).click()
          await page.getByRole('button', { name: 'Mörkt tema', exact: true }).click()
          await capture('19-theme-dark', true)
          await page.getByRole('button', { name: 'Ljust tema', exact: true }).click()
        })
        await inspect('20-email', async () => {
          await open('Mejl')
          await page.getByRole('heading', { name: 'Kundbekräftelse · SV', exact: true }).waitFor()
          await capture('20-email-editor', true)
          await scrollSeries('20-email-editor', '.cms-workspace-content')
          await page.getByLabel('Rubrik', { exact: true }).fill('Din nästa klippning börjar här')
          if (compact) await page.getByRole('button', { name: 'Förhandsvisa', exact: true }).click()
          const mail = page.frameLocator('iframe[title="Mejl som skickas"]')
          await mail
            .getByRole('heading', {
              name: 'Din nästa klippning börjar här',
              exact: true,
            })
            .waitFor()
          await capture('21-email-preview', true)
          await scrollSeries('21-email-preview', '.cms-workspace-content')
          if (compact) {
            await page
              .getByRole('combobox', { name: 'Mejlmall', exact: true })
              .selectOption('customer_reminder')
            await mail
              .getByRole('heading', {
                name: defaultEmailTemplate('customer_reminder', 'sv').title,
                exact: true,
              })
              .waitFor()
            await capture('22-email-reminder')
            await page
              .getByRole('combobox', { name: 'Mejlmall', exact: true })
              .selectOption('customer_confirmation')
            await page.getByRole('button', { name: 'Redigera', exact: true }).click()
          }
          await page.getByRole('button', { name: 'Aktivera design', exact: true }).click()
          await page.getByText('Utseende', { exact: true }).click()
          await capture('23-email-design', true)
          await scrollSeries('23-email-design', '.cms-workspace-content')
        })
        await inspect('24-history', async () => {
          await open('History')
          await page.locator('.cms-history-row').first().waitFor()
          await capture('24-history', true)
          await page
            .locator('.cms-history-row')
            .first()
            .getByRole('button', { name: 'Granska', exact: true })
            .click()
          await page.getByRole('dialog', { name: /Granska version/ }).waitFor()
          await capture('25-history-review', true)
        })
        await inspect('26-history-error', async () => {
          failHistory = true
          await open('History')
          await page.getByRole('alert').waitFor()
          await capture('26-history-error', true)
          failHistory = false
          await page
            .locator('.cms-notice[role="alert"]')
            .getByRole('button', { name: 'Stäng', exact: true })
            .click()
        })
        await inspect('27-booking-scenes', async () => {
          await library()
          await page
            .locator('#cms-library')
            .getByRole('button', { name: 'Bokning', exact: true })
            .click()
          await page.getByLabel('Visa i editorn', { exact: true }).waitFor()
          for (const scene of ['booking-options', 'booking-details', 'booking-confirmation']) {
            await page.getByLabel('Visa i editorn', { exact: true }).selectOption(scene)
            await frame.locator(`[data-knc-surface="${scene}"]`).waitFor()
            await capture(`27-${scene}`)
          }
        })
        await inspect('28-english-dark', async () => {
          await library()
          await page
            .locator('#cms-library')
            .getByRole('button', { name: 'Startsida', exact: true })
            .click()
          await page.getByRole('button', { name: 'EN', exact: true }).click()
          await page.getByRole('button', { name: 'Mörk', exact: true }).click()
          await frame
            .locator(`[data-knc-surface="${compact ? 'mobile' : 'desktop'}-home"]`)
            .waitFor()
          await capture('28-english-dark', true)
          await page.getByRole('button', { name: 'SV', exact: true }).click()
          await page.getByRole('button', { name: 'Ljus', exact: true }).click()
        })
        await inspect('29-compare', async () => {
          await page.getByRole('button', { name: 'Jämför', exact: true }).click()
          await capture('29-compare')
          await page.getByRole('button', { name: 'Jämför', exact: true }).click()
        })
        check(
          backend.writes.every((operation) => operation === 'publish') &&
            backend.writes.length === 1,
          `${prefix}: only the deliberate isolated fixture publication wrote data`,
          backend.writes,
        )
      } catch (error) {
        failures.push(`${prefix}: ${error.message}`)
        await capture('fatal-failure').catch(() => undefined)
      } finally {
        await context.close()
      }
    }
  } finally {
    await browser.close()
  }
}
await writeFile(
  `${out}/surfaces.json`,
  JSON.stringify({ checks, failures, screenshots, accessibility, fixture: true }, null, 2),
)
console.log(
  JSON.stringify({ checks: checks.length, screenshots: screenshots.length, failures }, null, 2),
)
assert.deepEqual(
  failures,
  [],
  'Every CMS surface must remain reachable, accessible and visually inspectable',
)

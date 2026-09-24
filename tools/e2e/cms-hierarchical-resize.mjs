import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { chromium, webkit } from 'playwright'
import { nativeBackend } from './cms-native.mjs'
import { emptyDocument } from '../../shared/cms.ts'
const base = process.env.BASE_URL ?? 'http://127.0.0.1:4199'
assert.equal(new URL(base).hostname, '127.0.0.1')
const out = process.env.CMS_EVIDENCE_DIR ?? '/tmp/cms-hierarchical-resize'
await mkdir(out, { recursive: true })
const engine = process.env.CMS_ENGINE === 'webkit' ? 'webkit' : 'chromium'
const browser = await { chromium, webkit }[engine].launch()
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
  reducedMotion: 'reduce',
})
context.setDefaultTimeout(10000)
const seed = emptyDocument()
seed.barbers = ['a', 'b', 'c', 'd'].map((id, i) => ({
  id,
  name: `Barber ${id}`,
  ig: id,
  role_sv: 'Frisör',
  role_en: 'Barber',
  bio_sv: 'Presentation',
  bio_en: 'Presentation',
  sort_order: i,
}))
const backend = await nativeBackend(context, seed)
await context.route('https://admin-harness.invalid/rest/v1/rpc/public_*', async (route) => {
  const headers = {
    'Access-Control-Allow-Origin': new URL(base).origin,
    'Access-Control-Allow-Headers': '*',
  }
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
  return route.fulfill({
    headers,
    json: {
      settings: {},
      barbers: seed.barbers.map((b) => ({ ...b, active: true, photo_path: null })),
      services: [],
      schedules: [],
    },
  })
})
const page = await context.newPage()
const select = (selector) =>
  page.evaluate(async (selector) => {
    const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
    const editor = cmsGrapes.editors.at(-1)
    const target = editor.getWrapper().find(selector)[0]
    if (!target) throw new Error(`Missing target ${selector}`)
    editor.select(target)
  }, selector)
const groupSelector = '[data-knc-fold="barber-marquee"][data-knc-source]'
let frame
const measure = () =>
  frame.locator(groupSelector).evaluate((group) => {
    const rect = (node) => {
      const r = node.getBoundingClientRect()
      return { width: r.width, height: r.height, bottom: r.bottom, top: r.top }
    }
    const cards = [...group.children]
    return {
      group: rect(group),
      cards: cards.map((card) => ({
        rect: rect(card),
        photo: rect(
          card.querySelector('img') ??
            card.querySelector('[data-knc-surface]') ??
            card.firstElementChild,
        ),
        text: card.textContent,
      })),
      next: rect(group.nextElementSibling),
    }
  })
const height = async (value) => {
  const input = page.locator('#cms-inspector .gjs-sm-property__height input').first()
  await input.fill(String(Math.round(value)))
  await input.press('Enter')
  await input.press('Tab')
}
try {
  await page.goto(`${base}/tools/e2e/admin-harness.html`)
  await page.evaluate(async () =>
    (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness(),
  )
  frame = page.frameLocator('.gjs-frame').first()
  await frame.locator(groupSelector).waitFor({ timeout: 90000 })
  const desktop = await measure()
  await page.getByRole('button', { name: 'Mobil', exact: true }).click()
  await page.waitForFunction(
    () => globalThis.document.querySelector('.gjs-frame')?.contentWindow.innerWidth === 390,
  )
  const before = await measure()
  assert.equal(before.cards.length, 4)
  await select(groupSelector)
  await height(before.group.height / 2)
  const after = await measure()
  await writeFile(
    `${out}/${engine}-geometry.json`,
    JSON.stringify({ desktop, before, after }, null, 2),
  )
  await frame.locator(groupSelector).scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${out}/${engine}-resize.png` })
  assert.ok(
    Math.abs(after.cards[0].photo.height / before.cards[0].photo.height - 0.5) < 0.08,
    'Group resize must scale its photographs, not crop them',
  )
  assert.ok(
    Math.abs(after.group.height / before.group.height - 0.5) < 0.08,
    'Group geometry must follow the requested size',
  )
  assert.ok(
    after.next.top >= Math.max(...after.cards.map((card) => card.rect.bottom)) - 2,
    'Following content may not overlap cards',
  )
  assert.deepEqual(
    after.cards.map((card) => card.text),
    before.cards.map((card) => card.text),
  )
  await page.getByRole('button', { name: 'Ångra', exact: true }).click()
  const undone = await measure()
  assert.ok(
    Math.abs(undone.cards[0].photo.height - before.cards[0].photo.height) < 2,
    'Undo restores nested geometry',
  )
  await select(`${groupSelector} > div:first-child`)
  await height(before.cards[0].rect.height * 0.75)
  const linked = await measure()
  assert.ok(
    linked.cards.every((card) => Math.abs(card.rect.height - linked.cards[0].rect.height) < 2),
    'Every corresponding barber card shares its size',
  )
  assert.ok(
    linked.cards[0].photo.height < before.cards[0].photo.height * 0.85,
    'Individual card resize also scales the portrait',
  )
  assert.deepEqual(
    linked.cards.map((card) => card.text),
    before.cards.map((card) => card.text),
    'Linked styles never copy names or text',
  )
  await page.getByRole('button', { name: 'Dator', exact: true }).click()
  await page.waitForFunction(
    () => globalThis.document.querySelector('.gjs-frame')?.contentWindow.innerWidth === 1440,
  )
  assert.ok(
    Math.abs((await measure()).cards[0].photo.height - desktop.cards[0].photo.height) < 2,
    'Mobile scaling never changes desktop geometry',
  )
  assert.equal(backend.writes.length, 0, 'Geometry inspection does not publish')
  console.log('PASS hierarchical resize: group, children, linked peers, undo and device isolation')
} finally {
  await context.close()
  await browser.close()
}

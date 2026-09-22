import { chromium, webkit } from 'playwright'
import { writeFile, mkdir } from 'node:fs/promises'
import { nativeBackend } from './cms-native.mjs'
const out = process.env.CMS_EVIDENCE_DIR ?? '/tmp/cms-workspace'
await mkdir(out, { recursive: true })
const records = []
for (const [name, engine] of Object.entries({ chromium, webkit })) {
  const browser = await engine.launch()
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })
  await nativeBackend(context)
  const page = await context.newPage()
  try {
    await page.goto('http://127.0.0.1:4188/tools/e2e/admin-harness.html?view=cms-studio')
    await page.evaluate(async () => (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness())
    await page.locator('.cms-canvas-shell').waitFor({ timeout: 90000 })
    await page.getByRole('button', { name: 'Mobil', exact: true }).click()
    const frame = page.frameLocator('.gjs-frame').first()
    const surface = frame.locator('[data-knc-surface="mobile-home"]')
    await surface.waitFor()
    const id = await surface.evaluate(root => [...root.querySelectorAll('[data-knc-source]')].find(node => ['DIV', 'P', 'SPAN'].includes(node.tagName) && !node.closest('[data-knc-slot]') && !node.hasAttribute('data-knc-required') && [...node.childNodes].some(child => child.nodeType === 3 && child.textContent.trim()) && node.getBoundingClientRect().height > 0)?.id)
    const target = frame.locator(`[id="${id}"]`)
    const before = await target.evaluate(node => { const b = node.getBoundingClientRect(); return { html: node.outerHTML, rect: b.toJSON(), hit: node.ownerDocument.elementFromPoint(b.x+b.width/2,b.y+b.height/2)?.outerHTML } })
    await target.click()
    await page.screenshot({ path: `${out}/selection-${name}.png` })
    const actual = await page.evaluate(async () => {
      const { cmsGrapes } = await import('/tools/e2e/admin-harness.tsx')
      const { isReadOnlyPreview, isProtected } = await import('/src/admin/cms/editorPolicy.ts')
      const s = cmsGrapes.editors.at(-1).getSelected()
      return { selected: s && { type: s.get('type'), tag: s.get('tagName'), attributes: s.getAttributes(), text: s.getEl()?.textContent, readOnly: isReadOnlyPreview(s), protected: isProtected(s), children: s.components().map(c => ({type:c.get('type'),tag:c.get('tagName'),content:c.get('content')})) }, inspector: globalThis.document.querySelector('#cms-inspector')?.innerText }
    })
    records.push({name,id,before,actual})
  } catch (error) { records.push({name,error:String(error)}) }
  finally { await browser.close() }
}
await writeFile(`${out}/selection.json`, JSON.stringify(records,null,2))

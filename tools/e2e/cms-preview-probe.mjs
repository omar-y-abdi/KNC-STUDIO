import { chromium, webkit } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { nativeBackend } from './cms-native.mjs'
const out = '/tmp/cms-preview-probe'
await mkdir(out, { recursive: true })
const report = []
for (const [engine, name] of [[chromium, 'chromium'], [webkit, 'webkit']]) {
 const browser = await engine.launch()
 try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
  context.setDefaultTimeout(20000)
  await nativeBackend(context)
  await context.addInitScript(() => {
   globalThis.events = []
   addEventListener('message', event => {
    const data = event.data
    if (data?.type?.startsWith('knc-')) globalThis.events.push({ type: data.type, id: data.id, scene: data.scene, time: performance.now() })
   })
   addEventListener('click', event => globalThis.events.push({ click: event.target?.textContent?.slice(0, 40), time: performance.now() }), true)
  })
  const page = await context.newPage()
  const snapshot = async label => {
   const state = await page.evaluate(() => {
    const frame = document.querySelector('.cms-live-preview iframe')
    const doc = frame?.contentDocument
    const anc = []
    for (let node = frame; node; node = node.parentElement) anc.push({ name: node.tagName, class: node.className, inert: node.inert, visibility: getComputedStyle(node).visibility })
    return {
     events: globalThis.events, frameEvents: frame?.contentWindow?.events,
     ready: doc?.documentElement.dataset.kncSourceReady, error: doc?.documentElement.dataset.kncSourceError,
     failure: doc?.documentElement.dataset.kncSourceFailure ? JSON.parse(doc.documentElement.dataset.kncSourceFailure).context.id : undefined,
     surfaces: [...(doc?.querySelectorAll('[data-knc-surface]') ?? [])].map(node => ({name:node.getAttribute('data-knc-surface'), display:frame.contentWindow.getComputedStyle(node).display, rect:node.getBoundingClientRect().toJSON()})),
     anc, feedback: document.querySelector('.cms-preview-feedback')?.textContent,
    }
   })
   report.push({ name, label, state })
   await writeFile(`${out}/probe.json`, JSON.stringify(report, null, 2))
   await page.screenshot({ path: `${out}/${name}-${label}.png` })
  }
  await page.goto('http://127.0.0.1:4188/tools/e2e/admin-harness.html?view=cms-studio')
  await page.evaluate(async () => (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness())
  await page.locator('.cms-canvas-shell').waitFor({ timeout: 90000 })
  const edit = page.frameLocator('.gjs-frame').first()
  await edit.getByText('KNC source sv', {exact:true}).first().waitFor()
  await page.getByRole('button', {name:'Fit',exact:true}).click()
  await edit.getByText('KNC source sv', {exact:true}).first().click()
  await page.locator('#cms-inspector').getByLabel('Text', {exact:true}).fill('Unpublished preview text')
  await page.getByRole('button', {name:'Lås vy',exact:true}).click()
  const frame = page.frameLocator('.cms-live-preview iframe')
  await frame.getByText('Unpublished preview text', {exact:true}).waitFor()
  await snapshot('before-click')
  await frame.getByRole('button', {name:'Boka tid',exact:true}).click()
  await page.waitForTimeout(2500)
  await snapshot('after-click')
  await page.getByRole('button', {name:'Lås upp',exact:true}).click()
  await page.getByRole('button', {name:'◐ Webbplatsens stil',exact:true}).click()
  await page.getByRole('region', {name:'Webbplatsens stil',exact:true}).waitFor()
  await page.setViewportSize({width:390,height:844})
  await page.waitForTimeout(24000)
  await snapshot('theme-mobile')
 } catch (error) { report.push({name, error:error.message}); await writeFile(`${out}/probe.json`, JSON.stringify(report,null,2)) }
 finally { await browser.close() }
}

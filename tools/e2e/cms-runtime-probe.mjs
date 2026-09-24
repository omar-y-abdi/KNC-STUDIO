/* global window, document */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { transform } from 'esbuild'
import { emptyDocument, validateDocument } from '../../shared/cms.ts'
import { validateDocumentMarkupPlacements } from '../../shared/cms-markup.ts'
import { CMS_BUILT_ASSETS } from '../../shared/cms-built-assets.ts'
import { nativeBackend } from './cms-native.mjs'
const out = '/tmp/cms-runtime'
await mkdir(out, { recursive: true })
const response = await fetch('https://bladeblendstudio.se/api/cms/presentation')
if (!response.ok) throw new Error(`Public presentation HTTP ${response.status}`)
const published = await response.json()
await writeFile(`${out}/published.json`, JSON.stringify(published))
const report = { revision: published.revision, validation: [], browser: [], image: [] }
const policy = { siteOrigin: 'https://bladeblendstudio.se', storageOrigin: 'https://soktgawvexeumqvtyhda.supabase.co', builtAssets: CMS_BUILT_ASSETS }
const check = (name, doc, rules = policy) => {
  const result = { name, bytes: Buffer.byteLength(JSON.stringify(doc)), pages: doc.presentation.pages.map(p => ({ path: p.path, sv: p.content.sv.html.length, en: p.content.en.html.length, light: p.content.sv.css.light.length, dark: p.content.sv.css.dark.length })) }
  try { validateDocument(doc); validateDocumentMarkupPlacements(structuredClone(doc), rules); result.ok = true }
  catch (error) { result.ok = false; result.error = error.message }
  report.validation.push(result)
}
const original = emptyDocument()
original.presentation = published.presentation
check('published-unchanged', original)
const fixture = JSON.parse(JSON.stringify(original).replaceAll('https://soktgawvexeumqvtyhda.supabase.co', 'https://admin-harness.invalid').replaceAll('https://bladeblendstudio.se', 'http://127.0.0.1:4188'))
const browser = await chromium.launch()
try {
 const context = await browser.newContext({ viewport: { width:390, height:844 }, reducedMotion:'reduce' })
 await nativeBackend(context, fixture)
 const page = await context.newPage()
 page.on('pageerror', e => report.browser.push(e.message))
 await page.goto('http://127.0.0.1:4188/tools/e2e/admin-harness.html?view=cms-studio')
 await page.evaluate(async () => (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness())
 await page.locator('.cms-canvas-shell').waitFor({ timeout:90000 })
 await page.evaluate(async () => { const source = await import('/src/admin/cms/corePages.ts'); await source.prepareCorePageSource() })
 const upgraded = await page.evaluate(async doc => (await import('/src/admin/cms/corePages.ts')).ensureCorePages(doc), fixture)
 await writeFile(`${out}/upgraded.json`, JSON.stringify(upgraded))
 check('source-upgrade', upgraded, {...policy,siteOrigin:'http://127.0.0.1:4188',storageOrigin:'https://admin-harness.invalid'})
 await page.getByRole('button',{name:'Publicera',exact:true}).click()
 await page.waitForTimeout(1500)
 report.browser.push(await page.locator('.cms-notice').allTextContents())
 await page.screenshot({ path:`${out}/published-validation.png` })
 // Generate a repeatable phone-sized JPEG. No owner media or live writes are used.
 const jpeg = await page.evaluate(() => {
   const canvas = document.createElement('canvas'); canvas.width=4032; canvas.height=3024
   const ctx=canvas.getContext('2d'); const pixels=ctx.createImageData(canvas.width,canvas.height)
   let seed=42
   for(let y=0;y<canvas.height;y++) for(let x=0;x<canvas.width;x++) {
     const i=(y*canvas.width+x)*4; seed=(Math.imul(seed,1664525)+1013904223)>>>0
     const noise=(seed>>>24)/5; pixels.data[i]=(x/20+y/30+noise)%256; pixels.data[i+1]=(y/16+noise)%256; pixels.data[i+2]=(x/16+noise)%256; pixels.data[i+3]=255
   }
   ctx.putImageData(pixels,0,0); return canvas.toDataURL('image/jpeg',0.82).split(',')[1]
 })
 const input=Buffer.from(jpeg,'base64'); await writeFile(`${out}/phone-fixture.jpg`,input)
 const source=await readFile('supabase/functions/upload-image/index.ts','utf8')
 const begin=source.indexOf('const MAX_INPUT_BYTES'); const end=source.indexOf('Deno.serve(')
 const body="import { Gravity, ImageMagick, MagickFormat, MagickGeometry, initializeImageMagick } from '@imagemagick/magick-wasm';\n"+source.slice(begin,end)+"\nexport { processImage, initializeImageMagick };\n"
 const js=await transform(body,{loader:'ts',format:'esm',target:'node22'})
 const modulePath=new URL('./.upload-profile.mjs',import.meta.url)
 await writeFile(modulePath,js.code)
 const module=await import(modulePath.href)
 let cpu=process.cpuUsage();let start=performance.now()
 await module.initializeImageMagick(new Uint8Array(await readFile('supabase/functions/upload-image/magick.wasm')))
 let used=process.cpuUsage(cpu);report.image.push({phase:'init',cpuMs:(used.user+used.system)/1000,wallMs:performance.now()-start})
 for(const kind of ['gallery','barber_photo']) {
   cpu=process.cpuUsage();start=performance.now()
   try { const image=module.processImage(input,kind); used=process.cpuUsage(cpu); report.image.push({kind,inputBytes:input.length,outputBytes:image.bytes.length,width:image.width,height:image.height,cpuMs:(used.user+used.system)/1000,wallMs:performance.now()-start}) }
   catch(error){ used=process.cpuUsage(cpu); report.image.push({kind,error:error.message,cpuMs:(used.user+used.system)/1000}) }
 }
 await context.close()
} finally { await browser.close(); await writeFile(`${out}/probe.json`,JSON.stringify(report,null,2)); console.log(JSON.stringify(report,null,2)) }

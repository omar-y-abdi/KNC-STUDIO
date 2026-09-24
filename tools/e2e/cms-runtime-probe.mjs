/* global document */
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'
import { transform } from 'esbuild'
import { emptyDocument, validateDocument } from '../../shared/cms.ts'
import { validateDocumentMarkupPlacements } from '../../shared/cms-markup.ts'
import { CMS_BUILT_ASSETS } from '../../shared/cms-built-assets.ts'
import { nativeBackend } from './cms-native.mjs'
const out = '/tmp/cms-runtime'
await mkdir(out, { recursive: true })
const published = await (await fetch('https://bladeblendstudio.se/api/cms/presentation')).json()
const original = emptyDocument(); original.presentation = published.presentation
const fixture = JSON.parse(JSON.stringify(original).replaceAll('https://soktgawvexeumqvtyhda.supabase.co', 'https://admin-harness.invalid').replaceAll('https://bladeblendstudio.se', 'http://127.0.0.1:4188'))
const policy = { siteOrigin:'http://127.0.0.1:4188', storageOrigin:'https://admin-harness.invalid', builtAssets:CMS_BUILT_ASSETS }
const report = { revision:published.revision, validation:[], image:[] }
const check = (name, doc) => {
 const result={name,bytes:Buffer.byteLength(JSON.stringify(doc))}
 try {validateDocument(doc);validateDocumentMarkupPlacements(structuredClone(doc),policy);result.ok=true}
 catch(error){result.ok=false;result.error=error.message}
 report.validation.push(result)
 return result
}
const browser=await chromium.launch()
try {
 const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'})
 context.setDefaultTimeout(15000)
 await nativeBackend(context,fixture)
 const page=await context.newPage()
 await page.goto('http://127.0.0.1:4188/tools/e2e/admin-harness.html?view=cms-studio')
 await page.evaluate(async()=> (await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness())
 await page.locator('.cms-canvas-shell').waitFor({timeout:90000})
 await page.evaluate(async()=> (await import('/src/admin/cms/corePages.ts')).prepareCorePageSource())
 await page.waitForTimeout(400)
 for (const p of fixture.presentation.pages) {
   await page.getByRole('button',{name:p.name.sv,exact:true}).click()
   for (const mode of ['Mörk','Ljus']) {
     await page.getByRole('button',{name:mode,exact:true}).click()
     await page.evaluate(async()=>{
       const {cmsGrapes}=await import('/tools/e2e/admin-harness.tsx');const e=cmsGrapes.editors.at(-1)
       const c=e.getWrapper().find('h1,h2,p').find(c=>c.get('stylable')!==false)
       if(c) c.addStyle({'letter-spacing':'0.1px'})
     })
     await page.waitForTimeout(350)
     const draft=await page.evaluate(async()=> (await import('/src/admin/cms/backup.ts')).loadBackup()?.document)
     if(draft){const status=check(`${p.path}:${mode}`,draft);if(!status.ok) await writeFile(`${out}/rejected-${report.validation.length}.json`,JSON.stringify(draft))}
   }
 }
 await page.getByRole('button',{name:'Skapa ny sida',exact:true}).click()
 const dialog=page.getByRole('dialog',{name:'Ny sida',exact:true})
 await dialog.getByLabel('Sidnamn',{exact:true}).fill('Diagnostic')
 await dialog.getByLabel('Adress',{exact:true}).fill('/diagnostic')
 await dialog.getByRole('button',{name:'Skapa sida',exact:true}).click()
 await page.waitForTimeout(300)
 const draft=await page.evaluate(async()=> (await import('/src/admin/cms/backup.ts')).loadBackup()?.document)
 if(draft) check('new-page',draft)
 await page.getByRole('button',{name:'Publicera',exact:true}).click()
 await page.waitForTimeout(1000)
 report.notices=await page.locator('.cms-notice').allTextContents()
 await page.screenshot({path:`${out}/roundtrip.png`})
 // Profile the existing server processor against raw versus browser-resized photo bytes.
 const source=await readFile('supabase/functions/upload-image/index.ts','utf8')
 const body="import { Gravity, ImageMagick, MagickFormat, MagickGeometry, initializeImageMagick } from '@imagemagick/magick-wasm';\n"+source.slice(source.indexOf('const MAX_INPUT_BYTES'),source.indexOf('Deno.serve('))+"\nexport { processImage, initializeImageMagick };\n"
 const js=await transform(body,{loader:'ts',format:'esm',target:'node22'})
 const modulePath=new URL('./.upload-profile.mjs',import.meta.url);await writeFile(modulePath,js.code)
 const processor=await import(modulePath.href)
 await processor.initializeImageMagick(new Uint8Array(await readFile('supabase/functions/upload-image/magick.wasm')))
 const images=await page.evaluate(()=>{
   const canvas=document.createElement('canvas');canvas.width=3000;canvas.height=3000
   const ctx=canvas.getContext('2d');const pixels=ctx.createImageData(3000,3000);let seed=7
   for(let i=0;i<pixels.data.length;i+=4){seed=(Math.imul(seed,1664525)+1013904223)>>>0;pixels.data[i]=seed&255;pixels.data[i+1]=(seed>>>8)&255;pixels.data[i+2]=(seed>>>16)&255;pixels.data[i+3]=255}
   ctx.putImageData(pixels,0,0)
   const jpeg=canvas.toDataURL('image/jpeg',0.5)
   const small=document.createElement('canvas');small.width=1600;small.height=1600
   small.getContext('2d').drawImage(canvas,0,0,1600,1600)
   return {raw:jpeg.split(',')[1],resized:small.toDataURL('image/webp',0.82).split(',')[1]}
 })
 for(const [variant,base64] of Object.entries(images)) {
   const input=Buffer.from(base64,'base64');const cpu=process.cpuUsage();const start=performance.now();const result={variant,inputBytes:input.length}
   try {const image=processor.processImage(input,'gallery');result.outputBytes=image.bytes.length}
   catch(error){result.error=error.message}
   const used=process.cpuUsage(cpu);result.cpuMs=(used.user+used.system)/1000;result.wallMs=performance.now()-start;report.image.push(result)
 }
 await context.close()
} finally {await browser.close();await writeFile(`${out}/probe.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))}

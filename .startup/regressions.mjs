import assert from 'node:assert/strict'
import { chromium, webkit, devices } from 'playwright'
import { mkdir,writeFile } from 'node:fs/promises'
import { emptyDocument } from '../../shared/cms.ts'
import { nativeBackend } from './cms-native.mjs'
const base='http://127.0.0.1:4188',out='/tmp/startup-regressions'
await mkdir(out,{recursive:true})
const live=await fetch('https://bladeblendstudio.se/api/cms/presentation').then(r=>r.json())
const results=[]
for(const [name,engine] of Object.entries({chromium,webkit})){
 const browser=await engine.launch()
 try {
  const context=await browser.newContext({...devices['iPhone 15'],defaultBrowserType:undefined})
  const state=emptyDocument();state.presentation=live.presentation
  const backend=await nativeBackend(context,state)
  let release;const waiting=new Promise(resolve=>{release=resolve})
  await context.route('**/cms-public/source',async route=>{await waiting; await route.abort()})
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message))
  await page.goto(base+'/tools/e2e/admin-harness.html?view=cms-studio')
  const start=Date.now();let error=null
  try {
   await page.evaluate(async()=>(await import('/tools/e2e/admin-harness.tsx')).mountCmsStudioHarness())
   await page.locator('.gjs-frame').first().waitFor({timeout:2000})
   await page.frameLocator('.gjs-frame').first().locator('[data-knc-surface="mobile-home"]').waitFor({timeout:1000})
   assert.equal(backend.writes.length,0)
  } catch(e){error=e.message}
  const elapsed=Date.now()-start
  await page.screenshot({path:out+'/'+name+'-stored-startup.png'})
  results.push({name,elapsed,error,errors});release();await context.close()
 }finally{await browser.close()}
}
await writeFile(out+'/results.json',JSON.stringify(results,null,2))
console.log(JSON.stringify(results,null,2));assert.ok(results.every(r=>!r.error),'stored pages must open without awaiting source capture')

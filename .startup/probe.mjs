import { chromium, webkit } from 'playwright'
import { writeFile, mkdir } from 'node:fs/promises'
import { emptyDocument } from '../../shared/cms.ts'
import { nativeBackend } from './cms-native.mjs'
import { loadEnv } from 'vite'
const base = 'http://127.0.0.1:4188'
const out = '/tmp/startup'
const env = loadEnv('production', process.cwd(), 'VITE_')
const upstream = env.VITE_SUPABASE_URL
const publicKey = env.VITE_SUPABASE_ANON_KEY
await mkdir(out, { recursive: true })
const live = await fetch('https://bladeblendstudio.se/api/cms/presentation').then(r => { if (!r.ok) throw new Error(`live ${r.status}`); return r.json() })
await writeFile(`${out}/live-presentation.json`, JSON.stringify(live))
const engineName = process.env.CMS_ENGINE ?? 'webkit'
const browser = await ({ chromium, webkit }[engineName]).launch()
const results = []
try {
 for (const scenario of ['live-public-reads']) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' })
  const state = emptyDocument()
  state.presentation = live.presentation
  const backend = await nativeBackend(context, state)
  const user = { id:'20000000-0000-4000-8000-000000000001',email:'cms-test@example.invalid',aud:'authenticated',role:'authenticated' }
  const jwt = [Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),Buffer.from(JSON.stringify({sub:user.id,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})).toString('base64url'),'test'].join('.')
  await context.addInitScript(session => localStorage.setItem('knc-admin-auth', JSON.stringify(session)), {user,access_token:jwt,refresh_token:'test',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer'})
  await context.route('https://admin-harness.invalid/**', async route => {
    const request=route.request(), url=new URL(request.url())
    const headers={'access-control-allow-origin':base,'access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,OPTIONS'}
    if(request.method()==='OPTIONS')return route.fulfill({status:204,headers})
    if(url.pathname==='/rest/v1/profiles')return route.fulfill({headers,json:{role:'owner',barber_id:null,must_change_password:false,account_enabled:true}})
    const readable=request.method()==='GET' && /^\/rest\/v1\/(site_content|about_content|gallery_images|barber_photos|reviews|barbers|services)$/.test(url.pathname)
    const rpc=request.method()==='POST' && ['/rest/v1/rpc/public_business_discovery','/rest/v1/rpc/public_booking_catalog'].includes(url.pathname)
    if(readable||rpc){
      const response=await fetch(new URL(url.pathname+url.search,upstream),{method:request.method(),headers:{apikey:publicKey,Authorization:`Bearer ${publicKey}`,'Content-Type':'application/json'},...(rpc?{body:request.postData()}:{}),signal:AbortSignal.timeout(10000)})
      return route.fulfill({status:response.status,headers:{...headers,'content-type':'application/json'},body:await response.text()})
    }
    return route.fallback()
  })
  const page = await context.newPage()
  const errors = [], requests = [], responses = []
  page.on('pageerror',e=>errors.push(e.stack))
  page.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
  page.on('request',r=>requests.push({url:r.url(),method:r.method(),t:Date.now()}))
  page.on('requestfailed',r=>errors.push(`${r.url()}: ${r.failure()?.errorText}`))
  page.on('response',r=>{if(r.status()>=400)responses.push({url:r.url(),status:r.status()})})
  const started=Date.now()
  let verdict='ready'
  try {
   await page.goto(`${base}/admin/cms/`)
   await page.waitForFunction(()=>!!document.querySelector('.gjs-frame')||!!globalThis.__cmsCrash||[...document.querySelectorAll('[role=alert]')].some(n=>n.textContent.includes('Studion kunde inte öppnas')),null,{timeout:75000})
  } catch(e){verdict=e.message}
  const elapsed=Date.now()-started
  await page.waitForTimeout(1500)
  const metrics=await page.evaluate(()=>({crash:globalThis.__cmsCrash,body:document.body.innerText.slice(0,2500),frames:[...document.querySelectorAll('iframe')].map(f=>({src:f.src,visible:!!f.getClientRects().length,dataset:f.contentDocument?.documentElement.dataset}))}))
  await page.screenshot({path:`${out}/${engineName}-${scenario}.png`})
  results.push({engineName,scenario,elapsed,verdict,errors,responses,metrics,requests,writes:backend.writes})
  await writeFile(`${out}/${engineName}-results.json`,JSON.stringify(results,null,2))
  console.log(JSON.stringify({engineName,scenario,elapsed,verdict,crash:metrics.crash,body:metrics.body.slice(0,600)}))
  await context.close()
 }
} finally { await browser.close() }

import { webkit, devices } from 'playwright'
import { writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { emptyDocument } from '../../shared/cms.ts'
import { loadEnv } from 'vite'
const site='https://bladeblendstudio.se', out='/tmp/live-cms'
const env=loadEnv('production',process.cwd(),'VITE_'), upstream=env.VITE_SUPABASE_URL
const live=await fetch(site+'/api/cms/presentation').then(r=>r.json())
const doc=emptyDocument();doc.presentation=live.presentation
const headers={apikey:env.VITE_SUPABASE_ANON_KEY,Authorization:`Bearer ${env.VITE_SUPABASE_ANON_KEY}`,'content-type':'application/json'}
const business=await fetch(upstream+'/rest/v1/rpc/public_business_discovery',{method:'POST',headers,body:'{}'}).then(r=>r.json())
doc.settings=business.settings??{};doc.barbers=business.barbers??[]
await mkdir(out,{recursive:true})
const browser=await webkit.launch()
try {
const context=await browser.newContext({...devices['iPhone 15'], reducedMotion:'reduce'})
const user={id:'20000000-0000-4000-8000-000000000001',email:'cms-test@example.invalid',aud:'authenticated',role:'authenticated'}
const jwt=[Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url'),Buffer.from(JSON.stringify({sub:user.id,exp:Math.floor(Date.now()/1000)+3600,role:'authenticated'})).toString('base64url'),'test'].join('.')
await context.addInitScript(session=>localStorage.setItem('knc-admin-auth',JSON.stringify(session)),{user,access_token:jwt,refresh_token:'test',expires_at:Math.floor(Date.now()/1000)+3600,expires_in:3600,token_type:'bearer'})
const blocked=[]
await context.route(upstream+'/**',async route=>{
 const r=route.request(),p=new URL(r.url()).pathname
 const cors={'access-control-allow-origin':site,'access-control-allow-headers':'*','access-control-allow-methods':'GET,POST,OPTIONS'}
 if(r.method()==='OPTIONS') return route.fulfill({status:204,headers:cors})
 if(p==='/rest/v1/profiles')return route.fulfill({headers:cors,json:{role:'owner',barber_id:null,must_change_password:false,account_enabled:true}})
 if(p==='/functions/v1/cms-studio'&&r.postDataJSON().operation==='state')return route.fulfill({headers:cors,json:{revision:live.revision,document:doc,assets:[],fingerprint:createHash('md5').update(JSON.stringify(doc)).digest('hex')}})
 if(r.method()==='GET'&&p.startsWith('/storage/'))return route.continue()
 if((r.method()==='GET'&&/^\/rest\/v1\/(site_content|about_content|gallery_images|barber_photos|reviews|barbers|services)$/.test(p))||(r.method()==='POST'&&['/rest/v1/rpc/public_business_discovery','/rest/v1/rpc/public_booking_catalog'].includes(p)))return route.continue()
 blocked.push({p,method:r.method()});return route.fulfill({status:403,headers:cors,json:{error:'test-denies-production-writes'}})
})
let instrumented=0
await context.route(site+'/assets/*.js',async route=>{
 const response=await route.fetch(), code=await response.text()
 const find='static getDerivedStateFromError(){return{failed:!0}}'
 if(code.includes(find)) {instrumented++;return route.fulfill({response,body:code.replace(find,'static getDerivedStateFromError(error){globalThis.__cmsCrash={message:String(error),stack:error?.stack};return{failed:!0}}')})}
 return route.fulfill({response,body:code})
})
const page=await context.newPage(),errors=[],requests=[]
page.on('pageerror',e=>errors.push(e.stack));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
page.on('request',r=>requests.push({url:r.url(),method:r.method(),t:Date.now()}))
const start=Date.now();await page.goto(site+'/admin/cms/');let timeout=null
try{await page.waitForFunction(()=>!!document.querySelector('.gjs-frame')||!!globalThis.__cmsCrash||document.body.innerText.includes('Studion kunde inte öppnas'),null,{timeout:60000})}catch(e){timeout=e.message}
const elapsed=Date.now()-start;await page.waitForTimeout(1500)
const metrics=await page.evaluate(()=>({body:document.body.innerText,crash:globalThis.__cmsCrash,frames:[...document.querySelectorAll('iframe')].map(f=>f.src)}))
await page.screenshot({path:out+'/iphone.png'})
await writeFile(out+'/result.json',JSON.stringify({elapsed,timeout,instrumented,metrics,errors,requests,blocked},null,2))
console.log(JSON.stringify({elapsed,timeout,instrumented,metrics,errors:[...new Set(errors)]}))
} finally {await browser.close()}

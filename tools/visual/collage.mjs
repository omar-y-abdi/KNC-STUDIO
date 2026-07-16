// Assembles the captured Task 2 (+ Task 1) states into two labelled collages — web + mobile —
// styled on-brand, by laying the PNGs out in an HTML grid and screenshotting it with Playwright.
//   SHOTS = dir of source PNGs   OUT = dir for collage-*.png
import { chromium } from 'playwright'
import { readFileSync, mkdirSync } from 'node:fs'

const SHOTS = process.env.SHOTS ?? '/tmp/t2shots'
const OUT = process.env.OUT ?? '/tmp/t2shots'
mkdirSync(OUT, { recursive: true })

const uri = (file) => `data:image/png;base64,${readFileSync(`${SHOTS}/${file}`).toString('base64')}`

// [file, tag, caption]
const WEB = [
  ['hero__desktop-light.png', 'Task 1', '"Boka tid" + "Mina bokningar" sida vid sida på startsidan'],
  ['booking-services__desktop-light.png', '§1', 'Bokning — barberarens egen, redigerbara tjänstemeny'],
  ['mybookings-list__desktop-light.png', 'Task 1', 'Mina bokningar — kommande + tidigare (ihopfällt)'],
  ['about__desktop-light.png', '§3', 'Om oss — platshållare (före foto)'],
  ['about-photo__desktop-light.png', '§3', 'Om oss — med uppladdat barberarfoto'],
  ['home-xl__desktop-light.png', '§2', 'Startsida — admin-satt fontstorlek (xl)'],
  ['about-xl__desktop-light.png', '§2', 'Om oss — admin-satt fontstorlek (xl)'],
  ['hero__desktop-dark.png', 'Tema', 'Mörkt läge'],
]
const MOBILE = [
  ['hero__mobile-light.png', 'Task 1', 'Startsida — knappar staplade'],
  ['booking-services__mobile-light.png', '§1', 'Tjänstemeny'],
  ['mybookings-list__mobile-light.png', 'Task 1', 'Mina bokningar'],
  ['about-photo__mobile-light.png', '§3', 'Barberarfoto'],
  ['home-xl__mobile-light.png', '§2', 'Fontstorlek xl'],
  ['hero__mobile-dark.png', 'Tema', 'Mörkt läge'],
]

const card = ([file, tag, caption]) => `
  <figure class="card">
    <div class="frame"><img src="${uri(file)}" alt="${caption}"/></div>
    <figcaption><span class="tag">${tag}</span><span class="cap">${caption}</span></figcaption>
  </figure>`

const page = (title, sub, cols, items, cardMax) => `
<!doctype html><html><head><meta charset="utf-8"/><style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #efece6; color: #1a1a1a; font-family: -apple-system,'SF Pro Text',system-ui,sans-serif;
         padding: 52px 48px 60px; }
  header { text-align: center; margin-bottom: 40px; }
  h1 { font-family: 'Playfair Display',Georgia,'Times New Roman',serif; font-weight: 600; font-size: 40px;
       letter-spacing: .2px; }
  .sub { margin-top: 10px; font-size: 15px; color: #6b6660; letter-spacing: .2px; }
  .grid { display: grid; grid-template-columns: repeat(${cols}, 1fr); gap: 30px; max-width: ${cols * cardMax}px;
          margin: 0 auto; }
  .card { display: flex; flex-direction: column; gap: 12px; }
  .frame { border: 0.5px solid #d8d2c8; border-radius: 14px; overflow: hidden; background: #fff;
           box-shadow: 0 10px 34px rgba(40,34,24,.10); }
  .frame img { display: block; width: 100%; height: auto; }
  figcaption { display: flex; align-items: baseline; gap: 10px; padding: 0 4px; }
  .tag { flex: none; font-size: 11px; font-weight: 700; letter-spacing: .5px; color: #fff; background: #1a1a1a;
         border-radius: 6px; padding: 3px 8px; }
  .cap { font-size: 13.5px; color: #46423c; line-height: 1.35; }
  footer { text-align: center; margin-top: 46px; font-size: 12.5px; color: #8a847c; }
</style></head><body>
  <header><h1>Blade &amp; Blend Studio</h1><div class="sub">${title} · ${sub}</div></header>
  <div class="grid">${items.map(card).join('')}</div>
  <footer>Fångat mot mock-preview · Adminpaneler (Tjänster/Startsida/Profil/Reservera kund) kräver inloggning — visas separat</footer>
</body></html>`

const browser = await chromium.launch()
try {
  for (const [name, width, html] of [
    ['collage-web', 1680, page('Kundvyn — webb', 'Task 1 · §1 tjänster · §2 fontstorlek · §3 foto', 2, WEB, 780)],
    ['collage-mobile', 1360, page('Kundvyn — mobil', 'Task 1 · §1 · §2 · §3', 3, MOBILE, 400)],
  ]) {
    const ctx = await browser.newContext({ viewport: { width, height: 1200 }, deviceScaleFactor: 2 })
    const p = await ctx.newPage()
    await p.setContent(html, { waitUntil: 'networkidle' })
    await p.evaluate(() => globalThis.document.fonts.ready)
    await p.waitForTimeout(300)
    await p.screenshot({ path: `${OUT}/${name}.png`, fullPage: true })
    console.log('wrote', `${name}.png`)
    await ctx.close()
  }
} finally {
  await browser.close()
}

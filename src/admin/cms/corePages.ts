import type { CmsDocument, CmsPage } from '../../../shared/cms'

export const CORE_PAGE_IDS = [
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000005',
  '10000000-0000-4000-8000-000000000006',
] as const

const common = String.raw`
*{box-sizing:border-box}.knc-cms-page{min-height:100vh;font-family:'Inter Variable',Inter,system-ui,sans-serif;background:#f4f3f0;color:#242427}.knc-shell{width:min(1180px,calc(100% - 48px));margin:auto}.knc-nav{height:76px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #24242722}.knc-brand{display:flex;align-items:center;gap:10px;color:inherit;text-decoration:none;font-weight:800;letter-spacing:.12em;text-transform:uppercase}.knc-brand img{width:28px;height:28px}.knc-links{display:flex;align-items:center;gap:22px}.knc-links a{color:inherit;text-decoration:none;font-size:13px;font-weight:650}.knc-hero{min-height:calc(100vh - 76px);display:grid;grid-template-columns:minmax(0,1.2fr) minmax(280px,.8fr);align-items:center;gap:64px;padding:72px 0}.knc-kicker{font-size:12px;letter-spacing:.18em;text-transform:uppercase;font-weight:750;margin:0 0 16px}.knc-display{font-family:'Playfair Display',Georgia,serif;font-size:clamp(54px,8vw,118px);line-height:.84;letter-spacing:-.045em;margin:0 0 28px}.knc-lead{font-size:18px;line-height:1.65;max-width:630px;margin:0 0 30px}.knc-actions{display:flex;gap:12px;flex-wrap:wrap}.knc-button{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:0 20px;border:1px solid currentColor;border-radius:999px;color:inherit;text-decoration:none;font-weight:750}.knc-button.primary{background:#242427;color:#f4f3f0;border-color:#242427}.knc-card{border:1px solid #24242722;border-radius:26px;padding:30px;background:#ffffffb8;box-shadow:0 24px 80px #24242714}.knc-card h2{font-family:'Playfair Display',Georgia,serif;font-size:34px;margin:0 0 14px}.knc-section{padding:90px 0}.knc-section h1,.knc-section h2{font-family:'Playfair Display',Georgia,serif}.knc-section h1{font-size:clamp(48px,7vw,88px);line-height:.95;margin:0 0 24px}.knc-section h2{font-size:38px}.knc-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px}.knc-copy{font-size:17px;line-height:1.7;max-width:760px}.knc-runtime-island{min-height:460px;border:1px dashed #24242755;border-radius:24px;padding:24px;background:#fff}.knc-runtime-island:empty:before{content:'Runtime';opacity:.45}.knc-legal dl{display:grid;grid-template-columns:minmax(150px,.35fr) 1fr;gap:10px 20px}.knc-legal dt{font-weight:750}.knc-legal dd{margin:0}.knc-footer{padding:36px 0 50px;border-top:1px solid #24242722;font-size:12px;display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap}
@media(max-width:768px){.knc-shell{width:min(100% - 28px,620px)}.knc-nav{height:66px}.knc-links{gap:12px}.knc-links a:nth-child(n+3){display:none}.knc-brand span{display:none}.knc-hero{min-height:calc(100dvh - 66px);display:flex;flex-direction:column;justify-content:center;align-items:stretch;gap:34px;padding:46px 0}.knc-display{font-size:clamp(52px,18vw,78px)}.knc-lead{font-size:16px}.knc-actions{display:grid}.knc-button{width:100%}.knc-card{border-radius:20px;padding:22px}.knc-section{padding:56px 0}.knc-section h1{font-size:48px}.knc-grid{grid-template-columns:1fr}.knc-runtime-island{min-height:520px;padding:16px}.knc-legal dl{grid-template-columns:1fr}.knc-legal dd{margin:0 0 12px}}
`

const dark = `${common}.knc-cms-page{background:#171719;color:#f3f0e8}.knc-nav,.knc-footer{border-color:#f3f0e828}.knc-card,.knc-runtime-island{background:#242427;border-color:#f3f0e824}.knc-button.primary{background:#f3f0e8;color:#171719;border-color:#f3f0e8}`
const light = common

function chrome(lang: 'sv' | 'en', body: string): string {
  const labels =
    lang === 'sv'
      ? { home: 'Hem', about: 'Om oss', book: 'Boka', mine: 'Mina bokningar' }
      : { home: 'Home', about: 'About', book: 'Book', mine: 'My bookings' }
  return `<div class="knc-cms-page"><div class="knc-shell"><nav class="knc-nav"><a class="knc-brand" href="/"><img src="/icons/knc-logo-pole.svg" alt=""><span>Blade & Blend Studio</span></a><div class="knc-links"><a href="/">${labels.home}</a><a href="/about">${labels.about}</a><a href="/booking">${labels.book}</a><a href="/my-bookings">${labels.mine}</a></div></nav>${body}<footer class="knc-footer"><span>Blade & Blend Studio</span><span><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></span></footer></div></div>`
}

function variant(lang: 'sv' | 'en', body: string): CmsPage['content']['sv'] {
  return { html: chrome(lang, body), css: { light, dark } }
}

function page(
  id: string,
  path: string,
  name: [string, string],
  description: [string, string],
  sv: string,
  en: string,
  kind: CmsPage['kind'] = 'page',
): CmsPage {
  return {
    id,
    kind,
    path,
    name: { sv: name[0], en: name[1] },
    title: { sv: name[0], en: name[1] },
    description: { sv: description[0], en: description[1] },
    content: { sv: variant('sv', sv), en: variant('en', en) },
    inMenu: kind === 'page' && path !== '/my-bookings',
  }
}

const corePages: readonly CmsPage[] = [
  page(
    CORE_PAGE_IDS[0],
    '/',
    ['Startsida', 'Home'],
    ['Blade & Blend Studio i Göteborg.', 'Blade & Blend Studio in Gothenburg.'],
    '<main class="knc-hero"><div><p class="knc-kicker">Blade & Blend Studio</p><h1 class="knc-display">Klipp.<br>Skägg.<br>Detalj.</h1><p class="knc-lead">En modern barberare med fokus på hantverk, lugn och en bokning som tar mindre tid än själva beslutet.</p><div class="knc-actions"><a class="knc-button primary" href="/booking">Boka tid</a><a class="knc-button" href="/my-bookings">Mina bokningar</a><a class="knc-button" href="/about">Om oss</a></div></div><aside class="knc-card"><h2>Göteborg.</h2><p>Välj barberare, behandling och tid. Resten håller vi enkelt.</p></aside></main>',
    '<main class="knc-hero"><div><p class="knc-kicker">Blade & Blend Studio</p><h1 class="knc-display">Cut.<br>Beard.<br>Detail.</h1><p class="knc-lead">A modern barbershop focused on craft, calm and booking that takes less time than the decision itself.</p><div class="knc-actions"><a class="knc-button primary" href="/booking">Book appointment</a><a class="knc-button" href="/my-bookings">My bookings</a><a class="knc-button" href="/about">About us</a></div></div><aside class="knc-card"><h2>Gothenburg.</h2><p>Choose barber, service and time. We keep the rest simple.</p></aside></main>',
  ),
  page(
    CORE_PAGE_IDS[1],
    '/about',
    ['Om oss', 'About us'],
    ['Salongen, barberarna och arbetet.', 'The salon, barbers and craft.'],
    '<main class="knc-section"><p class="knc-kicker">Om studion</p><h1>Hantverk utan teater.</h1><div class="knc-grid"><div class="knc-copy"><p>Blade & Blend är byggt för bra klippningar, tydliga tider och en avslappnad upplevelse.</p></div><div id="knc-about-runtime" class="knc-runtime-island"></div></div></main>',
    '<main class="knc-section"><p class="knc-kicker">About the studio</p><h1>Craft without theatre.</h1><div class="knc-grid"><div class="knc-copy"><p>Blade & Blend is built around good cuts, clear appointments and a relaxed experience.</p></div><div id="knc-about-runtime" class="knc-runtime-island"></div></div></main>',
  ),
  page(
    CORE_PAGE_IDS[2],
    '/booking',
    ['Bokning', 'Booking'],
    ['Boka barberare och behandling.', 'Book a barber and service.'],
    '<main class="knc-section"><p class="knc-kicker">Bokning</p><h1>Din tid. Din stol.</h1><div id="knc-booking-runtime" class="knc-runtime-island"></div></main>',
    '<main class="knc-section"><p class="knc-kicker">Booking</p><h1>Your time. Your chair.</h1><div id="knc-booking-runtime" class="knc-runtime-island"></div></main>',
  ),
  page(
    CORE_PAGE_IDS[3],
    '/my-bookings',
    ['Kundens bokningar', 'My bookings'],
    ['Hantera dina bokningar.', 'Manage your bookings.'],
    '<main class="knc-section"><p class="knc-kicker">Mina bokningar</p><h1>Allt på ett ställe.</h1><div id="knc-my-bookings-runtime" class="knc-runtime-island"></div></main>',
    '<main class="knc-section"><p class="knc-kicker">My bookings</p><h1>Everything in one place.</h1><div id="knc-my-bookings-runtime" class="knc-runtime-island"></div></main>',
  ),
  page(
    CORE_PAGE_IDS[4],
    '/privacy',
    ['Integritetspolicy', 'Privacy policy'],
    ['Hur personuppgifter hanteras.', 'How personal data is handled.'],
    '<main class="knc-section knc-legal"><p class="knc-kicker">Juridik</p><h1>Integritetspolicy</h1><p class="knc-copy">Vi behandlar endast uppgifter som behövs för bokning, kundservice och lagkrav.</p><section id="legal-business-details-sv"><dl><dt>Verksamhet</dt><dd data-business-name>Blade & Blend Studio</dd><dt>Personuppgiftsansvarig</dt><dd data-business-controller="sv">Blade & Blend Studio</dd><dt>Kontakt</dt><dd><span data-business-contact></span></dd></dl></section></main>',
    '<main class="knc-section knc-legal"><p class="knc-kicker">Legal</p><h1>Privacy policy</h1><p class="knc-copy">We process only the information needed for bookings, customer service and legal obligations.</p><section id="legal-business-details-en"><dl><dt>Business</dt><dd data-business-name>Blade & Blend Studio</dd><dt>Controller</dt><dd data-business-controller="en">Blade & Blend Studio</dd><dt>Contact</dt><dd><span data-business-contact></span></dd></dl></section></main>',
    'privacy',
  ),
  page(
    CORE_PAGE_IDS[5],
    '/terms',
    ['Bokningsvillkor', 'Booking terms'],
    ['Villkor för bokning och avbokning.', 'Booking and cancellation terms.'],
    '<main class="knc-section knc-legal"><p class="knc-kicker">Juridik</p><h1>Bokningsvillkor</h1><p class="knc-copy">Din bokning gäller den valda behandlingen och tiden.</p><p id="cancellation-policy-sv">Avbokningsregeln hämtas från verksamheten.</p><section id="legal-business-details-sv"></section></main>',
    '<main class="knc-section knc-legal"><p class="knc-kicker">Legal</p><h1>Booking terms</h1><p class="knc-copy">Your booking applies to the selected service and appointment time.</p><p id="cancellation-policy-en">The cancellation rule is provided by the business.</p><section id="legal-business-details-en"></section></main>',
    'terms',
  ),
]

export function ensureCorePages(document: CmsDocument): CmsDocument {
  const next = structuredClone(document)
  const existing = new Map(next.presentation.pages.map((item) => [item.id, item]))
  const pathExisting = new Map(next.presentation.pages.map((item) => [item.path, item]))
  const protectedPages = corePages.map((item) => {
    const found = existing.get(item.id) ?? pathExisting.get(item.path)
    if (!found) return structuredClone(item)
    const usable = (['sv', 'en'] as const).every((lang) => found.content[lang]?.html.trim())
    return usable
      ? { ...found, id: item.id, kind: item.kind, path: item.path }
      : structuredClone(item)
  })
  const coreIds = new Set(protectedPages.map((item) => item.id))
  const corePaths = new Set(protectedPages.map((item) => item.path))
  const custom = next.presentation.pages.filter(
    (item) => !coreIds.has(item.id) && !corePaths.has(item.path),
  )
  next.presentation.pages = [...protectedPages, ...custom]
  return next
}

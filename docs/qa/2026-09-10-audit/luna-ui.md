# Publik UI-audit — Luna Max

Datum: 2026-09-10

Branch: `codex/fix-unnoticed-issues`

Baslinje: `88ab39a` (`origin/main` efter fast-forward)

Caveman status: hittade 4 riktiga UI-fel. 4 fixade lokalt i tilldelade filer. PrivacyBanner-layout väntar produktbeslut. PM:s kundlänk/sessionfix ligger separat.

## Täckning

Läst före kod:

- `AGENTS.md` rad 1–136.
- `README.md` rad 1–152.
- `CODEBASE-MAP.md` rad 1–1078.
- `BACKEND.md` rad 1–145.
- `LAUNCH_READINESS_PLAN.md` rad 1–185.
- `docs/operations/PUBLIC_BOOKING_GATEWAY_ROLLOUT.md` rad 1–282.
- `docs/operations/BACKUP_RESTORE.md` rad 1–135.
- `docs/qa/2026-08-31-github-issues-review.md` rad 1–721, inklusive användarbeslut #22, #33, #35, #36, #37 och #41.
- `docs/qa/2026-09-10-audit/pm.md` rad 1–64.

Publik kod läst:

- `src/app/App.tsx`, `DesktopSite.tsx`, `MobileSite.tsx`.
- `src/booking/BookingFlow.tsx`, `bookingStyles.ts`, `DetailsDialog.tsx`, `ConfirmationDialog.tsx`.
- `src/mybookings/MyBookingsDialog.tsx`, adapters, `accessLink.ts`.
- `src/site/PrivacyBanner.tsx`, `storageConsent.ts`, `useSiteChrome.ts`, `siteChrome.ts`.
- `src/about/AboutSection.tsx`, `GalleryMarquee.tsx`, `StarRating.tsx`, CMS/content/galleri-adapters.
- `src/i18n/index.ts`, `sv.ts`, `en.ts`.
- `src/ui/Dialog.tsx`, `LazySurface.tsx`, `public/_headers`.

Browser/harness:

- Produktionssida läst i egen Browser-tab. Ingen bokning, avbokning, mejl eller prod-mutation.
- Playwright fresh contexts: local och produktion, 320×568, 360×800, 390×844, 412×915, 768×1024, 769×900, 1280×720, 1280×900, 1440×900 och 2400×900.
- Bevis före lokal fix: `/tmp/knc-audit-2026-09-10/luna-ui/reports/mobile-desktop-audit.json`, `public-ui-proof.json`.
- Bevis efter lokal fix, Vite + remote catalog: `/tmp/knc-audit-2026-09-10/luna-ui/reports/current-ui-proof.json`, `current-desktop-close-proof.json`, `cold-lazy-booking-proof.json`, `booking-scroll-no-jump-proof.json`, `reopen-booking-proof.json`.
- Screenshots: `/tmp/knc-audit-2026-09-10/luna-ui/screenshots/local-proof-320x568.png`, `local-proof-360x800.png`, `local4175-booking-calendar.png`.
- My Bookings direct-token loading test: `/tmp/knc-audit-2026-09-10/luna-ui/reports/mybookings-token-loading-proof.json`.
- Cold lazy + no-jump + embedded preview + late/reset autofill: `cold-lazy-booking-proof.json`, `booking-scroll-no-jump-proof.json`, `embedded-preview-proof.json`, `initial-contact-late-hydration-proof.json`, `initial-contact-reset-proof.json`.

Officiell praxis använd: [MDN button disabled](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/disabled), [MDN inert](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/inert), [WCAG focus order](https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html), [WAI date picker](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/examples/datepicker-dialog/).

## Fynd

### UI-01 — PrivacyBanner blockerar CTA på smal mobil — P1 — FEEDBACK NEEDED

Repro:

1. Ny browser-context utan consent-cookie.
2. Öppna `/` på 320×568.
3. Försök trycka `Boka tid` eller `Mina bokningar`.

Fakta:

- Banner fixed: `PrivacyBanner.tsx:44–102`, rect `x=12,y=260,w=296,h=232`.
- `Boka tid`: rect `y=318–368`; center träffar bannertext. Playwright click timeout: banner intercepts pointer events.
- `Mina bokningar`: rect `y=378–421`; center träffar bannerknapp.
- 360×800: banner `y=511.5–724`; överlappar `Mina bokningar y=505.8–548.8`.
- 390×844: banner `y=555.5–768`; överlappar `Mina bokningar y=532.1–575.1`.
- Produktion visar samma placering. 412×915 klarar sig med liten marginal.

Effekt: kund på vanlig liten mobil kan inte trycka viktig boknings- eller historikknapp. Banner blockerar fysisk input, inte bara text.

Ägare/fix: `src/site/PrivacyBanner.tsx` + mobil layout i `src/app/MobileSite.tsx`. Kräver produktval om compact banner, annan placering eller reserverad yta. Ingen ändring gjord; PM ska få användarens val.

### UI-02 — Desktop `Boka tid` såg ut som död knapp — P1 — FIXED LOCALLY

Före:

- Produktion/lokal 1280×720: efter click låg booking-step `top=739,bottom=843`, `scrollY=0`, alltså helt under viewport.
- 1280×900: step `top=919`, också under fold.
- Källa: `DesktopSite.tsx:290–346`, tidigare hero `minHeight:100dvh`; App öppnade state men flyttade inte viewport.

Fix:

- `DesktopSite.tsx:72–170`: scrolla till booking-fold för vanlig window och embedded `scrollRootRef`; `ResizeObserver` re-checkar efter cold lazy-load, väntar på stabil fold-layout, deduplicerar verkliga mål, följer reduced-motion och kopplas bort efter bounded settle.
- `DesktopSite.tsx:290–346`: hero får `minHeight:auto` när booking är öppen. Formens första steg får plats även 1280×720.

Efter:

- Den äldre warm-rapporten `current-ui-proof.json` fångade steget före final settle och får inte läsas som fullt synligt (`top=634,bottom=738` vid 720 px).
- Final warm proof med 1,5 s väntan före öppning: `scrollY=18`, step `top=616,bottom=720`; första steg fullt inom viewport efter settle. Körning: `/tmp/knc-audit-2026-09-10/luna-ui/warm-reveal-debug.mjs`.
- Cold lazy import fördröjd 1.8 s: 1280×600 step `top=417,bottom=521`; 1280×720 step `top=537,bottom=641`. Båda fullt synliga efter chunk-resolve.
- Efter scroll till datum/service och konstgjord fold-resize ändrades scrollY inte. Bevis: `booking-scroll-no-jump-proof.json`.
- Kalenderbevis: `current-ui-proof.json`; reveal-bevis: `warm-reveal-debug.mjs` och `cold-lazy-booking-proof.json`; e2e smoke PASS.

### UI-03 — Stängd desktop-fold lämnade tabbbar kontroll — P1 — FIXED LOCALLY

Före:

- Efter öppna/stäng: fold `grid-template-rows:0px`, `opacity:0`, men barberknapp i fold hade `tabIndex=0`, rect synlig/utanför layout. `focus()` lyckades.
- Källa: `DesktopSite.tsx:152–161,278–316`.

Fix:

- `DesktopSite.tsx:346–352`: closed fold får native `inert` och `aria-hidden=true`; open fold tar bort dem.

Efter:

- 1280×720 close proof: fold height `0`, `inert=true`, `ariaHidden=true`; focus probe active `false`.
- Bevis: `current-desktop-close-proof.json`.

### UI-04 — Kalender hade tomma/unavailable tabbtargets och engelska råetiketter — P1 — FIXED LOCALLY

Före:

- Produktion 1280×900: `prev`/`next` var råa engelska `img alt`, utan button label, `disabled=false`, `tabIndex=0`.
- 9 unavailable datum hade opacity `.32` men `disabled=false`, `aria-disabled=null`, `tabIndex=0`.
- 5 tomma kalender-paddingceller var `<button></button>`, utan namn, `disabled=false`, `tabIndex=0`.
- Källa: `BookingFlow.tsx:248–295,575–615`.

Fix:

- `BookingFlow.tsx:256–305,587–644`: padding blir `span aria-hidden`; unavailable datum blir native disabled; datum får full localized aria label, år och `aria-pressed`; nav får localized label, native disabled och `type=button`.
- `i18n/index.ts:7–15`, `i18n/sv.ts:12–21`, `i18n/en.ts:12–21`: `previousMonth`, `nextMonth`, `dateUnavailable`.

Efter:

- Local fresh context: 5 blank spans, 0 blank buttons; unavailable datum disabled och `activeElement` stannar inte på disabled datum; nav `Föregående månad`/`Nästa månad`, prev disabled.
- Bevis: `current-ui-proof.json`, screenshot `local4175-booking-calendar.png`.

## Cross-owner observations

- Produktion console gav CSP-blockerade inline scripts från Cloudflare injection. UI fortsatte fungera; ingen bevisad kundregression här. Handoff till drift/Cloudflare, ingen UI-fix.
- Produktion visar test-/stagingkatalog (`k`, placeholders, inga publicerade reviews). Tidigare beslut #22 säger att roster/services ännu inte är finala. PM/ägare hanterar data; UI ändrade inte detta.
- Direct root customer path test: Worker redirectar till fragment, App städar URL till `/` och öppnar Mina bokningar. Fake token gav korrekt invalid-link text; giltig prod-token testades inte för att inte mutera eller skapa data.
- Initial-contact race var verklig i tidigare kod: `BookingFlow.tsx` effect skrev över hela form när App session restore kom sent. Nu fyller effect bara tomma fält (`BookingFlow.tsx:91–102`). Sen profilhydrering efter tre manuellt ifyllda fält behåller alla tre; bevis `initial-contact-late-hydration-proof.json`. `reset()` fyller samma profile igen (`BookingFlow.tsx:103–120`), så ny bokning behåller cookie-autofill; bevis `initial-contact-reset-proof.json`.
- My Bookings blank loading var verklig före PM:s ändring. Nu visar direct-token delayed test `Hämtar bokningar …` med `role=status`; inget öppet UI-fynd.
- Session-autofill browser proof: injected profile hydrates first details, typed values submit, `Boka en ny tid` opens second details with same profile values. Bevis: `initial-contact-reset-proof.json`.

## PASS

- `npm run typecheck` PASS efter shared-worktree ändringen; `npm run build` PASS i lokal release gate.
- `npx prettier --check` på alla UI-fixfiler PASS.
- Fokuserade Vitest: 5 filer, 17 tester PASS.
- `BASE_URL=http://127.0.0.1:4175 npm run test:e2e` PASS: desktop, mobile, assets, booking, My Bookings, discovery.
- `npm run lint` PASS.
- i18n SV/EN parity PASS.
- Cold lazy booking PASS vid 1280×600 och 1280×720 efter 1,8 s fördröjd chunk; reduced-motion använde `behavior:auto`, första steg fullt synligt.
- Embedded CMS preview PASS: Bokning scrollar sin egen 580 px scroll-root, stängning gör fold inert, reopen återställer scroll till synligt första steg; inga browser/page errors.
- Initial-contact sen hydrering/reset PASS: manuella värden skrivs inte över; profile återkommer efter ny bokning.
- Dialog focus trap/close, gallery pointer-cancel/clone handling, star keyboard control: befintliga tester PASS.

## Gaps

- Ingen fysisk iOS Safari/Android-enhet.
- Ingen riktig kundlänk från Resend inbox i denna UI-agent; PM körde runtime-gate.
- Ingen prod booking, cancel, review submit eller mail.
- Production deploy av lokala UI-fixar ej gjord; live-sidan visar därför före-fix UI tills PM deployar.
- Final local source freeze: UI-fixfiler har inga typecheck-, lint- eller diff-checkfel. PM release gate körde full build/lint/dry-run efter senaste source.

## Feedback behövs

1. Välj privacy banner-layout som inte blockerar CTA på 320–390 px. Sedan kan UI-agent fixa och testa alla narrow viewports.
2. Ingen feedback behövs för UI-02–UI-04; dessa är funktionella/a11y-fixar och redan lokalt verifierade.

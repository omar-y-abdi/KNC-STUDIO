# Launch 13 september — UI-partner

Baseline: `adfc26ee358ea6ef37e22c73e4ae4d502cebc7c7`, samma `codex/fix-unnoticed-issues`.
AGENTS, full CODEBASE-MAP, README/BACKEND/launchplan, båda operationsrunbooks och senaste QA-loggar lästa.
Användarens Turnstile-stub i admin-harness.html och reduced-motion-scroll i App bevarade.
Ingen commit, deployment eller DB-/providerändring från partner. På ägarens uttryckliga instruktion testar en egen Luna Max-agent; partner skriver produktkod.

## Öppettidsrad — klar lokalt

- RED i faktisk App,1280×720: heroBottom720, infoBottom2691.17, inHero=false.
- DesktopSite placerade raden efter hela main. Samma rad/stil flyttad till relativa herons nederkant.
- GREEN: infoBottom=heroBottom720 respektive900. Global cookiepanel och hero-only återöppnare intakta.
- Befintlig admin-state-harness kontrollerar home, booking, About-scroll och layoutbyte.
- **6/6**: Chromium/Firefox/WebKit ×1280×720 EN mörk och1024×768 SV ljus, inklusive befintligt samtyckesflöde.
- Scoped ESLint, tsc, format och diffcheck gröna. Bilder1280SV/1440EN granskade.
- Bevis/kommandon: `/tmp/knc-ui-2026-09-13/hero-before.log`, `hero-matrix.log`; kör `node /tmp/knc-ui-2026-09-13/hero-matrix.mjs` med isolerad Vite4198. Bildfiler `hero-*-saved.png` i samma mapp.
- Produktionssidan och Linux-CI-baseline ännu inte uppdaterade av partner.

## Godkänt UI-paket — kod/test klara lokalt

Äger DesktopSite, MobileSite, shared.ts, AboutSection-footer, godkända aria-pressed-/DetailsDialog-länkhunkar, respektive i18n-nycklar och befintlig harness. Root äger App/Root,
Worker/SEO/404/legal/public, kundprofil/DB/backup och faktisk Chrome/Gmail/produktionsresa.

- [x] Öppettider/adress i herons nederkant.
- [x] Småtextkontrast: källans färger/opacity ger desktop-kicker2.85:1 ljus/4.18 mörk; mobil info3.90; desktop info4.35. Ändrat endast textton/opacity. Browser mäter nu minst4.5:1 för samma informationsrader. Normal text kräver minst4.5:1 enligt [WCAG1.4.3](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html). Logo undantas; design/färgfamilj bevaras.
- [x] Reduced motion: gemensam matchMedia-hook i shared.ts styr skalens övergångar, även vid ändrad OS-preferens. Befintlig App-scrollfix bevarad; byte av preferens får inte starta om booking reveal.
- [x] Hero/cookie-overlay: vid1024×768 låg första barberarknappen y668–738 under panel y607–756. Mittpunkten täcktes; Playwright kunde ibland använda annan kant, så total blockering påstås inte. Reveal räknar nu panelens verkliga reserverade höjd och fasta nav. Första valet är helt ovanför panelen.
- [x] Tangentbord/etiketter: barberarval exponerar aria-pressed; Enter väljer. Terms-länk går att aktivera med tangentbord och bevarar ifylld bokning. Befintliga logotyper har namn, dekorativa markeringar döljs, CMS-replikan är inert. Delayed catalog + embedded reveal passerar och efterföljande layout ändrar inte scroll. Ingen full skärmläsar-/fysisk iPhone-certifiering påstås.
- [x] Diskreta SV/EN-footerlänkar till /terms och /privacy bredvid integritetsinställningar. Sista DetailsDialog har tydlig terms-länk i ny flik, uttrycklig etikett, ingen checkbox/ny avgift. Root äger policydokument och route-integration.
- [x] Fokuserade regressioner: **26/26** (18UI över3engines,6terms/keyboard/draft,2delayed/embedded), **32/32** unit i5befintliga filer; scoped ESLint/tsc/format/diffcheck gröna. Ingen fristående repotestfil. `/tmp/knc-ui-2026-09-13/ui-final-matrix.mjs` och `.log`. Efter matrisen tillkom endast countassert för två informationsfält och browserglobal-kvalificering; Luna verifierade aktuell assertion i1024ENlight och aktuell termsresa i320SV. Sju slutbilder visuellt granskade, alla PASS: `final-1280-*`, `final-1440-*`, `final-320-sv-booking-details-terms-link.png` i samma mapp.

Prestandaläsning: bokning lazy-loadas, reveal-observer stängs efter settlement, mobilscroll använder rAF.
Ingen mätning motiverar en separat prestandaombyggnad ännu.

## Säkerhetsreview till root

- Identitetsspec granskad, ingen DB-/Edge-implementation av partner. Hela grupper måste mergeas under sparade ID/versioner; konkurrerande koppling ska avvisas utan retarget/split.
- Källans exakta issuing-email/generation behövs; målrotation måste också invalidiera intent om rotation ska neka. Fel browser får inte consume eller exponera profil. Separat fragment, aldrig generisk permanent-token-login.
- Outbox skippar utgångna/ersatta/använda intents. Receipt förblir exakt-ID, aldrig implicit verified/profile/review efter merge.
- Markerad designavvägning: befintlig full A-session kan skapa beständig B-alias som A-tokenrotation inte tar bort. Root accepterade färskt mailboxbevis även A: båda mejl behöver egna kopplingsnonce, aktuell A-session, båda generationer och gruppversioner.
- Calendar-transport: waitUntil kan förstärka handlerlivstid men bevisar inte deadline som rotorsak. Rootens nya5s och30s anrop båda lyckades; första transportfelets orsak ännu inte fastställd. Samma dispatch-token/lease/idempotens måste bevaras.

## Calendar-P0 — klar lokalt

- Root verifierade backend helt frånkopplad:0tokens,0eventmaps,0jobs. UI stod kvar på ”Kopplar loss”. Hooken läste bara mount/manuellrefresh och sparade lokalt pending efter disconnect.
- Äger `useCalendarSync.ts`, `CalendarConnectButton.tsx`, `status.ts`, `adapters/supabaseCalendarSync.ts` och Calendar-nycklar i `adminStrings.ts`. Luna äger regressioner i befintlig admin-harness/admin-state och `calendarSync.test.ts`.
- Visible pendingpoll15s och focus/visibilityrefresh. Samtidiga statusläsningar delar promise;10s deadline behåller senast bekräftad status. Läsning före mutation, gammal port, timeout och unmount får inte skriva över nyare tillstånd. Synkron mutationsspärr skyddar dubbelanrop före omrendering.
- Okänd/trasig status visas som hämtningsfel, aldrig frånkopplingsbevis. Parsersvar kräver boolean connected och validerar eventuella övriga fält; legitima äldre svar utan valfria fält fungerar. Pending/fel har lokaliserad ”Kontrollera status”; text förklarar att säker bortkoppling kan ta några minuter.
- Originalhook och komponent bevarade i `/tmp/knc-ui-2026-09-13/baseline-*`; cmp mot orörd källa exit0 före implementation. RED:15s senare statusCalls1/disconnectCalls1/pendingtrue, ny serverstatus begärdes aldrig.
- GREEN: `node /tmp/knc-ui-2026-09-13/calendar-p0-green.mjs` PASS. Faktisk hook/komponent täcker pendingack/immediate refresh,15spoll,hidden/visible/focus,initial/later error,retry,10sdeadline,stale read,port A→B,unmount,late connect URL och synkrona dubbelmutationer. Första greenrunner hade ett klockfel (+1ms vid ackflush), rättat i harness utan ändrad produktgräns.
- `npx vitest run tests/unit/calendarSync.test.ts`: **40/40**. Scoped ESLint, `npx tsc -b --pretty false`, `node --check tools/e2e/admin-state.mjs`, diffcheck PASS. Ingen produktions-UIeffekt påstås före release.

## Kundmejlkoppling — kod klar, regression pågår

- Root godkände separat `CustomerEmailLink.tsx`, `customerEmailLinkStrings.ts`, MyBookingsDialog och endast accesslink-state/effect/props i App. Metadata/privacy/receipt-revocation bevarade. Root äger adapter/port/Edge/SQL.
- `#email_link` läses till minnet och strippas direkt, även vid hashchange. Samtidig booking-token ignoreras och strippas; inget implicit login eller confirm. Felaktig/duplicerad nonce blir lokal invalid-state. Endast explicit knapp bekräftar.
- Hanteringsdelen är diskret/collapsible efter historiken och kräver riktig verified profile-email. Device och mockprofil utan mejl får inga kopplingskontroller. Egna alias visas; copy förklarar båda gruppers hela historik och två färska mejlbevis. Queued säger ”Vi skickar”, aldrig inboxbevis. Fel browser får vardaglig återhämtningsinstruktion.
- Port/tokenbyte tömmer gammal dialog; readsequence och livstid spärrar sena list-/mutationssvar. Komponentens port/mejl/nonce/synkrona busyspärr skyddar sena kopplingsresultat. Linked/already_linked laddar om profil/historik; transportfel behåller senaste bekräftade lista med retry.
- Extra bekräftad gräns: bytt HttpOnly-cookie kan annars låta A:s öppna vy starta koppling som B. Root accepterade obligatorisk `sourceEmail`; UI skickar exakt visad issuing-email, Edge nekar mismatch.
- Fokuserad produkt-ESLint/format/diffcheck PASS. Luna äger verklig dialog/App-browsergate och befintliga accesslink-unitregressioner; ännu inget färdigbevis.

## Root-migration — oberoende statisk review

Läst hela `20260913131739_verified_customer_profiles.sql`, nya request/confirm-Edgehunkar, nya verifieringsbrev/outboxhunkar och berörda befintliga token-/receipthelpers. Ingen SQL-/produktionsändring från partner.

1. Fel full kundcookie + giltig nonce blev `invalid`, vilket gav fel återhämtningsresa. Root ändrade till separat nonce-lookup och `access_denied` för source mismatch före proofmutation.
2. Target generation0 hade ingen tokenrad att SHARE-låsa. Första token kunde skapas efter generationcheck men före merge. Reproplan: blockera alias-B UPDATE, starta andra proofconfirm, skapa B-token parallellt, släpp alias. Root inför gemensamma email-advisorylocks före tokenrowlocks i ensure/rotate/repair och request/confirm; concurrencybevis inväntas.
3. Request läste session före lås men återvaliderade inte efter rotation. Revokerad session kunde köa nya verifieringsmejl med ny generation; confirm hindrade fortfarande merge. Root återvaliderar exactsession under samma credentiallocks före intent/outbox.

Övrigt läst: source/target-versioner och båda credential-generationer jämförs; hela grupper flyttas under ordnade profillås; frontendgrants saknas på nya privata tabeller/helpers; outboxpayload endast link_id/side/lang; dispatch skippar använda/utgångna/stale intents. Receipt behåller exakt booking-ID och parent-email. Statisk review ersätter inte rootens DB/Edge-concurrencyprov.

# Kundprofilbackend — 13 september

Avgränsning: befintlig profilimplementation på `codex/fix-unnoticed-issues`; ingen produktion,
deployment, commit eller ändring av UI/CMS/Worker/backup. Supabase-, Ponytail- och sPTC-flöden använda.

## Kontrakt klargjort av PM

”Exakt initierande session” i äldre planen betyder **exakt källmejladress A och aktuell
credential-generation**, inte en bestämd cookieinstans. Ny giltig A-session i en annan webbläsare
får slutföra kopplingen. Fel B-session avslås. Första delbevisets replay ger idempotent `waiting`
för återhämtning efter tappat HTTP-svar; efter slutlig merge/utgång/ersättning avslås replay.
Ingen sessionhashbindning eller ändrad delbevissemantik infördes.

## Kod

- `20260913131739_verified_customer_profiles.sql`: listningen nollställde sessionsnummer genom
  `SELECT INTO` när inga bokningar fanns kvar. Det utelämnade det obligatoriska `phone`-fältet och
  frontendens wire-schema avvisade en giltig tom profil. Separat senaste-bokningsnummer med fallback
  till det autentiserade sessionsnumret fixar detta. Telefon ger fortfarande ingen behörighet.
- Samma migration: borttagen helt oanvänd `customer_profile_emails_for_access`-funktion och oanvänd
  reviewlokal. Ingen ny auktorisationsväg eller abstraktion.
- Formatering av redan tillagda kopplingshunkar i `src/backend/publicBookingActions.ts` och
  `src/mybookings/adapters/supabaseMyBookings.ts`. Övriga ägda Edge/adapter/mejlfiler lästa;
  befintliga kontrakt och säkerhetsgränser bevarade.

## Bevis

Körbar avgränsad gate:

```sh
node /tmp/knc-backend-high/verify.mjs
```

Logg: `/tmp/knc-backend-gate.log` — `PASS BACKEND MATRIX` och `PASS exact local fixture cleanup`.
Gaten använder en hårdkodad lokal PostgreSQL-anslutning. Den ersätter enbart denna sessions nya
profilobjekt transactionellt, bevarar bookings/auth och återanvänder nuvarande migrationsfil.
Sekventiella fixtures rullas tillbaka; concurrencyfixtures har egna ID/mejl och städas exakt.
Fixturebokningar kör utan drifttriggers; committade testmejljobb får `next_attempt_at=infinity`.

- Samma mejl/ändrat nummer, två mejl/samma nummer, list/cancel/review före och efter verifiering.
- Båda färska mejlbevis, fel kundsession, permanent råcredential och receipt nekade för koppling;
  ny A-session tillåten; idempotent första proof och slutlig replay-denial.
- Hela grupper, framtida aliasbokningar, utgång, ersatt intent, source/target-rotation.
- Två separata outboxjobb utan rånycklar/ciphertext i payload; dispatch läser krypterat proof och
  skippar redan bekräftat delbevis.
- Receipt förblir exact-ID, exact-parent-email och device-authority efter profilmerge.
- Deterministisk concurrency: merge blockeras vid aliasuppdateringen **efter** generationläsning;
  första B-token blockeras på mergens email-advisorylock och fortsätter först efter merge.
- Deterministisk concurrency: request väntar på pågående source-rotation; efter låset avslås den
  revokerade sessionen utan nytt intent/proofmejl. Två konkurrerande gruppmerges ger en vinnare och
  ett invalid/stale avslag; inga splittrade eller omriktade grupper.
- Nya tabellers RLS/grants samt befintliga service-RPC:ers browser-denial kontrolleras.
- Tomprofilfixen har separat SQL RED/GREEN: föregående body saknar obligatoriskt `phone`;
  nuvarande body returnerar giltigt nummer och tom historik. Hela extra kontrollen rullades tillbaka.
- Scoped frontend-ESLint, Prettier, scriptsyntax och diffcheck PASS.

## Lokal ACL-avvikelse och återställning

Den tidigare `/tmp/knc-sep13-root-tests/profile-resync.sql` droppade också befintliga RPC:er.
Återskapandet gav `proacl=NULL`, alltså standard-EXECUTE för PUBLIC. Verifierat på fyra RPC:er.
Detta kom från den lokala resyncen; produktionsmigrationskedjans `CREATE OR REPLACE` bevarar ACL.
Den nya gaten droppar endast nya profilhelpers/tabeller och återställer de föregående migrationernas
exakta service-only RPC-grants; cleanup förblir utan service-role-EXECUTE. Nuvarande lokala migration
och korrekta gamla ACL är applicerade efter godkänd fullkörning.

Kvar: PM/Luna äger breda unit/build-/Edge-/browsergrindar och dokumentuppdatering av den tidigare
formuleringen ”exakt initierande session”. Inga kvarvarande bekräftade produktfynd i ägt scope.

## Kund-E2E: avbokningsfixture — klar

Felsymptom: `tools/e2e/smoke.mjs:1369` väntade på ”Tiden är avbokad.” medan DOM visade
”Något gick fel vid avbokningen.” Faktiskt Edge-svar med kontrollerad lokal 72-timmarspolicy:
`{"ok":false,"error":"not_found"}`. Fixture bokade tre datum framåt kl 11:00 svensk tid;
`2026-09-16 09:00Z` låg mindre än 72 timmar efter provets `2026-09-13 15:21Z`.
SQL-villkoret `start_at > now() + make_interval(hours => 72)` var false. Servern avslog korrekt.

Endast harness ändrad: datum nio dagar framåt ligger utanför högsta stödda avbokningsgränsen
sju dygn och inom befintlig bokningshorisont. Kalendern går till nästa månad vid behov. Confirm-
knappen väntas alltid in; testet fångar och kontrollerar avbokningssvaret före framgångstexten,
så framtida backendavslag ger exakt fel i stället för en missvisande DOM-timeout.

- RED72: `/tmp/knc-customer-cancel-policy72-red.log`, explicit `not_found` med ursprungsdatumet.
- GREEN72: `npm run test:e2e -- --customer`, exit 0; Chromium, Firefox och WebKit passerade hela
  befintliga kundmatrisen inklusive device-cancellation. Logg
  `/tmp/knc-customer-cancel-policy72-green.log`.
- Testet kördes mot verklig lokal Worker → Edge → DB, separata Playwright-kontexter.
  Föregående lokala policyvärde 24 återställdes och lästes tillbaka efter provet.
- Scriptsyntax, Prettier och diffcheck PASS. Ingen produktregel eller produktkod ändrad.

Under första försöket hade parallellt CMS-prov redan återställt policy 24: Chromium passerade men
Firefox träffade ett intermittent bokningsdialogöverlägg vid shared-cookie-steget (`smoke:1162`).
Logg `/tmp/knc-customer-cancel-red.log`; UI-partner underrättad. Samma Firefox-steg och hela matrisen
passerade i slutliga 72-provet utan UI-ändring. Orsaken till det separata intermittenta överlägget är
inte fastställd; ingen spekulativ produktfix gjordes.

## Kundmejlkoppling: 320 px textoverflow — klar

Rotorsak: bekräftelsens sessionsmejl renderades som obruten `<strong>`-text utan tillåten
brytpunkt. Kortets befintliga mobilzoom 0,85 förklarar `clientWidth=339` vid faktisk bredd 288 px;
`scrollWidth=438` kom från mejltexten, inte från fel kortbredd.

Endast `src/mybookings/CustomerEmailLink.tsx` ändrad: `overflowWrap: 'anywhere'` på den befintliga
notistextstilen låter även den ärvande mejltexten brytas inom kortet. Ingen förändring av dialogens
storlek, global zoom, knappar, desktoplayout eller auktorisationsflöde.

- RED: `node /tmp/knc-ui-2026-09-13/customer-independent.mjs` gav stabilt 339/438.
  Logg `customer-width-red.log`; separat geometri i `customer-width-probe-red.json`.
- GREEN: samma oberoende kundscript, samtliga sju befintliga fall PASS.
  Logg `/tmp/knc-ui-2026-09-13/customer-width-green.log`.
- Extra riktat Chromiumprov: `node /tmp/knc-ui-2026-09-13/customer-width-matrix.mjs`, **8/8 PASS**
  (SV/EN × 320/1280 × bekräftelse/hantering), med 197 tecken långt mejl och långt alias.
  Ingen horisontell overflow; samtliga åtgärdsknappar gick att klicka.
  Mobilkortet renderar x=16..304 med client/scroll=339/339; desktop x=440..840 och 400/400.
- Screenshot 320 SV och 1280 EN visuellt granskade; lång mejltext bryts inom kortet och åtgärden
  är tillgänglig. `customer-width-*-green.png` och `customer-width-matrix.log` i samma /tmp-mapp.
- Scoped ESLint och Prettier PASS. Ingen full DB-/treengine-svit körd för CSS-fixen.

## Admin-gate: kundportens svarordning

Det exakta `verifyCustomerEmail`-fallet reproducerade B-lista fast i ”Loading bookings …”, trots
att anropsräknaren senare visade B=1. Browserinstrumentering av befintlig produktkod visade att
`waitCustomerCalls` återvände redan vid B=0; testets `resolve-list` tappades då av optional chaining.
Produktens livstidsvakt läste senare ett fortfarande olöst B-promise och betedde sig korrekt.

Rotorsak: `waitCustomerCalls` använde ett async predikat som först importerade harnessmodulen.
Installerad Playwright (`node_modules/playwright-core/lib/coreBundle.js:23502`) testar predikatets
returvärde direkt som truthy; ett Promise uppfyller det innan dess false-värde har lösts ut.

Ändring endast i testharness:

- `admin-harness.tsx`: `customerControl` är synkron (inga await-operationer fanns). Försök att
  släppa ett list/request/confirm/cancel-svar utan motsvarande startad gate kastar nu tydligt fel.
- `admin-state.mjs`: `waitCustomerCalls` importerar kontrollfunktionen före pollningen och använder
  ett synkront snapshotpredikat via ett JSHandle som frigörs i finally. Alla befintliga anrop till
  helpern får samma korrekta startgräns; assertions och produktkod bevarade, inga sleeps tillagda.

Riktat RED: `/tmp/knc-ui-2026-09-13/admin-customer-current.log`.
Browsertrace: `/tmp/knc-ui-2026-09-13/customer-owner-trace.log` (väntan returnerar B=0).
Riktat GREEN: `node /tmp/knc-ui-2026-09-13/admin-customer-current.mjs` PASS.
`node /tmp/knc-ui-2026-09-13/customer-response-order.mjs` PASS: snapshot synkront, prematurt B-svar
kastar `Customer resolve-list response has no started b[0] request`.
Scoped ESLint och diffcheck PASS.

Slutlig exakt fullgate: `BASE_URL=http://127.0.0.1:4188 npm run test:e2e:admin` **PASS, exit 0**.
41 Chromiumscenarier + fem privacyfall vardera i Firefox och WebKit.
Logg `/tmp/knc-final-admin-e2e-green.log`. Kort diffgranskning: endast synkron snapshot/startgräns
och fel vid för tidig fixture-release; inga kundisoleringar, assertions eller produktfiler ändrade.

Samma risk upptäcktes i `waitCalendarCalls` och äldre adminpredikat. Dessa korrigeras i det
påföljande avgränsade uppdraget nedan.

## Samtliga async-predikat i admin-grinden

Ytterligare **sex predikat** korrigerade: två mutationsräknare, två hydrationsräknare,
kalenderns initiala läsning och `waitCalendarCalls`. Moduler importeras före polling; själva
predikatet läser en synkron snapshot och returnerar boolean. Kalenderns initiala läsning
återanvänder den befintliga kalenderhelpern. `calendarControl` är nu synkron och avvisar ett
fixture-svar utan en startad status/connect/disconnect-gate. Produktkod och assertions bevarade.

AST-inventering av hela `admin-state.mjs`: **43 waitForFunction-anrop, noll async-predikat**.
Tillsammans med föregående kundhelperfix har sju async-predikat korrigerats.

Deterministiskt riktat bevis: `node /tmp/knc-ui-2026-09-13/calendar-wait-order.mjs` PASS.
Browserinstrumentering visar att den riktiga `waitCalendarCalls` utvärderar B-count=0 och
förblir pending; efter verklig portväxling/start av B-läsningen släpper den med count=1.
Ingen sleep/retryloop tillagd. Logg `/tmp/knc-ui-2026-09-13/calendar-wait-order.log`.

Slutverifiering efter samtliga sex korrigeringar:
`BASE_URL=http://127.0.0.1:4188 npm run test:e2e:admin` **PASS, exit 0** — 41 Chromiumscenarier,
fem Firefox-privacyfall och fem WebKit-privacyfall. Logg `/tmp/knc-final-admin-sync-e2e.log`.
Scoped ESLint, scriptsyntax, Prettier och diffcheck PASS. Inga kvarvarande async-predikat i grinden.

## PR 60: Firefox-integritetslänk vid återkallelse

Senaste CI-fel: job `103751367029`, head `97c1405`,
`/tmp/knc-pr60-final-db-failure.log`: efter klick på Abouts integritetslänk saknades checkboxen.
SSR-fallbacken innehåller inte länken med detta aria-label; testet hade hittat en Preact-renderad
länk. Varken källkod eller riktad browsertrace visade att en öppnad panel senare nollställdes.
Det ursprungliga CI-klickets eventsekvens finns inte i loggen och har inte återskapats exakt.

En kontrollerad Firefox-repro visar samma felklass: `public_booking_catalog` hålls tills
pointerdown på Aboutlänken; rosterhydrering under en 150 ms fysisk knapptryckning flyttar footern.
Trace: pointerdown på A ”Integritet”, pointerup på DIV, slutligt click på SECTION. Ingen handler
på länken anropas och checkboxen uteblir. Samma katalogfördröjning med fokus + Enter ger click på
rätt A och öppnar panelen. Tryckfördröjningen finns endast i den negativa /tmp-repron, inte i grinden.
Bevis: `/tmp/knc-ui-2026-09-13/firefox-privacy-hydration.mjs` och motsvarande `.json`.

Endast `tools/e2e/smoke.mjs` ändrad: authprovets footer aktiveras med fokus + Enter, enligt samma
verkliga tangentbordsflöde som annan UI-verifiering. Separata About-pointertester bevarade.
Befintliga assertions kontrollerar checkbox → `forget_device` → borttagen receipt-cookie,
nekad receipt-åtkomst och bevarade bokningar. Den senare verifierade kundfasen kontrollerar också
att `forget_device` bevarar full sessionscookie och verifierad historik.

Riktad verklig Firefox-körning av receipt/withdrawal/rotation PASS via lokal Worker → Edge → DB:
`/tmp/knc-customer-firefox-privacy-green.log`. Tre isolerade mountprov PASS; inga belägg för
SSR-/mount- eller consent-statefel. Ingen produktkod, generell retry, sleep eller timeout ändrad.

Slutlig fullkörning (en gång efter fix): `npm run test:e2e -- --customer` **PASS, exit 0**,
Chromium + Firefox + WebKit inklusive withdrawal och bevarad full session.
Logg `/tmp/knc-pr60-customer-final-green.log`. Scoped ESLint, Prettier och diffcheck PASS.

# Launch completion — partner

Bas: `codex/fix-unnoticed-issues`, `6da1b77` efter rootens gröna baseline-signal.
Egen källscope färdig och fryst för rootens PR-grind. Ingen egen commit, deploy, DB-mutation, providersändning eller extra agent.
Root äger release/produktion/backup, kundmodell/Worker/Edge/DB, paket/Actions och CODEBASE-MAP. Partner fick slutligen även App/About enbart för privacy-hunkar; receipt-hook och övriga kundflöden bevarade.

## Lästa underlag

- AGENTS, hela CODEBASE-MAP, README, BACKEND, LAUNCH_READINESS_PLAN.
- Operations: PUBLIC_BOOKING_GATEWAY_ROLLOUT, BACKUP_RESTORE, CUSTOMER_ACCESS_REPAIR_2026-09-10.
- Fem aktuella auditloggar, launch-issues, hela PR58-reviewn och 2026-08-31-feedbacken.
- Berörda källor/tester/harness; Caveman, Ponytail, speculative-tool-calling, Furl, Supabase, Playwright.
- Råkälla styr. Ingen helrepo-review eller produktionsverifiering påstås.

## Reproducerade fel och ändringar

| Fel före fix                        | Faktisk reproduktion                                                                                                                | Implementerad gräns                                                                                                                                                                                                  |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Disabled staff behåller kunddata    | Riktig AdminApp + SDK: focus/visibility gör ingen ny profilread, visad syntetisk kund ligger kvar.                                  | `useAdminSession`: Auth-events, focus/visibility, synlig 30s-poll, 10s kontrollgräns. Bekräftad denial avmonterar privat träd direkt. Nätverksfel behåller vy med status.                                            |
| Logout lämnar privat UI             | SDK-session blir null men kund ligger kvar. UI-logout med hållen nätverksrespons väntar med rensning.                               | Gate låser före signOut; timers/listeners/resultat och navigationsminne spärras/rensas.                                                                                                                              |
| Sen profil återöppnar               | Hållen lyckad profilread släpps efter SIGNED_OUT och återöppnar gammal AdminShell.                                                  | Generationskontroll och abort; olika användare/roller får nytt träd.                                                                                                                                                 |
| A-kö körs som B                     | Riktig SiteView/SDK: A:s företagsnamn skickades med B-JWT, även när både BroadcastChannel- och storage-notiser fördröjdes.          | Kö-epoch och fångad principal per data-client; accessToken returnerar exakt kontrollerad A-token eller nekar. A-closure kan aldrig låna B-token i event-gap.                                                         |
| Sena lösenordssvar återställer Auth | Riktig SDK PUT efter logout återställer A-token i storage; hållen Settings-verifiering ersätter B med A. Båda RED.                  | Separat memory-only Auth-client för password I/O; originalsession till updateUser, kortlivad verifieringssession städas lokalt. Epoch/sessionkontroll mellan steg; sena SDK-svar skriver aldrig global auth-storage. |
| Privacyplacering missförstådd       | Tidigare hero-only initialbanner stred mot användarens förtydligande.                                                               | Initial och återöppnad panel fixed bottom globalt. Endast liten återöppnare hör till hero; About har diskret länk. Uppmätt utrymme håller scroll/klick åtkomliga.                                                    |
| Firefox efter dialog→Avvisa         | Vanlig click på Mina bokningar timeout. Uppmätt scrollTop132, opacity0.599 men pointer-events:none. WebKit samma förlopp passerade. | Synliga heroaktioner förblir klickbara under fade. Helt dold hero får inert. Scroll-anchoring-försök borttaget. Firefox/WebKit fokuserad regression grön.                                                            |
| Mediafel tappas                     | Gallery/profile delete 401 blir network. Tre delete-adapters accepterar syntetisk ok-body trots HTTP-denial. Fem röda regressioner. | Gemensam säker statusklassning; denial prioriteras, domäntexter och logo409/CAS bevaras. Ingen CRUD-abstraktion.                                                                                                     |
| ICS för långa rader                 | 38 Å ger SUMMARY84 UTF-8-byte; sista CRLF saknas. Sex röda regressioner.                                                            | 75-octet folding efter escaping, fortsättningsblank räknas, kodpunkter hela, slut-CRLF. UTC/escaping kvar.                                                                                                           |

## Testevidens och luckor

- Ursprunglig AdminApp-repro kördes före fix med `node /tmp/knc-launch-admin-6da1b77/baseline-reproduction.mjs` på 6da1b77. Fem reproducerade fel finns i `/tmp/knc-launch-admin-6da1b77/baseline-results.json`. Scriptet använder checkoutens källa; omkörning kräver isolerad 6da1b77-checkout och uppdaterad `repo`-sökväg, aldrig återställning av gemensam arbetskatalog.
- Alla browserfixture-anrop interceptas före mount. Syntetiska JWT/personuppgifter och inert ledger. Inga riktiga backend/provider-/produktionsmuteringar.
- Hållbar gate: befintliga `tools/e2e/admin-harness.tsx` + `admin-state.mjs`; faktisk AdminApp/SDK och faktisk App/privacy. Tidigare full gate45/45 grön före sista auth/placeringsändringarna. Slutliga berörda grindar kördes därefter separat enligt nedan; ingen ny full47-körning påstås.
- Körning: `BASE_URL=http://127.0.0.1:4198 npm run test:e2e:admin`. Isolerad Vite-server4198 använder fake Supabase-konfiguration. CI behöver Chromium, Firefox och WebKit samt explicit fake VITE_SUPABASE_URL/ANON_KEY.
- Tidigare bred fokusgate102/102, 9 filer; berörd ESLint och tsc gröna. Efter slutlig authändring: auth/queue23/23 + tsc gröna. Root rapporterade därefter hela unit579/579 och pgTAP989/989; root äger dessa körningar.
- Testfiler: adminAuth, servicesAdmin, adminNavigationState, customerPhoneMemoryRemoval, imageUploadAdapters, deleteAdapters, ics, bookingLinks, calendar.
- Slutlig privacy: **15/15** via `node /tmp/knc-launch-admin-6da1b77/privacy-global-focused.mjs`; samma regressioner i befintlig admin-state-harness. Chromium/Firefox/WebKit ×320×568 SV ljus,390×844 SV mörk,360×800 EN blockerade cookies,1280×720 EN mörk samt390 dialog→Avvisa→Mina bokningar. Initial panel kvar fixed bottom i hero/bokning/About; About öppnar preferences på plats via Enter, fokus återställs, accept/reject och breakpointbyte bevaras. Vanliga klick utan force. Ingen fysisk iPhone-verifiering från partner.
- Extra slutkontroll av hero-återöppnaren och uppdaterade bilder: **2/2**, mobil/dator, `node /tmp/knc-launch-admin-6da1b77/privacy-global-visual.mjs`. Återöppnaren försvinner i bokning och följer aldrig med till About. Bilder `privacy-global-320-sv-{initial,preferences}.png` och `privacy-global-1280-en-{initial,preferences}.png` under samma /tmp-folder granskade. På320px behöver heroaktionerna scrollas fram när den initiala panelen visas; de är fullt klickbara. Ingen ändring av logotypens storlek/coredesign.
- Sista public-smoke hittade saknad mobil tillbakanavigation med **ovalt** samtycke. Partner reproducerade RED (`Back to home` timeout) och rättade endast MobileSite: full hero kan scrollas ovanför panelen; när About nås återkommer befintlig sticky compact-nav/spacer. Collapsegränsen utgår från hero100dvh, inte den reserverade scrollhöjden. **Riktat slutprov PASS**,390×844 EN, faktisk App: `node /tmp/knc-launch-admin-6da1b77/privacy-pending-navigation.mjs`; About→Back→scrollTop0→Mina bokningar med getter fortfarande null, därefter hela preferenceförloppet. Hållbar assertion i admin-state. Tidigare15-matrisen inte omkörd i sin helhet efter denna sista navigationfix; root kör standard public-smoke/build.
- `tests/integration/authSecurity.test.ts` utökat: verkligt inloggad Settings-fixture, oförändrad originaltoken och lyckad refresh efter password update. Root rapporterade **GoTrue-integration PASS**, även faktisk setNewPassword/captured-JWT-logout och login med nya lösenordet. Partner utförde inga DB-mutationer.
- ICS UTF-8/unfold/injection-gränser testade; ingen specifik kalenderklient testad. Produktens fulla bygg-/kund-/releasegrind ägs av root.

## Faktiskt filägarskap och kontrakt

- Admin: AdminApp, useAdminSession, auth, adminClient, ForcedPasswordChange, orderedOperations. Ingen LoginPage- eller navigationState-källändring. `getActiveProfile` är read-only; gate äger cleanup. `captureAdminOperation` återanvänds av Auth-steg och köer.
- Media: galleryAdmin, barberPhotoAdmin, homepageLogoAdmin, nya mediaGateway. Parsing och serverauktoritet stannar i befintliga adapters/Edge.
- Privacy: PrivacyBanner, storageConsent, nya usePrivacyPreferences, DesktopSite, MobileSite, enbart privacy-hunkar i App/About och sv/en. Root äger övriga hunkar; dess receipt-withdrawal-hook bevarad.
- `readStoragePreferences(): StoragePreferences | null` läser aktuellt val inklusive memory-only fallback vid blockerade cookies; null skiljs från functional:false. `saveStoragePreferences` publicerar förändring. Automatisk receipt kräver functional===true. Nödvändig mejllänkscookie fungerar oavsett frivilligt val.
- `usePrivacyPreferences(): PrivacyControls` delas av båda skal. App monterar en global `PrivacyBanner` per aktiv layout; skalen monterar endast `PrivacyManageButton` i hero. About-länken öppnar panelen på plats. Panelens ResizeObserver reserverar faktisk höjd via `--privacy-overlay-space`; mobilen kan scrolla CTA ovanför panelen. Ingen onSaved-prop eller tvingad hemnavigation kvar.
- ICS: `src/booking/ics.ts`; befintligt `tests/unit/ics.test.ts`. Inga dependencies eller fristående repo-testfiler tillagda.
- Arkitekturhunkar skickade till root för CODEBASE-MAP. Bevara ospårade AGENTS, 2026-08-31-feedback och PR58-review.

## Slutlig auth-racegrind

- Riktig tvåsidig SDK-repro höll både native storage-event och BroadcastChannel-notis till A medan B loggade in. Före fix skickades `POST /rest/v1/site_settings`, `business_name: OLD A INTENT`, med B:s syntetiska JWT. Inga riktiga konton/data.
- Data-fasaden binder principal och kö-epoch vid godkänd gate. Varje nätanrop returnerar den sessiontoken som faktiskt kontrollerades; mismatch låser UI och nekar. En extra eventlistener ensam löser inte event-gap.
- Password arbetar i memory-only Auth-client. Lyckad reset bär fångad Session till logout. Explicit A-JWT skickas till logout; jämförd lokal rensning låser samma storage-seam som SDK:s skrivningar. Sen A-logout raderar aldrig B:s session. Utan Web Locks används per-tab sessionStorage; blockerad storage får memoryfallback.
- **7/7** verkliga SDK-browserfall: `node /tmp/knc-launch-admin-6da1b77/auth-final-focused.mjs`. Notification-gap, sen reset/logout efter B-login, långsam logout, revoke med privat dialog, lyckad forced-change, sen password-update och sen Settings-verifiering. Både UI och nätverk/storage verifierades.
- Hållbara fall finns i befintlig `tools/e2e/admin-state.mjs`; root godkände authgränsen efter GoTrue-integration. Ingen kvarvarande partnerblockerare. Root sköter sista format/build/visuella Linuxbilder och release.

## Kund-P0 och receipt-review — avgränsat

- Root verifierade live Set-Cookie-sammanslagning: kundcookie + Supabase __cf_bm gav främmande Domain och browserreject. Partner jämförde immutable 6da1b77; root äger fix/test/deploy. Ingen egen kundkälländring.
- Separat HttpOnly receipt-collection + Web Locks över submit→cookieproof accepterad. Utan Locks: booking/mejl lyckas, ingen receipt. Serverappend under lås; ingen IP/UA-/telefonidentitet.
- 20260910214200 granskad read-only: inga scope-bypass hittade statiskt. Kräver SQL/browserbevis nedan. Parent-email bevarar A vid ny A-session; explicit verifierad aliasmodell är rootarbete. Kandidatbaserad linking granskad: singleton/split, purge-FK, nonce-mismatch utan consume, stabil destination och äldre mejlhistorik. Root inväntar användarsvar om uttrycklig historikmerge efter två mailboxproofs.
- Konkret expiry-fynd: sista-dagen-append behöll serverexpiry men Set-Cookie fick30d. Root accepterade fix: returnera återstående max_age och sätt exakt bounded cookie-livstid. Root testar sista-timmen-fallet och expired-proof.

Källor: [Supabase Auth-events](https://supabase.com/docs/reference/javascript/auth-onauthstatechange),
[Auth updateUser](https://supabase.com/docs/reference/javascript/auth-updateuser),
[setSession](https://supabase.com/docs/reference/javascript/auth-setsession),
[GoTrue password/session-revocation](https://github.com/supabase/auth/blob/master/internal/models/user.go),
[Web Locks](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API),
[RFC5545 §3.1](https://www.rfc-editor.org/rfc/rfc5545.html#section-3.1).

## Oberoende receipt-/identitetsreview

Rootens följduppdrag: statisk adversarial granskning av föreslagen modell. Ingen ny modell finns
implementerad i granskad bas; följande är designgrindar, inte påstådda exploateringar av ny kod.

**Hård gräns:** obekräftad receipt ger bara exakt skapade boknings-ID:n. Verifierad profil ger
historik för profilens verifierade mejladresser. Telefon väljer aldrig behörighet.

### Befintliga seams som måste ändras tillsammans

- `20260824075454_permanent_customer_booking_access.sql:216–242`: scope-funktionen returnerar bara
  telefon/mejl, utan credential-kind, och accepterar alla sessionstabellens giltiga rader.
- `20260910130556_serialize_customer_access_sessions.sql:125–143`: list hämtar namn från senaste
  bokningen och all historik via mejl. Samma gamla scope används av cancel i `20260824075454:277–320`.
  En receipt-rad i samma tabell utan genomgående diskriminator skulle därför omedelbart ge full historik.
- `public-booking-actions/index.ts:314–365`: list/cancel väljer explicit permanent länk före cookie;
  `:374–385` gör dessutom review-phone-gate före DB. Receipt får inte glida genom gammal email-/phone-scope.
- `rpcSchemas.ts:109–115`, `mybookings/domain.ts:36–37`, `supabaseMyBookings.ts:108–116`,
  `App.tsx:105–110`: varje lyckat listresultat blir idag `CustomerProfile` och autofill.
  Ny authority-kind måste bevaras hela vägen; receipt får inte låtsas vara verifierad profil.
- `supabaseBooking.ts:57–90` skickar direkt till Supabase; first-party cookie kräver verklig
  Workertransport. `customerGateway.ts:66–94` tillåter bara befintligt cookienamn och upstream public actions.
- `rpcSchemas.ts:44–50` validerar avsiktligt bara booking-success. Cookieproblem efter lyckad insert
  får inte förvandlas till "bokning misslyckades" med risk för dubbelbokning/retry.
- `ensure_customer_booking_access_token` uppdaterar telefon vid senare bekräftelsemejl; listnamn
  kommer från senaste bokningen. Det är bokningskontakt, inte ny verifierad profilauktoritet.

### Obligatoriska attack-/racetester

| Fall                                                  | Måste bevisas                                                                                                                                                     |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tom browser bokar med A:s befintliga mejl             | Receipt visar endast den nya bokningen. A:s äldre namn, kontaktuppgifter, bokningar, avbokning och recensionsbehörighet exponeras inte.                           |
| A-mejl + B:s kända telefon                            | Befintligt A-mejl vinner association. Ingen historik eller telefonäganderätt flyttas från B. Receipt fortfarande endast ny bokning.                               |
| Nytt mejl + B:s kända telefon utan B-proof            | Ingen automatisk profillänk/import. Även senare proof av enbart nya mejlet är otillräckligt för B:s historik. Bokningskvitto hålls separat från profilkopplingen. |
| Verifierad A-cookie + nytt mejl + B-telefon           | A-proof räcker inte som B-proof. Ingen koppling till B eller flytt av dess telefon.                                                                               |
| Receipt som initiator till mejlanknytning             | Nekas som bevis av befintlig profil, även när receiptens inskrivna mejl matchar den profilen.                                                                     |
| Mail-attachment bekräftas i annan aktuell cookie      | Intent binder initiatorns profile-ID, målmejl, engångsnonce, generation/expiry. Bekräftelse byter aldrig mål till den cookie som råkar vara aktiv vid klicket.    |
| Målmejl hinner kopplas till annan profil              | Atomär unikhets-/CAS-kontroll vid consume; ingen tyst merge eller ompekning. Prova båda låsordningarna.                                                           |
| Receipt innehåller/sänder ett äldre booking-ID        | List/cancel måste kontrollera serverns receipt→booking-mappning. Mejl, telefon, klientens ID-lista och känt boknings-UUID ger inget extra scope.                  |
| Giltig A-cookie överlever blockerad receipt-/B-cookie | Exakt session-proof och authority-kind måste matcha innan UI påstår rätt åtkomst. Ingen gammal profil visas som ny kund.                                          |
| Två samtidiga bokningar från samma browser            | Båda skapade ID:n stannar i receipt-scope utan lost update. Testa båda svarordningarna; inget annat ID importeras.                                                |
| Fördröjt receipt-svar efter verifierad B-inloggning   | Ingen tyst cookie-nedgradering eller UI som blandar verifierad B med A-receipt. Behåll tydlig cookie-/authority-prioritet.                                        |
| Insert lyckas, receipt-mint/cookie/proof misslyckas   | Bekräfta att bokningen finns exakt en gång; UI behåller bokningssuccess och visar separat åtkomstfallback.                                                        |
| Rotation samtidigt med receipt→profile-upgrade        | Gamla email-credentials får inte överleva som full profil via receipt. Varje ny profilcookie binds till giltig proof-generation under lås.                        |
| Nytt kontaktvärde via obekräftad offentlig bokning    | Kan lagras på just bokningen enligt produktbeslut; får inte bli verifierad mejlalias eller en indirekt väg att importera historik.                                |
| Expirerad/replayad anknytningslänk                    | Engångskonsumtion atomär; gammal nonce efter rotation/nytt intent kan inte återanknyta eller flytta en profil.                                                    |

Review-gate behöver explicit authority-matris. Dagens avtal kräver mejlproof för recension;
receipt får inte automatiskt få större recensionsbehörighet bara för att list/cancel stödjer receipt.
Verifierad profil ska kunna recensera äldre avslutat besök efter telefonbyte utan att återinföra
telefon som identitet eller försvaga en-recension-per-bokning.

Aktiv verifierad A-session + bokning för annat, ännu obekräftat mejl är ett viktigt produktfall:
bevara åtskilda capabilities eller byt uttryckligt till receipt. Unionera aldrig historik via det
inskrivna mejlet och gör aldrig annan mejladress verifierad bara för att A-cookie finns.

Nya interna RPC:er: service-role-only, RLS-deny på credential/association-tabeller, hash i DB,
identifier-only outbox och befintlig HMAC/no-store/cookieallowlist. Behåll gamla rootlänkar och
parallell acceptans av äldre säkra klienter enligt rootens deployordning.

Återanvänd `reviews.test.ts`, `39_permanent_customer_booking_access_test.sql` och befintlig riktiga
HTTPS kundbrowser-gate. Observera `pg_blocking_pids` i nya identitetsrace; sekventiella tester räcker
inte för samtidiga anknytningar/uppgraderingar. Partner har inte kört ny DB/browsermuterande suite.

## Kalenderavveckling — live läsning 2026-09-10 22:22 UTC

Projekt `soktgawvexeumqvtyhda`. Endast MCP-metadata och SQL `BEGIN READ ONLY ... ROLLBACK`.
Ingen trigger/cron/dispatcher körd; inga tokenvärden, kundrader eller provider-ID:n visade.

- Deploy: pensionerad `calendar-sync` ACTIVE v22; ersättare `external-cleanup` ACTIVE v10.
  Live executor innehåller WEBHOOK_SECRET, dispatch-token, Calendar-specifik dispatcher,
  identity-scoped cleanup, `calendar_record_event_if_current`, compare-delete och kompensation.
- Retirement-migration `20260901213117` finns. Legacy-trigger/urlreferens över samtliga triggers=0;
  public/supabase_functions-kroppar med legacy-URL=0; legacy-cron=0; väntande legacy pg_net-request=0.
- `booking_calendar_sync_on_change` och båda cleanup-triggers enabled. Samtliga fem nödvändiga
  queue/dispatch-RPC:er finns. Aktiv external-action-dispatch varje minut;1440/1440 succeeded senaste24h.
- Outbox helt tom. Nylig pg_net-respons: calendar_event_sync completed HTTP200 kl21:39 UTC;
  token-tabellens senaste lyckade sync21:39:01. Inget fullständigt provider/E2E-bevis påstås.
- En Calendaranslutning: inga fel, saknade credentials/Calendar-ID/mejl eller väntande disconnect.
- Fyra mappar, varav en framtida. Orphan/token-/Calendar-/barber-mismatch=0. Framtida anslutna bokningar utan map=0.
- Vaultnamn finns; external_cleanup_url matchar korrekt projekt/endpoint. Ny digestparitetskontroll
  inte körd här; root äger secret-verifiering. Den lyckade dispatchen bevisar fungerande väg vid21:39.

**Kvar före deploy-deletion:** roots verkliga Google create/update/cancel-kontroll och färsk
sista-invocation-logg för gamla Edge-endpointen. Inget get_logs/analytics-tool exponerat;
pg_net täcker inte alla möjliga externa anrop. Ta därefter bort endast pensionerad deploy,
lista funktioner igen och kontrollera outbox/nya dispatcherloggar. Ingen deletion utförd av partner.

Källfolder, configsektion och nuvarande deploylistor saknar redan gamla funktionen.
`CODEBASE-MAP.md:937` är konkret drift: säger fortfarande att insert/update kräver extern webhook.
Root behöver rätta raden, stärka befintligt calendarDocumentationContract mot den formuleringen och
uppdatera operationsstatus efter verifierad borttagning. Historiska migrations-/rolloutreferenser behålls.

**Direkt påträffad grantevidens:** anon + authenticated har SELECT/INSERT/UPDATE/DELETE på
barber_calendar_tokens och calendar_event_map; TRUNCATE=false. RLS=true, policies=0. Verkligt
`SET LOCAL ROLE anon` läser0 tokenrader och0 mappar. Inga oväntade browser-callable Calendar-RPC:er.
Ingen påvisad exponering; onödiga grants bör återkallas via migration med service/RPC-kontrakt intakt.
Inga dubbla policies på berörda tabeller; ingen separat bred policysweep genomförd.

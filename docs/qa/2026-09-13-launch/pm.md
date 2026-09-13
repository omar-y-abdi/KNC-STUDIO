# Launch — 13 september

Bas `adfc26e` (PR59, mergad av ägaren). Branch `codex/fix-unnoticed-issues`.
Ägarens CI-fixar bevaras. Senaste läget nedan; detaljbevis i agentloggarna.

## Plan / ansvar

1. Projektindex, driftinstruktioner och tidigare fynd lästa före ändringar.
2. Två GPT-6 High kodar ett avgränsat uppdrag var. Två Luna Max gör separata Chrome-prov.
3. PM granskar, ordnar drift/release. Tre agentslots utöver PM; arbete i vågor.
4. Oberoende CLI-kontroller parallellt; stora loggar i `/tmp`, korta resultat här.
5. En agent skriver lokala DB-fixturer åt gången. Tidigare värden återställs exakt.
6. Riktad verifiering → gemensam slutkontroll → commit → ny PR → CI för rätt SHA.

Nya testfiler i `/tmp`; befintliga sviter utökas för bestående CI-bevakning.
Ingen ny bred audit startas efter slutkontrollen.

## Kodområden

- Hero-botten, global cookiebanner, hero-begränsad återöppning, kontrast och minskad rörelse.
- Kalenderstatus uppdateras efter serverns bakgrundsarbete; gamla svar får inte skriva över ny status.
- Kundprofil kräver båda mejladressers ägarbevis. Telefon ensam ger aldrig historikåtkomst.
- Kunddialoger skyddas vid kundbyte, avbokning och mejlkoppling. Långa mejl bryts även vid 320 px.
- 404, sidunika metadata, läsbar källtext, villkor/integritet, schema och interna länkar.
- CMS för juridiskt namn/organisationsnummer. Klienten fyller slutliga verksamhetsuppgifter själv.
- Galleri: ärliga tom-/fel-/laddningslägen och användbara alt-texter.
- Privata DB-grants, hållbara mejl-/kalenderjobb, beroenden och genererade lintfiler.
- Ponytail: oanvända testhjälpare, scheman och exports borttagna; inga nya beroenden.

## Produktion — bekräftat

- Main-CI `34607194260`: success på `adfc26e`.
- Ny consented testbokning syntes direkt via bokningsbegränsat enhetskvitto.
- Riktig bekräftelse kom till godkänd Gmail. Mejlets Mina bokningar fungerade i Chrome.
- Google Kalender visade alla fyra bokningar efter återanslutning och hållbara återförsök.
- Egen testbokning `4bb6beab-bb60-4ae5-b529-c1eb1db1d673` avbokad via kundvyn.
  Servern visar cancelled, egen mapping borta, tre mappings kvar. Gmail-avbokningsmejl och tre återstående Google-händelser visuellt bekräftade. Legacy-triggers/cron: noll; oanvända Edge-funktionen `calendar-sync` borttagen.
- `public-booking-actions` v14, `external-cleanup` v14, `send-confirmation` v53 och samtliga fyra launchmigrationer live.
  Alla tre pg_net-dispatchers har 30 s budget. Lokal abort/lifetime-gate grön.
- Cloudflare-mätning begränsad till `/`, `/privacy`, `/terms`; EU-exkludering bevarad.
  Inga privata kund-/adminsidor. Branchens policy/CSP följer avgränsningen.

## Backup — löst

- Ägaren godkände nytt DB-lösenord. Officiella Management API uppdaterade det.
- `SUPABASE_DB_URL` satt säkert via stdin i GitHub. DB-inloggning verifierad med officiell CA
  och värdnamnskontroll. Inga hemligheter i loggar, chatt eller git.
- [Backup 34764434644](https://github.com/omar-y-abdi/KNC-STUDIO/actions/runs/34764434644): success.
  Krypterad artifact, SHA256, dekryptering och innehållsinventering kontrollerade.
- Daglig cron 02:17 UTC konfigurerad. Denna körning var manuell; nästa schemakörning har inte hänt än.
- Krypterad anslutningskopia: `~/.config/bladeblend-backup/db-connection-2026-09-13.env.age`.
  Temporära plaintextuppgifter/dekrypterad backup raderade. Befintlig privat age-nyckel bevarad.
- Tidigare återställningsprov från PR59 är separat bevis; nya backupen har inte återställts igen.

## Testbevis

- Kundprofil-DB: kontaktkonflikter, dubbelbevis, hela grupper, list/cancel/review,
  replay/rotation/expiry, samtidiga skrivningar, revocation och krypterad outbox gröna.
- Integration 49/49 gröna. Första försöket saknade lokal Edge-container; samma suite grön efter start.
- Alla 12 Edge-entrypoints: Deno frozen check grön.
- Fullt kundflöde Chromium/Firefox/WebKit grönt även med 72 h avbokningsgräns.
  Testdatum rättat; produktregeln bevarad. Lokal policy återställd till 24 h.
- Kalender: 40 unit samt faktiska hook-/komponentfall gröna.
- Hero/cookies/tangentbord/kontrast: 26 browserfall och 32 unit gröna.
- CMS: 58 riktade unit, 15 DB-assertions, Chrome desktop/mobil och riktiga Worker-svar gröna.
- Galleri: 22 unit gröna. Ponytail: 35 + 47 riktade unit gröna.
- Stale testkontrakt rättade utan sänkta gränser: 18 unit + 13 site-content DB-assertions gröna.
- Långa mejl: RED 339/438 → GREEN 339/339; åtta bredd/språkfall och sju kundfall gröna.

## Slutkontroll

- Gemensamt: 614 unit, 991 DB-assertions, lint, typecheck/build och deploy dry-run gröna.
- Publik browsergate grön. Galleri-tester använder egna bildfixturer, ingen ändrad tomgalleri-UI.
- Linux-bildjämförelse lokal: åtta gröna. Första CI-körningen stoppade enbart fyra desktopbilder.
  Luna granskade samtliga par: endast godkänd hero-textkontrast och hero-botten skiljer.
  Fyra desktopreferenser uppdaterade; mobilbilder och 0,1-procentsgräns oförändrade.
  Samma CI-körning klarade alla funktionella browserfall, DB, integration och Edge.
- Luna: 320/390/1440 px kundruta och galleri loading/empty/error/ready visuellt godkända.
- Full adminsvit hittade fel i testets synkronisering: Promise räknades som sant före startad request.
  Produktens kundisolering intakt; sju async-predikat korrigerade. Alla 43 polling-anrop inventerade. Riktat väntordningsprov samt full adminsvit gröna: 41 Chromium + 5 Firefox + 5 WebKit.
- Backend/migrationsrelease klar. Ny frontend väntar på PR/merge/deploy.
- Backend och verktygsändringar committade. Samlade frontendfixar och loggar avslutar branchen.
  GitHub-checks är källa för PR:s slutliga CI-status; frontend blir live efter merge/deploy.

Fysisk iPhone Safari inte omprovad. Lokal WebKit och riktig Chrome/Gmail ger avgränsade bevis.
Tidigare Firefox-overlay intermittent; fulla kundflödet passerade utan UI-ändring.
Inga frågor om salongs-/juridikdata till utvecklaren; klientens CMS är rätt plats.

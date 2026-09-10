# Luna Max — hygien- och Ponytail-audit

Datum: 2026-09-10

Branch: `codex/fix-unnoticed-issues`

Ägare: Luna Max (hygien/docs)

## Omfattning

Läste `AGENTS.md`, `README.md`, `CODEBASE-MAP.md`, `BACKEND.md`,
`LAUNCH_READINESS_PLAN.md`, handoff, driftplaner, backup-plan, notification-planer,
tidigare QA, användarens feedbackfil, `pm.md`, `sol-admin.md` och `sol-platform.md`.
Sökte hela repo efter gamla paths, oanvänd kod, testtäckning, scripts, CI, env-filer,
docs-drift och beroenden.

## Testbevis

- `npm audit --omit=dev --json`: **PASS, 0 runtime-fynd**. Bevis:
  `/tmp/knc-audit-2026-09-10/luna-hygiene-runtime-audit.json`.
- Full `npm audit --json`: **12 dev/verktygsfynd** (8 high, 4 moderate, 0 critical).
  Samma fynd finns i Sol-plattformens rapport. Ingen dubbel fix här.
  Bevis: `/tmp/knc-audit-2026-09-10/luna-hygiene-full-audit.json`.
- Coverage med de två kända, ännu ej anpassade same-origin-testerna exkluderade:
  **78 filer, 490 tester PASS**. Total coverage: lines 25.43 %, statements 24.26 %,
  functions 21.82 %, branches 19.62 %. Bevis:
  `/tmp/knc-audit-2026-09-10/luna-hygiene/coverage.log` och
  `/tmp/knc-audit-2026-09-10/luna-hygiene/coverage/coverage-summary.json`.
- Full `npm run test:coverage` är **501/503 PASS** tills parent-agentens två
  `credentials`/`/api/customer-bookings`-tester anpassas. Detta är känt same-origin-arbete,
  inte nytt kundlänkfynd.
- `npx prettier --check CODEBASE-MAP.md README.md BACKEND.md LAUNCH_READINESS_PLAN.md`:
  **PASS**. `git diff --check`: **PASS**.
- Ingen produktion, live-DB eller produktionsdata ändrad av denna agent.

## Fynd

### HYG-01 — Testgrind mäter inte täckning

- **Prioritet:** P1 före launch.
- **Repro:** `.github/workflows/ci.yml:27-33` kör runtime audit, lint, typecheck,
  `npm test`, build och dry-run, men aldrig `npm run test:coverage` och har ingen threshold.
  Lokal täckning är bara 25.43 % lines och 19.62 % branches.
- **Påverkan:** CI kan bli grön även när stora UI-, admin- och integrationsvägar saknar
  test. Kundlänkfix kan därför passera unit-test men falla i browser/Worker/Edge.
- **Fix:** Lägg coverage som separat synlig CI-gate efter att mätområdet är uppdelat i
  meningsfulla domäner. Börja med Worker, customer gateway, Edge contract och booking
  browser-flöde. Sätt threshold efter baslinje, aldrig genom att sänka assertioner.
- **Status:** Öppen. Ägare: PM/CI.

### HYG-02 — Gammal slot-generator ligger kvar som död produktkod

- **Prioritet:** P2.
- **Repro:** `src/booking/slots.ts` används bara av `tests/unit/slots.test.ts`.
  Produktionskod använder `src/booking/slotPacking.ts`; repo-sökning hittar inga andra
  imports.
- **Påverkan:** Två slot-modeller ser aktiva ut. Agent/utvecklare kan ändra fel modell.
- **Fix:** Efter extern-consumer-check: ta bort `src/booking/slots.ts` och dess enda
  test, eller arkivera uttryckligt som historik. Behåll `slotPacking.ts`.
- **Status:** Öppen; feedback behövs om extern användning finns.

### HYG-03 — Oanvänd visual-collage och gammal visual-harness

- **Prioritet:** P2.
- **Repro:** `tools/visual/collage.mjs` har inga callers i package scripts, CI, docs eller
  andra scripts. Repoets faktiska harness är `capture.mjs` + `compare.mjs`.
- **Påverkan:** One-off-kod skapar falsk releaseväg och mer underhåll.
- **Fix:** Ta bort eller lägg i historik efter ägarbekräftelse. Uppdatera ev. docs om någon
  extern manuell körning finns.
- **Status:** Öppen; feedback behövs om collage används manuellt.

### HYG-04 — Consent-helper har död funktion och no-op

- **Prioritet:** P2.
- **Repro:** `src/site/storageConsent.ts:57` (`functionalStorageAllowed`) har inga callers.
  `clearFunctionalStorage` på rad 61 gör inget och anropas bara i
  `src/site/PrivacyBanner.tsx:30`.
- **Påverkan:** Kod säger att optional storage rensas fast ingen sådan data finns. Det gör
  privacy-flödet svårare att förstå och kan lura framtida ändringar.
- **Fix:** Förenkla till faktisk preference-cookie: ta bort oanvänd helper och no-op-anrop,
  behåll synlig consent-kontroll och nödvändig HttpOnly kundsession.
- **Status:** Öppen; liten produktändring men behöver owner-godkännande för consent-copy.

### HYG-05 — `.env` är tracked

- **Prioritet:** P2 security-hygien.
- **Repro:** `git ls-files .env` returnerar `.env`. `.gitignore` ignorerar `*.local` men
  inte `.env`. Filen innehåller nu bara `VITE_*` publika värden; inga privata secrets
  hittades i filen eller historikkontrollen.
- **Påverkan:** Nästa utvecklare kan lägga secret i tracked fil och skicka den till Git.
  Nuvarande test `tests/unit/documentationContracts.test.ts` läser dessutom filen direkt.
- **Fix:** Lägg `.env` i ignore, behåll `.env.example`, flytta test till example eller
  explicit test-fixture. Kontrollera historik före ändring; radera inte docs/history.
- **Status:** Öppen. Ägare: PM/security.

### HYG-06 — Notification-planer beskriver gammal verklighet som aktuell

- **Prioritet:** P1 docs-risk.
- **Repro:** `docs/booking-notifications/EMAIL-CONFIRMATION-PLAN.md` säger att bokningar
  alltid är `method='sms'`, email är dormant och att `send-customer-email` ska byggas.
  Nuvarande branch har email-länk/outbox i `customer_access_email_send`,
  `src/mybookings/customerGateway.ts`, Edge public actions och migration
  `20260910130556_serialize_customer_access_sessions.sql`.
- **Påverkan:** Nästa agent kan återinföra phone-only-flöde eller bygga dubbla tabeller.
  Det hotar akut Mina bokningar-fixen.
- **Fix:** Lägg tydlig historik-banner med datum och länk till dagens gateway/session- och
  rollout-dokument. Bevara hela planen.
- **Status:** Öppen; docs-ägare.

### HYG-07 — SMS-plan är märkt “ready to build” fast ingen implementation finns

- **Prioritet:** P2 docs-risk.
- **Repro:** `docs/booking-notifications/SIM-SMS-GATEWAY-PLAN.md:3` säger
  “Implementation spec, ready to build”. Repoet saknar `sms_outbox`,
  `dispatch-booking-sms` och motsvarande runtime-path.
- **Påverkan:** Planen ser ut som launch-scope och kan få någon att bygga en separat
  kontaktkanal mitt i email/session-fixen.
- **Fix:** Märk dokumentet “framtida förslag, ej launch-path”, med datum och produktbeslut.
  Ta inte bort innehåll.
- **Status:** Öppen; feedback om SMS fortfarande är önskad produkt.

### HYG-08 — Äldre performance/QA-dokument saknar historikvarning

- **Prioritet:** P2 docs-risk.
- **Repro:** `PERFORMANCE_AUDIT.md` börjar med branch `perf/launch-readiness-2026-08-28`
  och baseline `main@f184f10f...` utan “historisk” banner. `docs/qa/2026-08-27-production-real-life-test.md`
  beskriver en äldre baseline och säger PUB-09 `/.well-known/acp.json` PASS/200.
  Aktuella discovery-tester/map säger frånvaro och noindex 404.
- **Påverkan:** Läsaren kan blanda gamla production claims med dagens branch och tro att
  ACP-manifest fortfarande ska finnas.
- **Fix:** Lägg kort banner: historiskt snapshot, datum/baseline, current status i
  `docs/qa/2026-09-10-audit/`. Bevara rapporterna.
- **Status:** Öppen; docs-ägare.

### HYG-09 — Tre feedbackrader har två val samtidigt

- **Prioritet:** P1 process-risk före feedbackstyrda ändringar.
- **Repro:** `docs/qa/2026-08-31-github-issues-review.md` markerar två inkompatibla val:
  rad 284 (#33) “Provide facts and approve drafting” + “Need legal advice/evidence”,
  rad 394 (#38) “Approve with changes” + “Need more evidence”, och rad 416 (#39) samma
  dubbelval.
- **Påverkan:** Agent kan börja en PR utan att veta om beslutet är godkänt, villkorat eller
  blockerat. #33 rör privacy-text; #38 password recovery; #39 död adapter/header-kod.
- **Fix:** Owner väljer exakt ett beslut per fråga och skriver villkor i Notes. Ändra inte
  användarens feedbackfil automatiskt.
- **Status:** Blockerar respektive feedbackstyrd PR; user feedback behövs.

### HYG-10 — Dev-beroenden har kända säkerhetsfynd

- **Prioritet:** P1 release-hygien, men samma fynd är redan rapporterade av Sol-plattform.
- **Repro:** Full audit visar 8 high + 4 moderate; runtime-only visar 0. Fynden ligger i
  test/buildkedjan, inte produktens runtime-lista.
- **Påverkan:** CI/developer tooling kan utsättas för kända advisories; high-fynd får inte
  tystas.
- **Fix:** Sol-plattform äger versionsplan och compatibility-check. Kör inte blind
  `npm audit fix`; Wrangler/workerd-kompatibilitet måste verifieras först.
- **Status:** Duplicerat, ingen ändring från denna agent.

## Gjort på branch

- Uppdaterat `CODEBASE-MAP.md`: gamla current calendar/phone-memory/slots paths bort som
  current; retired history kvar; customer gateway, HMAC och first-party HttpOnly session
  dokumenterade; ACP absent-by-design dokumenterad.
- Uppdaterat `README.md`, `BACKEND.md`, `LAUNCH_READINESS_PLAN.md` med verifierad current
  gateway/session/secret/backup-status. Gamla historiska claims markerades där de ägs av
  dessa docs.
- Prettier och whitespace-check passerar för dessa fyra docs.

## Feedback behövs

- Finns extern användning av `src/booking/slots.ts` eller `tools/visual/collage.mjs`?
- Godkänn deletion/simplification av dead code efter svaret.
- Är SMS-planen framtida arbete eller ska den stoppas före launch?
- Välj ett beslut i feedbackfilens tre dubbelmarkerade rader.
- Sätt coverage-mål och ansvarig CI-ägare efter parent-agentens same-origin-testfix.

## Gaps

Ingen browser-session, live Worker/Edge smoke, live Supabase migration/RLS-verifiering eller
production deploy testades här. Detta kräver PM/plattformsagentens credentials och separata
staging/prod-gates.

## PM disposition after consolidated review

- HYG-02/HYG-04: fixed locally by PM; production DB slot authority and visible consent UI preserved. New approval was unnecessary under the explicit dead-code cleanup request.
- HYG-01: low unit coverage alone is not a launch blocker; browser/integration coverage is separate. Prioritize executable customer-chain regressions in CI, then choose meaningful coverage boundaries.
- HYG-03: no automated callers does not prove a manual tool is dead. No deletion; optional tool documentation only.
- HYG-05: optional env hygiene, no discovered current secret exposure.
- HYG-06/HYG-07: ignored user-owned future/old plans preserved; current architecture/runbook remains authoritative. “Ready to build” is a specification claim, not evidence of a live SMS system. Product scope requires user choice.
- HYG-08: tracked performance/production reports now marked historical.
- HYG-09: read user Notes and session authorization before deciding. Mixed checkboxes alone are not a new implementation blocker; feedback file remains untouched.
- HYG-10: consolidated dev-tool upgrade issue. Current results and final gates are in pm.md; earlier figures above are historical audit observations.

# Launch audit — Drift

Datum: 2026-09-10. Branch: `codex/fix-unnoticed-issues`.

## Omfattning

- Bokningsregler: pris/längd, tillgänglighet, samtidighet, Stockholm/DST.
- Effektiv DB: senaste migration vinner, RLS/grants, RPC, Cron/Vault/Edge-kontrakt.
- Hållbar leverans: bokningsmejl, påminnelser, Calendar, cleanup-outbox.
- CI, backup/restore, Cloudflare Worker/config/cache/metadata.
- Mina bokningar-token/session: PM äger huvudfix. Jag gjorde oberoende hostile review + avgränsad
  session-proof-fix efter PM-godkännande.

## Bas

- PASS: rätt gren.
- PASS: `88ab39a`, samma som `origin/main`, efter merge av PR #57.
- Bevarat: användarägda ospårade `AGENTS.md` och `docs/qa/2026-08-31-github-issues-review.md`.

## Lästa docs

- PASS: `AGENTS.md`, `README.md`, `CODEBASE-MAP.md`, `BACKEND.md`, `LAUNCH_READINESS_PLAN.md`.
- PASS: `docs/operations/PUBLIC_BOOKING_GATEWAY_ROLLOUT.md`, `docs/operations/BACKUP_RESTORE.md`.
- PASS: hela `docs/qa/2026-08-31-github-issues-review.md`; användarbeslut styr.
- PASS: `docs/qa/2026-09-10-audit/pm.md`.
- PASS: inventerat alla filer under `docs/`; läst båda notifieringsplanerna och
  `docs/qa/2026-08-27-production-real-life-test.md` som historik.
- PASS: README nära `send-confirmation`, `submit-booking`, Calendar och backup.

## Produktionsgräns

- Prod: endast läsning.
- Inga bokningar, utskick, dataradering, migrationer, deployer eller configändringar.
- Lokal DB-mutation körs bara av PM.

## Fynd

### P0 — ingen fungerande produktionsbackup

- Repro: GitHub Actions `database-backup.yml`, 10 senaste schemakörningar 2026-09-01–10 = FAIL.
- Senast: run `34449508611`, steg `Validate backup configuration`:
  `Missing SUPABASE_DB_URL secret`.
- Effekt: ingen verifierad krypterad DB+Storage-återställningspunkt.
- Status: ÖPPEN. Användaren vill lägga hemligheten när sajten är produktionsklar. Måste passera manuell
  backup + restore-tree-kontroll före launch.

### P0 — Worker saknar publik Supabase-binding

- Live Worker settings: bindings = `ASSETS`, `SUPABASE_URL`. `SUPABASE_ANON_KEY` saknas.
- Repro 2026-09-10: `/` -> `Cache-Control: no-store`, `cf-cache-status: BYPASS`;
  `/llms.txt` -> statisk asset, `max-age=0`.
- Effekt: CMS-styrd SEO/JSON-LD/llms laddas inte. Homepage-cache stängs av vid varje request.
- Fix: sätt Worker secret `SUPABASE_ANON_KEY`, deploya aktuell Worker, bevisa dynamisk metadata och HIT.
- Status: ÖPPEN. Prodmutation kräver action-time körning.

### P0 — same-origin kundproxy tappar klient-IP utan autentiserad forwarding

- Lokal PM-diff: Worker -> Supabase är cross-zone subrequest. Cloudflare ersätter
  `CF-Connecting-IP` med `2a06:98c0:3600::103`.
- Effekt före fix: alla kunder delar IP-rate-limit: 8 länkbegäranden/10 min, 5 recensioner/dygn.
- Officiell evidens: `developers.cloudflare.com/fundamentals/reference/http-headers/`,
  “CF-Connecting-IP in Worker subrequests”.
- Status: FIXAD LOKALT AV PM. Delad HMAC signerar origin+tid+IP+body. Prod kräver gemensam
  `CUSTOMER_GATEWAY_SECRET`, Worker anon key, Edge deploy och Worker deploy.

### P0 — ny kundlänk kunde godkänna gammal kundcookie

- Repro: giltig cookie A + länk B + browser avvisar ny `Set-Cookie`. Före fix kontrollerade adaptern bara
  `ok`; legacy exchange kunde visa A. Direkt länk visade B men senare avbokning använde A och misslyckades.
- Fixad lokalt: Edge returnerar domänseparerad `session_proof` för exakt skapad session. Cookie-only proof
  måste matcha. Proof är varken rå cookie eller DB-tokenhash.
- Bevis: `/tmp/knc-audit-2026-09-10/sol-platform/session-proof/sessionProof.test.ts` 4/4 PASS;
  `edgeSessionProof.test.cjs` 1/1 PASS.
- Status: FIXAD LOKALT. Produktion oförändrad.

### P0 — ciphertext-repair kunde skriva över ny kundlänk

- Repro före fix: email worker läste generation N; fresh-link roterade till N+1; gammal unconditional repair
  ersatte vinnaren och raderade dess challenge/session.
- Fixad lokalt av PM: generation-CAS; missad CAS laddar vinnaren; gamla 4-arg callers fail closed.
- Hostile review: UPDATE revaliderar generation efter radlås. Samma låsordning som rotation. Null/ogiltig
  generation nekas. Vinnarens token skrivs aldrig över.
- Bevis: sender harness 5/5 PASS. PM local DB 5/5 PASS inklusive stale repair, giltig repair, revocation,
  två rotationsrace och real Edge/DB.
- Status: FIXAD LOKALT. Produktion oförändrad.

### P1 — pensionerad Calendar-function lever fortfarande

- Repo: källa/config för `calendar-sync` borttagen; migration
  `20260901213117_retire_legacy_calendar_sync.sql` tar bort gamla DB-triggern.
- Prod: Edge Function `calendar-sync` fortfarande ACTIVE v21, `verify_jwt=false`.
- Durable trigger, Cron och `external-cleanup` finns. Prod: 3 mappingar, 0 orphan, 0 köade externa jobb.
- Effekt: onödig hemlighetsskyddad endpoint + driftförvirring. Ingen bevisad aktiv caller.
- Fix: verifiera senaste function logs/callers; undeploya. Rotera delad webhook-hemlighet i planerat fönster.
- Status: ÖPPEN, action-time prodändring.

### P1 — `admin_create_booking` kan anropas av anon

- Prod ACL: `anon=X/postgres`; `has_function_privilege(...)=true`.
- Orsak: numeric-migration skapade ny signatur. Supabase default ACL gav anon EXECUTE; migration revokerar
  bara rollen `public` och grantar `authenticated`.
- Intern kontroll returnerar `forbidden` utan staff-identitet. Ingen anonym bokning bevisad.
- Effekt: onödig SECURITY DEFINER-yta; Security Advisor WARN; framtida auth-regression blir farligare.
- Fix: forward migration `REVOKE EXECUTE ... FROM PUBLIC, anon, service_role`; grant endast
  `authenticated`; pgTAP med effektiv anon-ACL + förbjudet anrop.
- Status: ÖPPEN. Ingen källäganderätt tilldelad.

### P1 — driftmanual motsade pensionerad Calendar-väg

- Före: runbook sa både delete och deploy/verify `calendar-sync`; fel triggernamn.
- Fixad: historikbanner, borttagen från deploylista, korrekt
  `booking_calendar_sync_on_change`, explicit absent-check.
- Verifiering: 12/12 dokumentkontrakt PASS; Prettier PASS; diff-check PASS.
- Rest: `CODEBASE-MAP.md` har gamla webhook/function-uppgifter. Hygienagent äger filen.

### P1 — devtool-kedja har kända sårbarheter

- `npm audit --omit=dev --audit-level=high`: PASS, 0 runtimefynd.
- Full audit: 12 fynd = 8 high, 4 moderate. Bland annat Vitest 4.1.9 path traversal/arbitrary file read;
  fix 4.1.11. Wrangler-transitiv `sharp`, samt `js-yaml`, `postcss`, `browserslist`, `nanoid`.
- Effekt: ingen bevisad browser-runtime-väg. CI/dev bearbetar repo/testinput och ska ändå patchas.
- Fix: separata/små dependency-uppgraderingar; changelog + lockdiff + full CI per grupp.

### P2 — RLS-policyer kostar onödigt dubbelarbete

- Supabase Performance Advisor: 15 `multiple_permissive_policies` över schedules, time-off, blocks,
  barbers, bookings, profiles och services.
- Effekt: varje fråga evaluerar flera owner/own-policyer. Liten nuvarande datamängd; ingen mätt slowness.
- Fix: slå ihop logiskt likvärdiga policyer per tabell. Bevisa samma owner/barber/anon-matris i pgTAP.

### P2 — ICS följer inte radvikning från RFC 5545

- `src/booking/ics.ts:62-81`: kommentar säger att folding utelämnas. CMS/service/barber-text kan göra
  SUMMARY/LOCATION/DESCRIPTION längre än 75 UTF-8-octets.
- Effekt: vissa Calendar-klienter kan tolka lång export fel.
- Fix: vik innehållsrader vid 75 octets utan att dela UTF-8, fortsättningsrad `CRLF + SPACE`; avsluta fil
  med CRLF. Testa svenska multibyte-tecken och roundtrip.

## Tester

- PASS: `npm test -- --run`: 80 filer, 503 tester.
- PASS: `npm run lint`.
- PASS: `npm run typecheck`.
- PASS: current kundpatch anpassad unit 499/499; nya stale-cookie tester 4/4.
- PASS: Edge kundruntime 7/7; session-proof Edge harness 1/1; sender repair harness 5/5.
- PASS: `npx deno check` för `public-booking-actions` och `send-confirmation`.
- PASS via PM: local DB kundrace/real Edge 5/5; pgTAP 56 filer, 949 tester; integration 43/43.
- PASS: isolerad ren `88ab39a` `npm run deploy:dry-run`; 91 assets, Worker bundle godkänd.
- PASS: ren `88ab39a` runtime dependency audit: 0.
- PASS: GitHub CI run `34203372655` på exakt `88ab39a`; tre jobs gröna.
- PASS: branch protection kräver PR + tre CI-contexts; strict, admins enforced, force-push/delete av.
- PASS: prod matchade pre-audit-baseline genom `20260905154608`; två nya kundfixmigrationer är lokala,
  granskade och ej deployade.
- PASS: alla `public`-tabeller har RLS; `btree_gist` finns i `extensions`.
- PASS: email/Calendar prod read-only: tre Vault-namn finns; 7 Cron-jobb aktiva; email-ledger endast
  terminal `delivered`; 0 aktivt försenade reminders; 0 externa jobs; 0 Calendar-orphans.
- PASS: live apex 200, www 308 med query bevarad, privacy 200, okänd route 404+noindex.
- FAIL: global formatcheck pga användarägda ospårade `AGENTS.md` + auditloggar. Spårad fixfil PASS separat.
- PASS: Deno finns via `npx deno`; båda ändrade kundfunktioner typecheckade.
- NOT RUN: riktiga mejl, bokningar, Calendar-writes, backup/restore, deploy/config. Prod read-only.

## Ponytail

- `delete:` undeploya pensionerad `calendar-sync`. Ersättning: ingen; durable trigger + dispatcher finns.
- `shrink:` slå ihop överlappande RLS-policyer först efter behörighetsmatris-test.
- Inget stöd för att riva durable outbox. Komplexiteten tjänar retry, idempotens och cleanup.
- net: produktion -1 Edge Function möjlig. DB-policyantal kan minska; LOC ej säkert uppskattat.

## Kundfix — reviewslutsats

- Lokal blocker kvar: NEJ efter CAS + session-proof.
- Radlås: permanent-only mint, rotation och legacy exchange serialiserar revocation korrekt.
- Session kan inte förlänga egen expiry.
- Proxy: exact same-origin POST, JSON 16 KiB, cookie allowlist, signerad IP/origin/tid/body, redirect reject,
  `no-store`, HttpOnly Secure host-only Lax.
- Legacy: rå permanent token och rå aktiv sessions-token fungerar för review. Äldre challenge exchange bevarad.
- Deploy blocker: fungerande backup först. Sedan samma gateway secret i Edge+Worker, Worker anon key, två
  migrationer, Edge-funktioner, Worker/frontend, live tre-browserbevis.
- Produktionsstatus: EJ DEPLOYAD. Inga prodändringar gjorda.

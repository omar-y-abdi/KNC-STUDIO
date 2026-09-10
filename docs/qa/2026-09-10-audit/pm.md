# Launch audit — PM

Datum: 2026-09-10. Branch: codex/fix-unnoticed-issues.

## Mål

- Akut: fungerande Mina bokningar från bekräftelsemejl och ny länk. Bevara permanent e-postbunden token, rotation, avbokning och identitetsgränser.
- Granska hela repo, DB, drift, mobil/webb. Verifierbara fel prioriteras; designbeslut väntar på feedback.
- Slutrapport: enbart samlade problem, fixstatus, korta feedbackfält.

## Arbetsdelning

| Ägare  | Modell   | Ansvar                                                    | Logg            |
| ------ | -------- | --------------------------------------------------------- | --------------- |
| PM     | GPT-6    | Kundåtkomst, kritiska fel, DB/integration, slutgranskning | pm.md           |
| UI     | Luna Max | Publik mobil/webb, tillgänglighet, i18n, gränsfall        | luna-ui.md      |
| Hygien | Luna Max | Docs, död kod, beroenden, förenkling                      | luna-hygiene.md |
| Admin  | Sol High | Admin/CMS/auth/media, integrationer vid dessa gränser     | sol-admin.md    |
| Drift  | Sol High | Bokningsregler, outbox/Calendar, CI/backup, DB-granskning | sol-platform.md |

## Regler

- Högst tre underagenter samtidigt. Fjärde startar när plats ledig.
- Varje agent läser AGENTS och samtliga orienteringsdocs, relevanta historikdocs och tidigare feedback. Exakt läs-/testtäckning i egen logg.
- Ingen agent ändrar andra agenters logg eller källkod innan PM tilldelat specifika filer.
- Nya tester/harness/loggar under /tmp/knc-audit-2026-09-10/<ägare>. Befintliga tester får köras. DB-muterande lokala sviter samordnas av PM.
- Prod initialt läsning. Inga riktiga utskick, testdataskapande/radering eller driftmutationer utan specifikt godkännande.
- Bekräftade akutfel rättas direkt lokalt; produkt-/designval dokumenteras för feedback.
- Inga fullständighetsanspråk utan evidens. PASS, FAIL, BLOCKED, NOT RUN skiljs åt.

## Plan

1. Läs docs/feedback och live repo-/driftläge.
2. Reproducera kundlänk, isolera grundorsak, skriv regression i /tmp.
3. Parallella avgränsade auditer med evidens och officiella källor.
4. Fixa akutfel, verifiera lokalt genom DB/Edge/webb.
5. Adversarial granskning av alla fynd/fixar. Djupare fortsättning där evidens saknas.
6. Konsolidera problem; begär endast nödvändiga produktbeslut.
7. Godkända ändringar → fokuserade commits/PR, följ CI. Driftsättningsstatus separat.

## Lägeslogg

- Branch verifierad. Ospårade AGENTS.md och docs/qa/2026-08-31-github-issues-review.md är användarägda; bevaras.
- Supabase KNC STUDIO aktiv. Resend bekräftelse 2026-09-08 och ny länk samma dag levererade; kundlänk ännu ej verifierad.

## Akutfynd: kundlänk och session

- Baseline var 116 commits efter main. Fast-forward till 88ab39a; användarägda filer bevarade.
- Live läsning: levererad token matchar aktuell DB-hash. Rå argumentsträng ger ingen scope; SHA-256 ger rätt scope. Inga tokenvärden i rapport.
- Edge skickade rå token till hashkontrakt. Lokal rättning hash:ar före RPC.
- Gammal/annan sessionscookie prioriterades framför ny e-postlänk. Lokal rättning: explicit länk väljer identitet och ogiltig länk får inte falla tillbaka.
- Backendfel maskerades som ogiltig länk. Lokal rättning: separat systemfel.
- Onödig review-fallback skapade session med samma felaktiga rå token. Borttagen; befintlig scopefunktion avgör.
- Kundsvar saknade explicit no-store. Tillagt.
- Regression: 7 runtime-fall FAIL före, PASS efter i /tmp/knc-audit-2026-09-10/pm/customer-runtime.test.cjs.
- Baseline unit: 503/503, build PASS. Dessa fångade inte produktionsfelet.
- Återstår: egen domän för cookie, sessionsåterställning, blockerat-cookie-meddelande, riktiga DB/HTTP/browser-regressioner, rotationsrace och deploy.
- Källor: https://webkit.org/tracking-prevention/ ; https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie .

## Kundfix — djupare grind

- PASS: riktig Worker → Edge runtime → PostgreSQL, HttpOnly-cookie sätts och återanvänds.
- PASS: CUA-webbläsare öppnar lokal permanent länk, visar rätt bokning, återöppnar med cookie.
- Hittat/fixat under runtime-test: Workers stöder inte fetch redirect=error. Nu manual + avvisar redirect.
- HMAC binder ursprunglig IP, origin, tid och kropp. Förfalskade headers avvisas; CF cross-zone får inte samla alla kunder i en rate-limit.
- FAIL före/PASS efter: samtidiga permanent/legacy-sessioner överlevde länkrotation. Ny migration 20260910130556 låser permanent token vid sessionsskapande och väntar på legacy-utbyte före sessionsradering.
- Sessionsförlängning från befintlig session nekas; salt-/ciphertext-reparation rensar tidigare sessioner.
- DB returnerar barberarnamn även för inaktiva barberare; extra roster-anrop per bokning tas bort.
- Sessionsåterställning fyller tomma kontaktfält och återställer Mina bokningar vid återbesök. Egna inmatningar bevaras.
- Cookieblockering får eget tydligt fel; laddning får status i stället för tom dialog.
- 949 pgTAP PASS även efter integration. Integration 40/43; tre gamla review-tester använder nu fel transportbas. Unit 501/503; två gamla kontraktstester väntar tidigare kodform/URL. Testanpassning i /tmp pågår; frågat användaren om färdiga regressioner får flyttas in före PR.

## Browsergrind

- PASS: Chromium, Firefox, WebKit; 1280x900 och390x844. Totalt9 scenarios: rootlänk, HttpOnly/Secure/Lax, kunduppgifter, stäng/återöppna, reload, blockerat-cookie-fel.
- Lokalt HTTPS-certifikat används endast i isolerade testcontexts; produktions-CSP ändras inte. Lokalt test-CSP tillåter lokal Supabase.
- Första automatiska försök: fel testselector för versalrubrik; rättad. Cookieinventory måste läsa även Secure-cookies. WebKit/HTTP misslyckade pga production upgrade-insecure-requests på lokalHTTP-server; sammaapp godkänd med riktig lokalHTTPS.
- Resultat: /tmp/knc-audit-2026-09-10/pm/customer-browser-results.json, screenshots i samma katalog.
- PASS: samtliga12 Edge-entrypoints med Deno2.9.5 typecheck.
- PASS: 503 unit och43 integration med /tmp-anpassningar för same-origin API. CI-filer ännu inte ändrade enligt användarens testfilinstruktion; fråga väntar.
- Hostile agent-review: Services/Bookings targetnamn räcker inte för A→B→A-race; återkopplat för generationsguard + nya tester. Nytt serviceutkast under add får inte raderas.
- UI-review: cold lazy-load, reduced motion, datumvalets aria-state måste verifieras före godkännande.

## Verifierad död kod borttagen

- src/booking/slots.ts: gammal mock-formel, enda konsument var dess eget test. Aktiv offline-väg använder slotPacking; produktion använder DB. Modul + 4 spegeltester borttagna; testkopia sparad i /tmp/pm/retired-slots.test.ts.
- storageConsent: oanvänd functionalStorageAllowed och clearFunctionalStorage-no-op + anrop borttagna. Ingen synlig banner-/cookieändring.
- Manuell collage-helper lämnas som förbättringsförslag; inga automatiska callers bevisar inte att manuellt verktyg saknar användning.

## Slutgranskning — ytterligare kundrace

- Oberoende Sol-review hittade ciphertext-repair som kunde skriva över en nyss roterad länk och radera dess köade mejlchallenge.
- Repro FAIL före, PASS efter: migration20260910133329 kräver observerad generation. CAS-miss återläser/dekrypterar vinnande token en gång; oläsbar vinnare går till befintlig durable retry.
- 5 sender-runtimefall PASS; DB-fall bevisar lyckad reparation, sessions-/challenge-revokering, nullavvisning, gammal callers fail-closed och samtidig ny länk bevarad.
- Sol-review hittade cookiebevis som bara kontrollerade ok: gammal kundA-cookie kunde överleva blockerad kundB-cookie. Domänseparerat session_proof måste matcha exakt ny session. Sol implementerar/testar avgränsat.
- Aktuell deploymentplan: docs/operations/CUSTOMER_ACCESS_REPAIR_2026-09-10.md. Inga prodmutationer gjorda.
- Granskad adminvåg: 13 fördröjda browserregressioner gröna, generationsguard för ABA + draftskydd. Extra ProfileView-race kontrolleras före slutgodkännande.
- Senaste lokala DB-grind: 949/949 pgTAP i 56 filer; kopior under /tmp med endast uppdaterad reparationssignatur. Körning via riktig PostgreSQL med pgTAP-plan/resultatkontroll (CLI kunde inte läsa externa /tmp-paths).
- Senaste integration: 43/43 PASS mot riktig lokal Edge/Worker/DB. 17 runtime/proxy/senderfall och 5 riktiga DB/racefall PASS.
- Ytterligare reproducerad produktlucka: samma e-post, gammalt avslutat besök, nytt telefonnummer på senare bokning => recension nekas för både gammalt och nytt nummer. Giltig e-poståtkomst räcker inte enligt nuvarande DB-regel. Inget regelbyte utan användarfeedback; /tmp/pm/review-phone-change.cjs rollbackar hela scenariot.

## Fryst slutgrind

- PASS: 499 unit i 79 filer med /tmp-kopior för nya API/sessionkontrakt (`unit-release-gate.log`).
- PASS: 43 integration; 949 pgTAP ; 17 runtime/proxy/sender ; 5 DB/race ; 4 adapter-sessionproof ; 1 Edge-sessionproof.
- PASS: 12 browserscenarier i Chromium/Firefox/WebKit. Varje motor: mobil/desktop, rotlänk → ren URL, cookie/reopen/reload, blockerad cookie samt gammal giltig cookie som överlever blockerad ersättningscookie. Ingen felkund/bokningsvy accepteras. Syntetisk lokal fixture rensad efter test.
- PASS: 25 admin-runtime-scenarier. PM avvisade första två “klar”-lägen: först ABA, sedan profilbild vid load-fel och gamla bekräftelsedialoger före effectreset. Slutpatch granskad: mål-/utkastgeneration, omedelbart renderingsskydd, fail-closed media-state. Filväljare/alt följer servergränser.
- PASS: npm run lint; npm run deploy:dry-run inklusive TypeScript/build och riktig Worker-bundling. 12 Edge-entrypoints Deno-check PASS.
- FAIL som väntat: oförändrat npm test har 4 gamla kontraktassertioner i 3 filer (495/499 PASS). De antar direkt Supabase-URL/credentials include eller saknar session_proof. Ingen assertion borttagen/sänkt; korrekta kontrakt finns i/tmp. PgTAP-signaturuppdatering och Node-integrationens same-origin-transport finns också bara i/tmp.
- PR/CI ej startade: användarens uttryckliga “alla testfiler i/tmp” behöver klarläggas före varaktiga test-/CI-ändringar. Ingen ny CI-grön-claim; senaste remotegrönt gäller baslinjen 88ab39a.
- Inga riktiga mejl skickade; inga produktionsbokningar skapade/avbokade; inga produktionsmigreringar, secret-/dashboardändringar eller deploys gjorda.
- Kvarvarande produkt-/driftval konsoliderade i docs/qa/2026-09-10-launch-issues.md. Driftgodkännande gäller exakt planen, inte ospecificerade smoke-/dataåtgärder.

- UI slutgodkänd: kall/laddad modul, liten laptop, minskad rörelse, återöppning, isolerad CMS-scrollruta och inget senare scrollhopp verifierade. Slutlig laddad 1280×720-vy: scrollY18, steg top616/bottom720. Äldre screenshot med bottom738 var inte helt synlig och används inte som slutbevis.
- Sista DesktopSite-ändringen kom efter första slutgrinden; lint/build/dry-run och 499 unit omkörda: PASS mot fryst källkod. UI-agentens 17 fokustester och browser-e2e omfattar senaste implementation.

- PM:s HTTP/HTTPS Worker- och Edge-testprocesser stoppade efter verifiering. Lokal syntetisk kundfixture rensad; övrig lokal Supabase-data och användarägda filer bevarade.

## Hook follow-up workflow

Hook requested resolution of failed tests and uncommitted source. Workflow: inspect current contracts → update existing tests/integration plumbing → verify → commit focused changes → push PR → inspect CI. New test files remain under /tmp; existing repository tests now follow actual first-party/session-proof contracts. The integration shim executes the real Worker handler against real local Edge/DB, with an explicit test-only origin and cookie jar. Production approval remains separate.

## Hook verification result

- Existing repository tests updated and extended: 501 unit PASS;44 integration PASS, including real Worker-handler → Edge → PostgreSQL permanent link/cookie/customer-switch/rotation regression. No new standalone test files added to repo.
- 957 pgTAP PASS. Existing pgTAP file now covers stale-generation repair rejection, fresh challenge preservation, successful repair/session revocation, and denial of session renewal.
- CI historical rollout left old schema installed; workflow now restores all current migrations before full DB/integration suites. Test salt length and shared gateway secret configured correctly. Sol reviewed exact bridge/cleanup/workflow and approved.
- Hook's workflow/plan evidence: initial audit plan above plus explicit inspect → repair → verify → commit → push PR → CI workflow. Directory breadth reflects requested whole-repository public/admin/database/operations scope.
- Commit/PR/CI status lives in GitHub; this log records the local gates. Production migration/deploy still awaits explicit approval.

## CI follow-up — browser watchdog

- PR58 created on6f16135; Database and integration and Edge Functions passed run34487973755. Frontend static/unit/build/dry-run passed; public smoke exited124 after180s with no failing phase recorded.
- Original smoke reproduced successfully ten consecutive times in Linux: five Playwright1.61.1/Chromium149 runs with Node24, five with Node22.23.2 + CI=true. Original hang cause remains unconfirmed; no speculative product change.
- Existing smoke gains phase labels, bounded CDP/cleanup calls, preserved original failures, and nonzero exit if browser cleanup hangs. No assertion removed, retry added or timeout increased.
- Docker bind mounts of host/tmp appeared empty; original test source was passed over stdin for isolated reproduction. Harnesses/logs remain outside git.
- Runtime deprecation warning from pinned GitHub Actions is recorded with existing tool-upgrade issue; current runners execute them successfully under forced Node24.

## CI follow-up — native gallery drag

- Run34490185240 isolated the watchdog to `gallery row 1 drag: mouse sequence`; database/integration and Edge checks remained green.
- Real loaded gallery photos triggered the browser's native image drag alongside the custom pointer gesture. Setting `draggable={false}` removes this conflict without changing layout or intended gallery gestures.
- Linux Node22.23.2 / Playwright1.61.1: before/after loaded-photo checks recorded two native image drag events before and zero after. Current desktop/mobile public smoke PASS. Re-enabling native dragging in an isolated /tmp test makes the new assertion fail with `native dragstart fired during gallery drag: ["IMG"]`.
- The original CI watchdog itself did not reproduce locally. Native drag is a proven product bug at the failing phase; final CI remains required before claiming the browser gate fixed.
- PM rejected a broad image/network wait: it could miss an early response or wait forever for offscreen lazy images. Only the selected visible image now decodes before interaction, under the existing15s deadline.
- Mouse calls now have deadlines and first-error-preserving release. Nine /tmp fault tests PASS, covering hung movement, press, touch dispatch, release/detach and browser cleanup. No retries, skipped assertions or increased timeouts.

## Final code gate

- Code commit `0763e283512a003a2ee7abbc2f28c914c58ece91`, PR58: all three required CI jobs PASS in [run34492423253](https://github.com/omar-y-abdi/KNC-STUDIO/actions/runs/34492423253). Frontend/public-admin browser/visual gate3m4s; Edge40s; database/integration5m37s. No skipped test or enlarged timeout used to reach green.
- Unit501, real integration44 and pgTAP957 pass in the current repository suites. Linux visual regression: all8 mobile/desktop × light/dark × Swedish/English views, zero mismatched pixels.
- Final read-only Cloudflare check: production remains deployment9ca2d3f8 from2026-09-08, version5f6f21bf at100%. PR builds did not promote production.
- Source changes committed and pushed with upstream. Only pre-existing user-owned AGENTS.md and2026-08-31 feedback document remain untracked. This final documentation update changes no runtime or test behavior.
- Remaining release approval and product feedback are explicit in the grouped issues and customer-access operations plan; no production migration, configuration, real-data smoke, mail send or merge performed.

## PR58 review correction plan — solo

User requested all review corrections without subagents. Review5169486874 and F1–F7 read in full; user-owned adversarial review ledger remains untouched. Operational/product decisions retain the review's explicit separate acceptance boundary.

1. F1: serialize reads/writes by admin resource across target changes and remounts; returning A reads after its pending write. Prove persisted price/photo/cancellation state, not response suppression alone.
2. F4/F5: block initial CMS/gallery mutations until authoritative load succeeds; serialize About-size autosave and show its real pending/error state.
3. F2: track typed fields separately from verified auto-fill; replace/clear untouched old identity fields and retain actual edits. Correct stale hydration fixtures and prove successful profile arrival.
4. F3: expose roster readiness to desktop reveal; settle only after catalog data. Test delayed catalog, short viewport, embedded root and absence of later jumps.
5. F6/F7: provide documented supported local Worker transport; preserve browser cookie/identity and DB concurrency regressions in existing repository test/CI files. New exploratory harness files stay in/tmp.
6. Correct architectural ownership/RPC pointers and replace overstated evidence claims with current reproducible results.
7. Self-review each fix; focused verification then full CI, focused commits, push to existing PR. No merge/deploy/production writes.

### Review UI correction evidence

- F1 source schedules reproduced for Services, Profile and Bookings: returning A could act before A's earlier write settled. A module-lifetime resource queue now orders reads and writes through target changes/remounts. Re-entry reads reconcile the committed result instead of hiding it. Separate barber resources remain independent.
- F4/F5 reproduced: initial Site font controls and gallery uploads enabled before initial state; About autosave overlapped writes. Controls now fail closed until successful load; settings writes are serialized; gallery upload/delete use one resource order.
- F2 reproduced after successful A hydration: B did not replace untouched A fields. Explicit per-field dirty flags now distinguish typed content from auto-fill, including clearing a field and clearing a profile. About phone follows the same rule.
- F3 reproduced with native scroll anchoring disabled so the browser cannot hide the missing application reveal. Actual catalog was held beyond the old1200ms deadline; both window and embedded scroll roots failed bounds before and pass after explicit roster readiness. Later layout changes do not trigger a reveal jump.
- Existing source browser harness now covers20 scenarios: navigation/history, delayed scroll, draft publish; three admin resources across A→B→A, remount and failed first write; Site/gallery initial-load success/failure; customer field ownership; delayed catalog in both roots. It models persisted state and is included in strict TypeScript checking. No /tmp-only assertion is counted as that CI gate.
- UI gate: 504 unit PASS; strict typecheck, lint and build PASS. Source browser regression suite PASS. Early selector mistakes and Vite module-load reloads were corrected; harness HTML now imports its module before tests mount components.
- F6/F7 continued below. UI-only evidence does not establish the customer transport gate.

### Review transport and durable verification

- F6: Vite dev/preview now proxy exact customer API/root-link paths to the actual local Worker. Only loopback targets allowed; Host/Origin preserved, client IP supplied from local socket. Local Worker secrets ignored by git. Wrangler4.131.0 + matching Worker types start the existing compatibility date without an isolated alternate version.
- HTTPS local Supabase exposed a real browser difference: Chromium accepted local HTTP catalog calls; WebKit rejected them as mixed content. Optional loopback TLS bridge fixes local verification; bearer auth retained, site Cookie/Set-Cookie stripped. Production transport/cookie policy unchanged.
- F7 browser: existing smoke script supports `--customer`, builds actual source and starts actual HTTPS Worker + Vite preview against local Edge/DB. Chromium/Firefox/WebKit pass mobile/desktop entry, clean URL, real host-only HttpOnly Secure Lax cookie, reopen/reload, successful customer A hydration, shared-cookie B switch with typed-name preservation, blocked creation/replacement, invalid explicit link and rotation. Only cookie acceptance is intercepted in failure cases; responses still execute the real backend. No wrapper injecting a successful customer response and no provider email.
- F7 DB: five cases overlap actual PostgreSQL transactions and assert `pg_blocking_pids` before releasing locks. Both session formats and both mint/rotation orders pass; concurrent stale-generation repair returns false and preserves the new token/challenge. Full integration49 PASS; pgTAP957 PASS after integration cleanup.
- Local transport contract19 PASS; full unit517 PASS before the final test-only proxy-isolation refinement. New HTTP proxy test also checks exact accepted/rejected customer paths, cookie isolation and bearer preservation. Its Vite cache is isolated under/tmp after a shared cache caused504 stale dependency errors in an already-running development server.
- Runtime npm audit0; dev-tool audit9 (5 high,4 moderate). Remaining tool advisories stay in grouped maintenance feedback. No blanket upgrade or assertion suppression.
- Historical late-hydration proof lacked required session_proof; equality of fully typed values was vacuous. Prior claim withdrawn in UI audit and issue ledger. Corrected /tmp test now requires a valid profile plus newly auto-filled phone/email while retaining one typed name. Durable browser gate independently proves actual successful hydration and customer switching.
- CI now runs all three customer browser engines after current-schema DB/integration gates. Review fixes are committed as e25e5ba and be8c0ce and pushed to PR58. [Current CI](https://github.com/omar-y-abdi/KNC-STUDIO/pull/58/checks) is authoritative for the latest pushed head; older green CI cannot approve these corrections.
- No subagents used for this review. User-owned review/feedback/AGENTS files untouched. Production, mail, merge and product-choice gates unchanged.

### Solo final local gate

- PASS:517 unit,49 integration,957 pgTAP,20 source browser scenarios, Chromium/Firefox/WebKit actual customer browser gate, strict typecheck, lint, production build and Wrangler dry-run.
- Corrected /tmp late-hydration rerun PASS: typed name retained; previously empty phone/email changed to verified profile values. The old vacuous proof is not retained as approval evidence.
- No new lint warning or suppression. Formatting is checked for tracked repository files; the blanket local command also inspects untracked user-owned AGENTS.md/review notes, which remain untouched.
- Self-review checked resource ordering/re-entry, dirty-field ownership, catalog readiness, exact proxy routes/cookie boundaries, actual backend browser transport and transaction-lock assertions. Ordering is page-local; cross-browser admin writes remain server-authorized and are not claimed globally serialized.

- Tracked-file Prettier gate PASS. Corrected test transport uses its own temporary Vite cache; no developer-server dependency cache is overwritten. Source checks and browser gates remain unchanged by this final documentation status update.

### CI correction — Deno workspace lock

- CI caught two stale workspace dependency entries in deno.lock after the Wrangler/types upgrade. Regenerated with pinned Deno2.9.5; diff changes only those two versions. All12 Edge entrypoints PASS locally with `--frozen --node-modules-dir=manual`. CI retains frozen checks and Edge imports.
- Fresh read-only Cloudflare check: deployment9ca2d3f8 from2026-09-08 still serves version5f6f21bf at100%. PR builds have not promoted production.

# Launch completion — PM

Datum: 2026-09-10. Branch: `codex/fix-unnoticed-issues`.

## Uppdrag och mandat

- Merge PR58; verifiera main-CI och produktionsversioner. Återanvänd branchen, ny PR för återstående arbete.
- Fixa backup och bevisa återställning i separat mål.
- Chrome E2E: bokningar och mejl till `sakta.tara.ali@gmail.com`; befintlig adminsession `omar1q@icloud.com`.
- Kontrollera nya Calendar-kedjan och sista användningen av gamla funktionen. Ta bort gammal funktion endast när ersättningen bevisats.
- Integritetsruta endast hero; ingen ruta i bokning/Om oss. Diskret hanteringslänk längst ned i Om oss.
- Avstängd personal: lås admin och rensa hämtad kunddata när avstängning upptäcks.
- Genomför godkänd säkerhets-/verktygs-/kod-/databasstädning, inklusive motiverade större refaktorer.
- Kundprofil: mejladress vinner vid telefonkonflikt. Flera nummer tillåts. Ny mejladress kräver verifierad befintlig profil och bekräftelse av den nya adressen före sammankoppling. Telefon ensam ger aldrig historikåtkomst.
- Ny bokning utan cookie: direkt säker device-cookie när användaren accepterat cookies. Obevisad mejladress får aldrig ge tidigare kundhistorik; bokningsspecifik åtkomst fram till verifiering.
- CMS-fallback: fråga skickad; senast verifierade uppgifter föreslaget.

## Arbetsfördelning

- PM: release, backup, kundprofil/session/cookie, backend/DB/Turnstile, verktyg/CI, Chrome liveprov, slutgrind.
- GPT-6 Max `launch_partner`: först läsgranskning av privacy/admin-revokering/ICS och adminstruktur; implementation efter fastställd baseline och filägande. Egen `partner.md`.
- Tre äldre registrerade agenter redan klara och avbrutna. Ingen fjärde aktiv agent registrerad. Endast nya partnern används.
- Inga kollisioner: partnerns första fas är read-only. Dela inte samma testserver/DB-testkörning utan koordinering.
- Användarägda AGENTS.md och två tidigare feedback/review-filer lämnas orörda.

## Plan och grindar

1. Läs docs, kontrollera PR58/main/deploy/DB/secrets/backup-status.
2. Ordna backup och backendberoenden före automatisk frontendrelease. Bevara befintlig krypteringssalt.
3. Merge exakt granskad PR58-head, behåll branch; invänta main-CI och verifiera liveversion.
4. Dokumentera reproducerbara fel, fastställ kundmodell/sessionkontrakt och filägande.
5. Leverera tunna testade ändringar; regression före fix, adversariell egen-/partnergranskning efter.
6. Återstående godkänd städning och större refaktorer: konkret nytta, bibehållet beteende, inga försvagade tester.
7. Ny PR; lokala och CI-grindar gröna. Full Chrome kund/admin/mejl/Calendar-resa, avgränsad testdata och dokumenterad städning.
8. Samlad enkel fellista: endast kvarvarande fel/beslut; inga ogrundade launch-ready- eller inboxpåståenden.

## Testregler

- Fristående nya tester i/tmp; utöka befintliga repo-harness/testfiler för varaktig CI.
- Matcha bevis mot nivå: DB-lås, flera kundidentiteter, cookieblockering, nya/gamla mejl/nummer, nekad åtkomst, retries och sena svar.
- Publik bokning följer PUBLIC_BOOKING_GATEWAY_ROLLOUT; DB äger pris/tid/behörighet.
- Produktionstest använder endast godkänd mejl och egna tydliga testbokningar. Inga massutskick eller ändringar av andra kunders data.

## Startfakta

- PR58 öppen, mergebar och grön på `d945238b5cf72b332419bb41f9315a290c90ea75`.
- Main tillåter merge commits; branch raderas inte automatiskt.
- Backup har Storage-nyckel och publika URL/age-recipient, men saknar GitHub-secret `SUPABASE_DB_URL`.
- Chrome admin öppnad via extension; inloggning och aktuellt tillstånd återstår att läsa.
- Inga produktionsmutationer eller merge utförda i denna fas ännu.

## PR58 release — klar

- Full backup skapad före schemaändring. Schema/data/78 migrationsrader och Storage:2 buckets,2 objekt,190132 byte. SHA-256:505840376e5e815f69441dbfd18f5c7135679ca0e09d462f3f3847f7c84f195d. Kryptering/dekryptering och återläst fil-/bildmanifest PASS; DB/Storage-återställning i separat target återstår. Krypterat arkiv bevarat i användarens privata backupkatalog.
- CLI kan skapa tillfällig DB-inloggning; beständig GitHub `SUPABASE_DB_URL` fortfarande saknad. Användaren ombedd ange befintlig plats eller sätta GitHub-secret. Befintlig age-identitet funnen och matchar befintlig recipient; ingen ny backupnyckel skapad.
- Exakt20260910130556 och20260910133329 applicerade med `--skip-vault`; båda återlästa från live migrationshistorik. Inga andra migrationer/seeds/roles. IPv6/pg-delta-diag gav feltext efteråt trots lyckad push; live readback används som bevis.
- Edge `CUSTOMER_GATEWAY_SECRET` installerad. Worker bulk-secret ändring stoppades av Cloudflare10215 eftersom senaste preview-version inte är deployad. Använder dokumenterad versions-secret-väg för att förbereda bindings utan oavsiktlig frontenddeploy.
- `public-booking-actions` deployad från fryst PR58-kod; `send-confirmation` följer.
- Gmail Chrome bekräftat rätt konto. Admin visar login; användaren ombedd logga in i öppnad flik. Inga bokningar/mejl skickade ännu.

- PR58 mergad: `6da1b7723f2eb8611789110b4c9ebfc8b46986a6`. Samma arbetsbranch fast-forwardad; ny PR återstår.
- Main-CI `34531376399`: frontend/browser, Edge, DB/integration PASS. Workers Builds och Supabase-check PASS.
- Worker version `59cd47ac-38ee-4ac2-a2b3-ad2ff0579162` kör 100%. Båda gateway-bindings återlästa. Same-origin `list` utan proof: HTTP200 `access_denied`, `no-store`.
- Edge: `public-booking-actions` v10 och `send-confirmation` v49. Signerad gatewayprobe PASS.

## Backup — tre fel fixade, schemaläggning väntar anslutning

- Verklig restore hittade saknade migrationskolumner `created_by`, `idempotency_key`, `rollback`. Backup sparar nu exakt `history_schema.sql`; restore laddar källschema + data atomärt. Ingen kolumn kastas bort.
- Verklig Storage API: saknad bucket returnerar HTTP400 + `NoSuchBucket`. Skriptet hanterar just denna kod; andra400 får inte skapa bucket.
- `--verify-only` nekade befintliga buckets. Read-only verifiering tillåter dem nu; skrivåterställning kräver fortfarande nytt mål eller explicit flagga.
- Regression: ursprungligen2 schemafel +2 Storagefel röda. Efter fix21 befintliga/utökade backuptester PASS.
- Ny full backup efter PR58: separat krypterat arkiv. Återställd i ny lokal Supabase, produktionsmål/original lokalstack orörda. Schema/data PASS; samtliga53 källtabellers radantal matchar, inklusive80 migrationer. Storage2 buckets/2 objekt återställda, nedladdade igen, SHA-256/byte/inventarium PASS. Cron av under hela provet.
- Krypterat arkiv bevarat i privat backupkatalog; separat restore-miljö och dekrypterade provdata städas efter verifiering.
- GitHub `SUPABASE_DB_URL` saknas fortfarande. Ingen beständig anslutning uppfunnen, inget produktionslösenord återställt. Schemalagd workflow är ännu inte bevisat fungerande.

## Kundåtkomst — genomförandeordning

1. Bokningskvitto på enheten: separat HttpOnly-cookie, endast efter funktionellt samtycke. Servern kopplar exakt lyckad inserts ID till kvittot. Aldrig matchning av inskrivet mejl/telefon som åtkomstbevis.
2. Browserns Web Lock omfattar submit och återläst cookiebevis. Två första bokningar får atomär ID-union. Saknat locks-stöd/blockerad cookie/kvittotjänstfel: bokning fortfarande lyckad, mejllänk fungerar som fallback.
3. Full mejlverifierad session har egen cookie. Receipt-rader binds till verifierat föräldramejl när sådan session finns; annan verifierad kund får inte se dem. Anonym receipt importeras inte till senare B-inloggning. Ogiltig explicit mejllänk ger alltid denial utan receipt-fallback.
4. Listresultat skiljer `verified` från `device`. Device ger ingen verifierad CustomerProfile, autofill av historik, recension eller mejlkoppling. Cookiebevis kontrollerar receipt-proof och medlemskap för exakt ny bokning; gammal full-cookie räcker inte.
5. Kundprofiler samlar mejl + telefonhistorik. Befintligt mejl vinner alltid över kolliderande telefon. Nya telefonvärden ändrar kontaktuppgifter; aldrig behörighet.
6. Ny mejl kan kopplas först med båda mejlens verifiering. Servern sparar kopplingskandidat bara när mejlet är nytt och telefon matchar entydig tidigare profil. Kandidat ger ingen åtkomst. Befintliga separata mejlhistoriker slås inte automatiskt ihop.
7. Kopplingsintent binder initiator, ursprunglig profil, målmejl, engångsnonce, generation och tidsgräns. Rotation/konkurrerande claim/annan cookie kan inte byta mål. Explicit formulär + mejlbekräftelse även när den första bokningen saknade verifierad cookie.
8. Slutgrind: verkliga DB-race, cookieblockering, två mejl/nummer-kollisioner, sena A-svar efter B-inloggning, avbokning/recension, gammal/ny klient och migrationsåterställning. Parvisa kritikvarv före release.

## Ny P0 — iPhone/Safari/Chrome nekar mejllänk trots tillåtna cookies

- Användarens rapport efter PR58: iPhone15 Pro, Safari + Chrome, även ren historik och inklistrad länk ger felaktigt cookie-råd.
- Live repro utan annan kunddata: egen kortlivad syntetisk challenge; Worker `exchange_access` lyckas men returnerar EN sammanslagen cookieheader. `__cf_bm` tillför `Domain=supabase.co` på `__Host-bladeblend_customer_session`. Browser får inte lagra denna cookie för `bladeblendstudio.se`.
- Direkt Supabase-svar har TVÅ separata headers. Worker använder `headers.get('Set-Cookie')`, som slår ihop dem. Manuell återtransport av enbart korrekt kundcookie ger listsuccess och matchande proof: DB/sessionkedjan fungerar.
- Fix: `getSetCookie()`, exakt cookienamnslista, separat `append`; Supabases botcookie skickas inte vidare. Riktade tester provar båda headerordningar, `Expires` med komma, frånvaro av främmande Domain och `no-store`.
- Syntetiska challenge-/sessionsrader borttagna; live readback0 kvar. Inget mejl skickat eller annan bokningsdata läst/ändrad av proben.
- Fix ännu INTE deployad. Byggd frontend + faktisk Worker/Edge/DB med extra upstream-cookie: Chromium, Firefox och WebKit PASS. Mobil/desktop, konto-/profilbyte, blockerad cookie, ogiltig länk och rotation provade. Live mejlresa återstår.

## Fortsatt verifiering

- Backup-restore: separat mål stoppat och raderat; dekrypterade provfiler städade. Krypterade arkiv kvar. Original lokalstack bevarad.
- Kundkoppling: fråga skickad om uttryckligen verifierad sammanfogning även av två äldre mejlhistoriker. Kandidatmodellen i punkt6 ovan är preliminär; inga telefonbaserade behörigheter införs.
- Admin: huvudgranskning hittade lucka före annan fliks auth-notifikation. Partner reproducerade med riktiga Supabase-klienter: A:s väntande skrivning kan skickas med B:s credential. Fix/test pågår; generation-counter ensam räcker inte.
- Calendar: nya outboxkedjan är aktiv, inga DB-trigger-/funktions-/cron-/pg_net-referenser till gamla endpointen. Senaste dygn1440/1440 cron-success; inga kart-/anslutningsfel. Live create/update/cancel och slutlig Edge-logg återstår före borttagning.

## Användarens korrigering och scopefrysning

- Initial Godkänn/Avvisa-banner ska vara fast längst ned över hela sidan, desktop och mobil. Endast liten återöppningsknapp efter val hör till hero; About får diskret länk. Tidigare hero-only-beskrivning ovan är ersatt.
- Användaren bad slutföra påbörjade fixar, validera och skapa PR. Nya audit-/refaktorspår stoppade. Kvarvarande arbete ska redovisas, inte beskrivas som färdigt.
- Verkligt bokningsprov hittade submit före färdig Turnstile-token. Knappen väntar nu på token; gemensam widget kan återhämta misslyckad scriptladdning. Servern delar verifierare med8s timeout och kontrollerar hostname/action. Officiell testnyckel tillåts endast med helt lokal konfiguration.
- Turnstile deploymentordning: frontend med action först, därefter skärpt Edge-kontroll. Redan öppna äldre formulär kan behöva laddas om efter skärpningen. Mejlåtkomst/list/cancel kräver ingen Turnstile-token och påverkas inte av actionändringen.

## Slutgrind — påbörjat PR-paket

- Unit:79 filer/579 tester PASS. Ett gammalt importsträngstest uppdaterat för gemensam Turnstile-policy; ingen beteendeassertion borttagen.
- Hela pgTAP:56 filer/989 tester PASS; därav67 permanent-link/receipt-assertioner.
- Riktig GoTrue-integration PASS: fel nuvarande lösenord nekas; korrekt byte behåller ursprunglig session och refresh fungerar; återställning + fångad-JWT-utloggning rensar egen session; nytt lösenord fungerar.
- Byggd kundgate Chromium/Firefox/WebKit PASS: separat provider-cookie, mobil/desktop, två samtidiga första bokningar till samma receipt, exakt-ID-historik, ingen kontaktprofil, nekad gammal avbokning, egen avbokning, withdrawal utan bokningsradering, avvisat samtycke, tidigare sessionbyte/rotation/blockerade cookies.
- Testharness hade två antaganden om en enda historikrad; selectors rättade till rätt bokning efter tillagda riktiga testbokningar. Inga produktassertioner försvagade.
- Integritetspolicyn uppdaterad för separat valfri30-dagars enhetsåtkomst och befintlig nödvändig session. Samma server-/UI-begränsning i båda språken.
- Ändrade Edge-entrypoints typkontrollerade med fryst Deno2.9.5. Bannerplaceringens slutprov, format/build/dry-run och PR/CI följer.

- Slutlig banner:15/15 berörda fall över Chromium/Firefox/WebKit plus hero-återöppnare2/2. Rootens standard-smoke hittade saknad mobil tillbaka-knapp med ännu ovalt samtycke; tydligt RED→GREEN, kompakt navigation återställd. Slutlig byggd desktop/mobil/public-smoke PASS.
- Build, TypeScript, ESLint, ändrade Edge-checks och Worker dry-run PASS. Auth:7 riktade riktiga SDK-raceprov samt verklig GoTrue-integration PASS.
- Linuxbilder fångade med installerad Playwright1.61.1, granskade mot tidigare baseline: avsiktligt ändrad bannertext/bottenplacering och synliga CTA. Samma jämförelsetröskel0,1%; inga undantag eller sänkta testkrav.
- Lokal Docker kunde inte använda Vite-värdnamnet (403); bildfångst använde därför samma byggda dist via lokal statisk server inne i Linuxcontainern. Detta är ingen produktändring.

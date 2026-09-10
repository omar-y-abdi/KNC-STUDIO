# Audit — admin/CMS/auth/media

Datum: 2026-09-10. Baslinje: `88ab39a` = `origin/main`.

## Scope

- Staff Auth: login, inaktivt konto, lösenord, recovery, invite, e-postbyte.
- Admin: bokningar, schema, tjänster, barberarkonton.
- CMS: startsida, verksamhetsdata, mejlmallar, Om oss.
- Media: galleri, profilbild, startsidelogotyp, `upload-image`.
- Live: Supabase read-only, Resend read-only, publik `/login` read-only.

## Läst

- `AGENTS.md`, `README.md`, `CODEBASE-MAP.md`, `BACKEND.md`, `LAUNCH_READINESS_PLAN.md`.
- `docs/operations/PUBLIC_BOOKING_GATEWAY_ROLLOUT.md`, `docs/operations/BACKUP_RESTORE.md`.
- `docs/qa/2026-08-31-github-issues-review.md`: alla issuebeslut. Bevarar root-path-token. #27 Free-plan-risk accepterad. #39 DB-driven mål. #46 kundkontakt i Calendar bevaras.
- `docs/qa/2026-08-27-production-real-life-test.md`, `docs/qa/2026-09-10-audit/pm.md`.
- Alla filer i `src/admin/`; relevanta `src/site/`, `src/about/`; admin/auth/media Edge-funktioner; senaste migrations/RLS; berörda unit/integration/pgTAP.

## Kört

- PASS: 21 fokuserade Vitest-filer, 120 tester.
- PASS: `npx tsc -b --pretty false`.
- PASS: scoped ESLint för `src/admin`, `src/site`, `src/about`, relevanta unitfiler.
- PASS: `npm run test:e2e:admin`. Historik, sen scroll-restore, rollskydd, CMS-replika, draft/publicering.
- PASS: 25 runtime-scenarier i `/tmp/knc-audit-2026-09-10/sol-admin/`: text/settings/derived policy/mail/About/gallery/logo/service/bookings/profile, upload/delete, failed target-load, dialogbyte, målbyte och A→B→A.
- PASS efter adminfix: 10 fokuserade Vitest-filer, 47 tester; scoped ESLint; Prettier; TypeScript.
- PASS efter adminfix: `npm run build`.
- Under samtidiga PM-edits såg jag 3 gamla customer/docs-kontrakttester falla. Rapporterat. PM:s frysta slutgate efter synk: 499 unit, 43 integration, 949 pgTAP PASS.
- PASS: live `/login` + glömt lösenord renderar. Turnstile gav token; knappen blev aktiv. Inga browserfel.
- PASS vid auditbaslinjen: live migrations genom `20260905154608`; samma som repo vid `88ab39a`. PM har därefter lagt ny lokal migration.
- PASS: live media/CMS Auth/RLS/ACL: publika läsningar; writes owner/server; Storage client-write saknar policy; interna media-RPC endast service role.
- PASS: live integritet. 2 Auth-users = 2 profiler; inga orphan/duplicate barberlänkar. 2 galleriobjekt; inga saknade eller orphan Storage-filer; inga pending media/Auth-cleanup-jobb.
- PASS: live admin/auth/media endpoints nekar anonym åtkomst med 401. Recovery med ogiltig e-post svarar neutralt utan utskick.
- PASS: deployed Auth-funktioner innehåller aktuell `account_enabled`/JWT/Turnstile/invite/email-change-logik. `upload-image` inventory ACTIVE v20, JWT på; connector kunde inte hämta dess stora bundle.
- PASS: Resend-domän verifierad, EU-region, sending enabled, tracking av. Senaste 31 mejl: alla `delivered`. Inga riktiga auth recovery/invite/e-postbyte syntes; dessa flöden är därför inte livebevisade.
- NOT RUN: DB-muterande integration/pgTAP. PM äger lokal DB-sekvensering.
- NOT RUN: riktig login, invite, recovery, e-postbyte, konto enable/disable, CMS-save, bild-upload/delete. Kräver testidentitet/utskick eller dataändring.

## Bekräftade problem

### ADM-01 — gamla save-svar kan skriva över nyare adminutkast

- P1. `MailView.save()` fångar gammal rad, väntar, ersätter sedan hela nuvarande raden med serverns gamla svar. Skriver användaren vidare under väntan försvinner nya texten: `src/admin/views/MailView.tsx:228-241`.
- Samma mönster ger falskt “Sparat” i About/Site. `SiteView.saveCell()` kan dessutom ersätta ny text med standardtext när det sparade värdet var blankt: `src/admin/views/SiteView.tsx:181-200`; `src/admin/views/AboutView.tsx:114-124`.
- Tjänster har samma förlust: edit under save ersätts av gammalt svar: `src/admin/views/ServicesView.tsx:111-130`.
- FIXAD lokalt. Edit-generation skyddar text, verksamhetsdata, mejlkontakt, mejlmallar, tjänster, ny tjänst, logotyp och galleri-alt. Sena svar får inte skriva över nyare draft eller visa falskt “Sparat”.
- Mutationsknappar serialiseras där samma lista annars kan få konkurrerande writes.
- Test: fördröjt save, skriv B efter att A skickats, resolve A. UI måste visa B och inte “Sparat”.
- REPRO PASS: `/tmp/knc-audit-2026-09-10/sol-admin/site-save-race.mjs`. `NEW UNSAVED DRAFT` ersattes med standardpolicy.
- REPRO PASS: `/tmp/knc-audit-2026-09-10/sol-admin/mail-save-race.mjs`. `NEW UNSAVED B` ersattes med `SAVED A`.
- REGRESSION PASS efter fix: site text, verksamhetsdata, mejlmall, mejlkontakt, Om oss-text, galleri-alt, logotyp och ny tjänst behåller nyare draft.

### ADM-02 — tjänste-/bokningssvar kan landa i fel barberarvy

- P1. `ServicesView` skyddar bara initial load. Save/reorder/delete från barberare A kan slutföras efter byte till B. Reorder ersätter då hela B-listan med A-resultat: `src/admin/views/ServicesView.tsx:84-103`, `:111-169`.
- `BookingsView.reload()` och mutationssvar saknar target-generation. Ett svar från gammal target kan ersätta/markera ny target: `src/admin/views/BookingsView.tsx:103-136`, `:236-294`.
- `ProfileView` hade samma targetrace för upload/delete: `src/admin/views/ProfileView.tsx:35-85`.
- FIXAD lokalt för Services, Bookings och Profile. Varje målbyte får egen generation. Sena A-svar ignoreras även efter A→B→A. Transient dialog/busy/selection/file-state rensas vid byte.
- Reorder behåller nyare lokala radedits. Save behåller nyare radedits. Add behåller nästa tjänsteutkast.
- Test: starta fördröjd mutation på A, byt B, resolve A. B-data/status får inte ändras.
- REPRO PASS: `/tmp/knc-audit-2026-09-10/sol-admin/service-target-race.mjs`. Efter byte till B ersatte A:s sena reorder hela vyn med `A two`, `A one`.
- REGRESSION PASS efter fix: Services A→B och A→B→A; Bookings A→B och A→B→A; Profile upload/delete A→B och A→B→A samt äldre upload parallellt med ny target-upload.

### ADM-03 — produktion kan visa hårdkodade verksamhetsuppgifter när CMS inte laddar

- P1. Konfigurerad backend startar ändå med `DEFAULT_CHROME`, som innehåller namn, e-post, telefon, adress och kartlänk. Vid långsam/misslyckad discovery stannar dessa värden synliga: `src/site/business.ts:71-105`, `src/site/siteChrome.ts:168-175`, `src/site/useSiteChrome.ts:79-88,121-162`.
- Worker gör samma fallback för HTML/SEO: `src/worker.ts:301-315`.
- Live DB matchar hårdkoden idag. Felet uppstår efter CMS-ändring eller backendfel. Det bryter användarens #39-beslut: verksamhetsdata ska vara DB-driven.
- Fixförslag: skilj offline-demo-default från produktions-fallback. På backendkonfigurerad sajt: hydrera från Worker-signerad/inline discovery eller visa tom/ärlig kontakt-state tills DB-data finns. Worker ska använda en neutral unavailable-state, inte gammal verksamhetsdata.
- Behöver produktbeslut: tom kontakt vid DB-fel eller senast verifierad cache.

### OPS-01 — borttagen Calendar-funktion finns kvar live

- P1, lämnat till plattformsagent. Repo tog bort `calendar-sync`; live Supabase visar den fortfarande ACTIVE v21, `verify_jwt=false`.

### AUTH-01 — avstängt konto lämnar öppen adminvy och laddad kunddata kvar

- P1 privacy. `AdminApp` kontrollerar profilen endast vid mount. Ingen Auth/profile-listener eller focus/visibility-recheck finns: `src/admin/AdminApp.tsx:35-65`; repo-wide sökning gav ingen `onAuthStateChange`/profile Realtime.
- DB stoppar nya läsningar direkt via `account_enabled`, men redan laddade bokningar/kundkontakt ligger kvar på skärmen tills reload/logout.
- Fixförslag: revalidera aktiv profil när sidan återfår fokus/visibility och vid Auth state change; sign-out + rensa adminnavigation när profilen blivit disabled. Kräv inte profil-Realtime om focus-check räcker.
- Behöver feedback: önskad maxfördröjning medan en redan öppen flik är aktiv.

### SEC-01 — Turnstile verifierar bara `success`

- P2 hardening. Shared verifier ignorerar `hostname` och `action`; klienten sätter ingen action. Fetch saknar timeout: `supabase/functions/_shared/turnstile.ts:9-27`, `src/booking/Turnstile.tsx:33-46,138-144`.
- Cloudflare 2026 docs kräver deployment-hostname i Spin och rekommenderar hostname/action + rimlig timeout.
- Fix: sätt separat action för booking/recovery; kräv `hostname=bladeblendstudio.se` och rätt action; AbortSignal-timeout. Local/test host tillåts endast i lokal config/test.

### MEDIA-01 — filväljaren lovar format servern avvisar

- P2. Galleri och profil använder `accept="image/*"`, men gateway tillåter endast JPEG/PNG/WebP/AVIF/HEIC/HEIF. GIF/BMP/TIFF kan väljas och laddas upp för att sedan få generiskt fel: `src/admin/views/AboutView.tsx:324-334`, `src/admin/views/ProfileView.tsx:145-155`, `supabase/functions/upload-image/index.ts:16-25,238-240`.
- Startsidelogotyp har redan rätt explicit accept-lista. Reuse samma sträng i alla tre.
- Galleri-alt saknar UI `maxLength`; servern avvisar >2000 efter upload. Lägg `maxLength={2000}`.
- FIXAD lokalt. Galleri och profil använder gatewayns exakta MIME-lista. Galleri-alt stoppar vid 2000 tecken. Browser-DOM verifierad.

## Kvalitet / förenkling

- `SiteView.tsx` 890 rader, `BarbersView.tsx` 826, `ScheduleDayGrid.tsx` 726, `BookingsView.tsx` 712, `MailView.tsx` 581. Hög ändringsrisk. Dela orchestration/state från sektioner först när respektive bug fixas; ingen ren filflytt.
- `galleryAdmin.ts`, `barberPhotoAdmin.ts`, `homepageLogoAdmin.ts` duplicerar gateway-statusmappning och public URL. En gemensam liten mediahjälpare kan minska ~35–50 rader. Gör endast tillsammans med mediaändring.
- `textOrDefault()` finns två gånger i `src/site/business.ts` och `src/site/siteChrome.ts`. Exportera/reuse en implementation; cirka -3 rader.

## Live advisor

- `auth_leaked_password_protection`: WARN. Redan känt #27; användaren accepterade Free-plan-risk. Inte nytt fynd.
- Policy-lösa interna tabeller: INFO. Avsiktligt RLS-deny + service-RPC.
- SECURITY DEFINER-varningar: granskade scope-funktioner har intern rollkontroll eller avsiktligt publik whitelist. Inget verifierat privilege bypass i detta spår.
- Performance: flera permissive owner/own policies + oanvända index. Låg datamängd; mät före schemaomskrivning.

## Gap

- Deployed auth/media-källparitet inte fullständigt bevisad. `upload-image` kunde inte hämtas via connector; inventory visar ACTIVE v20, JWT på.
- Riktig bildpixelkedja testad av repo-runtime tester, men ingen ny live upload gjord.
- Riktig Auth delivery/acceptance saknar stagingkonto. Resend-listan visar inga recovery/invite/e-postbyte bland senaste 31.

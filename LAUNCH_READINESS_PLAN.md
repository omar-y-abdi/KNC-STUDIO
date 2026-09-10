# Blade & Blend Studio — launch readiness

**Statusdatum:** 2026-08-23

> **Historisk planbild.** Checklistan och verifieringen nedan är från 2026-08-23. Aktuell launchstatus
> finns i `docs/qa/2026-09-10-audit/pm.md`, `sol-platform.md` och agentloggarna. Behåll historiken; läs
> aktuell kod, migrationer, live config och CI innan någon operatörsåtgärd körs.

**Syfte:** verifierad handoff och körordning inför produktionssättning

**Kodstatus:** kodblockerarna från den adversariala launch-reviewn är implementerade. Aktuell head
måste passera CI och därefter de externa operatörsgrindarna innan go-live.

## Slutbedömning

Bokningsdata är serverauktoritativ. Kundens självservice kräver e-postbesittning via kundens aktuella
permanenta token och recensioner använder samma verifierade bokningsidentitet. Externa sidoeffekter
köas hållbart. Personalinloggning använder inbjudan,
bilduppladdning konverteras före Storage och CMS omfattar verksamhetsuppgifter och e-posttexter.

Produktion ska inte öppnas förrän aktuell head har passerat CI och checklistan **Externa
lanseringsgrindar** är genomförd. Återstående externa punkter kräver dashboard-, DNS-, juridik- eller
produktionsdataåtkomst och kan inte lösas enbart i repot.

## Levererat

### Bokning och kundflöden

- Databasen härleder behandlingens namn, pris och längd från aktiv tjänst.
- Kundens e-post och telefon sparas. **Mina bokningar** och avbokning kräver den aktuella permanenta,
  slumpmässiga tokenen som levereras till bokningens e-postadress. En ny länkbegäran använder bara
  e-post, roterar tokenen atomärt och ogiltigförklarar föregående länk. Telefon används inte som
  autentiseringshemlighet. Worker `/api/customer-bookings` binder origin, timestamp, IP och body med
  `CUSTOMER_GATEWAY_SECRET`; giltig åtkomst får en first-party HttpOnly `SameSite=Lax`-cookie. Ingen
  `sessionStorage`, `localStorage` eller telefon-minne ger åtkomst; cookies-disabled visar fallback.
- Bokningsmetoden använder `email` eller `phone`; SMS-semantik är borttagen.
- Länkbegäran och recension går via Edge Function med Turnstile och rate limit. Listning och
  avbokning kräver den e-postbundna permanenta tokenen; äldre engångslänkar stöds under migration.
- Bokning och avbokning skickar bekräftelse till både kund och barberare.
- Kundens länkmejl köas i samma hållbara external-action-ledger som övriga externa
  sidoeffekter. Edge- eller Resend-fel kan därför retryas i stället för att tappa länken efter ett
  lyckat publikt svar.
- Kundpåminnelse schemaläggs 24 timmar före besöket; bokningar gjorda närmare än 24 timmar får ingen
  påminnelse.
- Google Calendar create/update/delete är idempotenta och barberarspecifika. Create/update köas i
  bokningstransaktionen och retryas via external-action-ledgern. Den migration-ägda triggern är
  correctness-vägen; pensionerad Dashboard Database Webhook/`calendar-sync` är inte en dependency.
- En bekräftad bokning räknas som aktiv tills `end_at`; historikradering får inte radera ett pågående
  besök efter att `start_at` passerat.

### Auth och personal

- Admin skapar barberarkonto via unik e-postinbjudan; gemensamt `123456` används inte.
- Publik rosterstatus och kontoåtkomst är separata. Inaktiverad kontoåtkomst stoppar ett redan
  utfärdat JWT i databasens behörighetskontroller och synkas hållbart till Supabase Auth.
- Permanent barberarradering blockeras av pågående eller framtida bekräftade bokningar och väntar på
  Calendar- och Auth-rensning via samma hållbara outbox.
- Admin och barberare har **Inställningar/Settings** för e-post- och lösenordsbyte.
- E-postbyte bekräftas på nya adressen.
- Lösenordsbyte kräver nuvarande lösenord.
- Login-sidans tidigare lösenordsbyte är borttaget.

### E-post

- Avsändaradressen är `booking@mail.bladeblendstudio.se`.
- Premium HTML- och textmallar finns för bokning, avbokning, påminnelse, kundåtkomst och Auth-flöden.
- Admin kan redigera all generell kund- och barberarcopy under **Mejl/Mail**.
- Bokningsspecifik information och varumärkesstruktur är hardcoded för konsekvens och säkerhet.
- Boknings- och påminnelsemejl länkar med kundens permanenta slump-token direkt till **Mina
  bokningar**. Telefon och karta hämtas från CMS där mallen använder dem.
- Boknings-/avbokningsmejl och kundens secure-link har durable retry i databasen. Permanenta
  leveransfel stannar synligt för operatörsåtgärd i stället för att loopa obegränsat.

### CMS, webb och discovery

- Verksamhetsidentitet, kontaktuppgifter och SEO-data hanteras via CMS.
- ACP discovery publiceras inte innan ett konformt officiellt protokoll och faktisk boknings-/checkout-auktoritet finns.
- Google Calendar-information är inte användarsynlig på startsidan.
- Verifieringsmetadata finns utan synlig mellanlandningssida eller flash.
- Legacy SF Pro-filer är ersatta med öppet licensierade Inter och Playfair Display med licensfiler.

### Bilder och Storage

- Authenticated upload-gateway validerar roll och filtyp.
- ImageMagick WASM är versionspinnad och licensdokumenterad.
- Metadata tas bort, dimensioner begränsas och output konverteras till WebP.
- Max input, pixelantal och outputstorlek valideras server-side.
- Storage tar emot slutfilen först efter lyckad konvertering.

### Drift och säkerhet

- CI kör format, lint, typer, unit tests, build, Cloudflare dry-run, browser smoke, visual regression,
  Edge Function-check, pgTAP och adapterintegration.
- External-action-ledgern äger retry/reclaim för Storage-rensning, Calendar
  create/update/delete/disconnect, kundens secure-link-mejl och Auth-sidoeffekter som inte kan delta i
  PostgreSQL-transaktionen.
- Krypterad daglig databas- och Storage-backup omfattar migrationshistorik, samtliga standardbuckets,
  faktiska objektbytes, databasreferenser, `age`, SHA-256 och 30 dagars artifact-retention.
- Backupen accepterar både moderna `sb_secret_`-nycklar och legacy `service_role`-JWT utan att skicka
  moderna API-nycklar felaktigt som bearer-token.
- Public booking deployas med explicit expand → Edge → frontend → verify → contract-körordning.
- Restore-runbook finns i `docs/operations/BACKUP_RESTORE.md`.
- Raw `pg_dump` används inte eftersom Supabase-managed scheman annars ger restore-fel.

## Verifiering

Verifieringen från **2026-08-22** avsåg head före launch-review-fixarna den 23 augusti. Den är
historisk evidens, inte godkännande av aktuell head. Aktuell head ska passera samma CI-gates inklusive
de nya unit- och pgTAP-regressionerna innan deploy.

Senast verifierat före review-fixen:

- Prettier, ESLint och TypeScript: godkända 2026-08-22.
- Unit tests och adapterintegration: godkända 2026-08-22.
- pgTAP: godkänd 2026-08-22.
- Alla Edge Function-entrypoints: Deno type-check godkänd 2026-08-22.
- Produktionsbuild och Cloudflare deploy dry-run: godkända 2026-08-22.
- Browser smoke och visual regression 8/8: godkända 2026-08-22.
- Produktionsberoenden: 0 kända npm-sårbarheter 2026-08-22.
- Backupkryptering, Storage byte round-trip och restore drill: godkända 2026-08-22.
- Supabase advisors: 0 errors 2026-08-22.

Advisor-warnings gäller flera befintliga permissive RLS-policies. `btree_gist`-varningen har en
lokalt verifierad, separat migration och pgTAP-regressionstest som flyttar extensionen till
`extensions` utan att ändra `bookings_no_overlap`; den länkade databasen är fortfarande inte ändrad.

## Externa lanseringsgrindar

- [ ] Aktuell PR-head ska ha full grön CI efter launch-review-fixarna.
- [ ] Registrera företaget och fyll i juridiskt namn, organisationsnummer, integritetspolicy,
      villkor och avbokningspolicy.
- [ ] Rensa testbarberare, testbokningar och testrecensioner från produktionsprojektet.
- [ ] Följ `docs/operations/PUBLIC_BOOKING_GATEWAY_ROLLOUT.md` exakt: expand, Edge Functions,
      frontend, live verifiering och först därefter contract. Kör inte ett obegränsat `db push`.
- [ ] Sätt och verifiera produktionssecrets för Resend, Turnstile, Google OAuth, hash-salt,
      `CUSTOMER_GATEWAY_SECRET`, tillåtna publika origins och cron-anrop. Kör
      `npm run verify:production-secrets -- --project-ref <ref>`;
      inga secret-värden får ligga i GitHub-loggar eller repot.
- [ ] Verifiera Supabase Auth Site URL, redirect allowlist, signup-policy, custom SMTP och
      e-postmallar i dashboard.
- [ ] Verifiera Resend DKIM, SPF och DMARC för `mail.bladeblendstudio.se`; skicka seed-tester till
      Gmail, iCloud och Outlook från `booking@mail.bladeblendstudio.se`.
- [ ] I Google Cloud: använd exakt `https://www.googleapis.com/auth/calendar.events.owned`, slutför
      OAuth branding-verifiering och återanslut alla barberare med befintliga bredare Calendar-tokens.
      Testa sedan connect/disconnect/sync med riktig barberare.
- [ ] Lägg GitHub secrets `SUPABASE_DB_URL` och `SUPABASE_STORAGE_SECRET_KEY`, variables
      `SUPABASE_URL` och `BACKUP_AGE_RECIPIENT`; kör backup-workflow manuellt, verifiera objektantal
      och spara offline-nyckeln på två säkra platser.
- [ ] Verifiera Cloudflare DNS, TLS, DNSSEC, canonical redirect, Turnstile-domän och cache efter sista
      deployment.
- [ ] Kontrollera att produktionssidan är indexerbar medan eventuell staging fortsätter vara
      `noindex`.
- [ ] Genomför en riktig end-to-end-bokning, secure-link, recension, avbokning och 24h-påminnelse med
      kontrollerade mottagare innan externa kunder släpps in.

## Körordning nästa session

1. Skapa eller välj rent Supabase-produktionsprojekt.
2. Konfigurera Auth, SMTP, redirect-URL:er och secrets.
3. Vänta in full grön CI för aktuell head.
4. Genomför expand → Edge → frontend → verify → contract enligt public booking-runbooken.
5. Verifiera att external-action-, e-post- och påminnelse-Cron-jobb finns och att köerna dräneras.
6. Verifiera Cloudflare DNS/TLS/DNSSEC/Turnstile efter frontend-switch.
7. Kör GitHub-workflow **Encrypted production backup** manuellt.
8. Lägg in riktig verksamhetscopy via admin-CMS.
9. Kör full produktions-smoke med en markerad testbokning och kontrollera Calendar + secure-link
   retry-observability.
10. Radera smoke-data och öppna för trafik först när samtliga grindar är markerade.

## Kvarvarande accepterade risker

- Kundåtkomst är e-postbesittningsbaserad och permanent tills kunden begär en ny länk. En angripare
  med åtkomst till kundens inkorg eller aktuella bearer-länk kan få samma åtkomst tills tokenen
  roteras; länken ska därför behandlas som en credential.
- Supabase Free saknar SLA och managed backup. Krypterad export minskar datarisken men inte
  driftstoppsrisken.
- Resend Free har kapacitetsgränser. Övervaka leverans och uppgradera innan gränsen blir operativ
  risk.
- SPF, DKIM och DMARC förbättrar leveransbarhet men kan inte garantera att varje mottagare undviker
  skräppost.
- Databas och Storage saknar gemensam transaktion. Workflowen aborterar vid ändrade bildreferenser
  eller Storage-inventory, men första produktionsbackupen ska ändå köras i ett lugnt fönster.

## Go-live-kriterium

Go-live är godkänd först när aktuell head har full grön CI, alla externa lanseringsgrindar är klara,
en produktionsbokning har skapat korrekta kund- och barberarmejl, secure-link har levererats och gett
korrekt avgränsad kundåtkomst, gammal länk har avvisats efter rotation, recension har krävt samma
e-postbesittning, avbokning har bekräftats
till båda, Calendar-eventet har synkats via durable queue, backup-artifacten har skapats, Storage-bytes
har verifierats och inga personuppgifter förekommer i loggar.

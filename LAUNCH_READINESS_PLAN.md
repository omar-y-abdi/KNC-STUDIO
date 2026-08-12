# Blade & Blend Studio — launch readiness

**Statusdatum:** 2026-08-12

**Syfte:** verifierad handoff och körordning inför produktionssättning

**Kodstatus:** tekniskt redo för kontrollerad lansering efter externa operatörssteg

## Slutbedömning

Kritiska kodblockerare från tidigare granskning är åtgärdade. Bokningsdata är
serverauktoritativ, publika telefonflöden ligger bakom skyddade gateways, kund- och
barberarmejl finns, personalinloggning använder inbjudan, bilduppladdning konverteras före
Storage, CMS omfattar verksamhetsuppgifter och e-posttexter, och CI täcker frontend,
databas, Edge Functions och browserflöden.

Produktion ska inte öppnas förrän checklistan **Externa lanseringsgrindar** är genomförd.
Återstående punkter kräver dashboard-, DNS-, juridik- eller produktionsdataåtkomst och kan
inte lösas enbart i repot.

## Levererat

### Bokning och kundflöden

- Databasen härleder behandlingens namn, pris och längd från aktiv tjänst.
- Kundens e-post och telefon sparas; telefon är fortsatt åtkomstnyckel till **Mina bokningar**
  och recensioner.
- Bokningsmetoden använder `email` eller `phone`; SMS-semantik är borttagen.
- Lookup, avbokning och recension går via Edge Function med Turnstile, rate limit och
  generiska felsvar.
- Bokning och avbokning skickar bekräftelse till både kund och barberare.
- Kundpåminnelse schemaläggs 24 timmar före besöket; bokningar gjorda närmare än 24 timmar
  får ingen påminnelse.
- Google Calendar-synk är idempotent och barberarspecifik.

### Auth och personal

- Admin skapar barberarkonto via unik e-postinbjudan; gemensamt `123456` används inte.
- Admin och barberare har **Inställningar/Settings** för e-post- och lösenordsbyte.
- E-postbyte bekräftas på nya adressen.
- Lösenordsbyte kräver nuvarande lösenord.
- Login-sidans tidigare lösenordsbyte är borttaget.

### E-post

- Avsändaradressen är `booking@mail.bladeblendstudio.se`.
- Premium HTML- och textmallar finns för bokning, avbokning, påminnelse och Auth-flöden.
- Admin kan redigera all generell kund- och barberarcopy under **Mejl/Mail**.
- Bokningsspecifik information och varumärkesstruktur är hardcoded för konsekvens och säkerhet.
- Mejl länkar till `bladeblendstudio.se`, **Mina bokningar**, telefon och karta.

### CMS, webb och discovery

- Verksamhetsidentitet, kontaktuppgifter och SEO-data hanteras via CMS.
- ACP discovery publiceras på `/.well-known/acp.json`.
- Google Calendar-information är inte användarsynlig på startsidan.
- Verifieringsmetadata finns utan synlig mellanlandningssida eller flash.
- Legacy SF Pro-filer är ersatta med öppet licensierade Inter och Playfair Display med
  licensfiler.

### Bilder och Storage

- Authenticated upload-gateway validerar roll och filtyp.
- ImageMagick WASM är versionspinnad och licensdokumenterad.
- Metadata tas bort, dimensioner begränsas och output konverteras till WebP.
- Max input, pixelantal och outputstorlek valideras server-side.
- Storage tar emot slutfilen först efter lyckad konvertering.

### Drift och säkerhet

- CI kör format, lint, typer, unit tests, build, Cloudflare dry-run, browser smoke,
  visual regression, Edge Function-check, pgTAP och adapterintegration.
- Produktionsberoenden har noll kända npm-sårbarheter.
- Krypterad daglig databasbackup använder Supabase CLI-filter, `age`, intern checksumma och
  30 dagars artifact-retention.
- Restore-runbook finns i `docs/operations/BACKUP_RESTORE.md`.
- Raw `pg_dump` används inte eftersom Supabase-managed scheman annars ger restore-fel.

## Verifiering 2026-08-12

| Gate                      | Resultat                                                           |
| ------------------------- | ------------------------------------------------------------------ |
| Prettier                  | Godkänd                                                            |
| ESLint                    | Godkänd                                                            |
| TypeScript                | Godkänd                                                            |
| Unit tests                | 35 filer, 264 tester                                               |
| pgTAP                     | 33 filer, 413 assertions                                           |
| Adapterintegration        | 6 filer, 38 tester                                                 |
| Edge Functions            | Alla entrypoints klarar Deno type-check                            |
| Produktionsbuild          | Godkänd                                                            |
| Cloudflare deploy dry-run | Godkänd                                                            |
| Browser smoke             | Desktop, mobil, assets, bokning och discovery godkända             |
| Visual regression         | 8 av 8 vyer godkända                                               |
| npm audit production      | 0 sårbarheter                                                      |
| Backupkryptering          | Encrypt/decrypt round-trip godkänd                                 |
| Restore drill             | Ny tom lokal Supabase-instans; samtliga kontrollräkningar matchade |
| Supabase advisors         | 0 errors                                                           |

Advisor-warnings gäller flera befintliga permissive RLS-policies och att `btree_gist` ligger i
`public`. De är inte launch-blockerande, men kan optimeras separat efter lansering. RLS-beteendet
täcks av pgTAP och ska inte ändras utan nya regressionstester.

## Externa lanseringsgrindar

- [ ] Registrera företaget och fyll i juridiskt namn, organisationsnummer, integritetspolicy,
      villkor och avbokningspolicy.
- [ ] Rensa testbarberare, testbokningar och testrecensioner från produktionsprojektet.
- [ ] Kör samtliga migrationer mot produktion och deploya samtliga Edge Functions.
- [ ] Sätt och verifiera produktionssecrets för Resend, Turnstile, Google OAuth, hash-salt och
      cron-anrop. Inga secrets får ligga i GitHub-loggar eller repot.
- [ ] Verifiera Supabase Auth Site URL, redirect allowlist, signup-policy, custom SMTP och
      e-postmallar i dashboard.
- [ ] Verifiera Resend DKIM, SPF och DMARC för `mail.bladeblendstudio.se`; skicka seed-tester till
      Gmail, iCloud och Outlook från `booking@mail.bladeblendstudio.se`.
- [ ] Slutför Google OAuth branding-verifiering och testa Calendar connect/disconnect/sync med
      riktig barberare.
- [ ] Lägg GitHub secret `SUPABASE_DB_URL` och variable `BACKUP_AGE_RECIPIENT`; kör backup-workflow
      manuellt och spara offline-nyckeln på två säkra platser.
- [ ] Exportera Supabase Storage-object bytes separat. Databasbackupen innehåller metadata men inte
      bildfilerna.
- [ ] Verifiera Cloudflare DNS, TLS, DNSSEC, canonical redirect, Turnstile-domän och cache efter sista
      deployment.
- [ ] Kontrollera att produktionssidan är indexerbar medan eventuell staging fortsätter vara
      `noindex`.
- [ ] Genomför en riktig end-to-end-bokning, avbokning och 24h-påminnelse med kontrollerade
      mottagare innan externa kunder släpps in.

## Körordning nästa session

1. Skapa eller välj rent Supabase-produktionsprojekt.
2. Konfigurera Auth, SMTP, redirect-URL:er och secrets.
3. Kör `npx supabase db push` och deploya Edge Functions.
4. Konfigurera Cron för bokningspåminnelser och verifiera leveransloggar.
5. Deploya Cloudflare och verifiera DNS/TLS/DNSSEC/Turnstile.
6. Kör GitHub-workflow **Encrypted database backup** manuellt.
7. Lägg in riktig verksamhetscopy via admin-CMS.
8. Kör full produktions-smoke med en markerad testbokning.
9. Radera smoke-data och öppna för trafik först när samtliga grindar är markerade.

## Kvarvarande accepterade risker

- Telefonnummer är praktisk bokningsnyckel, inte stark autentisering. Turnstile och rate limit
  minskar missbruk men ersätter inte OTP.
- Supabase Free saknar SLA och managed backup. Krypterad export minskar datarisken men inte
  driftstoppsrisken.
- Resend Free har kapacitetsgränser. Övervaka leverans och uppgradera innan gränsen blir operativ
  risk.
- SPF, DKIM och DMARC förbättrar leveransbarhet men kan inte garantera att varje mottagare undviker
  skräppost.
- Storage-object bytes kräver separat export tills automatiserad objektbackup införs.

## Go-live-kriterium

Go-live är godkänd först när alla externa lanseringsgrindar är klara, en produktionsbokning har
skapat korrekta kund- och barberarmejl, avbokning har bekräftats till båda, Calendar-eventet har
synkats, backup-artifacten har skapats och inga personuppgifter förekommer i loggar.

# Lanseringsproblem — 10 september

Status: PR58-granskning F1–F7 rättad lokalt, solo. Ny CI-grind återstår; äldre grönt gäller tidigare kod. Produktion oförändrad. Nio samlade problem nedan.

## 1. Kundlänk, återbesök och kunduppgifter — akut

**Problem:** giltiga mejllänkar nekas. Gammal cookie kan vinna över ny länk. Mobilwebbläsare kan blockera sessionscookien. Samtidig länkrotation kan lämna gammal session giltig; tokenreparation kan skriva över nyare länk. Återbesök återställer inte kundåtkomst korrekt.

**Fixat lokalt:** länken kontrolleras rätt; ny länk väljer rätt kund; cookie på sajtens egen domän; gammal åtkomst stängs när ny länk begärs; reparation kan inte ersätta nyare länk; återbesök; tydligt cookie-/laddningsfel; kundbyte ersätter orörda autofyllda uppgifter; verkliga ändringar bevaras även när fältet tömts. Barberarnamn följer bokningen även när barberaren inaktiverats.

**Verifierat:** faktisk HTTPS Worker → Edge → DB i Chromium, Firefox och WebKit; mobil/desktop, accepterad/blockerad cookie, lyckad autofill, kundbyte och rotation. Fem överlappande DB-fall kontrollerar riktiga lås och slutdata. Körbart i repo/CI.

**Kvar:** samordnad driftsättning enligt planen. Grön PR/CI krävs före release. Permanenta slumpmässiga rotlänkar bevaras.

## 2. Admin tappar ändringar eller visar fel barberares data — viktigt

**Problem:** långsam sparning kan skriva över ny text. Byte A → B → A kan tappa pågående sparning. CMS/galleri kunde ändras innan startdata laddats.

**Fixat lokalt:** bekräftade race i CMS/mejl/tjänster/bokningar/profilbilder. Läsning och skrivning körs i ordning per resurs, även efter vybyte. CMS/galleri spärras tills startdata lyckats; teckenstorlek visar pågående sparning/fel.

**Verifierat:** aktuell repo-svit: 20 browserscenarier för admin/autofill/reveal. Testerna kontrollerar sparat pris, bild och bokningsstatus efter vybyte, återmontering och fel. Äldre 25-/tmp-fall ersätter inte denna grind. Ingen designändring.

## 3. Bokningsknappar, tangentbord och bilddrag fungerar inte pålitligt — viktigt

**Problem:** Boka tid kan öppna formuläret utanför skärmen. Dold bokningspanel kan fortfarande få tangentbordsfokus. Otillgängliga datum ser spärrade ut men är inte korrekt spärrade/namngivna. Galleribilder startar webbläsarens egen dragfunktion mitt i sajtens draggest.

**Fixat lokalt:** visning, fokus och datumknappar. Reveal väntar även på verklig barberarkatalog; långsam laddning testad i både vanlig sida och CMS-scrollruta. Inbyggd bilddragning avstängd i galleriet. Befintlig design behålls.

**Verifierat:** kall sidladdning, små laptopskärmar, minskad rörelse och andra bokningen. Tangentbord, valt datum, återöppning och CMS-förhandsvisning verifierade. Galleritest med laddad bild: fångar dragfelet före fix; grönt efter fix.

## 4. Integritetsrutan täcker mobilens knappar — feedback

**Problem:** på 320–390 px bred mobil täcker rutan Boka tid/Mina bokningar. Nuvarande valfria lagringsval beskriver främst lagring av själva valet; kundsessionen är nödvändig lagring.

**Förslag:** förenkla text/val och placera rutan så bokningsknappar förblir nåbara.

**Din prioritet:** `[ ] Före presentation  [ ] Senare`

**Din feedback:**

## 5. Drift saknar viktiga lanseringsdelar — blockerar launch

- **Backup:** senaste tio körningar misslyckas. `SUPABASE_DB_URL` saknas. Du har tidigare sagt att du lägger den inför launch.
- **CMS/SEO:** Worker saknar `SUPABASE_ANON_KEY`. Dynamisk metadata faller tillbaka; cache uteblir.
- **Calendar:** pensionerad `calendar-sync` finns kvar live. Kontrollera sista anrop, ta bort enligt driftplan.
- **Kundfix:** samma `CUSTOMER_GATEWAY_SECRET` krävs i Worker och Edge; skyddar kundens IP/rate limits.

**Fixat lokalt:** driftmanualens motsägande Calendar-kommandon rättade.

**Driftplan:** [Exakta steg och kontrollpunkter](../operations/CUSTOMER_ACCESS_REPAIR_2026-09-10.md).

**Din prioritet:** `[ ] Kör granskad driftplan före presentation  [ ] Vänta`

**Din feedback:**

## 6. CMS kan visa gamla standarduppgifter vid fel — feedback

**Problem:** om CMS är långsamt/nere kan gammalt hårdkodat namn, telefon eller adress visas. Livevärden matchar idag; framtida ändringar riskerar bli fel.

**Val:** visa senast verifierade uppgifter, eller tydligt tomt/otillgängligt läge.

**Din prioritet:** `[ ] Före presentation  [ ] Senare`

**Din feedback:**

## 7. Säkerhets- och underhållsytan behöver städas — feedback

- `admin_create_booking` har onödig anonym anropsrätt. Intern behörighetskontroll stoppar bokning; ingen anonym bokning bevisad.
- Bygg-/testverktyg har 9 kända säkerhetsfynd (5 höga, 4 måttliga). Sajten har inga kända fynd i sina runtimeberoenden. Uppgradera i separata verifierade steg.
- CI använder äldre Actions-runtime. GitHub växlar den automatiskt; uppgradera Actions vid verktygsstädning.
- **Rättat i PR58:** Wrangler + Worker-typer uppgraderade till kompatibla låsta versioner. Installerad Worker startar nu i repo-gaten.
- Avstängt personalkonto lämnar redan hämtad kunddata synlig i öppen flik. Nya DB-anrop nekas. Välj när fliken ska låsas/rensas.
- Turnstile saknar kontroll av hostname/action och timeout på vissa anrop. Härdning behöver matcha live- och testmiljö.
- `.env` innehåller bara publika värden idag men är versionshanterad. Föreslagen hygien: `.env.example` + lokal konfiguration.
- Överlappande DB-policyer och stora adminfiler försvårar underhåll. Ingen visad prestandavinst för större omskrivning ännu.
- Kalenderexport saknar standardens radvikning för långa texter.

**Din prioritet:** `[ ] Före presentation  [ ] Endast tydliga risker nu  [ ] Senare`

**Din feedback:**

## 8. Verifiering och dokumentation har luckor — måste följas upp

**Problem:** hundratals gröna tester missade trasiga kundlänken. Flera dokument beskriver borttagen kod som aktuell. Ignorerade äldre mejl-/SMS-planer beskriver andra lösningar; aktuell arkitektur måste styra nya ändringar. Riktig Auth-mejlresa, Calendar-koppling och backup/restore saknar ny fullständig liveverifiering.

**Fixat lokalt:** gammal oanvänd mock-logik och tomma lagringsfunktioner borttagna. Aktuella RPC-pekare rättade. Vite dev/preview har dokumenterad lokal Worker-transport; kundbrowser- och DB-racetester finns nu i befintliga repo-filer och CI. Kontrollerade liveprov kräver separat, konkret godkännande.

**Fixat efter hookgranskning:** gamla repoassertioner uppdaterade. Befintliga integrationstester kör nu riktiga Worker → Edge → DB, inklusive kundbyte, återbesök och länkrotation. CI återställer aktuellt schema efter historiska migreringstester.

**CI-häng rättat:** fasdiagnos pekade på galleriets musdrag. Samtidig inbyggd bilddragning reproducerad och fixad; nytt test fångar felet. Mus/CDP/cleanup har tidsgränser och tydliga fel. Hela CI passerar efter fix. Exakt ursprungligt häng kunde inte återskapas lokalt.

**Granskningsrättelse:** gammalt autofill-test saknade obligatoriskt sessionbevis och kunde passera utan hydrering. Det gamla resultatet är återkallat. Aktuella tester kräver faktiskt fyllda kundfält och rätt kund efter byte.

**Testfiler:** befintliga repo-filer uppdaterade; fristående nya QA-harness ligger kvar i `/tmp` enligt instruktion.

**Din feedback:**

## 9. Recension blockeras efter telefonbyte — feedback

**Problem:** kund har genomfört besök, byter nummer vid nästa bokning. Giltig mejllänk fungerar, men recension av gamla besöket nekas. Båda telefonnumren nekas. Reproducerat mot lokal DB.

**Val:** låt verifierad mejladress koppla även äldre besök till recension, eller behåll dagens krav på samma telefonnummer. Behörighetsregel ändras först efter ditt val.

**Din prioritet:** `[ ] Rätta före presentation  [ ] Behåll regeln  [ ] Senare`

**Din feedback:**

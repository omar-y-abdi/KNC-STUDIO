# Launch — fixar och kvarvarande fel

Aktuell PR följer mergad PR58. Lokal fix betyder inte publicerad fix.
Användaren bad frysa nya granskningsspår och färdigställa påbörjat arbete.

## Fixat i denna PR

| Problem                                                                                     | Fix                                                                                                                                                                  |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P0: mejllänk nekas trots tillåtna cookies.**                                              | Servern blandade ihop två cookies. Kundcookie skickas nu separat; främmande cookie filtreras bort.                                                                   |
| Ny kund måste hitta mejlet för att se ny bokning.                                           | Godkänd valfri lagring ger direkt åtkomst till exakt nya bokningar. Tidigare historik kräver mejlbevis.                                                              |
| Integritetslayout missförstods.                                                             | Godkänn/avvisa ligger fast längst ned över hela sidan. Liten återöppningsknapp endast hero; About får länk.                                                          |
| Admin kunde visa gammal kunddata eller skicka väntande ändring med nästa kontos inloggning. | Avstängning rensar skyddad vy. Köer och anrop binds till rätt konto. Sena lösenordssvar får inte återställa gammal session.                                          |
| Backup gick inte att återställa korrekt.                                                    | Exakt migrationsschema följer med; saknad Storage-bucket hanteras rätt; befintlig återställning kan kontrolleras utan att skriva. Full separat återställning provad. |
| Snabb bokning skickade före färdig säkerhetskontroll. Misslyckad laddning kunde fastna.     | Submit väntar på token; kontrollen kan laddas om. Servern kontrollerar domän/åtgärd och har timeout.                                                                 |
| Dubblerad bildfelhantering och felaktig radbrytning i kalenderfiler.                        | Gemensam bildstatushantering; ICS följer UTF-8-gränsen.                                                                                                              |

## Kvar — inte löst av denna PR

| Samlat arbete                                                                                                                                | Nästa steg                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| **Produktionsverifiering.** Nya fixar ännu inte live; Gmail/admin/Google Calendar-resan inte färdigprovad.                                   | Följ releaseordning, invänta gröna deploys, kör egen testbokning och verifiera faktisk inbox/länk/avbokning. Adminfliken kräver inloggning.    |
| **Daglig backup.** GitHub saknar `SUPABASE_DB_URL`.                                                                                          | Ägaren lägger permanent anslutning i GitHub Secrets. Kör workflow och kontrollera krypterat arkiv. Privat backupnyckel stannar utanför GitHub. |
| **Flera mejladresser i samma kundprofil.** Telefon kan fortfarande inte koppla ihop historik.                                                | Bygg verifierad mejlkoppling enligt beslutad mejl-före-telefon-regel. Denna PR inför bara säker enhetsåtkomst.                                 |
| **Gammal Calendar-funktion.** Ny kö är kopplad; gammal deployment finns kvar.                                                                | Bevisa live create/update/cancel och kontrollera sista gamla anropet; radera därefter gamla deploymenten.                                      |
| **Återstående städning.** Onödiga DB-grants/policydubletter,9 utvecklingsberoendevarningar, Actions-uppdatering, env-/CMS-fallback återstår. | Samlat nästa kodpaket. Inga oanvända index raderas enbart på rådgivarstatistik.                                                                |

Testnamn/priser i salongens katalog är avsiktliga enligt tidigare skriftlig feedback. Ägaren lämnar
slutliga uppgifter när funktionerna är klara; de ersätts inte med påhittade salongsdata.

## Din feedback

- **Äldre separata mejlhistoriker:** får kunden uttryckligen förena dem efter verifiering av båda
  mejladresserna, eller ska koppling bara tillåtas till helt ny mejladress?
  **Svar:**
- **CMS vid driftfel:** behåll senast verifierade verksamhetsuppgifter, eller visa otillgängligt?
  **Svar:**
- **Admin/liveprov:** logga in i öppnad Chrome-adminflik. **Klart:**
- **Backup:** lägg `SUPABASE_DB_URL` i GitHub Secrets; skicka inget lösenord i dokumentet. **Klart:**

Beslut som redan är godkända frågas inte om igen: mejladress vinner telefonkonflikt; telefon ensam
ger aldrig historik; ändrad telefon för samma mejl behåller historiken; bannerplacering enligt ovan.

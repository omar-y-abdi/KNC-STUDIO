# Kundidentitet — genomförande

Godkänd regel: mejl styr historik. Telefon är kontaktuppgift, aldrig ägarbevis.

## Beteende

- Samma mejl + ändrat nummer: samma profil, tidigare och nya bokningar.
- Annat mejl + upptaget nummer: separat profil tills båda mejladresserna verifierats.
- Kunden kan i Mina bokningar välja ”Koppla en mejladress”. Kräver verifierad mejlsession; enhetskvitto räcker inte.
- Färska verifieringsmejl till BÅDA adresserna beskriver uttryckligen att bokningshistoriken kopplas samman. En gammal eller stulen session ensam får inte skapa beständig åtkomst via ett nytt mejl.
- Länken öppnar bekräftelseruta. Ingen ändring vid mejlscanner/GET. Kunden bekräftar i webbläsare med fortfarande giltig session för ursprungsadressen.
- Båda adressers gamla och framtida bokningar hör därefter till samma profil. Alla ursprungliga mejladresser/nummer ligger kvar på sina bokningar.
- Kopplingen får inte flytta, radera eller ändra bokningar. Telefonmatchning startar aldrig automatisk sammanslagning.

## Minsta nödvändiga datamodell

- `customer_profiles`: id + versionsnummer för kopplingskonflikter.
- `customer_profile_emails`: unik normaliserad mejladress → profil. Befintliga adresser börjar i varsin profil. Nya bokningsadresser får egen profil.
- `customer_email_links`: två hashade engångsnycklar med krypterade motsvarigheter, separata bekräftelsetider, käll-/målmejl, deras profilversioner och BÅDA credential-generationerna; 30 min giltighet. Ett aktivt försök per källmejl.
- Telefonnummer härleds från profilens bokningar; inget globalt unikt telefonregister.
- Befintliga permanenta mejllänkar och HttpOnly-sessioner bevaras. Servern slår upp profilens verifierade adresser vid läsning/avbokning/omdöme.
- Befintlig outbox återanvänds för verifieringsmejl, med separat event och idempotensnyckel. Aldrig rånyckel i jobbpayload/loggar.

## Servergränser

- Start: aktuell full session + CSRF/samma-origin-gateway + rate limit. Inga frågor om måladressens bokningshistorik i svaret.
- Bekräfta: engångsnyckel + aktuell session för exakt källmejl; deterministiska profillås och versionskontroll. Båda färska mejlbevis krävs. Ny giltig cookie för samma källmejl tillåts; det är mejlidentitet/generation, inte cookieinstans, som binds. Ett redan bekräftat delbevis får idempotent waiting; slutförd/utgången/ersatt koppling avvisas. Rotation på endera adress eller ändrad profil avslår utan ändrad historik.
- Merge omfattar båda gruppernas alla mejladresser atomärt. Andra väntande försök för grupperna ogiltigförklaras; inga splittrade eller automatiskt omriktade grupper.
- Fel kund i webbläsaren: avslag, inte automatisk kontoväxling eller profilflytt.
- Enhetskvitton behåller sitt ursprungliga bokningsscope. Koppling får aldrig bredda oidentifierad enhetsåtkomst.
- Nya tabeller: RLS, inga browsergrants. Smala service-RPC:er; private helpers saknar publik EXECUTE.

## Bevis före leverans

pgTAP: samma mejl/två nummer; två mejl/samma nummer isolerade; korrekt dubbelbevis kopplar; gammal/ny historik; list/cancel/review samma gräns; fel session; utgång; replay; tokenrotation; samtidiga konkurrerande kopplingar; anon/authenticated saknar direktåtkomst.

Edge/browser: parsning, same-origin, rate limit, krypterat outboxbrev, explicit knapp, fel konto får begriplig återhämtning, lyckad koppling uppdaterar Mina bokningar. Produktion: endast ägarens godkända testadress/alias, alla testbokningar avbokas.

Ordning: partner granskar denna gräns → lokal migration/Edge/UI → regressionsprov → migrations- och releaseinstruktioner → PR.

# Parallell CMS-introduktion och senare rensning

## Gällande leveranskrav

Den nya ingången **Redigering** öppnar `/admin/cms/` för ett autentiserat, aktiverat ägarkonto. Samtliga gamla adminflikar, deras befintliga URL-parametrar, vyer, behörigheter och adaptrar ska finnas kvar under introduktionen. De får inte döljas eller ersättas med omdirigeringar. Schema, bokningar, tjänster, inställningar och personalens befintliga självservice ska fortsätta fungera som tidigare.

Detta tillägg ersätter den tidigare implementationsplanens idé om att samtidigt minska ägarens meny till sex ingångar. Den menyrensningen är uppskjuten. Denna fil är en instruktion för en senare, uttryckligen godkänd rensning, inte ett tillstånd att genomföra den nu. Inga produktionsdata ska återställas eller raderas när redigeraren introduceras.

## Samtidig användning

De gamla innehållsvyerna och den nya studion använder samma befintliga innehållstabeller. Studion ska läsa aktuella värden när den öppnas. Publicering måste jämföra både CMS-revisionen och innehållets fingerprint; en ändring från den gamla redigeraren får inte skrivas över av ett äldre studioutkast. Konflikten ska visas, båda versionerna ska kunna granskas och ett lokalt utkast ska bevaras. Ändringar i studion är utkast tills Publicera används; omedelbara personal-/kontoåtgärder får inte presenteras som ångringsbara utkast.

Publicera inte ett gammalt utkast för att återskapa en borttagen personalidentitet. Historik får återställa presentation, inte bokningar, konton, tjänster eller autentiseringsuppgifter. Bilder som används i publicerat innehåll eller behållen historik måste finnas kvar även när äldre bildverktyg används. Detta måste verifieras i integrationstester; enbart kvarvarande menyknappar är inte tillräckligt.

## Godkännandekrav före rensning

1. Kör den ordinarie CI-kedjan och de nya CMS-testerna från en ren checkout. Verifiera Chromium, Firefox och WebKit samt ägar-, barberar-, utloggade och tvingat-lösenordsbyte-fallen.
2. Kontrollera alla gamla adminflikar innan och efter installationen: schema, egna bokningar, tjänster, profil, alla bokningar, barberare, startsida, om oss, mejl och inställningar. Kontrollera även deras direktlänkar och sparad scrollposition.
3. Jämför den gamla och nya redigeringen fält för fält: båda språk, båda teman, logotyp, företagsuppgifter, sidtexter, galleri/alternativtexter, profiler, samtliga mejlmallar och felhantering för leveranser. Kontrollera verklig publicering, omladdning och publik visning, inte bara preview.
4. Prova korsvisa konflikter: öppna studion, spara en text i en gammal vy och försök därefter publicera studioutkastet. Ingen tyst överskrivning tillåts. Kontrollera även samtidig publicering och förlorat nätverkssvar.
5. Kontrollera nya sidor med direkt URL, HEAD, metadata, meny, borttagning och 404. Boknings-, kund-, auth- och adminadresser får aldrig kunna ersättas av en innehållssida.
6. Godkänn resultatet manuellt med ägarkontot. Ta databas- och mediebackup och genomför ett återställningsprov i en isolerad miljö innan någon destruktiv förändring övervägs.

## Senare rensning — separat ändring efter godkännande

- Ändra ägarens navigation i `src/admin/AdminShell.tsx` till Redigering, Mitt schema, Mina bokningar, Tjänster, Alla bokningar och Inställningar. Behåll barberarens behöriga profil-/självserviceflöde.
- Inventera importerna innan `SiteView.tsx`, `AboutView.tsx` och `MailView.tsx` tas bort. Ta inte bort hjälpfunktioner som studion eller operativa vyer fortfarande använder.
- `BarbersView.tsx` och `ProfileView.tsx` innehåller mer än sidtexter. Kontoinbjudan, kontostatus, behörigheter, kalenderkopplingar och personalens egen profil måste ha verifierade ersättare innan en vy tas bort.
- Bevara gamla direktlänkar via tydlig kompatibilitetshantering först när motsvarande funktion verkligen finns i studion. Ta inte bort URL-hantering i `navigationState.ts` utan regressionstester.
- Radera endast adaptrar efter en fullständig referenssökning. Befintliga tabeller och funktioner för mejlleverans, bokningar, personal, gallerier och företagsuppgifter ska inte tas bort bara för att deras äldre formulär försvinner.
- Ta bort döda importer, stilar och tester som endast hör till faktiskt borttagna vyer. Ersätt funktionskontrollerna med tester mot studion; sänk inte verifieringskraven.
- Leverera rensningen som en separat commit/PR med exakt lista över borttagna filer och ett verifierat återgångsförfarande. CMS-introduktionen ska kunna behållas oberoende av denna rensning.

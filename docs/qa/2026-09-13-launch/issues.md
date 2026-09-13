# Samlade launchfel — 13 september

Endast fel och åtgärder. Relaterade fynd samlade. Produktion och PR skiljs åt.

| Fel                                                                                                  | Åtgärd / läge                                                                                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P0: Mina bokningar kunde inte öppnas från mejl.**                                                  | Tidigare cookie-/gatewayfix live. Riktigt Gmail-klick fungerar; ny bokning syns direkt med godkänd lagring. Chromium, Firefox, WebKit gröna. Fysisk iPhone inte omprovad.                                           |
| **P0: mejl och kalenderjobb fastnade. Bortkoppling visade gammal status.**                           | Serverjobb får tillräcklig körtid och hållbara återförsök. Gmail + alla fyra Google-händelser bevisade; egen avbokning tog bort rätt händelse. Statusuppdatering ingår i PR. Gammal kalenderfunktion borttagen.     |
| **Kunduppgifter kunde inte säkert samla flera mejladresser.**                                        | Verifiera båda adresserna, samla deras historik. Telefon ensam kopplar aldrig personer. Backend live; kundknappar i PR. Konflikter och samtidiga ändringar testade.                                                 |
| **Öppettider hamnade längst ned på hela sidan. Cookiekontroller och smala dialoger behövde rättas.** | Öppettider vid hero-botten. Godkänn/avvisa fast i botten överallt; liten återöppning bara hero samt Om oss-länk. Kontrast, rörelse, tangentbord och långa mejladresser rättade i PR.                                |
| **Saknade eller felaktiga siduppgifter, felsida och juridiskt innehåll.**                            | 404 med rätt status, sidunika metadata, läsbar källa, canonical, sitemap/llms, verksamhetsschema, villkor/integritet. CMS får juridiskt namn/organisationsnummer. Klienten fyller riktiga uppgifter. Frontend i PR. |
| **Backup kunde inte köras.**                                                                         | Nytt DB-lösenord enligt godkännande. GitHub-hemlighet satt. Riktig krypterad backup grön; checksumma, dekryptering och innehåll kontrollerade. Dagligt schema finns.                                                |
| **Galleri visade falska bilder vid tomt innehåll; alt-texter kunde saknas.**                         | Ärliga laddnings-/tom-/felläge, inga falska klickytor, korrekta alt-texter. PR.                                                                                                                                     |
| **Överflödig kod, privilegier och sköra testantaganden.**                                            | Oanvända hjälpare/scheman/exports borttagna. Privata DB-rättigheter åtstramade. Beroendevarningar rättade. Testfixturer följer verkliga avbokningsregler och CMS-kontrakt.                                          |

## Återstår före överlämning

- Merge av färdig PR; kontrollera main-CI och Cloudflaredeploy för samma commit.
- Klienten fyller slutliga CMS-uppgifter och tjänster inför publik lansering.

## Din feedback

Inget ytterligare designbeslut eller svar krävs för dessa fixar.
Eventuella nya önskemål kan skrivas nedan; de ändrar inte redan godkända kund-/cookiegränser.

- Feedback:
- Prioritet:

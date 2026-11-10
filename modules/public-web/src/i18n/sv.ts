import type { CalendarLabels } from './index'

// Swedish strings. These tables define the keys of the string types in index.ts.

export const bookingSv = {
  chooseBarber: 'Välj din barberare',
  loadingBarbers: 'Laddar barberare …',
  noBarbers: 'Inga barberare är tillgängliga för bokning just nu.',
  chooseDate: 'Välj en dag',
  previousMonth: 'Föregående månad',
  nextMonth: 'Nästa månad',
  dateUnavailable: 'Ej bokningsbar',
  chooseTime: 'Välj en tid',
  chooseService: 'Välj behandling',
  loadingServices: 'Laddar behandlingar …',
  noServices: 'Barberaren har inga aktiva behandlingar den valda dagen.',
  pickDayForService: 'Välj en dag i kalendern för att se behandlingar.',
  pickServiceForTime: 'Välj en behandling för att se lediga tider.',
  /** Shown in the time column while real availability is loading from the backend. */
  loadingTimes: 'Laddar tider …',
  /** Shown in the time column when a barber+date+service is chosen but no bookable times remain
   * (barber off/on time-off, fully booked, or — for the backend — a read error; fail-closed). */
  noSlots: 'Inga lediga tider den här dagen. Välj en annan dag.',
  legendChosen: 'Vald',
  legendClosed: 'Stängt / upptaget',
  yourDetails: 'Dina uppgifter',
  summary: 'Din bokning',
  fBarber: 'Barberare',
  fWhen: 'Tid',
  fService: 'Behandling',
  fTotal: 'Att betala',
  name: 'Namn',
  namePh: 'För- och efternamn',
  phone: 'Telefon',
  phonePh: '07X XXX XX XX',
  email: 'E-post',
  emailPh: 'namn@exempel.se',
  book: 'Boka tid',
  termsLink: 'Läs bokningsvillkoren',
  termsLinkLabel: 'Läs bokningsvillkoren (öppnas i ny flik)',
  policy:
    'Vid bokning accepterar du att avbokning måste ske senast {hours} timmar före besöket. Sen avbokning eller utebliven tid ger {businessName} rätt att debitera för den bokade tiden.',
  bookedTitle: 'Tack — din tid är bokad!',
  /** Confirmation sentence template. `{email}` and legacy `{phone}` tokens are interpolated. */
  confirmSent:
    'En bokningsbekräftelse har skickats till {email}. Hantera bokningen via en säker länk under "Mina bokningar".',
  addToCal: 'Lägg till i kalender',
  calApple: 'Apple Kalender',
  calGoogle: 'Google Kalender',
  directions: 'Vägbeskrivning till salongen',
  newBooking: 'Boka en ny tid',
  min: 'min',
  errName: 'Namnet är för långt',
  errPhone: 'Ogiltigt telefonnummer',
  errEmail: 'Ogiltig e-postadress',
  errSubmit: 'Något gick fel. Försök igen.',
  /** Gateway rejection: too many booking attempts (per-IP/phone backstop). */
  errRateLimited: 'För många bokningsförsök. Vänta en stund och försök igen.',
  /** Gateway rejection: the Turnstile human-verification challenge failed. */
  errChallenge: 'Vi kunde inte verifiera att du är en människa. Ladda om sidan och försök igen.',
}

export const appSv = {
  findUs: 'Hitta oss',
  book: 'Boka tid',
  /** Secondary hero action next to/under "Boka tid" — opens the Mina bokningar popup. */
  myBookings: 'Mina bokningar',
  kicker: 'BARBERSHOP · GÖTEBORG',
  hours: 'Öppet Mån–Lör 09–18 · Sön stängt',
  addr: 'Geijersgatan 10, 411 34 Göteborg',
  ariaTheme: 'Växla ljust/mörkt',
  ariaBackHome: 'Till startsidan',
  ariaCall: 'Ring',
  /** Underlined hero links added under the "Boka tid" button. */
  aboutLink: 'Om oss',
  cancelLink: 'Avbokning',
  lazyBookingLoading: 'Laddar bokning …',
  lazyBookingError: 'Kunde inte ladda bokningen.',
  lazyMyBookingsError: 'Kunde inte ladda bokningarna.',
  lazyReload: 'Ladda om',
}

export const privacySv = {
  title: 'Integritet och lagring',
  lead: 'Välj om den här enheten får minnas de bokningar du gör här. Vi använder inga analys- eller annonscookies.',
  privacyLink: 'Läs integritetspolicyn',
  accept: 'Godkänn valfri lagring',
  reject: 'Avvisa valfri lagring',
  preferences: 'Inställningar',
  save: 'Spara val',
  functionalTitle: 'Valfri lagring',
  functionalLead:
    'Ger åtkomst till nya bokningar på den här enheten och fyller i kontaktuppgifter från din senaste bokning här. Äldre bokningar kräver din mejllänk.',
  necessary:
    'Efter giltig e-postlänk används en nödvändig, säker sessionscookie för att hålla dig inloggad. Utan cookies kan Mina bokningar inte logga in automatiskt.',
  manage: 'Integritet',
  manageLabel: 'Hantera integritetsinställningar',
}

export const aboutSv = {
  /** Static legal links at the bottom of the About section. */
  termsLink: 'Villkor',
  privacyLink: 'Integritetspolicy',
  /** Section eyebrow + heading + intro paragraph. */
  eyebrow: 'OM OSS',
  heading: 'Hantverk, inte bara en klippning',
  intro:
    'Vi tar oss tid med varje besök — ren fade, skarpa kanter och ett skägg som sitter. Lugn lokal, bra musik och barberare som kan sitt yrke.',
  /** Salon photo gallery. */
  galleryTitle: 'I salongen',
  galleryAlt: 'Bild från salongen',
  galleryLoading: 'Hämtar bilder …',
  galleryEmpty: 'Inga bilder publicerade ännu.',
  galleryUnavailable: 'Bilderna kan inte hämtas just nu.',
  /** Stylists block. */
  stylistsTitle: 'Barberarna',
  /** Customer-cuts gallery. */
  cutsTitle: 'Jobb vi gjort',
  cutsAlt: 'Kundklippning',
  /** Reviews require a device receipt or a verified session for a finished booking; phone is a
   * scope cross-check. The name is derived server-side from that booking ("Förnamn E."), so the
   * form asks for the phone, not a name. */
  reviewsTitle: 'Omdömen',
  reviewsLoading: 'Hämtar publicerade omdömen …',
  reviewsEmpty: 'Inga publicerade omdömen ännu.',
  reviewsUnavailable: 'Omdömen kan inte hämtas just nu.',
  /** Review page row: `aria-label` of the row, of a page button (`{n}` is replaced) and of the
   * arrows that move the row to earlier or later page numbers. */
  reviewPagesLabel: 'Sidor med omdömen',
  reviewPageLabel: 'Sida {n}',
  reviewPagesPrevious: 'Föregående sidor',
  reviewPagesNext: 'Fler sidor',
  reviewPhone: 'Telefonnummer',
  reviewPhonePh: '07X XXX XX XX',
  /** Helper line under the phone field explaining the gate + derived name. */
  reviewPhoneHint:
    'Ange numret du bokade med. Ditt namn hämtas från bokningen och visas som förnamn + initial.',
  reviewRating: 'Betyg',
  reviewText: 'Ditt omdöme',
  reviewTextPh: 'Berätta om ditt besök …',
  reviewSubmit: 'Lämna ett omdöme',
  reviewThanks: 'Tack för ditt omdöme!',
  reviewErrPhone: 'Ogiltigt telefonnummer',
  reviewErrText: 'Skriv något om ditt besök',
  reviewErrRating: 'Välj ett betyg',
  /** No device receipt or verified session, or no eligible finished, not-yet-reviewed booking in
   * that scope. */
  reviewErrNoBooking:
    'Vi kunde inte hitta en avslutad bokning som du kan lämna omdöme om. Kontrollera telefonnumret och bokningen i Mina bokningar.',
  reviewErrInvalid: 'Omdömet kunde inte valideras. Kontrollera uppgifterna och försök igen.',
  reviewErrChallenge: 'Verifieringen misslyckades. Ladda om kontrollen och försök igen.',
  reviewErrRateLimited: 'För många försök. Vänta en stund innan du försöker igen.',
  reviewErrSubmit: 'Omdömet kunde inte skickas. Försök igen.',
  reviewErrUnavailable: 'Omdömen kan lämnas när bokningstjänsten är tillgänglig.',
  /** `aria-label` for a rendered star rating, e.g. "Betyg: 4 av 5". `{n}` is replaced. */
  ratingValueLabel: 'Betyg: {n} av 5',
  /** `aria-label` for a star in the keyboard selector, e.g. "4 stjärnor". `{n}` is replaced. */
  ratingStarLabel: '{n} stjärnor',
  ratingGroupLabel: 'Välj betyg, 1 till 5 stjärnor',
}

export const myBookingsSv = {
  title: 'Mina bokningar',
  /** Lookup step - rotate and email the customer's permanent access link. */
  lookupLead: 'Ange e-postadressen från bokningen. Vi skickar en ny säker länk.',
  email: 'E-post',
  emailPh: 'namn@exempel.se',
  lookupBtn: 'Skicka säker länk',
  lookingUp: 'Skickar …',
  errEmail: 'Ogiltig e-postadress',
  accessSent:
    'Om e-postadressen matchar en bokning skickar vi en ny länk. Den tidigare länken slutar då att fungera.',
  errAccess: 'Länken är ogiltig eller har ersatts. Begär en ny säker länk.',
  loadingBookings: 'Hämtar bokningar …',
  errCookies:
    'Den säkra åtkomsten kunde inte sparas. Öppna mejllänken igen. Kontrollera webbplatsens cookieinställningar om felet kvarstår.',
  deviceBookingsNote:
    'Här visas bokningar skapade på den här enheten. Öppna mejllänken för tidigare bokningar.',
  deviceReady: 'Din bokning finns nu under Mina bokningar på den här enheten.',
  deviceUnavailable: 'Öppna länken i bekräftelsemejlet för att se dina bokningar.',
  /** Network/parse failure. */
  errSystem: 'Kunde inte hämta bokningarna. Försök igen.',
  errChallenge: 'Verifieringen misslyckades. Ladda om kontrollen och försök igen.',
  errRateLimited: 'För många försök. Vänta en stund innan du försöker igen.',
  /** List step. */
  upcomingTitle: 'Kommande',
  pastTitle: 'Tidigare',
  upcomingEmpty: 'Du har inga kommande bokningar.',
  /** Link back to the lookup step (check a different email). */
  changeEmail: 'Använd en annan e-postadress',
  /** Expanded-row detail labels. */
  fBarber: 'Barberare',
  fService: 'Behandling',
  fDuration: 'Längd',
  min: 'min',
  /** Self-cancel (upcoming rows only). */
  cancelBtn: 'Avboka tid',
  cancelConfirmQ: 'Är du säker på att du vill avboka den här tiden?',
  cancelConfirmYes: 'Ja, avboka tid',
  cancelConfirmNo: 'Avbryt',
  cancelling: 'Avbokar …',
  errCancel: 'Något gick fel vid avbokningen. Försök igen.',
  cancelledNote: 'Tiden är avbokad.',
  /** Localised time connector for a row label ("kl " / ""). */
  atSep: 'kl ',
  ariaClose: 'Stäng',
  ariaExpandRow: 'Visa detaljer',
  ariaExpandPast: 'Visa tidigare bokningar',
}

export const labelsSv: CalendarLabels = {
  weekdays: ['söndag', 'måndag', 'tisdag', 'onsdag', 'torsdag', 'fredag', 'lördag'],
  months: [
    'januari',
    'februari',
    'mars',
    'april',
    'maj',
    'juni',
    'juli',
    'augusti',
    'september',
    'oktober',
    'november',
    'december',
  ],
  headers: ['Mån', 'Tis', 'Ons', 'Tor', 'Fre', 'Lör', 'Sön'],
}

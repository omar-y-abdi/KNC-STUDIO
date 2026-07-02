import type {
  AboutStrings,
  AppStrings,
  BookingStrings,
  CalendarLabels,
  CancelStrings,
} from './index'

// Swedish strings — copied verbatim from the source `BF_STR.sv`, `APP_T.sv`,
// and the BF_WD/BF_MON/BF_HEAD `sv` rows.

export const bookingSv: BookingStrings = {
  chooseBarber: 'Välj din barberare',
  chooseDate: 'Välj en dag',
  chooseTime: 'Välj en tid',
  chooseService: 'Välj behandling',
  pickDayForService: 'Välj en dag i kalendern för att se behandlingar.',
  pickServiceForTime: 'Välj en behandling för att se lediga tider.',
  loadingTimes: 'Laddar tider …',
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
  book: 'Boka tid',
  policy:
    'Vid bokning accepterar du att avbokning måste ske senast 24 timmar före besöket. Sen avbokning eller utebliven tid ger KNC Studio rätt att debitera för den bokade tiden.',
  bookedTitle: 'Tack — din tid är bokad!',
  addToCal: 'Lägg till i kalender',
  calApple: 'Apple Kalender',
  calGoogle: 'Google Kalender',
  directions: 'Vägbeskrivning till salongen',
  newBooking: 'Boka en ny tid',
  grpWedSat: 'Herr · onsdag–lördag',
  grpMonTue: 'Herr · måndag–tisdag',
  grpStudent: 'Studentrabatt · onsdag',
  grpKids: 'Barn upp till 12 år',
  noteStudent: 'Endast onsdagar',
  sHairBeard: 'Hårklippning + skägg',
  sHair: 'Hårklippning',
  sBeard: 'Skäggklippning',
  sHairStudent: 'Hårklippning (student)',
  sKids: 'Klippning, barn',
  min: 'min',
  errName: 'Namnet är för långt',
  errPhone: 'Ogiltigt telefonnummer',
  errSubmit: 'Något gick fel. Försök igen.',
  errRateLimited: 'För många bokningsförsök. Vänta en stund och försök igen.',
  errChallenge: 'Vi kunde inte verifiera att du är en människa. Ladda om sidan och försök igen.',
}

export const appSv: AppStrings = {
  findUs: 'Hitta oss',
  book: 'Boka tid',
  kicker: 'BARBERSHOP · GÖTEBORG',
  hours: 'Öppet Mån–Lör 09–18 · Sön stängt',
  addr: 'Geijersgatan 10, 411 34 Göteborg',
  ariaTheme: 'Växla ljust/mörkt',
  ariaBackHome: 'Till startsidan',
  ariaCall: 'Ring',
  aboutLink: 'Om oss',
  cancelLink: 'Avbokning',
}

// NOTE: All About-section copy below is ON-BRAND PLACEHOLDER text — no real bios, photos or
// reviews exist yet. Swap the prose freely; the structure (typed keys) is what the UI binds to.
export const aboutSv: AboutStrings = {
  eyebrow: 'OM OSS',
  heading: 'Hantverk, inte bara en klippning',
  intro:
    'KNC Studio är en barbershop på Geijersgatan i Göteborg. Vi tar oss tid med varje besök — ren fade, skarpa kanter och ett skägg som sitter. Lugn lokal, bra musik och barberare som kan sitt yrke.',
  galleryTitle: 'I salongen',
  galleryAlt: 'Bild från salongen (platshållare)',
  stylistsTitle: 'Barberarna',
  stylists: {
    hassan: {
      role: 'Barberare',
      bio: 'Specialist på skinfades och precisa kanter. Hassan har saxen i handen sedan tonåren och gör jobbet med is i magen.',
    },
    victor: {
      role: 'Barberare',
      bio: 'Klassiska klippningar med modern touch. Victor lyssnar in vad du vill ha och levererar varje gång — skägg är hans signatur.',
    },
    salman: {
      role: 'Barberare',
      bio: 'Texturerat hår och rena övergångar. Salman tar gärna den extra minuten för att detaljen ska bli helt rätt.',
    },
  },
  stylistAvatarAlt: 'Porträtt (platshållare)',
  cutsTitle: 'Jobb vi gjort',
  cutsAlt: 'Kundklippning (platshållare)',
  reviewsTitle: 'Omdömen',
  reviewPhone: 'Telefonnummer',
  reviewPhonePh: '07X XXX XX XX',
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
  reviewErrNoBooking:
    'Vi hittade ingen genomförd bokning på det numret. Du kan lämna ett omdöme efter ditt besök.',
  ratingValueLabel: 'Betyg: {n} av 5',
  ratingStarLabel: '{n} stjärnor',
  ratingGroupLabel: 'Välj betyg, 1 till 5 stjärnor',
}

// NOTE: Cancellation flow is a MOCK — the looked-up booking is generated on the fly and nothing
// is persisted. Copy here is real, the appointment behind it is demo data.
export const cancelSv: CancelStrings = {
  title: 'Avbokning',
  phone: 'Telefon',
  phonePh: '07X XXX XX XX',
  lookupBtn: 'Avboka tid',
  lookingUp: 'Hämtar …',
  errPhone: 'Ogiltigt telefonnummer',
  errLookup: 'Kunde inte hämta bokningen. Försök igen.',
  foundLead: 'Vi hittade din bokning',
  fBarber: 'Barberare',
  fWhen: 'Tid',
  fService: 'Behandling',
  confirmQuestion: 'Vill du avboka den här tiden?',
  confirmBtn: 'Avboka',
  abortBtn: 'Avbryt',
  cancelling: 'Avbokar …',
  errCancel: 'Något gick fel vid avbokningen. Försök igen.',
  doneTitle: 'Din tid är avbokad',
  doneVia: 'En bekräftelse skickas via SMS.',
  doneBtn: 'Stäng',
  ariaClose: 'Stäng',
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

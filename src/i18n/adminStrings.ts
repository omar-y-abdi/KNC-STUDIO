// Typed admin UI string table — SV + EN. The pattern mirrors the public i18n (BookingStrings,
// AppStrings in index.ts): a closed interface means a missing translation is a compile error.
// All admin strings live in one file (not split into sv.ts/en.ts) because the admin UI is
// self-contained and the volume is much smaller than the public-facing copy.

import type { Lang } from './index'

// --- Interface (the single source of truth for required keys) ------------------------------------

export interface AdminStrings {
  // Navigation tabs (AdminShell sidebar + mobile strip)
  readonly tabSchedule: string
  readonly tabBookings: string
  readonly tabAllBookings: string
  readonly tabBarbers: string
  readonly tabAbout: string
  readonly tabServices: string
  readonly tabSite: string
  readonly tabProfile: string
  // Profil (barber photo) view.
  readonly profileTitle: string
  readonly profileLead: string
  readonly profilePhotoAlt: string
  readonly profileUpload: string
  readonly profileReplace: string
  readonly profileUploading: string
  readonly profileRemove: string
  readonly profileRemoving: string
  readonly profileNoPhoto: string
  readonly profileUploadedOk: string
  readonly profileRemovedOk: string
  readonly profileLoading: string
  readonly profileError: string
  readonly profileDeleteTitle: string
  readonly profileDeleteBody: string
  // Startsida (homepage chrome) view.
  readonly siteTextTitle: string
  readonly siteTextLead: string
  readonly siteFieldKicker: string
  readonly siteFieldHours: string
  readonly siteFieldAddr: string
  readonly siteFontTitle: string
  readonly siteFontLead: string
  readonly siteFontHomepage: string
  readonly siteFontAbout: string
  readonly siteSizeSm: string
  readonly siteSizeMd: string
  readonly siteSizeLg: string
  readonly siteSizeXl: string
  readonly siteLoading: string
  readonly siteSaveError: string
  // Services (per-barber menu) view.
  readonly servicesTitle: string
  readonly servicesLead: string
  readonly svcColName: string
  readonly svcColPrice: string
  readonly svcColDuration: string
  readonly svcNamePh: string
  readonly svcActive: string
  readonly svcInactiveTag: string
  readonly svcSave: string
  readonly svcSaving: string
  readonly svcSaved: string
  readonly svcDelete: string
  readonly svcMoveUp: string
  readonly svcMoveDown: string
  readonly svcAddTitle: string
  readonly svcAddBtn: string
  readonly svcAdding: string
  readonly svcLoading: string
  readonly svcEmpty: string
  readonly svcSaveError: string
  readonly svcValidation: string
  readonly svcDeleteTitle: string
  readonly svcDeleteBody: string
  readonly svcDeleteConfirm: string
  readonly svcDeleteCancel: string
  // Shell chrome
  readonly signOut: string
  /** Used as `{t.greeting} {firstName}` in the topbar — kept as a plain word ("Hej" / "Hi"). */
  readonly greeting: string
  readonly ariaSelectBarber: string
  readonly themeLight: string
  readonly themeDark: string
  readonly ariaNav: string
  // Bookings view headings + leads (constructed in AdminShell, passed as props to BookingsView)
  /** Prefix for the owner heading: "Bokningar · {barberName}" / "Bookings · {barberName}". */
  readonly bookingsOwnerHeadingPrefix: string
  readonly bookingsBarberHeading: string
  readonly bookingsOwnerLead: string
  readonly bookingsBarberLead: string
  // Schedule empty state (rendered inline in AdminShell when no barber is selected)
  readonly scheduleNoBarber: string
  // BookingsView — table column headers
  readonly bookingsColTime: string
  readonly bookingsColBarber: string
  readonly bookingsColCustomer: string
  readonly bookingsColService: string
  readonly bookingsColContact: string
  readonly bookingsColStatus: string
  readonly bookingsColAction: string
  // BookingsView — section headings + empty states
  readonly bookingsUpcoming: string
  readonly bookingsPast: string
  readonly bookingsEmptyUpcoming: string
  readonly bookingsEmptyPast: string
  // BookingsView — loading + status labels
  readonly bookingsLoading: string
  readonly bookingsStatusConfirmed: string
  readonly bookingsStatusCancelled: string
  /** Inline "· hos {barberName}" / "· with {barberName}" in the card all-barbers view. */
  readonly bookingsAtBarber: string
  // BookingsView — cancel flow
  readonly bookingsCancelAction: string
  readonly bookingsCancelledOk: string
  readonly bookingsCancelDialogTitle: string
  readonly bookingsCancelDialogBodySuffix: string
  readonly bookingsCancelDialogConfirm: string
  readonly bookingsCancelDialogKeep: string
  // ScheduleView — section headings + loading
  readonly scheduleHeadingPrefix: string
  readonly scheduleLoading: string
  readonly scheduleWeekHeadingPrefix: string
  readonly scheduleWeekLead: string
  // ScheduleView — bulk time row
  readonly scheduleFrom: string
  readonly scheduleTo: string
  readonly scheduleSameTimeAllDays: string
  // ScheduleView — per-day rows
  readonly scheduleDayOffLabel: string
  readonly scheduleStartTimeAria: string
  readonly scheduleEndTimeAria: string
  readonly scheduleWorkingAria: string
  readonly scheduleInvalidHours: string
  // ScheduleView — auto-save status line
  readonly scheduleSaving: string
  readonly scheduleSaved: string
  readonly scheduleRetry: string
  // ScheduleView — time-off section
  readonly scheduleTimeOffHeading: string
  readonly scheduleTimeOffLead: string
  readonly scheduleTimeOffReason: string
  readonly scheduleTimeOffAdding: string
  readonly scheduleTimeOffAdd: string
  readonly scheduleTimeOffAdded: string
  readonly scheduleTimeOffRemoved: string
  readonly scheduleTimeOffEmpty: string
  readonly scheduleTimeOffRemove: string
  readonly scheduleTimeOffColPeriod: string
  readonly scheduleTimeOffColReason: string
  readonly scheduleTimeOffColAction: string
  readonly scheduleTimeOffDateError: string
  readonly scheduleTimeOffDeleteTitle: string
  readonly scheduleTimeOffDeleteCancel: string
  // ScheduleDayGrid — headings + navigation
  readonly scheduleGridHeading: string
  readonly scheduleGridLead: string
  readonly scheduleGridAriaDayPicker: string
  readonly scheduleGridToday: string
  readonly scheduleGridLoading: string
  // ScheduleDayGrid — day state cards
  readonly scheduleGridDayOff: string
  readonly scheduleGridNonWorkingDay: string
  readonly scheduleGridDayBlockedMsg: string
  readonly scheduleGridDayNotInWeekMsg: string
  readonly scheduleGridRangeOffMsg: string
  // ScheduleDayGrid — whole-day controls + legend
  readonly scheduleGridOpenDay: string
  readonly scheduleGridBlockDay: string
  readonly scheduleGridLegendFree: string
  readonly scheduleGridLegendBlocked: string
  readonly scheduleGridLegendBooked: string
  readonly scheduleGridLegendClosed: string
  // ScheduleDayGrid — hour/quarter controls + slot states
  readonly scheduleGridSaveError: string
  readonly scheduleGridBlockHour: string
  readonly scheduleGridOpenHour: string
  readonly scheduleGridSlotFree: string
  readonly scheduleGridSlotBlocked: string
  readonly scheduleGridSlotBooked: string
  readonly scheduleGridSlotPast: string
  readonly scheduleGridSlotClosed: string
  /** Suffix for `${n}/4 ${t.scheduleGridFreeCountSuffix}` in the hour chip summary. */
  readonly scheduleGridFreeCountSuffix: string
  // ScheduleDayGrid — "Reservera kund" (manual booking)
  readonly reserveBtn: string
  readonly reserveTitle: string
  readonly reserveLeadPrefix: string
  readonly reserveName: string
  readonly reserveNamePh: string
  readonly reservePrice: string
  readonly reservePricePh: string
  readonly reservePhone: string
  readonly reservePhonePh: string
  readonly reserveConfirm: string
  readonly reserveBusy: string
  readonly reserveCancel: string
  readonly reserveDefaultName: string
  readonly reserveServiceName: string
  readonly reserveErrPhone: string
  readonly reserveOk: string
  // BarbersView — section headings + roster states
  readonly barbersTitle: string
  readonly barbersLead: string
  readonly barbersAddNew: string
  readonly barbersNewHeading: string
  readonly barbersLoading: string
  readonly barbersEmpty: string
  // BarbersView — table column headers
  readonly barbersColName: string
  readonly barbersColInstagram: string
  readonly barbersColLogin: string
  readonly barbersColStatus: string
  readonly barbersColAction: string
  // BarbersView — status pills
  readonly barbersStatusLinked: string
  readonly barbersStatusUnlinked: string
  readonly barbersStatusActive: string
  readonly barbersStatusHidden: string
  // BarbersView — row/card action buttons
  readonly barbersEdit: string
  readonly barbersClose: string
  readonly barbersHide: string
  readonly barbersActivate: string
  readonly barbersCreateLogin: string
  // BarbersView — edit/new form field labels
  readonly barbersFieldName: string
  readonly barbersFieldInstagram: string
  readonly barbersFieldRoleSv: string
  readonly barbersFieldRoleEn: string
  readonly barbersFieldBioSv: string
  readonly barbersFieldBioEn: string
  readonly barbersFieldId: string
  readonly barbersFieldEmail: string
  readonly barbersEmailPlaceholder: string
  // BarbersView — form action buttons
  readonly barbersSave: string
  readonly barbersSaving: string
  readonly barbersCreate: string
  readonly barbersCreating: string
  readonly barbersCancel: string
  // BarbersView — notices + validation
  readonly barbersUpdatedOk: string
  readonly barbersHiddenOk: string
  readonly barbersActivatedOk: string
  readonly barbersAddedOk: string
  readonly barbersIdError: string
  readonly barbersNameRequired: string
  readonly barbersEmailError: string
  /** The "login created" note. KEEP the literal "123456" — only the surrounding copy is translated. */
  readonly barbersDefaultPasswordNote: string
  // AboutView — text editor headings + controls
  readonly aboutTextTitle: string
  readonly aboutTextLead: string
  readonly aboutLoading: string
  readonly aboutLangSwedish: string
  readonly aboutLangEnglish: string
  readonly aboutSave: string
  readonly aboutSaving: string
  readonly aboutSaved: string
  // AboutView — the 7 editable about_content field labels
  readonly aboutFieldEyebrow: string
  readonly aboutFieldHeading: string
  readonly aboutFieldIntro: string
  readonly aboutFieldGalleryTitle: string
  readonly aboutFieldCutsTitle: string
  readonly aboutFieldStylistsTitle: string
  readonly aboutFieldReviewsTitle: string
  // AboutView — gallery managers (salon + cuts)
  readonly aboutGallerySalonTitle: string
  readonly aboutGalleryCutsTitle: string
  readonly aboutGalleryLead: string
  readonly aboutGalleryAltLabel: string
  readonly aboutGalleryFileLabel: string
  readonly aboutGalleryUploading: string
  readonly aboutGalleryLoading: string
  readonly aboutGalleryEmpty: string
  readonly aboutGalleryUploadedOk: string
  readonly aboutGalleryDeletedOk: string
  readonly aboutGalleryRemove: string
  readonly aboutGalleryDeleteTitle: string
  readonly aboutGalleryDeleteBody: string
  readonly aboutGalleryDeleteCancel: string
  // --- Auth area: /login + password screens ------------------------------------------------------
  // LoginPage (`/login`)
  readonly loginErrorEmptyFields: string
  /** The "backend not configured" notice, split so the `<code>VITE_SUPABASE_*</code>` literals stay verbatim. */
  readonly loginNotConfiguredPre: string
  readonly loginNotConfiguredMid: string
  readonly loginNotConfiguredPost: string
  readonly loginEmailLabel: string
  readonly loginPasswordLabel: string
  readonly loginSubmitting: string
  readonly loginSubmit: string
  readonly loginKicker: string
  readonly loginBackToSite: string
  readonly loginBackToSiteAria: string
  readonly loginHeading: string
  readonly loginLead: string
  readonly loginChangePasswordLink: string
  readonly loginForgotPasswordLink: string
  // Shared auth links (identical across the password screens)
  readonly authToSignIn: string
  readonly authBackToSignIn: string
  // ChangePasswordForm ("Byt lösenord" — flow A)
  readonly changePwSubtitle: string
  readonly changePwSuccess: string
  readonly changePwEmailLabel: string
  readonly changePwCurrentPassword: string
  readonly changePwNewPassword: string
  readonly changePwConfirmPassword: string
  readonly changePwSaving: string
  readonly changePwSubmit: string
  // ForgotPasswordForm ("Glömt lösenord" — flow B)
  readonly forgotPwSubtitle: string
  readonly forgotPwSuccess: string
  readonly forgotPwEmailLabel: string
  readonly forgotPwSending: string
  readonly forgotPwSubmit: string
  // ForcedPasswordChange (forced first-login change)
  readonly forcedPwSubtitle: string
  readonly forcedPwIntro: string
  readonly forcedPwNewPassword: string
  readonly forcedPwConfirmPassword: string
  /** Soft failure: the password changed but the flag-clear RPC failed. */
  readonly forcedPwClearError: string
  readonly forcedPwSaving: string
  readonly forcedPwSubmit: string
  // ResetPasswordPage (`/reset` recovery landing)
  readonly resetPwSubtitle: string
  readonly resetPwInvalidLink: string
  readonly resetPwChecking: string
  readonly resetPwSuccess: string
  readonly resetPwNewPassword: string
  readonly resetPwConfirmPassword: string
  readonly resetPwSaving: string
  readonly resetPwSubmit: string
}

// --- Swedish (default) ---------------------------------------------------------------------------

const SV: AdminStrings = {
  tabSchedule: 'Mitt schema',
  tabBookings: 'Mina bokningar',
  tabAllBookings: 'Alla bokningar',
  tabBarbers: 'Barberare',
  tabAbout: 'Om oss',
  tabServices: 'Tjänster',
  tabSite: 'Startsida',
  tabProfile: 'Profil',
  profileTitle: 'Profilbild',
  profileLead:
    'Bilden visas i "Om oss" på hemsidan. Utan bild visas en platshållare. Kvadratiskt format ser bäst ut.',
  profilePhotoAlt: 'Profilbild',
  profileUpload: 'Ladda upp bild',
  profileReplace: 'Byt bild',
  profileUploading: 'Laddar upp …',
  profileRemove: 'Ta bort bild',
  profileRemoving: 'Tar bort …',
  profileNoPhoto: 'Ingen bild uppladdad ännu.',
  profileUploadedOk: 'Bilden är uppladdad.',
  profileRemovedOk: 'Bilden är borttagen.',
  profileLoading: 'Laddar profil …',
  profileError: 'Kunde inte spara. Försök igen.',
  profileDeleteTitle: 'Ta bort profilbild?',
  profileDeleteBody: 'Bilden tas bort och platshållaren visas igen på hemsidan.',
  siteTextTitle: 'Startsidans text',
  siteTextLead:
    'Redigera texten på startsidan. Tomt fält återgår till standardtexten. Loggan och knapptexterna ändras inte här.',
  siteFieldKicker: 'Underrubrik (t.ex. "BARBERSHOP · GÖTEBORG")',
  siteFieldHours: 'Öppettider',
  siteFieldAddr: 'Adress',
  siteFontTitle: 'Textstorlek',
  siteFontLead:
    'Välj textstorlek för startsidan och Om oss-sektionen. Alla val håller sig inom layouten.',
  siteFontHomepage: 'Startsidans text',
  siteFontAbout: 'Om oss-sektionen',
  siteSizeSm: 'Liten',
  siteSizeMd: 'Mellan',
  siteSizeLg: 'Stor',
  siteSizeXl: 'Extra stor',
  siteLoading: 'Laddar startsidan …',
  siteSaveError: 'Kunde inte spara. Försök igen.',
  servicesTitle: 'Tjänster',
  servicesLead:
    'Lägg till behandlingar, sätt pris och längd, och ordna listan. Kunderna ser dina aktiva tjänster när de bokar. En rabatt är bara en egen tjänst (t.ex. "Studentklippning").',
  svcColName: 'Namn',
  svcColPrice: 'Pris (kr)',
  svcColDuration: 'Längd (min)',
  svcNamePh: 'T.ex. Skinfade',
  svcActive: 'Aktiv',
  svcInactiveTag: 'Dold för kunder',
  svcSave: 'Spara',
  svcSaving: 'Sparar …',
  svcSaved: 'Sparat',
  svcDelete: 'Ta bort',
  svcMoveUp: 'Flytta upp',
  svcMoveDown: 'Flytta ner',
  svcAddTitle: 'Ny tjänst',
  svcAddBtn: 'Lägg till tjänst',
  svcAdding: 'Lägger till …',
  svcLoading: 'Laddar tjänster …',
  svcEmpty: 'Inga tjänster ännu. Lägg till den första nedan.',
  svcSaveError: 'Kunde inte spara. Försök igen.',
  svcValidation: 'Ange namn, pris och längd.',
  svcDeleteTitle: 'Ta bort tjänst?',
  svcDeleteBody: 'Behandlingen tas bort permanent. Redan bokade tider påverkas inte.',
  svcDeleteConfirm: 'Ta bort',
  svcDeleteCancel: 'Avbryt',
  signOut: 'Logga ut',
  greeting: 'Hej',
  ariaSelectBarber: 'Välj barberare att hantera',
  themeLight: 'Byt till ljust läge',
  themeDark: 'Byt till mörkt läge',
  ariaNav: 'Adminmeny',
  bookingsOwnerHeadingPrefix: 'Bokningar',
  bookingsBarberHeading: 'Mina bokningar',
  bookingsOwnerLead: 'Bokningar för vald barberare. Byt barberare uppe till vänster.',
  bookingsBarberLead: 'Dina kommande och tidigare bokningar. Avboka vid behov.',
  scheduleNoBarber: 'Ingen barberare vald.',
  bookingsColTime: 'Tid',
  bookingsColBarber: 'Barberare',
  bookingsColCustomer: 'Kund',
  bookingsColService: 'Behandling',
  bookingsColContact: 'Kontakt',
  bookingsColStatus: 'Status',
  bookingsColAction: 'Åtgärd',
  bookingsUpcoming: 'Kommande',
  bookingsPast: 'Tidigare',
  bookingsEmptyUpcoming: 'Inga kommande bokningar.',
  bookingsEmptyPast: 'Inga tidigare bokningar.',
  bookingsLoading: 'Laddar bokningar …',
  bookingsStatusConfirmed: 'Bekräftad',
  bookingsStatusCancelled: 'Avbokad',
  bookingsAtBarber: 'hos',
  bookingsCancelAction: 'Avboka',
  bookingsCancelledOk: 'Bokningen avbokad.',
  bookingsCancelDialogTitle: 'Avboka bokningen?',
  bookingsCancelDialogBodySuffix: '. Detta går inte att ångra.',
  bookingsCancelDialogConfirm: 'Avboka',
  bookingsCancelDialogKeep: 'Behåll',
  scheduleHeadingPrefix: 'Schema',
  scheduleLoading: 'Laddar schema …',
  scheduleWeekHeadingPrefix: 'Veckoschema',
  scheduleWeekLead: 'Markera vilka dagar du jobbar och sätt tider — ändringar sparas automatiskt.',
  scheduleFrom: 'Från',
  scheduleTo: 'Till',
  scheduleSameTimeAllDays: 'Samma tid alla dagar',
  scheduleDayOffLabel: 'Ledig',
  scheduleStartTimeAria: 'Starttid',
  scheduleEndTimeAria: 'Sluttid',
  scheduleWorkingAria: 'Jobbar',
  scheduleInvalidHours: 'Sluttid måste vara efter starttid.',
  scheduleSaving: 'Sparar …',
  scheduleSaved: 'Sparat ✓',
  scheduleRetry: 'Försök igen',
  scheduleTimeOffHeading: 'Ledighet',
  scheduleTimeOffLead:
    'Blockera en dag eller en period (semester, ledig dag). Blockerade datum visas inte som bokningsbara.',
  scheduleTimeOffReason: 'Anledning (valfritt)',
  scheduleTimeOffAdding: 'Lägger till …',
  scheduleTimeOffAdd: 'Lägg till',
  scheduleTimeOffAdded: 'Ledighet tillagd.',
  scheduleTimeOffRemoved: 'Ledighet borttagen.',
  scheduleTimeOffEmpty: 'Ingen ledighet inlagd.',
  scheduleTimeOffRemove: 'Ta bort',
  scheduleTimeOffColPeriod: 'Period',
  scheduleTimeOffColReason: 'Anledning',
  scheduleTimeOffColAction: 'Åtgärd',
  scheduleTimeOffDateError: 'Slutdatum måste vara samma eller efter startdatum.',
  scheduleTimeOffDeleteTitle: 'Ta bort ledigheten?',
  scheduleTimeOffDeleteCancel: 'Avbryt',
  scheduleGridHeading: 'Dagsöversikt',
  scheduleGridLead:
    'Välj dag, tryck på en timme och blockera kvartarna som är upptagna (t.ex. bokat via sms) — sparas direkt. Tryck igen för att öppna.',
  scheduleGridAriaDayPicker: 'Välj dag',
  scheduleGridToday: 'Idag',
  scheduleGridLoading: 'Laddar …',
  scheduleGridDayOff: 'Ledig dag',
  scheduleGridNonWorkingDay: 'Ingen arbetsdag',
  scheduleGridDayBlockedMsg: 'Dagen är blockerad — inga tider kan bokas.',
  scheduleGridDayNotInWeekMsg: 'Dagen är avmarkerad i veckoschemat.',
  scheduleGridRangeOffMsg: 'Dagen ingår i en ledighetsperiod — hantera den under Ledighet.',
  scheduleGridOpenDay: 'Öppna dagen',
  scheduleGridBlockDay: 'Blockera hela dagen',
  scheduleGridLegendFree: 'Ledig',
  scheduleGridLegendBlocked: 'Blockerad',
  scheduleGridLegendBooked: 'Bokad',
  scheduleGridLegendClosed: 'Stängt',
  scheduleGridSaveError: 'Kunde inte spara. Försök igen.',
  scheduleGridBlockHour: 'Blockera',
  scheduleGridOpenHour: 'Öppna',
  scheduleGridSlotFree: 'Ledig',
  scheduleGridSlotBlocked: 'Blockerad',
  scheduleGridSlotBooked: 'Bokad',
  scheduleGridSlotPast: 'Passerad',
  scheduleGridSlotClosed: 'Stängt',
  scheduleGridFreeCountSuffix: 'lediga',
  reserveBtn: 'Reservera kund',
  reserveTitle: 'Reservera kund',
  reserveLeadPrefix: 'Tid:',
  reserveName: 'Namn',
  reserveNamePh: 'Kundens namn (valfritt)',
  reservePrice: 'Pris (kr)',
  reservePricePh: 'Valfritt',
  reservePhone: 'Telefon',
  reservePhonePh: '07X XXX XX XX (valfritt)',
  reserveConfirm: 'Boka kund',
  reserveBusy: 'Bokar …',
  reserveCancel: 'Avbryt',
  reserveDefaultName: 'Reserverad kund',
  reserveServiceName: 'Reserverad tid',
  reserveErrPhone: 'Ogiltigt telefonnummer',
  reserveOk: 'Kunden är bokad.',
  barbersTitle: 'Barberare',
  barbersLead:
    'Lägg till, redigera och dölj barberare. Klicka på "Skapa inloggning" för en ej kopplad barberare för att ge dem ett inloggningskonto.',
  barbersAddNew: '+ Ny barberare',
  barbersNewHeading: 'Ny barberare',
  barbersLoading: 'Laddar barberare …',
  barbersEmpty: 'Inga barberare.',
  barbersColName: 'Namn',
  barbersColInstagram: 'Instagram',
  barbersColLogin: 'Inloggning',
  barbersColStatus: 'Status',
  barbersColAction: 'Åtgärd',
  barbersStatusLinked: 'Inloggning kopplad',
  barbersStatusUnlinked: 'Ej kopplad',
  barbersStatusActive: 'Aktiv',
  barbersStatusHidden: 'Dold',
  barbersEdit: 'Redigera',
  barbersClose: 'Stäng',
  barbersHide: 'Dölj',
  barbersActivate: 'Aktivera',
  barbersCreateLogin: 'Skapa inloggning',
  barbersFieldName: 'Namn',
  barbersFieldInstagram: 'Instagram',
  barbersFieldRoleSv: 'Roll (SV)',
  barbersFieldRoleEn: 'Roll (EN)',
  barbersFieldBioSv: 'Bio (SV)',
  barbersFieldBioEn: 'Bio (EN)',
  barbersFieldId: 'Id (a–z, 0–9, -)',
  barbersFieldEmail: 'E-post',
  barbersEmailPlaceholder: 'barberare@exempel.se',
  barbersSave: 'Spara',
  barbersSaving: 'Sparar …',
  barbersCreate: 'Skapa',
  barbersCreating: 'Skapar …',
  barbersCancel: 'Avbryt',
  barbersUpdatedOk: 'Barberaren uppdaterad.',
  barbersHiddenOk: 'Barberaren dold.',
  barbersActivatedOk: 'Barberaren aktiv.',
  barbersAddedOk: 'Barberare tillagd.',
  barbersIdError: 'Id får bara innehålla a–z, 0–9 och bindestreck (max 32).',
  barbersNameRequired: 'Namn krävs.',
  barbersEmailError: 'Ange en giltig e-postadress.',
  barbersDefaultPasswordNote:
    'Konto skapat. Tillfälligt lösenord: 123456 — barberaren byter det vid första inloggningen.',
  aboutTextTitle: 'Om oss · text',
  aboutTextLead: 'Redigera sektionstexterna på svenska och engelska. Varje fält sparas för sig.',
  aboutLoading: 'Laddar innehåll …',
  aboutLangSwedish: 'Svenska',
  aboutLangEnglish: 'Engelska',
  aboutSave: 'Spara',
  aboutSaving: 'Sparar …',
  aboutSaved: 'Sparat',
  aboutFieldEyebrow: 'Etikett (eyebrow)',
  aboutFieldHeading: 'Rubrik',
  aboutFieldIntro: 'Intro',
  aboutFieldGalleryTitle: 'Galleri-titel (salong)',
  aboutFieldCutsTitle: 'Galleri-titel (klippningar)',
  aboutFieldStylistsTitle: 'Barberar-titel',
  aboutFieldReviewsTitle: 'Omdömen-titel',
  aboutGallerySalonTitle: 'Galleri · I salongen',
  aboutGalleryCutsTitle: 'Galleri · Jobb vi gjort',
  aboutGalleryLead: 'Ladda upp bilder till galleriet och ta bort dem du inte vill visa.',
  aboutGalleryAltLabel: 'Alt-text (beskrivning)',
  aboutGalleryFileLabel: 'Bildfil',
  aboutGalleryUploading: 'Laddar upp …',
  aboutGalleryLoading: 'Laddar galleri …',
  aboutGalleryEmpty: 'Inga bilder ännu.',
  aboutGalleryUploadedOk: 'Bild uppladdad.',
  aboutGalleryDeletedOk: 'Bild borttagen.',
  aboutGalleryRemove: 'Ta bort',
  aboutGalleryDeleteTitle: 'Ta bort bilden?',
  aboutGalleryDeleteBody: 'Bilden tas bort från galleriet och lagringen. Detta går inte att ångra.',
  aboutGalleryDeleteCancel: 'Avbryt',
  loginErrorEmptyFields: 'Fyll i både e‑post och lösenord.',
  loginNotConfiguredPre:
    'Adminpanelen kräver den live-backend som inte är konfigurerad i den här miljön. Sätt',
  loginNotConfiguredMid: 'och',
  loginNotConfiguredPost: 'för att aktivera inloggning.',
  loginEmailLabel: 'E‑post',
  loginPasswordLabel: 'Lösenord',
  loginSubmitting: 'Loggar in …',
  loginSubmit: 'Logga in',
  loginKicker: 'ADMINPANEL',
  loginBackToSite: '‹ Till webbplatsen',
  loginBackToSiteAria: 'Blade & Blend Studio — till webbplatsen',
  loginHeading: 'Logga in',
  loginLead: 'Hantera ditt schema och dina bokningar.',
  loginChangePasswordLink: 'Byt lösenord',
  loginForgotPasswordLink: 'Glömt lösenord?',
  authToSignIn: 'Till inloggning',
  authBackToSignIn: 'Tillbaka till inloggning',
  changePwSubtitle: 'Byt lösenord',
  changePwSuccess: 'Lösenordet är ändrat. Logga in med ditt nya lösenord.',
  changePwEmailLabel: 'E‑post',
  changePwCurrentPassword: 'Nuvarande lösenord',
  changePwNewPassword: 'Nytt lösenord',
  changePwConfirmPassword: 'Bekräfta nytt lösenord',
  changePwSaving: 'Sparar …',
  changePwSubmit: 'Byt lösenord',
  forgotPwSubtitle: 'Glömt lösenord',
  forgotPwSuccess:
    'Om ett konto med den adressen finns har vi skickat en återställningslänk. Kolla din inkorg (och skräpposten).',
  forgotPwEmailLabel: 'E‑post',
  forgotPwSending: 'Skickar …',
  forgotPwSubmit: 'Skicka återställningslänk',
  forcedPwSubtitle: 'Byt ditt lösenord',
  forcedPwIntro:
    'Ditt konto har ett tillfälligt lösenord. Du måste välja ett nytt för att komma åt panelen.',
  forcedPwNewPassword: 'Nytt lösenord',
  forcedPwConfirmPassword: 'Bekräfta nytt lösenord',
  forcedPwClearError: 'Lösenordet är ändrat, men ett nätverksfel inträffade. Kontakta ägaren.',
  forcedPwSaving: 'Sparar …',
  forcedPwSubmit: 'Byt lösenord',
  resetPwSubtitle: 'Återställ lösenord',
  resetPwInvalidLink:
    'Återställningslänken är ogiltig eller har gått ut. Begär en ny på inloggningssidan.',
  resetPwChecking: 'Kontrollerar länken …',
  resetPwSuccess: 'Ditt lösenord är uppdaterat. Logga in med ditt nya lösenord.',
  resetPwNewPassword: 'Nytt lösenord',
  resetPwConfirmPassword: 'Bekräfta nytt lösenord',
  resetPwSaving: 'Sparar …',
  resetPwSubmit: 'Spara nytt lösenord',
}

// --- English -------------------------------------------------------------------------------------

const EN: AdminStrings = {
  tabSchedule: 'My schedule',
  tabBookings: 'My bookings',
  tabAllBookings: 'All bookings',
  tabBarbers: 'Barbers',
  tabAbout: 'About us',
  tabServices: 'Services',
  tabSite: 'Home page',
  tabProfile: 'Profile',
  profileTitle: 'Profile photo',
  profileLead:
    'The photo shows in the "About" section on the site. Without one a placeholder is shown. A square image looks best.',
  profilePhotoAlt: 'Profile photo',
  profileUpload: 'Upload photo',
  profileReplace: 'Replace photo',
  profileUploading: 'Uploading …',
  profileRemove: 'Remove photo',
  profileRemoving: 'Removing …',
  profileNoPhoto: 'No photo uploaded yet.',
  profileUploadedOk: 'The photo is uploaded.',
  profileRemovedOk: 'The photo is removed.',
  profileLoading: 'Loading profile …',
  profileError: 'Could not save. Please try again.',
  profileDeleteTitle: 'Remove profile photo?',
  profileDeleteBody: 'The photo is removed and the placeholder shows again on the site.',
  siteTextTitle: 'Home page text',
  siteTextLead:
    'Edit the text on the home page. An empty field falls back to the default. The logo and button labels are not changed here.',
  siteFieldKicker: 'Sub-heading (e.g. "BARBERSHOP · GOTHENBURG")',
  siteFieldHours: 'Opening hours',
  siteFieldAddr: 'Address',
  siteFontTitle: 'Text size',
  siteFontLead:
    'Choose the text size for the home page and the About section. Every option stays within the layout.',
  siteFontHomepage: 'Home page text',
  siteFontAbout: 'About section',
  siteSizeSm: 'Small',
  siteSizeMd: 'Medium',
  siteSizeLg: 'Large',
  siteSizeXl: 'Extra large',
  siteLoading: 'Loading home page …',
  siteSaveError: 'Could not save. Please try again.',
  servicesTitle: 'Services',
  servicesLead:
    'Add services, set price and length, and order the list. Customers see your active services when booking. A discount is just its own service (e.g. "Student cut").',
  svcColName: 'Name',
  svcColPrice: 'Price (kr)',
  svcColDuration: 'Length (min)',
  svcNamePh: 'e.g. Skin fade',
  svcActive: 'Active',
  svcInactiveTag: 'Hidden from customers',
  svcSave: 'Save',
  svcSaving: 'Saving …',
  svcSaved: 'Saved',
  svcDelete: 'Delete',
  svcMoveUp: 'Move up',
  svcMoveDown: 'Move down',
  svcAddTitle: 'New service',
  svcAddBtn: 'Add service',
  svcAdding: 'Adding …',
  svcLoading: 'Loading services …',
  svcEmpty: 'No services yet. Add the first one below.',
  svcSaveError: 'Could not save. Please try again.',
  svcValidation: 'Enter a name, price and length.',
  svcDeleteTitle: 'Delete service?',
  svcDeleteBody: 'The service is removed permanently. Existing bookings are unaffected.',
  svcDeleteConfirm: 'Delete',
  svcDeleteCancel: 'Cancel',
  signOut: 'Sign out',
  greeting: 'Hi',
  ariaSelectBarber: 'Select barber to manage',
  themeLight: 'Switch to light mode',
  themeDark: 'Switch to dark mode',
  ariaNav: 'Admin navigation',
  bookingsOwnerHeadingPrefix: 'Bookings',
  bookingsBarberHeading: 'My bookings',
  bookingsOwnerLead: 'Bookings for the selected barber. Switch barber in the top left.',
  bookingsBarberLead: 'Your upcoming and past bookings. Cancel if needed.',
  scheduleNoBarber: 'No barber selected.',
  bookingsColTime: 'Time',
  bookingsColBarber: 'Barber',
  bookingsColCustomer: 'Customer',
  bookingsColService: 'Service',
  bookingsColContact: 'Contact',
  bookingsColStatus: 'Status',
  bookingsColAction: 'Action',
  bookingsUpcoming: 'Upcoming',
  bookingsPast: 'Past',
  bookingsEmptyUpcoming: 'No upcoming bookings.',
  bookingsEmptyPast: 'No past bookings.',
  bookingsLoading: 'Loading bookings …',
  bookingsStatusConfirmed: 'Confirmed',
  bookingsStatusCancelled: 'Cancelled',
  bookingsAtBarber: 'with',
  bookingsCancelAction: 'Cancel',
  bookingsCancelledOk: 'Booking cancelled.',
  bookingsCancelDialogTitle: 'Cancel booking?',
  bookingsCancelDialogBodySuffix: '. This cannot be undone.',
  bookingsCancelDialogConfirm: 'Cancel booking',
  bookingsCancelDialogKeep: 'Keep',
  scheduleHeadingPrefix: 'Schedule',
  scheduleLoading: 'Loading schedule …',
  scheduleWeekHeadingPrefix: 'Weekly schedule',
  scheduleWeekLead: 'Mark which days you work and set hours — changes are saved automatically.',
  scheduleFrom: 'From',
  scheduleTo: 'To',
  scheduleSameTimeAllDays: 'Same time for all days',
  scheduleDayOffLabel: 'Off',
  scheduleStartTimeAria: 'Start time',
  scheduleEndTimeAria: 'End time',
  scheduleWorkingAria: 'Working',
  scheduleInvalidHours: 'End time must be after start time.',
  scheduleSaving: 'Saving …',
  scheduleSaved: 'Saved ✓',
  scheduleRetry: 'Try again',
  scheduleTimeOffHeading: 'Time off',
  scheduleTimeOffLead:
    'Block a day or a period (holiday, day off). Blocked dates will not be available for booking.',
  scheduleTimeOffReason: 'Reason (optional)',
  scheduleTimeOffAdding: 'Adding …',
  scheduleTimeOffAdd: 'Add',
  scheduleTimeOffAdded: 'Time off added.',
  scheduleTimeOffRemoved: 'Time off removed.',
  scheduleTimeOffEmpty: 'No time off scheduled.',
  scheduleTimeOffRemove: 'Remove',
  scheduleTimeOffColPeriod: 'Period',
  scheduleTimeOffColReason: 'Reason',
  scheduleTimeOffColAction: 'Action',
  scheduleTimeOffDateError: 'End date must be the same as or after the start date.',
  scheduleTimeOffDeleteTitle: 'Remove time off?',
  scheduleTimeOffDeleteCancel: 'Cancel',
  scheduleGridHeading: 'Day overview',
  scheduleGridLead:
    'Select a day, tap an hour and block the quarters that are taken (e.g. booked by text) — saved immediately. Tap again to open.',
  scheduleGridAriaDayPicker: 'Select day',
  scheduleGridToday: 'Today',
  scheduleGridLoading: 'Loading …',
  scheduleGridDayOff: 'Day off',
  scheduleGridNonWorkingDay: 'No working day',
  scheduleGridDayBlockedMsg: 'The day is blocked — no times can be booked.',
  scheduleGridDayNotInWeekMsg: 'The day is not in the weekly schedule.',
  scheduleGridRangeOffMsg: 'The day is part of a time-off period — manage it under Time off.',
  scheduleGridOpenDay: 'Open day',
  scheduleGridBlockDay: 'Block whole day',
  scheduleGridLegendFree: 'Free',
  scheduleGridLegendBlocked: 'Blocked',
  scheduleGridLegendBooked: 'Booked',
  scheduleGridLegendClosed: 'Closed',
  scheduleGridSaveError: 'Could not save. Try again.',
  scheduleGridBlockHour: 'Block',
  scheduleGridOpenHour: 'Open',
  scheduleGridSlotFree: 'Free',
  scheduleGridSlotBlocked: 'Blocked',
  scheduleGridSlotBooked: 'Booked',
  scheduleGridSlotPast: 'Past',
  scheduleGridSlotClosed: 'Closed',
  scheduleGridFreeCountSuffix: 'free',
  reserveBtn: 'Reserve customer',
  reserveTitle: 'Reserve customer',
  reserveLeadPrefix: 'Time:',
  reserveName: 'Name',
  reserveNamePh: 'Customer name (optional)',
  reservePrice: 'Price (kr)',
  reservePricePh: 'Optional',
  reservePhone: 'Phone',
  reservePhonePh: '07X XXX XX XX (optional)',
  reserveConfirm: 'Book customer',
  reserveBusy: 'Booking …',
  reserveCancel: 'Cancel',
  reserveDefaultName: 'Reserved',
  reserveServiceName: 'Reserved time',
  reserveErrPhone: 'Invalid phone number',
  reserveOk: 'The customer is booked.',
  barbersTitle: 'Barbers',
  barbersLead:
    'Add, edit and hide barbers. Click "Create login" for an unlinked barber to give them a login account.',
  barbersAddNew: '+ New barber',
  barbersNewHeading: 'New barber',
  barbersLoading: 'Loading barbers …',
  barbersEmpty: 'No barbers.',
  barbersColName: 'Name',
  barbersColInstagram: 'Instagram',
  barbersColLogin: 'Login',
  barbersColStatus: 'Status',
  barbersColAction: 'Action',
  barbersStatusLinked: 'Login linked',
  barbersStatusUnlinked: 'Not linked',
  barbersStatusActive: 'Active',
  barbersStatusHidden: 'Hidden',
  barbersEdit: 'Edit',
  barbersClose: 'Close',
  barbersHide: 'Hide',
  barbersActivate: 'Activate',
  barbersCreateLogin: 'Create login',
  barbersFieldName: 'Name',
  barbersFieldInstagram: 'Instagram',
  barbersFieldRoleSv: 'Role (SV)',
  barbersFieldRoleEn: 'Role (EN)',
  barbersFieldBioSv: 'Bio (SV)',
  barbersFieldBioEn: 'Bio (EN)',
  barbersFieldId: 'Id (a–z, 0–9, -)',
  barbersFieldEmail: 'Email',
  barbersEmailPlaceholder: 'barber@example.com',
  barbersSave: 'Save',
  barbersSaving: 'Saving …',
  barbersCreate: 'Create',
  barbersCreating: 'Creating …',
  barbersCancel: 'Cancel',
  barbersUpdatedOk: 'Barber updated.',
  barbersHiddenOk: 'Barber hidden.',
  barbersActivatedOk: 'Barber active.',
  barbersAddedOk: 'Barber added.',
  barbersIdError: 'Id may only contain a–z, 0–9 and hyphens (max 32).',
  barbersNameRequired: 'Name is required.',
  barbersEmailError: 'Enter a valid email address.',
  barbersDefaultPasswordNote:
    'Account created. Temporary password: 123456 — the barber changes it at first login.',
  aboutTextTitle: 'About us · text',
  aboutTextLead: 'Edit the section texts in Swedish and English. Each field is saved separately.',
  aboutLoading: 'Loading content …',
  aboutLangSwedish: 'Swedish',
  aboutLangEnglish: 'English',
  aboutSave: 'Save',
  aboutSaving: 'Saving …',
  aboutSaved: 'Saved',
  aboutFieldEyebrow: 'Label (eyebrow)',
  aboutFieldHeading: 'Heading',
  aboutFieldIntro: 'Intro',
  aboutFieldGalleryTitle: 'Gallery title (salon)',
  aboutFieldCutsTitle: 'Gallery title (cuts)',
  aboutFieldStylistsTitle: 'Barbers title',
  aboutFieldReviewsTitle: 'Reviews title',
  aboutGallerySalonTitle: 'Gallery · In the salon',
  aboutGalleryCutsTitle: 'Gallery · Work we did',
  aboutGalleryLead: 'Upload images to the gallery and remove the ones you do not want to show.',
  aboutGalleryAltLabel: 'Alt text (description)',
  aboutGalleryFileLabel: 'Image file',
  aboutGalleryUploading: 'Uploading …',
  aboutGalleryLoading: 'Loading gallery …',
  aboutGalleryEmpty: 'No images yet.',
  aboutGalleryUploadedOk: 'Image uploaded.',
  aboutGalleryDeletedOk: 'Image removed.',
  aboutGalleryRemove: 'Remove',
  aboutGalleryDeleteTitle: 'Remove image?',
  aboutGalleryDeleteBody:
    'The image will be removed from the gallery and storage. This cannot be undone.',
  aboutGalleryDeleteCancel: 'Cancel',
  loginErrorEmptyFields: 'Fill in both email and password.',
  loginNotConfiguredPre:
    'The admin panel requires the live backend, which is not configured in this environment. Set',
  loginNotConfiguredMid: 'and',
  loginNotConfiguredPost: 'to enable sign-in.',
  loginEmailLabel: 'Email',
  loginPasswordLabel: 'Password',
  loginSubmitting: 'Signing in …',
  loginSubmit: 'Log in',
  loginKicker: 'ADMIN PANEL',
  loginBackToSite: '‹ To the website',
  loginBackToSiteAria: 'Blade & Blend Studio — to the website',
  loginHeading: 'Log in',
  loginLead: 'Manage your schedule and bookings.',
  loginChangePasswordLink: 'Change password',
  loginForgotPasswordLink: 'Forgot password?',
  authToSignIn: 'To sign-in',
  authBackToSignIn: 'Back to sign-in',
  changePwSubtitle: 'Change password',
  changePwSuccess: 'Your password has been changed. Sign in with your new password.',
  changePwEmailLabel: 'Email',
  changePwCurrentPassword: 'Current password',
  changePwNewPassword: 'New password',
  changePwConfirmPassword: 'Confirm new password',
  changePwSaving: 'Saving …',
  changePwSubmit: 'Change password',
  forgotPwSubtitle: 'Forgot password',
  forgotPwSuccess:
    'If an account with that address exists, we have sent a reset link. Check your inbox (and your spam folder).',
  forgotPwEmailLabel: 'Email',
  forgotPwSending: 'Sending …',
  forgotPwSubmit: 'Send reset link',
  forcedPwSubtitle: 'Change your password',
  forcedPwIntro:
    'Your account has a temporary password. You must choose a new one to access the panel.',
  forcedPwNewPassword: 'New password',
  forcedPwConfirmPassword: 'Confirm new password',
  forcedPwClearError: 'Your password was changed, but a network error occurred. Contact the owner.',
  forcedPwSaving: 'Saving …',
  forcedPwSubmit: 'Change password',
  resetPwSubtitle: 'Reset password',
  resetPwInvalidLink:
    'The reset link is invalid or has expired. Request a new one on the sign-in page.',
  resetPwChecking: 'Checking the link …',
  resetPwSuccess: 'Your password has been updated. Sign in with your new password.',
  resetPwNewPassword: 'New password',
  resetPwConfirmPassword: 'Confirm new password',
  resetPwSaving: 'Saving …',
  resetPwSubmit: 'Save new password',
}

// --- Accessor (same pattern as bookingStrings / appStrings in index.ts) -------------------------

export function adminText(lang: Lang): AdminStrings {
  return lang === 'en' ? EN : SV
}

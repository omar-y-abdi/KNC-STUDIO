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
}

// --- Swedish (default) ---------------------------------------------------------------------------

const SV: AdminStrings = {
  tabSchedule: 'Mitt schema',
  tabBookings: 'Mina bokningar',
  tabAllBookings: 'Alla bokningar',
  tabBarbers: 'Barberare',
  tabAbout: 'Om oss',
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
  scheduleTimeOffLead: 'Blockera en dag eller en period (semester, ledig dag). Blockerade datum visas inte som bokningsbara.',
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
  scheduleGridLead: 'Välj dag, tryck på en timme och blockera kvartarna som är upptagna (t.ex. bokat via sms) — sparas direkt. Tryck igen för att öppna.',
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
  barbersTitle: 'Barberare',
  barbersLead: 'Lägg till, redigera och dölj barberare. Klicka på "Skapa inloggning" för en ej kopplad barberare för att ge dem ett inloggningskonto.',
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
  barbersDefaultPasswordNote: 'Konto skapat. Tillfälligt lösenord: 123456 — barberaren byter det vid första inloggningen.',
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
}

// --- English -------------------------------------------------------------------------------------

const EN: AdminStrings = {
  tabSchedule: 'My schedule',
  tabBookings: 'My bookings',
  tabAllBookings: 'All bookings',
  tabBarbers: 'Barbers',
  tabAbout: 'About us',
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
  scheduleTimeOffLead: 'Block a day or a period (holiday, day off). Blocked dates will not be available for booking.',
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
  scheduleGridLead: 'Select a day, tap an hour and block the quarters that are taken (e.g. booked by text) — saved immediately. Tap again to open.',
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
  barbersTitle: 'Barbers',
  barbersLead: 'Add, edit and hide barbers. Click "Create login" for an unlinked barber to give them a login account.',
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
  barbersDefaultPasswordNote: 'Account created. Temporary password: 123456 — the barber changes it at first login.',
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
  aboutGalleryDeleteBody: 'The image will be removed from the gallery and storage. This cannot be undone.',
  aboutGalleryDeleteCancel: 'Cancel',
}

// --- Accessor (same pattern as bookingStrings / appStrings in index.ts) -------------------------

export function adminText(lang: Lang): AdminStrings {
  return lang === 'en' ? EN : SV
}

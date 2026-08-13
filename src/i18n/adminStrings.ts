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
  readonly tabSettings: string
  readonly tabMail: string
  // Mail (owner-only transactional email copy)
  readonly mailTitle: string
  readonly mailLead: string
  readonly mailLoading: string
  readonly mailPlaceholderHelp: string
  readonly mailSwedish: string
  readonly mailEnglish: string
  readonly mailSubject: string
  readonly mailPreheader: string
  readonly mailHeading: string
  readonly mailIntro: string
  readonly mailSectionTitle: string
  readonly mailNote: string
  readonly mailButton: string
  readonly mailContact: string
  readonly mailSave: string
  readonly mailSaving: string
  readonly mailSaved: string
  // Settings (authenticated owner/barber account)
  readonly settingsTitle: string
  readonly settingsLead: string
  readonly settingsEmailTitle: string
  readonly settingsEmailLead: string
  readonly settingsCurrentEmail: string
  readonly settingsNewEmail: string
  readonly settingsEmailPlaceholder: string
  readonly settingsEmailInvalid: string
  readonly settingsEmailSame: string
  readonly settingsEmailSaving: string
  readonly settingsEmailSubmit: string
  readonly settingsEmailSent: string
  readonly settingsPasswordTitle: string
  readonly settingsPasswordLead: string
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
  readonly siteBusinessTitle: string
  readonly siteBusinessLead: string
  readonly siteFieldBusinessName: string
  readonly siteFieldBusinessEmail: string
  readonly siteFieldBusinessPhoneDisplay: string
  readonly siteFieldBusinessPhoneTel: string
  readonly siteFieldBusinessStreet: string
  readonly siteFieldBusinessPostalCode: string
  readonly siteFieldBusinessCity: string
  readonly siteFieldBusinessMapsUrl: string
  readonly siteFieldCancellationPolicyHours: string
  readonly siteSeoTitle: string
  readonly siteSeoLead: string
  readonly siteFieldSeoTitle: string
  readonly siteFieldSeoDescription: string
  readonly siteFieldKicker: string
  readonly siteFieldHours: string
  readonly siteBookingTextTitle: string
  readonly siteBookingTextLead: string
  readonly siteBookingDetailsGroup: string
  readonly siteBookingConfirmationGroup: string
  readonly siteFieldYourDetails: string
  readonly siteFieldSummary: string
  readonly siteFieldBarberLabel: string
  readonly siteFieldWhenLabel: string
  readonly siteFieldServiceLabel: string
  readonly siteFieldTotalLabel: string
  readonly siteFieldNameLabel: string
  readonly siteFieldNamePlaceholder: string
  readonly siteFieldPhoneLabel: string
  readonly siteFieldPhonePlaceholder: string
  readonly siteFieldPolicy: string
  readonly siteFieldBookedTitle: string
  readonly siteFieldConfirmSent: string
  readonly siteFieldAddToCal: string
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
  // Kalender-koppling (Google Calendar-sync) — barberns "Mina bokningar".
  readonly calendarConnect: string
  readonly calendarConnecting: string
  readonly calendarConnected: string
  readonly calendarDisconnect: string
  readonly calendarDisconnecting: string
  readonly calendarHint: string
  readonly calendarLoading: string
  readonly calendarSyncErrorPrefix: string
  readonly calendarOpenApp: string
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
  // BookingsView — 3-section switcher (Kommande/Avbokade/Tidigare) + Avbokade empty state
  readonly bookingsSectionCancelled: string
  readonly bookingsEmptyCancelled: string
  // BookingsView — multi-select history clearing (Tidigare + Avbokade only)
  readonly bookingsSelectWeek: string
  readonly bookingsSelectAll: string
  /** Label of the delete-selected action; the count is interpolated in the view. */
  readonly bookingsClearSelected: string
  readonly bookingsClearTitle: string
  readonly bookingsClearBody: string
  readonly bookingsClearConfirm: string
  readonly bookingsClearCancel: string
  readonly bookingsClearedOk: string
  // BookingsView — owner-only global purge (type-to-confirm)
  readonly bookingsPurgeAll: string
  /** The token the owner must type to confirm the global purge (same literal in both languages). */
  readonly bookingsPurgeToken: string
  readonly bookingsPurgeTitle: string
  readonly bookingsPurgeBody: string
  readonly bookingsPurgeConfirm: string
  readonly bookingsPurgeCancel: string
  readonly bookingsPurgedOk: string
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
  readonly reserveService: string
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
  // Unavailability ↔ booking conflict (block day / veckoschema / ledighet that clashes with bookings)
  readonly unavailTitle: string
  readonly unavailLead: string
  readonly unavailExplainCancel: string
  readonly unavailExplainKeep: string
  readonly unavailCancelBtn: string
  readonly unavailKeepBtn: string
  readonly unavailAbortBtn: string
  readonly unavailBusy: string
  readonly unavailCancelError: string
  readonly unavailCancelledTitle: string
  readonly unavailCancelledLead: string
  readonly unavailNoPhone: string
  readonly unavailClose: string
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
  readonly barbersResendInvite: string
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
  readonly barbersResending: string
  readonly barbersCancel: string
  // BarbersView — notices + validation
  readonly barbersUpdatedOk: string
  readonly barbersHiddenOk: string
  readonly barbersActivatedOk: string
  readonly barbersAddedOk: string
  readonly barbersIdError: string
  readonly barbersNameRequired: string
  readonly barbersEmailError: string
  readonly barbersInviteSentNote: string
  // BarbersView — delete flow (type-the-id confirm + has-bookings purge confirm)
  readonly barbersDelete: string
  readonly barbersDeleteTitle: string
  /** Body of the type-to-confirm dialog. `{name}` is interpolated with the barber's name. */
  readonly barbersDeleteBody: string
  readonly barbersDeleteConfirm: string
  readonly barbersDeleteCancel: string
  /** Purge confirm body. `{count}`/`{past}`/`{upcoming}` are interpolated with the booking counts. */
  readonly barbersDeleteBookingsBody: string
  readonly barbersDeleteBookingsConfirm: string
  readonly barbersDeleteBookingsCancel: string
  readonly barbersDeletedOk: string
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
  readonly loginForgotPasswordLink: string
  // Shared auth links (identical across the password screens)
  readonly authToSignIn: string
  readonly authBackToSignIn: string
  // Settings password form
  readonly changePwSuccess: string
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
  readonly resetPwIntro: string
  readonly resetPwContinue: string
  readonly resetPwInvalidLink: string
  readonly resetPwChecking: string
  readonly resetPwSuccess: string
  readonly resetPwNewPassword: string
  readonly resetPwConfirmPassword: string
  readonly resetPwSaving: string
  readonly resetPwSubmit: string
  // ResetPasswordPage (`/invite` staff invitation landing)
  readonly invitePwSubtitle: string
  readonly invitePwIntro: string
  readonly invitePwContinue: string
  readonly invitePwInvalidLink: string
  readonly invitePwChecking: string
  readonly invitePwSuccess: string
  readonly invitePwNewPassword: string
  readonly invitePwConfirmPassword: string
  readonly invitePwSaving: string
  readonly invitePwSubmit: string
  // EmailChangeConfirmPage (`/auth/confirm`)
  readonly emailChangeConfirmSubtitle: string
  readonly emailChangeConfirmIntro: string
  readonly emailChangeConfirmSubmit: string
  readonly emailChangeConfirming: string
  readonly emailChangeConfirmSuccess: string
  readonly emailChangeConfirmInvalid: string
  readonly emailChangeConfirmToAdmin: string
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
  tabSettings: 'Inställningar',
  tabMail: 'Mejl',
  mailTitle: 'Mejlmallar',
  mailLead:
    'Redigera all fast text som kunder och barberare ser. Varumärket, kontaktuppgifterna och bokningens faktiska uppgifter är låsta.',
  mailLoading: 'Laddar mejlmallar …',
  mailPlaceholderHelp: 'Dynamiska värden',
  mailSwedish: 'Svenska',
  mailEnglish: 'Engelska',
  mailSubject: 'Ämnesrad',
  mailPreheader: 'Förhandsvisning i inkorgen',
  mailHeading: 'Huvudrubrik',
  mailIntro: 'Inledning',
  mailSectionTitle: 'Rubrik ovanför bokningsuppgifterna',
  mailNote: 'Information under bokningsuppgifterna',
  mailButton: 'Knapptext',
  mailContact: 'Text före telefonnumret',
  mailSave: 'Spara mall',
  mailSaving: 'Sparar …',
  mailSaved: 'Sparat',
  settingsTitle: 'Inställningar',
  settingsLead: 'Hantera inloggningsuppgifterna för ditt konto.',
  settingsEmailTitle: 'E‑post',
  settingsEmailLead: 'Bekräfta ändringen via länken som skickas till din nya e‑postadress.',
  settingsCurrentEmail: 'Nuvarande e‑post',
  settingsNewEmail: 'Ny e‑post',
  settingsEmailPlaceholder: 'namn@exempel.se',
  settingsEmailInvalid: 'Ange en giltig e‑postadress.',
  settingsEmailSame: 'Den nya e‑postadressen måste skilja sig från den nuvarande.',
  settingsEmailSaving: 'Skickar …',
  settingsEmailSubmit: 'Skicka bekräftelse',
  settingsEmailSent:
    'En bekräftelselänk har skickats till den nya adressen. E‑postadressen ändras när den nya adressen har bekräftats.',
  settingsPasswordTitle: 'Lösenord',
  settingsPasswordLead: 'Ange ditt nuvarande lösenord innan du väljer ett nytt.',
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
  siteBusinessTitle: 'Företagsuppgifter',
  siteBusinessLead:
    'Visas på hemsidan, i bokningens kalenderlänkar och i strukturerad sökdata. Telefonnummer för länk ska vara siffror med valfritt + i början.',
  siteFieldBusinessName: 'Företagsnamn',
  siteFieldBusinessEmail: 'Kontaktadress för e-post',
  siteFieldBusinessPhoneDisplay: 'Telefonnummer som visas',
  siteFieldBusinessPhoneTel: 'Telefonnummer för ringlänk',
  siteFieldBusinessStreet: 'Gatuadress',
  siteFieldBusinessPostalCode: 'Postnummer',
  siteFieldBusinessCity: 'Ort',
  siteFieldBusinessMapsUrl: 'Kartlänk',
  siteFieldCancellationPolicyHours: 'Avbokning senast (timmar före besöket)',
  siteSeoTitle: 'SEO',
  siteSeoLead:
    'Titlar och beskrivningar uppdaterar sidans metadata när besökaren väljer språk. Håll titlar korta och beskrivningar tydliga.',
  siteFieldSeoTitle: 'Sidtitel',
  siteFieldSeoDescription: 'Metabeskrivning',
  siteFieldKicker: 'Underrubrik (t.ex. "BARBERSHOP · GÖTEBORG")',
  siteFieldHours: 'Öppettider',
  siteBookingTextTitle: 'Bokningens popuptexter',
  siteBookingTextLead:
    'Redigera alla synliga texter utom knappar. Barberare, Tid och Behandling används i båda rutorna. Behåll {email} och {phone} där kundens uppgifter ska visas.',
  siteBookingDetailsGroup: 'Före bokning',
  siteBookingConfirmationGroup: 'Efter bokning',
  siteFieldYourDetails: 'Popupens rubrik',
  siteFieldSummary: 'Bokningssammanfattningens rubrik',
  siteFieldBarberLabel: 'Etikett: Barberare (båda rutorna)',
  siteFieldWhenLabel: 'Etikett: Tid (båda rutorna)',
  siteFieldServiceLabel: 'Etikett: Behandling (båda rutorna)',
  siteFieldTotalLabel: 'Etikett: Att betala',
  siteFieldNameLabel: 'Etikett: Namn',
  siteFieldNamePlaceholder: 'Platshållare: Namn',
  siteFieldPhoneLabel: 'Etikett: Telefon',
  siteFieldPhonePlaceholder: 'Platshållare: Telefon',
  siteFieldPolicy: 'Meddelande före bokning',
  siteFieldBookedTitle: 'Bekräftelserubrik',
  siteFieldConfirmSent: 'Bokningsbekräftelse ({email} = kundens e-post, {phone} = kundens nummer)',
  siteFieldAddToCal: 'Rubrik ovanför kalenderalternativen',
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
  calendarConnect: 'Koppla kalender',
  calendarConnecting: 'Öppnar Google…',
  calendarConnected: 'Kalender kopplad',
  calendarDisconnect: 'Koppla loss',
  calendarDisconnecting: 'Kopplar loss…',
  calendarHint: 'Få dina bokningar direkt i Google Calendar-appen (iPhone + Android).',
  calendarLoading: 'Laddar kalenderstatus…',
  calendarSyncErrorPrefix: 'Senaste synk misslyckades:',
  calendarOpenApp: 'Öppna Google Calendar',
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
  bookingsSectionCancelled: 'Avbokade',
  bookingsEmptyCancelled: 'Inga avbokade bokningar.',
  bookingsSelectWeek: 'Markera veckan',
  bookingsSelectAll: 'Markera alla',
  bookingsClearSelected: 'Radera markerade',
  bookingsClearTitle: 'Radera markerade bokningar?',
  bookingsClearBody: 'Detta raderar de markerade bokningarna permanent.',
  bookingsClearConfirm: 'Radera',
  bookingsClearCancel: 'Avbryt',
  bookingsClearedOk: 'Bokningarna raderades.',
  bookingsPurgeAll: 'Töm all historik',
  bookingsPurgeToken: 'RADERA ALLT',
  bookingsPurgeTitle: 'Töm ALL historik?',
  bookingsPurgeBody:
    'Detta raderar alla barberares tidigare och avbokade bokningar permanent. Skriv token nedan för att bekräfta.',
  bookingsPurgeConfirm: 'Töm historik',
  bookingsPurgeCancel: 'Avbryt',
  bookingsPurgedOk: 'All historik tömd.',
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
    'Välj dag, tryck på en timme och blockera kvartarna som är upptagna (t.ex. manuellt bokat) — sparas direkt. Tryck igen för att öppna.',
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
  reserveService: 'Tjänst',
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
  unavailTitle: 'Kunder är bokade',
  unavailLead: 'Följande kunder är bokade under tiden du vill vara borta:',
  unavailExplainCancel: 'Avboka kunder – avbokar kunderna nedan och gör dig ledig.',
  unavailExplainKeep:
    'Ha kvar kunder – kunderna behåller sina tider; resten av tiden blockeras för nya bokningar.',
  unavailCancelBtn: 'Avboka kunder',
  unavailKeepBtn: 'Ha kvar kunder, blockera resten',
  unavailAbortBtn: 'Avbryt',
  unavailBusy: 'Avbokar …',
  unavailCancelError:
    'Avbokade {done} av {total} kunder. Kunde inte avboka resten – försök igen, behåll resten, eller avbryt.',
  unavailCancelledTitle: 'Avbokade kunder',
  unavailCancelledLead: 'Dessa bokningar har avbokats:',
  unavailNoPhone: 'Inget nummer',
  unavailClose: 'Stäng',
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
  barbersResendInvite: 'Skicka ny inbjudan',
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
  barbersResending: 'Skickar …',
  barbersCancel: 'Avbryt',
  barbersUpdatedOk: 'Barberaren uppdaterad.',
  barbersHiddenOk: 'Barberaren dold.',
  barbersActivatedOk: 'Barberaren aktiv.',
  barbersAddedOk: 'Barberare tillagd.',
  barbersIdError: 'Id får bara innehålla a–z, 0–9 och bindestreck (max 32).',
  barbersNameRequired: 'Namn krävs.',
  barbersEmailError: 'Ange en giltig e-postadress.',
  barbersInviteSentNote:
    'Inbjudan skickad. Barberaren skapar sitt personliga lösenord via länken i mejlet.',
  barbersDelete: 'Radera',
  barbersDeleteTitle: 'Radera barberare?',
  barbersDeleteBody:
    'Barberaren {name} tas bort permanent. Detta går inte att ångra. Skriv barberarens id nedan för att bekräfta.',
  barbersDeleteConfirm: 'Radera',
  barbersDeleteCancel: 'Avbryt',
  barbersDeleteBookingsBody:
    'Barberaren har {count} bokningar ({past} tidigare, {upcoming} kommande). Radera dem också?',
  barbersDeleteBookingsConfirm: 'Radera allt',
  barbersDeleteBookingsCancel: 'Avbryt',
  barbersDeletedOk: 'Barberaren raderad.',
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
  loginForgotPasswordLink: 'Glömt lösenord?',
  authToSignIn: 'Till inloggning',
  authBackToSignIn: 'Tillbaka till inloggning',
  changePwSuccess: 'Lösenordet är ändrat.',
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
  resetPwIntro: 'Fortsätt för att kontrollera länken och välja ett nytt lösenord.',
  resetPwContinue: 'Fortsätt',
  resetPwInvalidLink:
    'Återställningslänken är ogiltig eller har gått ut. Begär en ny på inloggningssidan.',
  resetPwChecking: 'Kontrollerar länken …',
  resetPwSuccess: 'Ditt lösenord är uppdaterat. Logga in med ditt nya lösenord.',
  resetPwNewPassword: 'Nytt lösenord',
  resetPwConfirmPassword: 'Bekräfta nytt lösenord',
  resetPwSaving: 'Sparar …',
  resetPwSubmit: 'Spara nytt lösenord',
  invitePwSubtitle: 'Aktivera ditt konto',
  invitePwIntro: 'Fortsätt för att kontrollera inbjudan och skapa ditt personliga lösenord.',
  invitePwContinue: 'Öppna inbjudan',
  invitePwInvalidLink: 'Inbjudan är ogiltig eller har gått ut. Be ägaren skicka en ny.',
  invitePwChecking: 'Kontrollerar inbjudan …',
  invitePwSuccess: 'Ditt konto är aktiverat. Logga in med ditt nya lösenord.',
  invitePwNewPassword: 'Välj lösenord',
  invitePwConfirmPassword: 'Bekräfta lösenord',
  invitePwSaving: 'Aktiverar …',
  invitePwSubmit: 'Aktivera konto',
  emailChangeConfirmSubtitle: 'Bekräfta ny e‑postadress',
  emailChangeConfirmIntro:
    'Bekräfta ändringen med knappen nedan. Din e‑postadress ändras direkt efter bekräftelsen.',
  emailChangeConfirmSubmit: 'Bekräfta e‑postadress',
  emailChangeConfirming: 'Bekräftar …',
  emailChangeConfirmSuccess: 'Din e‑postadress är ändrad.',
  emailChangeConfirmInvalid:
    'Bekräftelselänken är ogiltig eller har gått ut. Logga in och skicka en ny länk från Inställningar.',
  emailChangeConfirmToAdmin: 'Till adminpanelen',
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
  tabSettings: 'Settings',
  tabMail: 'Mail',
  mailTitle: 'Email templates',
  mailLead:
    'Edit all fixed copy customers and barbers see. Brand, contact details, and actual booking data remain locked.',
  mailLoading: 'Loading email templates …',
  mailPlaceholderHelp: 'Dynamic values',
  mailSwedish: 'Swedish',
  mailEnglish: 'English',
  mailSubject: 'Subject',
  mailPreheader: 'Inbox preview',
  mailHeading: 'Main heading',
  mailIntro: 'Introduction',
  mailSectionTitle: 'Heading above booking details',
  mailNote: 'Information below booking details',
  mailButton: 'Button label',
  mailContact: 'Copy before phone number',
  mailSave: 'Save template',
  mailSaving: 'Saving …',
  mailSaved: 'Saved',
  settingsTitle: 'Settings',
  settingsLead: 'Manage your account sign-in details.',
  settingsEmailTitle: 'Email',
  settingsEmailLead: 'Confirm the change using the link sent to your new email address.',
  settingsCurrentEmail: 'Current email',
  settingsNewEmail: 'New email',
  settingsEmailPlaceholder: 'name@example.com',
  settingsEmailInvalid: 'Enter a valid email address.',
  settingsEmailSame: 'The new email address must differ from the current one.',
  settingsEmailSaving: 'Sending …',
  settingsEmailSubmit: 'Send confirmation',
  settingsEmailSent:
    'A confirmation link has been sent to the new address. The email changes after the new address is confirmed.',
  settingsPasswordTitle: 'Password',
  settingsPasswordLead: 'Enter your current password before choosing a new one.',
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
  siteBusinessTitle: 'Business details',
  siteBusinessLead:
    'Shown on the site, in booking calendar links, and in structured search data. The phone link value must contain digits with an optional leading +.',
  siteFieldBusinessName: 'Business name',
  siteFieldBusinessEmail: 'Contact email address',
  siteFieldBusinessPhoneDisplay: 'Displayed phone number',
  siteFieldBusinessPhoneTel: 'Phone number for call link',
  siteFieldBusinessStreet: 'Street address',
  siteFieldBusinessPostalCode: 'Postal code',
  siteFieldBusinessCity: 'City',
  siteFieldBusinessMapsUrl: 'Map URL',
  siteFieldCancellationPolicyHours: 'Cancellation deadline (hours before appointment)',
  siteSeoTitle: 'SEO',
  siteSeoLead:
    'Titles and descriptions update the page metadata when a visitor selects a language. Keep titles concise and descriptions clear.',
  siteFieldSeoTitle: 'Page title',
  siteFieldSeoDescription: 'Meta description',
  siteFieldKicker: 'Sub-heading (e.g. "BARBERSHOP · GOTHENBURG")',
  siteFieldHours: 'Opening hours',
  siteBookingTextTitle: 'Booking pop-up text',
  siteBookingTextLead:
    'Edit every visible string except buttons. Barber, Time and Service are shared by both dialogs. Keep {email} and {phone} where the customer details should appear.',
  siteBookingDetailsGroup: 'Before booking',
  siteBookingConfirmationGroup: 'After booking',
  siteFieldYourDetails: 'Pop-up heading',
  siteFieldSummary: 'Booking summary heading',
  siteFieldBarberLabel: 'Label: Barber (both dialogs)',
  siteFieldWhenLabel: 'Label: Time (both dialogs)',
  siteFieldServiceLabel: 'Label: Service (both dialogs)',
  siteFieldTotalLabel: 'Label: Total',
  siteFieldNameLabel: 'Label: Name',
  siteFieldNamePlaceholder: 'Placeholder: Name',
  siteFieldPhoneLabel: 'Label: Phone',
  siteFieldPhonePlaceholder: 'Placeholder: Phone',
  siteFieldPolicy: 'Notice before booking',
  siteFieldBookedTitle: 'Confirmation heading',
  siteFieldConfirmSent:
    'Booking confirmation ({email} = customer email, {phone} = customer number)',
  siteFieldAddToCal: 'Heading above calendar options',
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
  calendarConnect: 'Connect calendar',
  calendarConnecting: 'Opening Google…',
  calendarConnected: 'Calendar connected',
  calendarDisconnect: 'Disconnect',
  calendarDisconnecting: 'Disconnecting…',
  calendarHint: 'Get your bookings straight into the Google Calendar app (iPhone + Android).',
  calendarLoading: 'Loading calendar status…',
  calendarSyncErrorPrefix: 'Last sync failed:',
  calendarOpenApp: 'Open Google Calendar',
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
  bookingsSectionCancelled: 'Cancelled',
  bookingsEmptyCancelled: 'No cancelled bookings.',
  bookingsSelectWeek: 'Select week',
  bookingsSelectAll: 'Select all',
  bookingsClearSelected: 'Delete selected',
  bookingsClearTitle: 'Delete selected bookings?',
  bookingsClearBody: 'This permanently deletes the selected bookings.',
  bookingsClearConfirm: 'Delete',
  bookingsClearCancel: 'Cancel',
  bookingsClearedOk: 'The bookings were deleted.',
  bookingsPurgeAll: 'Clear all history',
  bookingsPurgeToken: 'RADERA ALLT',
  bookingsPurgeTitle: 'Clear ALL history?',
  bookingsPurgeBody:
    'This permanently deletes the past and cancelled bookings of every barber. Type the token below to confirm.',
  bookingsPurgeConfirm: 'Clear history',
  bookingsPurgeCancel: 'Cancel',
  bookingsPurgedOk: 'All history cleared.',
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
  reserveService: 'Service',
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
  unavailTitle: 'Customers are booked',
  unavailLead: 'These customers are booked during the time you want off:',
  unavailExplainCancel: 'Cancel customers – cancels the customers below and frees you up.',
  unavailExplainKeep:
    'Keep customers – they keep their times; the rest is blocked for new bookings.',
  unavailCancelBtn: 'Cancel customers',
  unavailKeepBtn: 'Keep customers, block the rest',
  unavailAbortBtn: 'Back',
  unavailBusy: 'Cancelling …',
  unavailCancelError:
    "Cancelled {done} of {total} customers. Couldn't cancel the rest — try again, keep the rest, or go back.",
  unavailCancelledTitle: 'Cancelled bookings',
  unavailCancelledLead: 'These bookings have been cancelled:',
  unavailNoPhone: 'No number',
  unavailClose: 'Close',
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
  barbersResendInvite: 'Send new invitation',
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
  barbersResending: 'Sending …',
  barbersCancel: 'Cancel',
  barbersUpdatedOk: 'Barber updated.',
  barbersHiddenOk: 'Barber hidden.',
  barbersActivatedOk: 'Barber active.',
  barbersAddedOk: 'Barber added.',
  barbersIdError: 'Id may only contain a–z, 0–9 and hyphens (max 32).',
  barbersNameRequired: 'Name is required.',
  barbersEmailError: 'Enter a valid email address.',
  barbersInviteSentNote:
    'Invitation sent. The barber creates a personal password through the email link.',
  barbersDelete: 'Delete',
  barbersDeleteTitle: 'Delete barber?',
  barbersDeleteBody:
    'The barber {name} is permanently deleted. This cannot be undone. Type the barber id below to confirm.',
  barbersDeleteConfirm: 'Delete',
  barbersDeleteCancel: 'Cancel',
  barbersDeleteBookingsBody:
    'This barber has {count} bookings ({past} past, {upcoming} upcoming). Delete them too?',
  barbersDeleteBookingsConfirm: 'Delete all',
  barbersDeleteBookingsCancel: 'Cancel',
  barbersDeletedOk: 'Barber deleted.',
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
  loginForgotPasswordLink: 'Forgot password?',
  authToSignIn: 'To sign-in',
  authBackToSignIn: 'Back to sign-in',
  changePwSuccess: 'Your password has been changed.',
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
  resetPwIntro: 'Continue to verify the link and choose a new password.',
  resetPwContinue: 'Continue',
  resetPwInvalidLink:
    'The reset link is invalid or has expired. Request a new one on the sign-in page.',
  resetPwChecking: 'Checking the link …',
  resetPwSuccess: 'Your password has been updated. Sign in with your new password.',
  resetPwNewPassword: 'New password',
  resetPwConfirmPassword: 'Confirm new password',
  resetPwSaving: 'Saving …',
  resetPwSubmit: 'Save new password',
  invitePwSubtitle: 'Activate your account',
  invitePwIntro: 'Continue to verify the invitation and create your personal password.',
  invitePwContinue: 'Open invitation',
  invitePwInvalidLink: 'The invitation is invalid or has expired. Ask the owner for a new one.',
  invitePwChecking: 'Checking the invitation …',
  invitePwSuccess: 'Your account is active. Sign in with your new password.',
  invitePwNewPassword: 'Choose password',
  invitePwConfirmPassword: 'Confirm password',
  invitePwSaving: 'Activating …',
  invitePwSubmit: 'Activate account',
  emailChangeConfirmSubtitle: 'Confirm new email address',
  emailChangeConfirmIntro:
    'Confirm the change with the button below. Your email address changes immediately after confirmation.',
  emailChangeConfirmSubmit: 'Confirm email address',
  emailChangeConfirming: 'Confirming …',
  emailChangeConfirmSuccess: 'Your email address has been changed.',
  emailChangeConfirmInvalid:
    'The confirmation link is invalid or has expired. Sign in and send a new link from Settings.',
  emailChangeConfirmToAdmin: 'Go to admin panel',
}

// --- Accessor (same pattern as bookingStrings / appStrings in index.ts) -------------------------

export function adminText(lang: Lang): AdminStrings {
  return lang === 'en' ? EN : SV
}

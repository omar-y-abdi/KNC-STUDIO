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
}

// --- Accessor (same pattern as bookingStrings / appStrings in index.ts) -------------------------

export function adminText(lang: Lang): AdminStrings {
  return lang === 'en' ? EN : SV
}

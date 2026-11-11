import type { AdminStrings } from '../adminStrings'
import type { AdminTab } from '../adminTabs'
import type { TourId } from './tourModel'

/** A `data-tour` value on an existing panel element. */
export type TourAnchor =
  | 'nav'
  | 'nav-settings'
  | 'week-day'
  | 'day-hours'
  | 'breaks'
  | 'time-off'
  | 'calendar'
  | 'booking-sections'
  | 'service-active'
  | 'service-move'
  | 'service-new'
  | 'profile-upload'
  | 'profile-details'
  | 'profile-work'

export interface TourStep {
  readonly anchor: TourAnchor
  readonly title: keyof AdminStrings
  readonly body: keyof AdminStrings
  /** The phone menu dropdown while this step shows. */
  readonly menu: 'open' | 'closed'
  /** Preferred card side on desktop. */
  readonly side: 'right' | 'bottom'
}

export interface TourDef {
  readonly tab: AdminTab
  /** The tour decides which steps are available once this anchor exists. */
  readonly ready: TourAnchor
  readonly steps: readonly TourStep[]
}

export const TOURS: Readonly<Record<TourId, TourDef>> = {
  overview: {
    tab: 'schedule',
    ready: 'week-day',
    steps: [
      {
        anchor: 'nav',
        title: 'tourOverview1Title',
        body: 'tourOverview1Body',
        menu: 'open',
        side: 'right',
      },
      {
        anchor: 'week-day',
        title: 'tourOverview2Title',
        body: 'tourOverview2Body',
        menu: 'closed',
        side: 'bottom',
      },
      {
        anchor: 'nav-settings',
        title: 'tourOverview3Title',
        body: 'tourOverview3Body',
        menu: 'open',
        side: 'right',
      },
    ],
  },
  schedule: {
    tab: 'schedule',
    ready: 'week-day',
    steps: [
      {
        anchor: 'day-hours',
        title: 'tourSchedule1Title',
        body: 'tourSchedule1Body',
        menu: 'closed',
        side: 'bottom',
      },
      {
        anchor: 'breaks',
        title: 'tourSchedule2Title',
        body: 'tourSchedule2Body',
        menu: 'closed',
        side: 'bottom',
      },
      {
        anchor: 'time-off',
        title: 'tourSchedule3Title',
        body: 'tourSchedule3Body',
        menu: 'closed',
        side: 'bottom',
      },
    ],
  },
  bookings: {
    tab: 'bookings',
    ready: 'booking-sections',
    steps: [
      {
        anchor: 'calendar',
        title: 'tourBookings1Title',
        body: 'tourBookings1Body',
        menu: 'closed',
        side: 'bottom',
      },
      {
        anchor: 'booking-sections',
        title: 'tourBookings2Title',
        body: 'tourBookings2Body',
        menu: 'closed',
        side: 'bottom',
      },
    ],
  },
  services: {
    tab: 'services',
    ready: 'service-new',
    steps: [
      {
        anchor: 'service-active',
        title: 'tourServices1Title',
        body: 'tourServices1Body',
        menu: 'closed',
        side: 'bottom',
      },
      {
        anchor: 'service-move',
        title: 'tourServices2Title',
        body: 'tourServices2Body',
        menu: 'closed',
        side: 'bottom',
      },
      {
        anchor: 'service-new',
        title: 'tourServices3Title',
        body: 'tourServices3Body',
        menu: 'closed',
        side: 'bottom',
      },
    ],
  },
  profile: {
    tab: 'profile',
    ready: 'profile-work',
    steps: [
      {
        anchor: 'profile-upload',
        title: 'tourProfile1Title',
        body: 'tourProfile1Body',
        menu: 'closed',
        side: 'bottom',
      },
      {
        anchor: 'profile-details',
        title: 'tourProfile2Title',
        body: 'tourProfile2Body',
        menu: 'closed',
        side: 'bottom',
      },
      {
        anchor: 'profile-work',
        title: 'tourProfile3Title',
        body: 'tourProfile3Body',
        menu: 'closed',
        side: 'bottom',
      },
    ],
  },
}

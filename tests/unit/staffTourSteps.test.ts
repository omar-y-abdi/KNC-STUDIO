// The staff tutorial's steps and copy, pinned to the owner-approved design (tour-spec section 2).

import { describe, expect, expectTypeOf, it } from 'vitest'
import { adminText, type AdminStrings } from '../../modules/staff-admin/src/adminStrings'
import type { AdminTab } from '../../modules/staff-admin/src/adminTabs'
import { TOUR_IDS, type TourId } from '../../modules/staff-admin/src/tour/tourModel'
import { TOURS, type TourAnchor } from '../../modules/staff-admin/src/tour/tourSteps'

const LANGS = ['sv', 'en'] as const

const ALL_ANCHORS = [
  'nav',
  'nav-settings',
  'week-day',
  'day-hours',
  'breaks',
  'time-off',
  'calendar',
  'booking-sections',
  'service-active',
  'service-move',
  'service-new',
  'profile-upload',
  'profile-details',
  'profile-work',
] as const satisfies readonly TourAnchor[]

/** The tabs AdminShell shows a barber (`ownerOnly: false`). */
const BARBER_TABS: readonly AdminTab[] = ['schedule', 'bookings', 'services', 'profile', 'settings']

type Copy = readonly [titleSv: string, bodySv: string, titleEn: string, bodyEn: string]
interface SpecStep {
  readonly anchor: TourAnchor
  readonly menu: 'open' | 'closed'
  readonly side: 'right' | 'bottom'
  readonly copy: Copy
}
interface SpecTour {
  readonly tab: AdminTab
  readonly ready: TourAnchor
  readonly key: string
  readonly steps: readonly SpecStep[]
}

const SPEC: Readonly<Record<TourId, SpecTour>> = {
  overview: {
    tab: 'schedule',
    ready: 'week-day',
    key: 'Overview',
    steps: [
      {
        anchor: 'nav',
        menu: 'open',
        side: 'right',
        copy: [
          'Allt ligger i menyn',
          'Varje sida visar ett par korta tips första gången du öppnar den.',
          'Everything is in the menu',
          'Each page shows a few short tips the first time you open it.',
        ],
      },
      {
        anchor: 'week-day',
        menu: 'closed',
        side: 'bottom',
        copy: [
          'Slå på dagarna du jobbar',
          'Välj tider för varje dag. Ändringar sparas direkt.',
          'Turn on the days you work',
          'Set the hours for each day. Changes save at once.',
        ],
      },
      {
        anchor: 'nav-settings',
        menu: 'open',
        side: 'right',
        copy: [
          'Vill du se detta igen?',
          'Inställningar > Tutorial. Där kan du också ta bort den.',
          'Want to see this again?',
          'Settings > Tutorial. You can also remove it there.',
        ],
      },
    ],
  },
  schedule: {
    tab: 'schedule',
    ready: 'week-day',
    key: 'Schedule',
    steps: [
      {
        anchor: 'day-hours',
        menu: 'closed',
        side: 'bottom',
        copy: [
          'Tryck på en tid',
          'Boka in en kund själv eller blockera tiden.',
          'Tap a time',
          'Book a customer in yourself or block the time.',
        ],
      },
      {
        anchor: 'breaks',
        menu: 'closed',
        side: 'bottom',
        copy: [
          'Lägg in lunchen en gång',
          'Återkommande paus spärrar samma tid varje vecka.',
          'Add your lunch once',
          'A recurring break blocks the same time every week.',
        ],
      },
      {
        anchor: 'time-off',
        menu: 'closed',
        side: 'bottom',
        copy: [
          'Lägg in ledighet',
          'Välj datum. Kunder kan inte boka de dagarna.',
          'Add time off',
          'Pick the dates. Customers cannot book those days.',
        ],
      },
    ],
  },
  bookings: {
    tab: 'bookings',
    ready: 'booking-sections',
    key: 'Bookings',
    steps: [
      {
        anchor: 'calendar',
        menu: 'closed',
        side: 'bottom',
        copy: [
          'Koppla Google Calendar',
          'Då får du bokningarna i kalenderappen i mobilen.',
          'Connect Google Calendar',
          'Your bookings then show up in the calendar app on your phone.',
        ],
      },
      {
        anchor: 'booking-sections',
        menu: 'closed',
        side: 'bottom',
        copy: [
          'Byt lista här',
          'Kommande, avbokade och tidigare bokningar.',
          'Switch list here',
          'Upcoming, cancelled and past bookings.',
        ],
      },
    ],
  },
  services: {
    tab: 'services',
    ready: 'service-new',
    key: 'Services',
    steps: [
      {
        anchor: 'service-active',
        menu: 'closed',
        side: 'bottom',
        copy: [
          'Dölj en tjänst',
          'Bocka ur Aktiv och tryck Spara. Då ser kunder den inte.',
          'Hide a service',
          'Untick Active and press Save. Customers no longer see it.',
        ],
      },
      {
        anchor: 'service-move',
        menu: 'closed',
        side: 'bottom',
        copy: [
          'Ändra ordningen',
          'Pilarna flyttar tjänsten upp eller ner i kundens lista.',
          'Change the order',
          "The arrows move the service up or down in the customer's list.",
        ],
      },
      {
        anchor: 'service-new',
        menu: 'closed',
        side: 'bottom',
        copy: [
          'Lägg till en tjänst',
          'Fyll i namn, pris och längd. Kunder ser den när de bokar.',
          'Add a service',
          'Enter name, price and length. Customers see it when they book.',
        ],
      },
    ],
  },
  profile: {
    tab: 'profile',
    ready: 'profile-work',
    key: 'Profile',
    steps: [
      {
        anchor: 'profile-upload',
        menu: 'closed',
        side: 'bottom',
        copy: [
          'Ladda upp din bild',
          'Den visas i Om oss på hemsidan. Kvadratisk bild ser bäst ut.',
          'Upload your photo',
          'It shows in About us on the website. A square photo looks best.',
        ],
      },
      {
        anchor: 'profile-details',
        menu: 'closed',
        side: 'bottom',
        copy: [
          'Skriv om dig själv',
          'Namn, bio och dina @. Visas på hemsidan när du sparar.',
          'Tell people about you',
          'Name, bio and your @ handles. Shown on the website when you save.',
        ],
      },
      {
        anchor: 'profile-work',
        menu: 'closed',
        side: 'bottom',
        copy: [
          'Visa dina jobb',
          'Ladda upp bilder. De visas i galleriet med ditt @.',
          'Show your work',
          'Upload pictures. They show in the gallery with your @.',
        ],
      },
    ],
  },
}

const OTHER_STRINGS: readonly (readonly [keyof AdminStrings, string, string])[] = [
  ['tourNext', 'Nästa', 'Next'],
  ['tourBack', 'Tillbaka', 'Back'],
  ['tourDone', 'Klar', 'Done'],
  ['tourClose', 'Stäng', 'Close'],
  ['tourProgress', '{current} av {total}', '{current} of {total}'],
  ['tutorialTitle', 'Tutorial', 'Tutorial'],
  [
    'tutorialLead',
    'Visar hur sidan fungerar, steg för steg.',
    'Shows how the page works, step by step.',
  ],
  [
    'tutorialRemovedLead',
    'Borttagen. Den visas inte förrän du startar den igen.',
    'Removed. It will not show until you start it again.',
  ],
  ['tutorialReplay', 'Gå igenom igen', 'Run it again'],
  ['tutorialRemove', 'Ta bort', 'Remove'],
  ['tutorialSaveError', 'Kunde inte spara. Försök igen.', 'Could not save. Try again.'],
]

const allSteps = TOUR_IDS.flatMap((id) => TOURS[id].steps)

describe('tour copy limits', () => {
  it.each(LANGS)('%s: every title is at most 27 characters and every body at most 75', (lang) => {
    const t = adminText(lang)
    for (const step of allSteps) {
      expect(t[step.title].length, step.title).toBeLessThanOrEqual(27)
      expect(t[step.body].length, step.body).toBeLessThanOrEqual(75)
    }
  })

  it.each(LANGS)('%s: the button labels are at most 15 characters', (lang) => {
    const t = adminText(lang)
    for (const key of [
      'tourNext',
      'tourBack',
      'tourDone',
      'tutorialReplay',
      'tutorialRemove',
    ] as const)
      expect(t[key].length, key).toBeLessThanOrEqual(15)
  })

  it.each(LANGS)('%s: every tutorial string is NFC, so lengths count what is shown', (lang) => {
    const t = adminText(lang)
    const keys = [
      ...allSteps.flatMap((step) => [step.title, step.body]),
      ...OTHER_STRINGS.map(([k]) => k),
    ]
    for (const key of keys) expect(t[key], key).toBe(t[key].normalize('NFC'))
  })
})

describe('tour structure', () => {
  it('the anchor list names every anchor', () => {
    expectTypeOf<Exclude<TourAnchor, (typeof ALL_ANCHORS)[number]>>().toBeNever()
    expectTypeOf(TOURS.overview.ready).toEqualTypeOf<TourAnchor>()
    expectTypeOf(allSteps[0]?.anchor).toEqualTypeOf<TourAnchor | undefined>()
  })

  it.each(TOUR_IDS)('%s has 1 to 3 steps on a barber tab, anchors known and distinct', (id) => {
    const tour = TOURS[id]
    expect(tour.steps.length).toBeGreaterThanOrEqual(1)
    expect(tour.steps.length).toBeLessThanOrEqual(3)
    expect(BARBER_TABS).toContain(tour.tab)
    const known: readonly string[] = ALL_ANCHORS
    expect(known).toContain(tour.ready)
    for (const step of tour.steps) expect(known).toContain(step.anchor)
    expect(new Set(tour.steps.map((step) => step.anchor)).size).toBe(tour.steps.length)
  })

  it('only the overview opens the phone menu', () => {
    for (const id of TOUR_IDS) {
      const opening = TOURS[id].steps.filter((step) => step.menu === 'open')
      expect(opening.length > 0, id).toBe(id === 'overview')
    }
  })

  it.each(TOUR_IDS)('%s matches the spec: tab, ready anchor, steps and their keys', (id) => {
    const spec = SPEC[id]
    expect(TOURS[id]).toEqual({
      tab: spec.tab,
      ready: spec.ready,
      steps: spec.steps.map((step, index) => ({
        anchor: step.anchor,
        title: `tour${spec.key}${index + 1}Title`,
        body: `tour${spec.key}${index + 1}Body`,
        menu: step.menu,
        side: step.side,
      })),
    })
  })
})

describe('tour copy (owner-facing, verbatim)', () => {
  it.each(TOUR_IDS)('%s: Swedish and English titles and bodies', (id) => {
    const sv = adminText('sv')
    const en = adminText('en')
    expect(
      TOURS[id].steps.map((step) => [sv[step.title], sv[step.body], en[step.title], en[step.body]]),
    ).toEqual(SPEC[id].steps.map((step) => step.copy))
  })

  it.each(OTHER_STRINGS)('%s', (key, sv, en) => {
    expect(adminText('sv')[key]).toBe(sv)
    expect(adminText('en')[key]).toBe(en)
  })

  it('names the panel controls with the labels the panel shows', () => {
    const sv = adminText('sv')
    const en = adminText('en')
    expect(en.tourServices1Body).toContain(en.svcActive)
    expect(en.tourServices1Body).toContain(en.svcSave)
    expect(en.tourSchedule2Body).toContain(en.scheduleRecurringBreakToggle.toLowerCase())
    expect(sv.tourServices1Body).toContain(sv.svcActive)
    expect(sv.tourServices1Body).toContain(sv.svcSave)
    expect(sv.tourSchedule2Body).toContain(sv.scheduleRecurringBreakToggle)
  })
})

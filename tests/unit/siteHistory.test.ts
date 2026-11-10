import { describe, expect, it } from 'vitest'
import {
  entryOrigin,
  entryState,
  historyStep,
  myBookingsEntry,
  searchWithLanguage,
  sitePlace,
  viewStateAfterTraversal,
  viewStateForPath,
  type SiteLocation,
  type SitePlace,
} from '../../modules/public-web/src/app/siteHistory'

const at = (pathname: string, search = '', hash = ''): SiteLocation => ({ pathname, search, hash })
const home = { view: 'home', myBookingsOpen: false } as const
const booking = { view: 'booking', myBookingsOpen: false } as const

describe('sitePlace', () => {
  it.each([
    ['/', 'home'],
    ['/about', 'home'],
    ['/booking', 'booking'],
    ['/my-bookings', 'my-bookings'],
  ] as const)('reads %s as %s', (pathname, place) => {
    expect(sitePlace(pathname)).toBe(place)
  })

  it.each(['/login', '/admin', '/terms', '/booking/', '/my-bookings/x', `/${'a'.repeat(64)}`, ''])(
    'does not claim %s',
    (pathname) => {
      expect(sitePlace(pathname)).toBeNull()
    },
  )
})

describe('viewStateForPath', () => {
  it('shows the start view at / and /about whatever was showing', () => {
    expect(viewStateForPath('/', 'booking')).toEqual(home)
    expect(viewStateForPath('/about', 'booking')).toEqual(home)
  })

  it('shows booking at /booking', () => {
    expect(viewStateForPath('/booking', 'home')).toEqual(booking)
  })

  it('opens the dialog at /my-bookings over the view that was showing', () => {
    expect(viewStateForPath('/my-bookings', 'home')).toEqual({ view: 'home', myBookingsOpen: true })
    expect(viewStateForPath('/my-bookings', 'booking')).toEqual({
      view: 'booking',
      myBookingsOpen: true,
    })
  })

  it('says nothing about a path that is not the shell’s', () => {
    expect(viewStateForPath('/login', 'booking')).toBeNull()
  })
})

describe('viewStateAfterTraversal', () => {
  it('follows Back and Forward between the start view and booking', () => {
    expect(viewStateAfterTraversal('booking', '/', booking)).toEqual(home)
    expect(viewStateAfterTraversal('home', '/booking', home)).toEqual(booking)
  })

  it('closes the dialog when Back leaves its entry, keeping the view under it', () => {
    expect(
      viewStateAfterTraversal('my-bookings', '/', { view: 'home', myBookingsOpen: true }),
    ).toEqual(home)
    expect(
      viewStateAfterTraversal('my-bookings', '/booking', { view: 'booking', myBookingsOpen: true }),
    ).toEqual(booking)
  })

  it('opens the dialog again when Forward returns to its entry', () => {
    expect(viewStateAfterTraversal('booking', '/my-bookings', booking)).toEqual({
      view: 'booking',
      myBookingsOpen: true,
    })
  })

  it('leaves everything as it is for a step within one place', () => {
    // A customer link opened the dialog over `/`; the fragment step that delivered it stays at `/`.
    const linked = { view: 'home', myBookingsOpen: true } as const
    expect(viewStateAfterTraversal('home', '/', linked)).toBe(linked)
    expect(viewStateAfterTraversal('home', '/about', linked)).toBe(linked)
    expect(viewStateAfterTraversal('booking', '/booking', booking)).toBe(booking)
  })

  it('reads the address when the step arrives from a path that is not the shell’s', () => {
    expect(viewStateAfterTraversal(null, '/', booking)).toEqual(home)
  })

  it('decides nothing at a path that is not the shell’s', () => {
    expect(viewStateAfterTraversal('home', '/login', home)).toBeNull()
  })

  it('never asks for a further history step after arriving in another place', () => {
    const places: readonly (SitePlace | null)[] = ['home', 'booking', 'my-bookings', null]
    for (const pathname of ['/', '/about', '/booking', '/my-bookings'])
      for (const from of places.filter((place) => place !== sitePlace(pathname)))
        for (const current of [home, booking, { view: 'home', myBookingsOpen: true } as const]) {
          const arrived = viewStateAfterTraversal(from, pathname, current)
          if (arrived === null) throw new Error(`No view state for ${pathname}`)
          expect(historyStep(at(pathname), null, { ...arrived, lang: 'sv' })).toEqual({
            kind: 'none',
          })
        }
  })
})

describe('searchWithLanguage', () => {
  it.each([
    ['', 'sv', ''],
    ['', 'en', '?lang=en'],
    ['?lang=en', 'en', '?lang=en'],
    ['?lang=en', 'sv', ''],
    ['?mode=dark&lang=en', 'sv', '?mode=dark'],
    ['?mode=dark', 'en', '?mode=dark&lang=en'],
    ['?lang=sv&mode=dark', 'en', '?lang=en&mode=dark'],
    // Already Swedish: an explicit or unknown value is not rewritten.
    ['?lang=sv', 'sv', '?lang=sv'],
    ['?lang=de', 'sv', '?lang=de'],
    ['?lang=de', 'en', '?lang=en'],
  ] as const)('%s in %s becomes %s', (search, lang, expected) => {
    expect(searchWithLanguage(search, lang)).toBe(expected)
  })
})

describe('historyStep', () => {
  it('leaves an address alone that already names the view and the language', () => {
    expect(historyStep(at('/'), null, { ...home, lang: 'sv' })).toEqual({ kind: 'none' })
    expect(historyStep(at('/about'), null, { ...home, lang: 'sv' })).toEqual({ kind: 'none' })
    expect(historyStep(at('/booking', '?lang=en'), null, { ...booking, lang: 'en' })).toEqual({
      kind: 'none',
    })
  })

  it('pushes one entry for a change of view, keeping the query', () => {
    expect(historyStep(at('/'), null, { ...booking, lang: 'sv' })).toEqual({
      kind: 'push',
      url: '/booking',
    })
    expect(historyStep(at('/about'), null, { ...booking, lang: 'sv' })).toEqual({
      kind: 'push',
      url: '/booking',
    })
    expect(historyStep(at('/booking', '?mode=dark'), null, { ...home, lang: 'sv' })).toEqual({
      kind: 'push',
      url: '/?mode=dark',
    })
    expect(historyStep(at('/', '?mode=dark'), null, { ...booking, lang: 'en' })).toEqual({
      kind: 'push',
      url: '/booking?mode=dark&lang=en',
    })
  })

  it('replaces the entry for a change of language, keeping path, query and fragment', () => {
    expect(historyStep(at('/booking', '', '#x'), null, { ...booking, lang: 'en' })).toEqual({
      kind: 'replace',
      url: '/booking?lang=en#x',
    })
    expect(
      historyStep(at('/', '?lang=en&mode=dark', '#privacy-preferences'), null, {
        ...home,
        lang: 'sv',
      }),
    ).toEqual({ kind: 'replace', url: '/?mode=dark#privacy-preferences' })
    expect(historyStep(at('/about'), null, { ...home, lang: 'en' })).toEqual({
      kind: 'replace',
      url: '/about?lang=en',
    })
  })

  it('gives a dialog that a customer link opened no entry of its own', () => {
    expect(
      historyStep(at('/', '', '#keep=1'), null, { view: 'home', myBookingsOpen: true, lang: 'sv' }),
    ).toEqual({ kind: 'none' })
  })

  it('keeps /my-bookings while the dialog is open there', () => {
    const open = { view: 'booking', myBookingsOpen: true } as const
    expect(historyStep(at('/my-bookings'), '/booking', { ...open, lang: 'sv' })).toEqual({
      kind: 'none',
    })
    expect(historyStep(at('/my-bookings'), '/booking', { ...open, lang: 'en' })).toEqual({
      kind: 'replace',
      url: '/my-bookings?lang=en',
    })
  })

  it('goes back to the entry the closed dialog was opened from', () => {
    expect(historyStep(at('/my-bookings'), '/', { ...home, lang: 'sv' })).toEqual({ kind: 'back' })
    expect(historyStep(at('/my-bookings'), '/about', { ...home, lang: 'sv' })).toEqual({
      kind: 'back',
    })
    expect(historyStep(at('/my-bookings'), '/booking', { ...booking, lang: 'sv' })).toEqual({
      kind: 'back',
    })
  })

  it('replaces the entry of a closed dialog that has no entry of this document before it', () => {
    // A direct visit or a reload: Back would leave the site.
    expect(historyStep(at('/my-bookings'), null, { ...home, lang: 'sv' })).toEqual({
      kind: 'replace',
      url: '/',
    })
    expect(historyStep(at('/my-bookings', '?lang=en'), null, { ...home, lang: 'en' })).toEqual({
      kind: 'replace',
      url: '/?lang=en',
    })
    // The entry before shows another view than the one now showing.
    expect(historyStep(at('/my-bookings'), '/', { ...booking, lang: 'sv' })).toEqual({
      kind: 'replace',
      url: '/booking',
    })
  })

  it('never rewrites a path that is not the shell’s', () => {
    expect(historyStep(at('/login'), null, { ...booking, lang: 'en' })).toEqual({ kind: 'none' })
    expect(historyStep(at('/login'), '/', { ...home, lang: 'en' })).toEqual({ kind: 'none' })
  })
})

describe('myBookingsEntry', () => {
  it('names the dialog’s entry from the address it opens over', () => {
    expect(myBookingsEntry(at('/'), 'sv')).toBe('/my-bookings')
    expect(myBookingsEntry(at('/booking', '?mode=dark'), 'en')).toBe(
      '/my-bookings?mode=dark&lang=en',
    )
    expect(myBookingsEntry(at('/', '', '#keep=1'), 'sv')).toBe('/my-bookings')
  })

  it('adds no entry when the address is the dialog’s already or not the shell’s', () => {
    expect(myBookingsEntry(at('/my-bookings'), 'sv')).toBeNull()
    expect(myBookingsEntry(at('/login'), 'sv')).toBeNull()
  })
})

describe('entry origin', () => {
  const state = entryState({ path: '/booking', document: 1731250000000.5 })

  it('survives the structured clone the browser stores', () => {
    expect(entryOrigin(structuredClone(state), 1731250000000.5)).toBe('/booking')
  })

  it('is not trusted in another document, where Back may reload or leave', () => {
    expect(entryOrigin(state, 1731250009999)).toBeNull()
  })

  it.each([
    null,
    undefined,
    'siteOrigin',
    {},
    { siteOrigin: '/' },
    { siteOrigin: { path: 7, document: 1731250000000.5 } },
    { siteOrigin: { document: 1731250000000.5 } },
  ])('reads no origin from %j', (value) => {
    expect(entryOrigin(value, 1731250000000.5)).toBeNull()
  })
})

import { describe, expect, it, vi } from 'vitest'
import { entryState } from '../../modules/public-web/src/app/siteHistory'
import {
  BACK_TIMEOUT_MS,
  createSiteHistoryDriver,
  type AddressedState,
  type HistoryBrowser,
} from '../../modules/public-web/src/app/siteHistoryDriver'

const home: AddressedState = { view: 'home', myBookingsOpen: false, lang: 'sv' }
const booking: AddressedState = { view: 'booking', myBookingsOpen: false, lang: 'sv' }
const dialog: AddressedState = { view: 'home', myBookingsOpen: true, lang: 'sv' }

/** This document among those of the session history. */
const DOCUMENT = 1

type ScrollRestoration = 'auto' | 'manual'

interface Entry {
  url: string
  state: unknown
  /** Scroll restoration belongs to the entry: `history.scrollRestoration` reads and writes the one
   * the address rests on, and an entry pushed from it starts with the same. */
  scrollRestoration: ScrollRestoration
}

// A session history a test can step through: entries with their state and scroll restoration, the
// index the address rests on, and timers that fire only when told to. `history.back()` is
// asynchronous in a browser, so the fake only counts the call: `arrive` moves the address and
// `popstate` delivers the event.
function drive(
  start: string,
  initial: AddressedState,
  startState: unknown = null,
  startScrollRestoration: ScrollRestoration = 'auto',
) {
  const entries: Entry[] = [
    { url: start, state: startState, scrollRestoration: startScrollRestoration },
  ]
  let index = 0
  let state = initial
  let nextTimer = 1
  const timers = new Map<number, { readonly handler: () => void; readonly timeout: number }>()
  const addresses: string[] = []
  const entry = (): Entry => {
    const current = entries[index]
    if (current === undefined) throw new Error('The address rests on no entry')
    return current
  }
  const at = (): URL => new URL(entry().url, 'https://site.example')
  const push = (url: string, data: unknown): void => {
    const scrollRestoration = entry().scrollRestoration
    entries.splice(index + 1, entries.length, { url, state: data, scrollRestoration })
    index++
  }
  const history = {
    get state(): unknown {
      return entry().state
    },
    get scrollRestoration(): ScrollRestoration {
      return entry().scrollRestoration
    },
    set scrollRestoration(mode: ScrollRestoration) {
      entry().scrollRestoration = mode
    },
    pushState: vi.fn((data: unknown, _unused: string, url: string) => {
      push(url, structuredClone(data))
    }),
    replaceState: vi.fn((data: unknown, _unused: string, url: string) => {
      const current = entry()
      current.url = url
      current.state = structuredClone(data)
    }),
    back: vi.fn(),
  }
  const browser: HistoryBrowser = {
    location: {
      get pathname() {
        return at().pathname
      },
      get search() {
        return at().search
      },
      get hash() {
        return at().hash
      },
    },
    history,
    document: DOCUMENT,
    setTimeout: (handler, timeout) => {
      timers.set(nextTimer, { handler, timeout })
      return nextTimer++
    },
    clearTimeout: (id) => {
      timers.delete(id)
    },
  }
  const driver = createSiteHistoryDriver(
    browser,
    () => state,
    (address) => addresses.push(address),
  )
  /** The app's "Mina bokningar" button: the entry first, then the state that shows the dialog. Its
   * render follows at once; the effect that tells the driver comes later (`effect`). */
  const pressDialogButton = (): void => {
    driver.enterDialog(state.lang)
    state = { ...state, myBookingsOpen: true }
  }
  return {
    driver,
    history,
    timers,
    addresses,
    urls: (): string[] => entries.map((each) => each.url),
    scrollRestorations: (): ScrollRestoration[] => entries.map((each) => each.scrollRestoration),
    address: (): string => entry().url,
    /** The visitor chooses a state: the app renders it and its effect tells the driver. */
    choose: (next: AddressedState): void => {
      state = next
      driver.follow(next)
    },
    pressDialogButton,
    /** The effect of the latest render tells the driver the state showing. */
    effect: (): void => driver.follow(state),
    /** The button, and the effect of the render that shows the dialog. */
    openDialog: (): void => {
      pressDialogButton()
      driver.follow(state)
    },
    /** The address moves along the session history, as after Back, Forward or `history.back()`. */
    arrive: (delta: number): void => {
      index += delta
    },
    /** A navigation the driver did not make: a fragment link, another part of the app. */
    visit: (url: string): void => {
      push(url, null)
    },
    /** The `popstate` event: the app shows what the driver answers. */
    popstate: (): ReturnType<typeof driver.traversed> => {
      const next = driver.traversed(state)
      if (next !== null) state = { ...next, lang: state.lang }
      return next
    },
    fireTimers: (): void => {
      for (const [id, timer] of [...timers]) {
        timers.delete(id)
        timer.handler()
      }
    },
  }
}

describe('a change the visitor makes', () => {
  it('pushes one entry for a change of view and reports the new address once', () => {
    const site = drive('/?mode=light', home)
    site.choose(booking)
    site.choose(booking)
    expect(site.urls()).toEqual(['/?mode=light', '/booking?mode=light'])
    expect(site.history.pushState).toHaveBeenCalledExactlyOnceWith(
      entryState({ path: '/', document: DOCUMENT }),
      '',
      '/booking?mode=light',
    )
    expect(site.addresses).toEqual(['/booking?mode=light'])
  })

  it('replaces the entry for a change of language and keeps its state', () => {
    const site = drive('/', home)
    site.choose(booking)
    site.choose({ ...booking, lang: 'en' })
    expect(site.urls()).toEqual(['/', '/booking?lang=en'])
    expect(site.history.replaceState).toHaveBeenCalledExactlyOnceWith(
      entryState({ path: '/', document: DOCUMENT }),
      '',
      '/booking?lang=en',
    )
    expect(site.addresses).toEqual(['/booking', '/booking?lang=en'])
  })

  it('touches nothing at a path that is not the shell’s', () => {
    const site = drive('/login', home, null, 'manual')
    site.choose({ ...booking, lang: 'en' })
    site.openDialog()
    site.choose({ ...booking, lang: 'en' })
    expect(site.urls()).toEqual(['/login'])
    expect(site.history.scrollRestoration).toBe('manual')
    expect(site.history.pushState).not.toHaveBeenCalled()
    expect(site.history.replaceState).not.toHaveBeenCalled()
    expect(site.addresses).toEqual([])
  })
})

describe('the document the driver starts in', () => {
  it('gives scroll restoration back to an entry a dialog was opened from and never returned to', () => {
    // The visitor left the site from the dialog and came back to this entry by a document load:
    // no popstate tells the driver.
    const site = drive('/booking', booking, null, 'manual')
    expect(site.history.scrollRestoration).toBe('auto')
    expect(site.history.replaceState).not.toHaveBeenCalled()
  })

  it('leaves the entry of the dialog itself without scroll restoration', () => {
    const site = drive('/my-bookings', dialog, null, 'manual')
    expect(site.history.scrollRestoration).toBe('manual')
  })
})

describe('the dialog a button opens', () => {
  it('gets an entry of its own, and the page under it leaves scroll restoration', () => {
    const site = drive('/?lang=en', { ...home, lang: 'en' })
    site.openDialog()
    expect(site.urls()).toEqual(['/?lang=en', '/my-bookings?lang=en'])
    expect(site.scrollRestorations()).toEqual(['manual', 'manual'])
    expect(site.addresses).toEqual(['/my-bookings?lang=en'])
    site.driver.enterDialog('en')
    expect(site.history.pushState).toHaveBeenCalledOnce()
  })

  it('is left by one step back, with a timer of 1000 ms behind it', () => {
    const site = drive('/', home)
    site.openDialog()
    site.choose(home)
    expect(site.history.back).toHaveBeenCalledOnce()
    expect(site.history.replaceState).not.toHaveBeenCalled()
    expect(site.address()).toBe('/my-bookings')
    expect(BACK_TIMEOUT_MS).toBe(1000)
    expect([...site.timers.values()].map((timer) => timer.timeout)).toEqual([BACK_TIMEOUT_MS])
  })

  it('needs nothing more when the popstate of that step arrives: the timer is dropped', () => {
    const site = drive('/', home)
    site.openDialog()
    site.choose(home)
    site.arrive(-1)
    expect(site.popstate()).toBe(home)
    expect(site.timers.size).toBe(0)
    site.fireTimers()
    expect(site.history.replaceState).not.toHaveBeenCalled()
    expect(site.history.pushState).toHaveBeenCalledOnce()
    expect(site.history.back).toHaveBeenCalledOnce()
    expect(site.history.scrollRestoration).toBe('auto')
    expect(site.urls()).toEqual(['/', '/my-bookings'])
    expect(site.address()).toBe('/')
    expect(site.addresses).toEqual(['/my-bookings', '/'])
  })

  it('has its entry replaced when no popstate arrives before the timer fires', () => {
    const site = drive('/', home)
    site.openDialog()
    site.choose(home)
    site.fireTimers()
    expect(site.history.replaceState).toHaveBeenCalledExactlyOnceWith(
      entryState({ path: '/', document: DOCUMENT }),
      '',
      '/',
    )
    expect(site.history.back).toHaveBeenCalledOnce()
    expect(site.history.scrollRestoration).toBe('auto')
    expect(site.urls()).toEqual(['/', '/'])
    expect(site.addresses).toEqual(['/my-bookings', '/'])
    expect(site.timers.size).toBe(0)
  })

  it('has its entry replaced by the state showing when the timer fires, not the one that closed it', () => {
    const site = drive('/', home)
    site.openDialog()
    site.choose(home)
    site.choose(booking)
    expect(site.history.pushState).toHaveBeenCalledOnce()
    site.fireTimers()
    expect(site.urls()).toEqual(['/', '/booking'])
    expect(site.history.replaceState).toHaveBeenCalledOnce()
  })

  it('holds a choice made while the step back is under way, then lets the address follow it', () => {
    const site = drive('/', home)
    site.openDialog()
    site.choose(home)
    site.choose(booking)
    expect(site.history.pushState).toHaveBeenCalledOnce()
    site.arrive(-1)
    expect(site.popstate()).toBe(booking)
    expect(site.urls()).toEqual(['/', '/booking'])
    expect(site.history.replaceState).not.toHaveBeenCalled()
  })

  it('is replaced, not stepped back from, when another document pushed its entry', () => {
    // A reload at /my-bookings: the entry before may be another site.
    const site = drive('/my-bookings', dialog, entryState({ path: '/', document: DOCUMENT + 1 }))
    site.choose(home)
    expect(site.history.back).not.toHaveBeenCalled()
    expect(site.urls()).toEqual(['/'])
    expect(site.timers.size).toBe(0)
  })

  it('drops the timer when the app leaves', () => {
    const site = drive('/', home)
    site.openDialog()
    site.choose(home)
    site.driver.dispose()
    expect(site.timers.size).toBe(0)
  })
})

describe('the dialog reopened while the step back from it is under way', () => {
  // Escape, then Enter on the button before the popstate of `history.back()` has arrived: the
  // address still rests on the entry of the dialog that was closed.
  const reopened = (): ReturnType<typeof drive> => {
    const site = drive('/', home)
    site.openDialog()
    site.choose(home)
    site.openDialog()
    expect(site.history.pushState).toHaveBeenCalledOnce()
    expect(site.address()).toBe('/my-bookings')
    return site
  }

  it('gets its entry once the step has arrived, so Back closes it and stays on the site', () => {
    const site = reopened()
    site.arrive(-1)
    expect(site.popstate()).toEqual(dialog)
    expect(site.history.pushState).toHaveBeenCalledTimes(2)
    expect(site.history.pushState).toHaveBeenLastCalledWith(
      entryState({ path: '/', document: DOCUMENT }),
      '',
      '/my-bookings',
    )
    expect(site.urls()).toEqual(['/', '/my-bookings'])
    expect(site.address()).toBe('/my-bookings')
    expect(site.scrollRestorations()).toEqual(['manual', 'manual'])
    expect(site.history.replaceState).not.toHaveBeenCalled()
    // The address is the one it was before the step: the head has nothing to follow.
    expect(site.addresses).toEqual(['/my-bookings'])
    // Back from the new entry is a step within the site.
    site.arrive(-1)
    expect(site.popstate()).toEqual({ view: 'home', myBookingsOpen: false })
    expect(site.address()).toBe('/')
    expect(site.addresses).toEqual(['/my-bookings', '/'])
  })

  it('gets it also when the step arrives before the effect of the render that shows it', () => {
    const site = drive('/', home)
    site.openDialog()
    site.choose(home)
    site.pressDialogButton()
    site.arrive(-1)
    site.popstate()
    expect(site.urls()).toEqual(['/', '/my-bookings'])
    expect(site.address()).toBe('/my-bookings')
    site.effect()
    expect(site.history.pushState).toHaveBeenCalledTimes(2)
    expect(site.history.replaceState).not.toHaveBeenCalled()
    expect(site.history.back).toHaveBeenCalledOnce()
  })

  it('keeps the entry it never left when the step times out', () => {
    const site = reopened()
    site.fireTimers()
    expect(site.urls()).toEqual(['/', '/my-bookings'])
    expect(site.address()).toBe('/my-bookings')
    expect(site.history.pushState).toHaveBeenCalledOnce()
    expect(site.history.replaceState).not.toHaveBeenCalled()
    // Closing it later is one step back again.
    site.choose(home)
    expect(site.history.back).toHaveBeenCalledTimes(2)
  })

  it('gets no entry when it was closed again before the step arrived', () => {
    const site = reopened()
    site.choose(home)
    site.arrive(-1)
    expect(site.popstate()).toBe(home)
    expect(site.history.pushState).toHaveBeenCalledOnce()
    expect(site.address()).toBe('/')
    expect(site.history.scrollRestoration).toBe('auto')
  })
})

describe('a state rendered before the button was pressed', () => {
  // "Mina bokningar" while its chunk loads, then "Boka tid": the chunk resolves, the entry is
  // pushed, and only then does the effect of the booking render reach the driver.
  it('does not replace the entry the dialog was just given', () => {
    const site = drive('/', home)
    site.pressDialogButton()
    site.driver.follow(booking)
    expect(site.history.replaceState).not.toHaveBeenCalled()
    expect(site.urls()).toEqual(['/', '/my-bookings'])
    site.choose({ ...booking, myBookingsOpen: true })
    expect(site.urls()).toEqual(['/', '/my-bookings'])
    expect(site.history.pushState).toHaveBeenCalledOnce()
    // Once the dialog has shown, a state without it is the visitor closing it: the entry was
    // pushed from the start view, so it becomes the booking view's.
    site.choose(booking)
    expect(site.urls()).toEqual(['/', '/booking'])
    expect(site.history.replaceState).toHaveBeenCalledOnce()
    expect(site.history.back).not.toHaveBeenCalled()
  })

  it('is not expected of a dialog that already shows: its closing is followed at once', () => {
    // A customer link opened the dialog over `/`; the driver has heard of it.
    const site = drive('/', home)
    site.choose(dialog)
    site.driver.enterDialog('sv')
    expect(site.urls()).toEqual(['/', '/my-bookings'])
    site.choose(home)
    expect(site.history.back).toHaveBeenCalledOnce()
  })
})

describe('a step through the session history', () => {
  it('shows the view of the address it arrives at, without a further step', () => {
    const site = drive('/', home)
    site.choose(booking)
    site.arrive(-1)
    expect(site.popstate()).toEqual({ view: 'home', myBookingsOpen: false })
    site.arrive(1)
    expect(site.popstate()).toEqual({ view: 'booking', myBookingsOpen: false })
    expect(site.history.pushState).toHaveBeenCalledOnce()
    expect(site.history.replaceState).not.toHaveBeenCalled()
    expect(site.history.back).not.toHaveBeenCalled()
    expect(site.addresses).toEqual(['/booking', '/', '/booking'])
  })

  it('closes the dialog on Back, reopens it on Forward, and gives the page its scroll restoration back', () => {
    const site = drive('/booking', booking)
    site.openDialog()
    site.arrive(-1)
    expect(site.popstate()).toEqual({ view: 'booking', myBookingsOpen: false })
    expect(site.scrollRestorations()).toEqual(['auto', 'manual'])
    expect(site.history.back).not.toHaveBeenCalled()
    site.arrive(1)
    expect(site.popstate()).toEqual({ view: 'booking', myBookingsOpen: true })
    expect(site.urls()).toEqual(['/booking', '/my-bookings'])
    // The entry that holds the dialog stays without it.
    expect(site.scrollRestorations()).toEqual(['auto', 'manual'])
  })

  it('keeps the interface language at an entry that was left in the other one', () => {
    const site = drive('/?lang=en', { ...home, lang: 'en' })
    site.choose({ ...booking, lang: 'en' })
    site.choose(booking)
    expect(site.urls()).toEqual(['/?lang=en', '/booking'])
    site.arrive(-1)
    expect(site.popstate()).toEqual({ view: 'home', myBookingsOpen: false })
    expect(site.urls()).toEqual(['/', '/booking'])
  })

  it('changes nothing for a step within one place: the fragment of a link-opened dialog', () => {
    const site = drive('/', dialog)
    site.visit('/#privacy-preferences')
    expect(site.popstate()).toBe(dialog)
    expect(site.history.pushState).not.toHaveBeenCalled()
    expect(site.history.replaceState).not.toHaveBeenCalled()
    expect(site.addresses).toEqual([])
  })

  it('decides nothing at a path that is not the shell’s', () => {
    const site = drive('/', home)
    site.visit('/login')
    expect(site.popstate()).toBeNull()
    expect(site.history.pushState).not.toHaveBeenCalled()
    expect(site.history.replaceState).not.toHaveBeenCalled()
    expect(site.addresses).toEqual([])
  })
})

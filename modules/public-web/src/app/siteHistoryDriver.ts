// Applies the decisions of siteHistory.ts to the browser's session history. Everything it touches
// comes in through `HistoryBrowser`, so a test can stand in for the browser; the app passes
// `window`'s own objects (App.tsx).

import type { Lang } from '../i18n/index'
import {
  entryOrigin,
  entryState,
  historyStep,
  myBookingsEntry,
  sitePlace,
  viewStateAfterTraversal,
  type SiteLocation,
  type SiteViewState,
} from './siteHistory'

/** How long the address may take to follow `history.back()` before the dialog's entry is replaced
 * instead: a step consumed by an embedded frame's own history never reaches this document. */
export const BACK_TIMEOUT_MS = 1000

/** What the address names: the view, the dialog and the interface language. */
export type AddressedState = SiteViewState & { readonly lang: Lang }

export interface HistoryBrowser {
  /** The live address (`window.location`). */
  readonly location: SiteLocation
  /** The session history (`window.history`). */
  readonly history: {
    readonly state: unknown
    scrollRestoration: 'auto' | 'manual'
    pushState(data: unknown, unused: string, url: string): void
    replaceState(data: unknown, unused: string, url: string): void
    back(): void
  }
  /** Tells this document from every other in the session history (`performance.timeOrigin`). */
  readonly document: number
  setTimeout(handler: () => void, timeout: number): number
  clearTimeout(id: number): void
}

export interface SiteHistoryDriver {
  /** Brings the address in step with a state the app has rendered; the states arrive in the order
   * they were rendered. While a step back of the driver's own is under way it waits: `traversed`
   * settles the address when that step arrives. A state that still shows the dialog closed after
   * `enterDialog` was rendered before the button was pressed and is passed over. */
  follow(state: AddressedState): void
  /** Gives the dialog a button opens an entry of its own, in `lang`. The caller opens the dialog
   * next. While a step back of the driver's own is under way the entry waits for that step to
   * settle: the address still rests on the entry of the dialog that was closed. */
  enterDialog(lang: Lang): void
  /** A `popstate` arrived: the view state to show now, or null at a path that is not the
   * shell's. `current` is the state showing. */
  traversed(current: AddressedState): SiteViewState | null
  /** Drops the timer behind a step back that has not arrived. */
  dispose(): void
}

export function createSiteHistoryDriver(
  browser: HistoryBrowser,
  /** The state of the latest render, read when the timer behind a step back fires. */
  latest: () => AddressedState,
  /** Told the new path and query whenever they have changed: the document head follows. */
  onAddress: (address: string) => void,
): SiteHistoryDriver {
  const addressNow = (): string => browser.location.pathname + browser.location.search
  let address = addressNow()
  let place = sitePlace(browser.location.pathname)
  let pendingBack: number | null = null
  // Whether the last state `follow` heard of showed the dialog.
  let dialogShown = false
  // `enterDialog` has run and no state showing the dialog has followed yet.
  let dialogExpected = false
  // `enterDialog` ran during a step back of the driver's own: the entry is still to be pushed.
  let dialogWaiting = false

  const noteAddress = (): void => {
    const current = addressNow()
    if (current === address) return
    address = current
    place = sitePlace(browser.location.pathname)
    onAddress(current)
  }
  const pushEntry = (url: string): void => {
    browser.history.pushState(
      entryState({ path: browser.location.pathname, document: browser.document }),
      '',
      url,
    )
    noteAddress()
  }
  // An entry that holds the dialog, and the one it was opened from, opt out of the browser's scroll
  // restoration (enterDialog): leaving the dialog must not move the page under it. Every other
  // entry the address rests on has it.
  const resumeScrollRestoration = (): void => {
    if (sitePlace(browser.location.pathname) !== 'my-bookings')
      browser.history.scrollRestoration = 'auto'
  }
  const pushDialogEntry = (lang: Lang): void => {
    const entry = myBookingsEntry(browser.location, lang)
    if (entry === null) return
    // Set on the entry the dialog opens from; the entry pushed from it takes the same.
    browser.history.scrollRestoration = 'manual'
    pushEntry(entry)
  }
  // A step back of the driver's own has settled, by its `popstate` or by its timer, with `state`
  // showing. A dialog asked for meanwhile gets its entry now, unless it has been closed again: it
  // shows, or the state that shows it is still to come.
  const settleDialog = (state: AddressedState): void => {
    if (!dialogWaiting) return
    dialogWaiting = false
    if (state.myBookingsOpen || dialogExpected) pushDialogEntry(state.lang)
  }
  const sync = (next: AddressedState, mayGoBack: boolean): void => {
    const step = historyStep(
      browser.location,
      mayGoBack ? entryOrigin(browser.history.state, browser.document) : null,
      next,
    )
    switch (step.kind) {
      case 'none':
        return
      case 'back':
        // The entry before this one is this document's, so `popstate` follows and settles this.
        pendingBack = browser.setTimeout(() => {
          pendingBack = null
          // The address never left the closed dialog's entry: a dialog reopened meanwhile keeps
          // it, and `settleDialog` finds nothing to push.
          const state = latest()
          sync(state, false)
          settleDialog(state)
        }, BACK_TIMEOUT_MS)
        browser.history.back()
        return
      case 'replace':
        browser.history.replaceState(browser.history.state, '', step.url)
        resumeScrollRestoration()
        noteAddress()
        return
      case 'push':
        pushEntry(step.url)
    }
  }

  // An entry the dialog was opened from keeps `manual` when the visitor leaves the site from the
  // dialog. A document load that lands on it again (the history menu, two steps back) brings no
  // `popstate`, so the entry resumes here, as `traversed` resumes one it arrives at.
  if (place !== null) resumeScrollRestoration()

  return {
    follow: (state) => {
      if (state.myBookingsOpen) dialogExpected = false
      // Rendered before `enterDialog`: acting on it would replace the entry just pushed.
      else if (dialogExpected) return
      dialogShown = state.myBookingsOpen
      if (pendingBack === null) sync(state, true)
    },
    enterDialog: (lang) => {
      const waits = pendingBack !== null
      if (!waits && myBookingsEntry(browser.location, lang) === null) return
      // A dialog `follow` already knows open has no earlier state on its way.
      dialogExpected = !dialogShown
      if (waits) dialogWaiting = true
      else pushDialogEntry(lang)
    },
    traversed: (current) => {
      const ownStep = pendingBack !== null
      if (pendingBack !== null) {
        browser.clearTimeout(pendingBack)
        pendingBack = null
      }
      const arrived = viewStateAfterTraversal(place, browser.location.pathname, current)
      if (arrived === null) {
        dialogWaiting = false
        return null
      }
      resumeScrollRestoration()
      // The step the driver took itself, to leave a closed dialog's entry, decides nothing: what
      // the visitor has chosen since stays, and the address follows it.
      const next = ownStep ? current : arrived
      // The interface language stays: the entry's own `lang` gives way to it.
      sync({ view: next.view, myBookingsOpen: next.myBookingsOpen, lang: current.lang }, false)
      if (ownStep) settleDialog(current)
      noteAddress()
      return next
    },
    dispose: () => {
      if (pendingBack !== null) browser.clearTimeout(pendingBack)
    },
  }
}

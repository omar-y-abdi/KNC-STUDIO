// Applies siteHistory.ts to the session history through `HistoryBrowser` (`window` in App.tsx).

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

export type AddressedState = SiteViewState & { readonly lang: Lang }

export interface HistoryBrowser {
  readonly location: SiteLocation
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
  /** Brings the address in step with a rendered state. Waits while the driver's own step back is
   * under way; passes over a state rendered before `enterDialog` that still shows it closed. */
  follow(state: AddressedState): void
  /** Pushes the button-opened dialog's own entry; the caller opens the dialog next. During the
   * driver's own step back, the push waits for that step to settle. */
  enterDialog(lang: Lang): void
  /** On `popstate`: the view state to show, or null at a path that is not the shell's. */
  traversed(current: AddressedState): SiteViewState | null
  dispose(): void
}

export function createSiteHistoryDriver(
  browser: HistoryBrowser,
  /** Read when the timer behind a step back fires. */
  latest: () => AddressedState,
  /** Gets the new path and query whenever they change. */
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
  // The dialog's entry and the one it opens from opt out of scroll restoration (pushDialogEntry),
  // so leaving the dialog does not move the page under it; every other entry has it.
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
  // After the driver's own step back settles: a dialog asked for meanwhile gets its entry now,
  // unless it has been closed again.
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
          // The address never left the closed dialog's entry: a dialog reopened meanwhile keeps it.
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

  // An entry left from the dialog for another site keeps `manual`; a document load that lands on it
  // again brings no `popstate`, so it resumes here.
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
      // The driver's own step back decides nothing: what the visitor chose since stays.
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

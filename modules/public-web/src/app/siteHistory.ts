// Browser history of the public shell. The address names one of three places: the start view (`/`
// and `/about`), the booking view (`/booking`) and the "Mina bokningar" dialog (`/my-bookings`),
// which lies over whichever view was showing. Any other path is not this shell's: it says nothing
// about the view and is never rewritten. Everything here is pure: App reads the address, applies
// the answer and listens for `popstate`.
//
// What `viewStateAfterTraversal` answers, for a step through history (Back, Forward, a fragment):
//  - a step that arrives in another place shows what that place names;
//  - a step within one place (only the fragment or the query differs) changes nothing, so a dialog
//    a customer link opened over `/` survives the fragment step that delivered the link.
//
// What `historyStep` answers:
//  - the view decides between `/` and `/booking`, and a change of view pushes one entry;
//  - a dialog at `/my-bookings` keeps that address while it is open. Once it has closed, the address
//    goes back to the entry the dialog was opened from when this document pushed it from the view
//    now showing; otherwise the dialog's entry is replaced by the view's address;
//  - a dialog opened by a customer link has no entry of its own, so the address stays the view's;
//  - the `lang` parameter follows the interface language: `lang=en` in English, none in Swedish
//    (an explicit `lang=sv` is left as it is).

import type { Lang } from '../i18n/index'
import { nativePublicPath } from '../site/routeMetadata'
import type { View } from './shared'

export type SitePlace = 'home' | 'booking' | 'my-bookings'

export interface SiteViewState {
  readonly view: View
  readonly myBookingsOpen: boolean
}

export interface SiteLocation {
  readonly pathname: string
  readonly search: string
  readonly hash: string
}

export type HistoryStep =
  | { readonly kind: 'none' }
  | { readonly kind: 'replace'; readonly url: string }
  | { readonly kind: 'push'; readonly url: string }
  | { readonly kind: 'back' }

/** Where a pushed entry came from: the path it was pushed from and the document that pushed it. */
export interface EntryOrigin {
  readonly path: string
  readonly document: number
}

const PLACE_PATHS: Readonly<Record<SitePlace, string>> = {
  home: '/',
  booking: '/booking',
  'my-bookings': '/my-bookings',
}

const ORIGIN_KEY = 'siteOrigin'

export function sitePlace(pathname: string): SitePlace | null {
  switch (nativePublicPath(pathname)) {
    case '/':
    case '/about':
      return 'home'
    case '/booking':
      return 'booking'
    case '/my-bookings':
      return 'my-bookings'
    case null:
      return null
  }
}

export function viewStateForPath(pathname: string, view: View): SiteViewState | null {
  switch (sitePlace(pathname)) {
    case 'my-bookings':
      return { view, myBookingsOpen: true }
    case 'booking':
      return { view: 'booking', myBookingsOpen: false }
    case 'home':
      return { view: 'home', myBookingsOpen: false }
    case null:
      return null
  }
}

export function viewStateAfterTraversal(
  from: SitePlace | null,
  pathname: string,
  current: SiteViewState,
): SiteViewState | null {
  const place = sitePlace(pathname)
  if (place === null) return null
  return place === from ? current : viewStateForPath(pathname, current.view)
}

export function searchWithLanguage(search: string, lang: Lang): string {
  const params = new URLSearchParams(search)
  if ((params.get('lang') === 'en' ? 'en' : 'sv') === lang) return search
  if (lang === 'en') params.set('lang', 'en')
  else params.delete('lang')
  const next = params.toString()
  return next === '' ? '' : `?${next}`
}

export function historyStep(
  at: SiteLocation,
  cameFrom: string | null,
  state: SiteViewState & { readonly lang: Lang },
): HistoryStep {
  const place = sitePlace(at.pathname)
  if (place === null) return { kind: 'none' }
  const search = searchWithLanguage(at.search, state.lang)
  const target: SitePlace =
    place === 'my-bookings' && state.myBookingsOpen
      ? place
      : state.view === 'booking'
        ? 'booking'
        : 'home'
  if (place === target)
    return search === at.search
      ? { kind: 'none' }
      : { kind: 'replace', url: at.pathname + search + at.hash }
  if (place !== 'my-bookings') return { kind: 'push', url: PLACE_PATHS[target] + search }
  return cameFrom !== null && sitePlace(cameFrom) === target
    ? { kind: 'back' }
    : { kind: 'replace', url: PLACE_PATHS[target] + search }
}

export function myBookingsEntry(at: SiteLocation, lang: Lang): string | null {
  const place = sitePlace(at.pathname)
  return place === null || place === 'my-bookings'
    ? null
    : PLACE_PATHS['my-bookings'] + searchWithLanguage(at.search, lang)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function entryState(origin: EntryOrigin): Record<string, EntryOrigin> {
  return { [ORIGIN_KEY]: origin }
}

export function entryOrigin(state: unknown, document: number): string | null {
  const origin = isRecord(state) ? state[ORIGIN_KEY] : null
  return isRecord(origin) && typeof origin['path'] === 'string' && origin['document'] === document
    ? origin['path']
    : null
}

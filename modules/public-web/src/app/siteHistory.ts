// Browser history of the public shell; pure, App applies it. A path that is not this shell's is
// never rewritten. A step within one place changes nothing, so a dialog a customer link opened
// over `/` survives the fragment step that delivered the link.

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

/** The path an entry was pushed from, and the pushing document (`HistoryBrowser.document`). */
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

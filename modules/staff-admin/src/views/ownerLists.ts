// Pure decisions shared by the two owner lists in Settings (review moderation and the admin log):
// where the next page starts, what a list holds after a page arrived, what a refused or failed call
// says and how a stored instant reads. No effects: the sections own the state and make the calls.

import { monthLabel, pad2 } from '@bladeblend/public-web/calendar'
import type { Lang } from '@bladeblend/public-web/localization'
import { stockholmWallClockDate } from '@bladeblend/public-web/scheduling-time'
import type { AdminStrings } from '../adminStrings'
import type { AdminError } from '../types'

/** What both lists page by: a row's id and its database timestamp, verbatim. */
export interface KeysetEntry {
  readonly id: string
  readonly createdAt: string
}

/** Where a page starts: just after this entry in newest-first order. */
export interface KeysetCursor {
  readonly before: string
  readonly beforeId: string
}

/** One answer of a list RPC. */
export interface KeysetPage<T extends KeysetEntry> {
  readonly entries: readonly T[]
  readonly hasMore: boolean
}

/** Everything read so far, and where the next page starts (`null`: nothing more to read). */
export interface KeysetList<T extends KeysetEntry> {
  readonly entries: readonly T[]
  readonly next: KeysetCursor | null
}

/**
 * The cursor of the page after `page`: its last entry, timestamp verbatim, while the server says more
 * rows exist. A page that claims more rows but holds none has no entry to continue from, so it ends
 * the list.
 */
export function cursorAfter<T extends KeysetEntry>(page: KeysetPage<T>): KeysetCursor | null {
  const last = page.entries.at(-1)
  return page.hasMore && last !== undefined ? { before: last.createdAt, beforeId: last.id } : null
}

/**
 * The list after `page` arrived. The cursor belongs to the page that was read, not to the rows the
 * list still shows: removing a row from the list afterwards does not move it.
 */
export function appendPage<T extends KeysetEntry>(
  entries: readonly T[],
  page: KeysetPage<T>,
): KeysetList<T> {
  return { entries: [...entries, ...page.entries], next: cursorAfter(page) }
}

export type OwnerListErrorText = Pick<
  AdminStrings,
  'ownerListForbidden' | 'ownerListSessionExpired'
>

/**
 * What a refused or failed call says in the panel's language. A refusal for not being the owner and
 * an ended session have their own sentence; everything else says `fallback`, which names what was
 * attempted.
 */
export function ownerListErrorText(
  error: AdminError,
  fallback: string,
  t: OwnerListErrorText,
): string {
  switch (error.kind) {
    case 'forbidden':
      return t.ownerListForbidden
    case 'auth':
      return t.ownerListSessionExpired
    case 'not_found':
    case 'validation':
    case 'network':
    case 'malformed':
    case 'challenge':
      return fallback
  }
}

/** Put `value` into `template` at `slot` (`{name}`), taking the value literally. */
export function fillSlot(template: string, slot: string, value: string): string {
  return template.replace(slot, () => value)
}

/**
 * "10 november 2026, 14:05": a stored instant in salon time, with its year (a review can be older
 * than a year and the log covers twelve months). Text that is not an instant is returned as it is.
 */
export function instantLabel(lang: Lang, iso: string): string {
  const instant = new Date(iso)
  if (Number.isNaN(instant.getTime())) return iso
  const local = stockholmWallClockDate(instant)
  const day = `${local.getDate()} ${monthLabel(lang, local.getMonth())} ${local.getFullYear()}`
  return `${day}, ${pad2(local.getHours())}:${pad2(local.getMinutes())}`
}

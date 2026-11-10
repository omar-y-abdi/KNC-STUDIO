// Pure decisions shared by the two Settings owner lists (review moderation and the admin log).

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

export interface KeysetPage<T extends KeysetEntry> {
  readonly entries: readonly T[]
  readonly hasMore: boolean
}

/** `next` is null when there is nothing more to read. */
export interface KeysetList<T extends KeysetEntry> {
  readonly entries: readonly T[]
  readonly next: KeysetCursor | null
}

/** A page claiming more rows but holding none ends the list: no entry to continue from. */
export function cursorAfter<T extends KeysetEntry>(page: KeysetPage<T>): KeysetCursor | null {
  const last = page.entries.at(-1)
  return page.hasMore && last !== undefined ? { before: last.createdAt, beforeId: last.id } : null
}

/** The cursor belongs to the page read, so removing a shown row afterwards does not move it. */
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

/** `fallback` names what was attempted. */
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

/** "10 november 2026, 14:05", in salon time and always with the year (the log covers twelve
 * months). Text that is not an instant is returned as it is. */
export function instantLabel(lang: Lang, iso: string): string {
  const instant = new Date(iso)
  if (Number.isNaN(instant.getTime())) return iso
  const local = stockholmWallClockDate(instant)
  const day = `${local.getDate()} ${monthLabel(lang, local.getMonth())} ${local.getFullYear()}`
  return `${day}, ${pad2(local.getHours())}:${pad2(local.getMinutes())}`
}
